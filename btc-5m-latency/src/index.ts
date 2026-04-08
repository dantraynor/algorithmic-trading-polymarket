/**
 * BTC 5-Minute Latency Arbitrage Bot
 *
 * Exploits the latency between real-time BTC spot prices on exchanges (Binance,
 * Coinbase) and the Chainlink BTC/USD oracle that Polymarket uses to resolve
 * 5-minute binary Up/Down markets. Runs a continuous tick-driven evaluation loop
 * within each window, buying underpriced outcomes when the probability model
 * detects edge.
 */

import Redis from 'ioredis';
import Decimal from 'decimal.js';
import { loadConfig } from './config';
import { logger } from './logger';
import type { Config, WindowPnL } from './types';
import { MarketDiscovery } from './market-discovery';
import { ExchangeFeed } from './exchange-feed';
import { ChainlinkOracle } from './chainlink-oracle';
import { OrderbookChecker } from './orderbook-checker';
import { LatencySignal } from './latency-signal';
import { TradeExecutor } from './trade-executor';
import { LatencyRiskManager } from './risk-manager';
import { WindowTracker } from './window-tracker';
import { SessionReporter } from './session-reporter';
// SQLite persistence — optional, fails gracefully if shared/db not available
let recordTrade: (trade: Record<string, unknown>) => void = () => {};
let updateDailyStats: (date: string, strategy: string, pnl: number, won: boolean, volume: number, dryRun: boolean) => void = () => {};
try {
  const db = require('../../shared/src/db');
  recordTrade = db.recordTrade;
  updateDailyStats = db.updateDailyStats;
} catch { /* SQLite not available in this build context */ }

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

const WINDOW_DURATION_SEC = 300;
const SETTLEMENT_BUFFER_MS = 15000; // Wait 15s after window close for resolution
const RESOLUTION_POLL_INTERVAL_MS = 5000; // Poll Gamma API every 5s for resolution
const RESOLUTION_MAX_WAIT_MS = 180000; // Wait up to 3 minutes for Gamma API resolution
const RISK_CHECK_INTERVAL_MS = 1000; // Check risk every 1s, not every tick

function serializeFills(pnl: WindowPnL) {
  return pnl.fills.map((fill) => ({
    timestamp: fill.timestamp,
    side: fill.side,
    tokenId: fill.tokenId,
    shares: fill.shares.toString(),
    price: fill.price.toString(),
    cost: fill.cost.toString(),
    edge: fill.edge.toString(),
    orderIds: fill.orderIds,
  }));
}

function flattenUnique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const flattened: string[] = [];

  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    flattened.push(value);
  }

  return flattened;
}

function deriveTradeDirection(pnl: WindowPnL): string | undefined {
  const hasUp = pnl.upSharesHeld.gt(0);
  const hasDown = pnl.downSharesHeld.gt(0);

  if (hasUp && hasDown) return 'BOTH';
  if (hasUp) return 'UP';
  if (hasDown) return 'DOWN';
  return undefined;
}

class BTC5MLatencyBot {
  private config: Config;
  private redis: Redis;
  private marketDiscovery: MarketDiscovery;
  private exchangeFeed: ExchangeFeed;
  private chainlinkOracle: ChainlinkOracle;
  private orderbookChecker: OrderbookChecker;
  private latencySignal: LatencySignal;
  private tradeExecutor: TradeExecutor;
  private riskManager: LatencyRiskManager;
  private windowTracker: WindowTracker;
  private sessionReporter: SessionReporter;
  private isRunning = false;

  constructor() {
    this.config = loadConfig();

    this.redis = new Redis(this.config.redisSocketPath, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    this.marketDiscovery = new MarketDiscovery(this.config);
    this.exchangeFeed = new ExchangeFeed(
      this.config.binanceWsUrl,
      this.config.coinbaseWsUrl,
      this.config.volLookbackSec,
    );
    this.chainlinkOracle = new ChainlinkOracle(
      this.config.chainlinkRpcUrl,
      this.config.chainlinkAggregator,
      this.config.chainlinkPollIntervalMs,
    );
    this.orderbookChecker = new OrderbookChecker(this.config);
    this.latencySignal = new LatencySignal(
      this.config,
      this.exchangeFeed,
      this.chainlinkOracle,
      this.orderbookChecker,
    );
    this.tradeExecutor = new TradeExecutor(this.config, this.redis, this.orderbookChecker);
    this.riskManager = new LatencyRiskManager(this.config, this.redis);
    this.windowTracker = new WindowTracker();
    this.sessionReporter = new SessionReporter(this.riskManager);
  }

  async start(): Promise<void> {
    logger.info('Starting BTC 5-minute latency arb bot', {
      dryRun: this.config.dryRun,
      minEdge: this.config.minEdge,
      edgeBuffer: this.config.edgeBuffer,
      kellyMultiplier: this.config.kellyMultiplier,
      maxPositionPerWindow: this.config.maxPositionPerWindow,
      bankroll: this.config.bankroll,
      tickAggregationMs: this.config.tickAggregationMs,
    });

    // Connect exchange feeds (Binance + Coinbase)
    try {
      await this.exchangeFeed.connect();
      logger.info('Exchange feeds connected');
    } catch (error: any) {
      logger.error('Failed to connect exchange feeds', { error: error.message });
      throw error;
    }

    // Start Chainlink oracle polling
    try {
      await this.chainlinkOracle.start();
      logger.info('Chainlink oracle started');
    } catch (error: any) {
      logger.error('Failed to start Chainlink oracle', { error: error.message });
      throw error;
    }

    // Initialize risk manager
    await this.riskManager.initialize();

    // Publish dry-run status for dashboard
    try {
      await this.redis.set('btc5m_latency:dry_run', this.config.dryRun ? 'true' : 'false');
    } catch {
      // Non-critical
    }

    this.isRunning = true;
    await this.mainLoop();
  }

  private async mainLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.processWindow();
      } catch (error: any) {
        logger.error('Error processing window', { error: error.message, stack: error.stack });
      } finally {
        this.sessionReporter.tickWindow();
      }

      // Wait for next window
      if (this.isRunning) {
        await this.waitForNextWindow();
      }
    }
  }

  private async processWindow(): Promise<void> {
    const windowTs = this.marketDiscovery.getCurrentWindowTimestamp();
    const windowCloseMs = (windowTs + WINDOW_DURATION_SEC) * 1000;

    logger.info('Processing window', {
      windowTimestamp: windowTs,
      secondsRemaining: this.marketDiscovery.getSecondsRemaining().toFixed(1),
    });

    // 1. Discover market
    const market = await this.marketDiscovery.discoverCurrentMarket();
    if (!market) {
      logger.debug('No market available for current window');
      return;
    }

    // 2. Record Chainlink price as "Price to Beat"
    const priceToBeat = this.chainlinkOracle.recordWindowPrice(windowTs);
    if (!priceToBeat) {
      logger.warn('No Chainlink price available, skipping window');
      return;
    }

    // 3. Record exchange window open price
    this.exchangeFeed.recordWindowOpen(windowTs);

    // 4. Initialize window tracking
    this.windowTracker.startWindow(windowTs, priceToBeat, market);
    this.riskManager.resetWindowPosition(windowTs);
    this.latencySignal.resetWindow(windowTs);

    // Pre-discover next window's market
    this.marketDiscovery.discoverNextMarket().catch(() => {});

    // 5. Tight evaluation loop
    let lastRiskCheckMs = 0;

    while (this.isRunning) {
      const now = Date.now();
      const timeRemainingSec = (windowCloseMs - now) / 1000;

      // Stop when less than minTimeRemaining seconds left
      if (timeRemainingSec < this.config.minTimeRemaining) {
        break;
      }

      // Skip first seconds of window (price to beat may not be settled)
      if (timeRemainingSec > this.config.maxTimeRemaining) {
        await this.sleep(100);
        continue;
      }

      // Risk check (throttled to once per second)
      if (now - lastRiskCheckMs >= RISK_CHECK_INTERVAL_MS) {
        lastRiskCheckMs = now;

        // Oracle divergence check MUST run before canTrade() so it can
        // self-resolve when prices converge (canTrade() breaks the loop
        // when divergence is active, preventing this check from running).
        const chainlinkPrice = this.chainlinkOracle.getPrice();
        const exchangePrice = this.exchangeFeed.getMedianPrice();
        if (chainlinkPrice && !exchangePrice.stale) {
          this.riskManager.checkOracleDivergence(exchangePrice.median, chainlinkPrice.price);
        }

        const riskCheck = await this.riskManager.canTrade();
        if (!riskCheck.allowed) {
          logger.info('Trading blocked by risk manager', { reason: riskCheck.reason });
          break;
        }
      }

      // Feed health check
      if (!this.exchangeFeed.isHealthy()) {
        await this.sleep(100);
        continue;
      }

      // Evaluate signal
      const decision = await this.latencySignal.evaluate(market, windowTs, timeRemainingSec);

      if (decision) {
        // Execute trade
        const result = await this.tradeExecutor.executeSingle({
          tokenId: decision.tokenId,
          side: decision.side,
          limitPrice: decision.maxPrice,
          shares: decision.shares,
        });

        // ALWAYS update position tracking to prevent runaway submissions.
        // Use actual fill cost on success, intended cost on failure.
        const positionCost = result.success
          ? result.price.mul(result.size)
          : decision.totalCost;
        this.latencySignal.recordFill(decision.side, positionCost);

        if (result.success) {
          const fillCost = result.price.mul(result.size);
          this.windowTracker.recordFill(windowTs, {
            side: decision.side,
            tokenId: decision.tokenId,
            shares: result.size,
            price: result.price,
            edge: decision.edge,
            orderIds: result.orderIds,
          });
          this.riskManager.addWindowPosition(decision.side, fillCost);

          logger.info('Latency trade executed', {
            side: decision.side,
            price: result.price.toFixed(4),
            size: result.size.toFixed(2),
            edge: decision.edge.toFixed(4),
            latencyMs: result.latencyMs.toFixed(0),
          });
        } else {
          logger.warn('Latency trade failed', {
            side: decision.side,
            intendedShares: decision.shares.toFixed(2),
            error: result.error,
          });
        }

        // Record paper trading metrics
        if (result.simResult) {
          this.riskManager.recordPaperFill(result.simResult);
        }
      }

      // Throttle: wait for next tick aggregation period
      await this.sleep(this.config.tickAggregationMs);
    }

    // 6. Store current window state to Redis for dashboard
    await this.storeWindowState(windowTs);

    // 7. Wait for window to close + settlement buffer
    const timeToClose = windowCloseMs - Date.now();
    if (timeToClose > 0) {
      logger.info(`Waiting ${((timeToClose + SETTLEMENT_BUFFER_MS) / 1000).toFixed(0)}s for window close + Chainlink settlement`);
      await this.sleepInterruptible(timeToClose + SETTLEMENT_BUFFER_MS);
    } else {
      await this.sleepInterruptible(SETTLEMENT_BUFFER_MS);
    }

    // 8. Settle window using Gamma API resolution (authoritative)
    const finalChainlink = this.chainlinkOracle.getPrice();
    const hasTraded = this.windowTracker.hasTraded(windowTs);

    // Poll Gamma API for the actual resolved outcome
    let resolvedOutcome: 'UP' | 'DOWN' | null = null;
    const pollStart = Date.now();
    while (Date.now() - pollStart < RESOLUTION_MAX_WAIT_MS) {
      resolvedOutcome = await this.marketDiscovery.fetchResolvedOutcome(windowTs);
      if (resolvedOutcome) break;
      await this.sleep(RESOLUTION_POLL_INTERVAL_MS);
    }

    if (hasTraded) {
      const settlementPrice = finalChainlink?.price || priceToBeat;
      const pnl = this.windowTracker.settleWindow(windowTs, settlementPrice);

      if (resolvedOutcome) {
        // Use Gamma API outcome as the ONLY source of truth
        if (pnl.outcome !== resolvedOutcome) {
          logger.warn('Chainlink disagrees with Gamma API — using Gamma', {
            windowTimestamp: windowTs,
            chainlinkOutcome: pnl.outcome,
            gammaOutcome: resolvedOutcome,
            priceToBeat: priceToBeat.toFixed(2),
            finalChainlink: settlementPrice.toFixed(2),
          });
        }
        pnl.outcome = resolvedOutcome;
        // Calculate P&L from authoritative outcome
        const upPayout = pnl.outcome === 'UP' ? pnl.upSharesHeld : new Decimal(0);
        const downPayout = pnl.outcome === 'DOWN' ? pnl.downSharesHeld : new Decimal(0);
        pnl.grossPnl = upPayout.plus(downPayout).minus(pnl.totalVolume);
      } else {
        // Gamma API unavailable after 3 minutes — do NOT use Chainlink as fallback.
        // Mark as unresolved and assume worst case (loss) for risk management.
        logger.error('Gamma API resolution unavailable after 3 min — recording as UNRESOLVED (worst-case loss)', {
          windowTimestamp: windowTs,
          chainlinkSuggests: pnl.outcome,
          upShares: pnl.upSharesHeld.toFixed(2),
          downShares: pnl.downSharesHeld.toFixed(2),
        });
        // Assume full loss for risk management to avoid corrupting stats with phantom wins
        pnl.grossPnl = pnl.totalVolume.neg();
        pnl.outcome = pnl.outcome; // Keep Chainlink guess in logs but P&L is worst-case
      }

      await this.riskManager.recordWindowResult(pnl);
      await this.publishTradeResult(windowTs, pnl);
    } else {
      const emptyPnl = this.windowTracker.settleWindow(
        windowTs,
        finalChainlink?.price || priceToBeat,
      );
      if (resolvedOutcome) {
        emptyPnl.outcome = resolvedOutcome;
      }
      await this.riskManager.recordWindowResult(emptyPnl);
    }
  }

  private async storeWindowState(windowTs: number): Promise<void> {
    try {
      const w = this.windowTracker.getCurrentWindow(windowTs);
      const chainlink = this.chainlinkOracle.getPrice();
      const exchange = this.exchangeFeed.getMedianPrice();

      await this.redis.hmset('btc5m_latency:window:current', {
        timestamp: windowTs.toString(),
        marketSlug: w?.marketSlug || '',
        conditionId: w?.conditionId || '',
        upTokenId: w?.upTokenId || '',
        downTokenId: w?.downTokenId || '',
        priceToBeat: w?.priceToBeat.toFixed(2) || '0',
        currentBtcPrice: exchange.median.toFixed(2),
        currentChainlinkPrice: chainlink?.price.toFixed(2) || '0',
        upSharesHeld: w?.upSharesHeld.toFixed(2) || '0',
        downSharesHeld: w?.downSharesHeld.toFixed(2) || '0',
        numTrades: (w?.numTrades || 0).toString(),
        totalVolume: w?.totalVolume.toFixed(2) || '0',
        maxEdgeSeen: w?.maxEdgeSeen.toFixed(4) || '0',
        grossPnl: w?.grossPnl.toFixed(4) || '0',
      });
    } catch {
      // Non-critical
    }
  }

  private async publishTradeResult(
    windowTs: number,
    pnl: WindowPnL,
  ): Promise<void> {
    const marketName = pnl.marketSlug || `btc-updown-5m-${windowTs}`;
    const fills = serializeFills(pnl);
    const orderIds = flattenUnique(fills.flatMap((fill) => fill.orderIds));
    const direction = deriveTradeDirection(pnl);

    const tradeEvent = {
      strategy: 'btc-5m-latency',
      market: marketName,
      direction,
      windowTimestamp: windowTs,
      conditionId: pnl.conditionId,
      upTokenId: pnl.upTokenId,
      downTokenId: pnl.downTokenId,
      outcome: pnl.outcome,
      priceToBeat: pnl.priceToBeat.toString(),
      finalPrice: pnl.finalChainlinkPrice?.toString(),
      upShares: pnl.upSharesHeld.toString(),
      downShares: pnl.downSharesHeld.toString(),
      grossPnl: pnl.grossPnl.toString(),
      numTrades: pnl.numTrades,
      totalVolume: pnl.totalVolume.toString(),
      maxEdgeSeen: pnl.maxEdgeSeen.toString(),
      avgEdgeAtFill: pnl.avgEdgeAtFill.toString(),
      fills,
      orderIds,
      timestamp: Date.now(),
      dryRun: this.config.dryRun,
    };

    try {
      await this.redis.publish('results:btc5m_latency', JSON.stringify(tradeEvent));
      await this.redis.lpush('trades:history', JSON.stringify(tradeEvent));
      await this.redis.ltrim('trades:history', 0, 499);
    } catch (error) {
      logger.error('Failed to publish trade event to Redis');
    }

    // Persist to SQLite
    const grossPnlNum = parseFloat(pnl.grossPnl.toString());
    const volumeNum = parseFloat(pnl.totalVolume.toString());
    recordTrade({
      strategy: 'btc-5m-latency',
      market: marketName,
      direction,
      outcome: pnl.outcome ?? undefined,
      shares: parseFloat(pnl.upSharesHeld.plus(pnl.downSharesHeld).toString()),
      cost: volumeNum,
      pnl: grossPnlNum,
      edge: parseFloat(pnl.maxEdgeSeen.toString()),
      dryRun: this.config.dryRun,
      metadata: {
        windowTimestamp: windowTs,
        marketSlug: marketName,
        conditionId: pnl.conditionId,
        upTokenId: pnl.upTokenId,
        downTokenId: pnl.downTokenId,
        priceToBeat: pnl.priceToBeat.toString(),
        finalPrice: pnl.finalChainlinkPrice?.toString(),
        numTrades: pnl.numTrades,
        avgEdgeAtFill: pnl.avgEdgeAtFill.toString(),
        orderIds,
        fills,
      },
      timestamp: Date.now(),
    });

    const today = new Date().toISOString().slice(0, 10);
    const won = grossPnlNum > 0;
    updateDailyStats(today, 'btc-5m-latency', grossPnlNum, won, volumeNum, this.config.dryRun);
  }

  private async waitForNextWindow(): Promise<void> {
    const nextWindowTs = this.marketDiscovery.getNextWindowTimestamp();
    const nowMs = Date.now();
    const nextWindowMs = nextWindowTs * 1000;
    const waitMs = Math.max(0, nextWindowMs - nowMs + 1000); // +1s buffer

    if (waitMs > 0) {
      logger.info(`Waiting ${(waitMs / 1000).toFixed(0)}s for next window`);
      await this.sleepInterruptible(waitMs);
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Sleep that can be interrupted by shutdown.
   */
  private async sleepInterruptible(ms: number): Promise<void> {
    const interval = 1000;
    let remaining = ms;

    while (remaining > 0 && this.isRunning) {
      const sleepTime = Math.min(remaining, interval);
      await new Promise((resolve) => setTimeout(resolve, sleepTime));
      remaining -= sleepTime;
    }
  }

  async stop(): Promise<void> {
    logger.info('Stopping latency arb bot...');
    this.isRunning = false;
    this.sessionReporter.printFinalSummary();
    this.exchangeFeed.disconnect();
    this.chainlinkOracle.stop();

    try {
      await this.redis.quit();
    } catch {
      // Already closed
    }

    logger.info('Latency arb bot stopped');
  }
}

// --- Entry point ---

async function main(): Promise<void> {
  const bot = new BTC5MLatencyBot();

  // Graceful shutdown
  const shutdown = async () => {
    await bot.stop();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  try {
    await bot.start();
  } catch (error: any) {
    logger.error('Fatal error', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

main();
