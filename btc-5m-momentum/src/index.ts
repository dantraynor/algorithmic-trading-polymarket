/**
 * BTC 5-Minute Momentum Sniper Bot
 *
 * Monitors BTC spot price via Binance WebSocket. At T-10 seconds before each
 * 5-minute window closes, if BTC has moved decisively, buys the winning side
 * (UP or DOWN) on Polymarket before the market fully prices in the outcome.
 */

import Redis from 'ioredis';
import Decimal from 'decimal.js';
import { loadConfig } from './config';
import { logger } from './logger';
import { Config } from './types';
import { MarketDiscovery } from './market-discovery';
import { BinanceFeed } from './binance-feed';
import { MomentumSignal } from './momentum-signal';
import { OrderbookChecker } from './orderbook-checker';
import { TradeExecutor } from './trade-executor';
import { MomentumRiskManager } from './risk-manager';
import { SessionReporter } from './session-reporter';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

const WINDOW_DURATION_SEC = 300;

class BTC5MMomentumBot {
  private config: Config;
  private redis: Redis;
  private marketDiscovery: MarketDiscovery;
  private binanceFeed: BinanceFeed;
  private momentumSignal: MomentumSignal;
  private orderbookChecker: OrderbookChecker;
  private tradeExecutor: TradeExecutor;
  private riskManager: MomentumRiskManager;
  private sessionReporter: SessionReporter;
  private isRunning = false;

  constructor() {
    this.config = loadConfig();

    this.redis = new Redis(this.config.redisSocketPath, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    this.marketDiscovery = new MarketDiscovery(this.config);
    this.binanceFeed = new BinanceFeed(
      this.config.binanceWsUrl,
      this.config.minDirectionBps,
    );
    this.orderbookChecker = new OrderbookChecker(this.config);
    this.momentumSignal = new MomentumSignal(
      this.config,
      this.binanceFeed,
      this.orderbookChecker,
    );
    this.tradeExecutor = new TradeExecutor(this.config, this.redis, this.orderbookChecker);
    this.riskManager = new MomentumRiskManager(this.config, this.redis);
    this.sessionReporter = new SessionReporter(this.riskManager);
  }

  async start(): Promise<void> {
    logger.info('Starting BTC 5-minute momentum sniper', {
      dryRun: this.config.dryRun,
      entrySecondsBefore: this.config.entrySecondsBefore,
      minDirectionBps: this.config.minDirectionBps,
      minEntryPrice: this.config.minEntryPrice,
      maxEntryPrice: this.config.maxEntryPrice,
      maxBetUsdc: this.config.maxBetUsdc,
    });

    // Connect Binance feed
    try {
      await this.binanceFeed.connect();
      logger.info('Binance feed connected, first price received');
    } catch (error: any) {
      logger.error('Failed to connect Binance feed', { error: error.message });
      throw error;
    }

    // Initialize risk manager
    await this.riskManager.initialize();

    // Publish dry-run status for dashboard
    try {
      await this.redis.set('btc5m_momentum:dry_run', this.config.dryRun ? 'true' : 'false');
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
    const secondsRemaining = this.marketDiscovery.getSecondsRemaining();

    await this.riskManager.recordWindow();

    logger.info('Processing window', {
      windowTimestamp: windowTs,
      secondsRemaining: secondsRemaining.toFixed(1),
    });

    // 1. Discover market
    const market = await this.marketDiscovery.discoverCurrentMarket();
    if (!market) {
      logger.debug('No market available for current window');
      await this.riskManager.recordSkip();
      return;
    }

    // 2. Record window open price
    this.binanceFeed.recordWindowOpen(windowTs);

    // 3. Calculate when to evaluate
    const windowCloseMs = (windowTs + WINDOW_DURATION_SEC) * 1000;
    const evaluateAtMs = windowCloseMs - (this.config.entrySecondsBefore * 1000);
    const nowMs = Date.now();

    if (nowMs >= windowCloseMs) {
      logger.debug('Window already closed, skipping');
      await this.riskManager.recordSkip();
      return;
    }

    // 4. Sleep until decision point
    if (nowMs < evaluateAtMs) {
      const sleepMs = evaluateAtMs - nowMs;
      logger.info(`Waiting ${(sleepMs / 1000).toFixed(1)}s until T-${this.config.entrySecondsBefore}s decision point`);
      await this.sleepInterruptible(sleepMs);

      if (!this.isRunning) return;
    }

    // 5. Decision point: evaluate and possibly trade
    // Risk check
    const riskCheck = await this.riskManager.canTrade();
    if (!riskCheck.allowed) {
      logger.info('Trading blocked by risk manager', { reason: riskCheck.reason });
      await this.riskManager.recordSkip();
      return;
    }

    // Health check
    if (!this.binanceFeed.isHealthy()) {
      logger.warn('Binance feed unhealthy, skipping window');
      await this.riskManager.recordSkip();
      return;
    }

    // Evaluate momentum signal
    const decision = await this.momentumSignal.evaluate(market, windowTs);
    if (!decision) {
      logger.info('No momentum signal this window');
      await this.riskManager.recordSkip();

      // Store window state
      await this.storeWindowState(windowTs, false);
      return;
    }

    // 6. Execute trade
    const result = await this.tradeExecutor.executeSingle(decision);

    logger.info('Trade result', {
      success: result.success,
      direction: result.direction,
      price: result.price.toFixed(4),
      size: result.size.toFixed(2),
      latencyMs: result.latencyMs.toFixed(0),
      orderId: result.orderId,
      error: result.error,
    });

    if (!result.success) {
      logger.warn('Trade execution failed', { error: result.error });
      await this.riskManager.recordSkip(result.simResult);
      return;
    }

    // 7. Wait for window to close and determine win/loss
    const timeToClose = windowCloseMs - Date.now();
    if (timeToClose > 0) {
      logger.info(`Waiting ${(timeToClose / 1000).toFixed(1)}s for window to close...`);
      await this.sleepInterruptible(timeToClose + 5000); // +5s buffer for settlement
    }

    // Determine outcome from BTC price
    const directionResult = this.binanceFeed.getDirection(windowTs);
    if (!directionResult) {
      logger.warn('Could not determine window outcome — Binance price unavailable. Skipping win/loss recording.');
      return;
    }

    let won = false;
    if (decision.direction === 'UP') {
      won = directionResult.currentPrice.gt(directionResult.openPrice);
    } else {
      won = directionResult.currentPrice.lt(directionResult.openPrice);
    }

    // 8. Record trade result (use actual/simulated fill price, not limit price)
    const fillPrice = result.price;
    await this.riskManager.recordTrade(
      decision.direction,
      fillPrice,
      result.size,
      won,
      result.simResult,
    );

    // 9. Publish to Redis for dashboard
    const pnl = won
      ? new Decimal(1).minus(fillPrice).mul(result.size)
      : fillPrice.mul(result.size).neg();

    const tradeEvent = {
      strategy: 'btc-5m-momentum',
      market: `BTC ${windowTs}`,
      direction: decision.direction,
      price: fillPrice.toString(),
      size: result.size.toString(),
      pnl: pnl.toString(),
      won,
      btcDeltaBps: decision.deltaBps.toFixed(2),
      timestamp: Date.now(),
      dryRun: this.config.dryRun,
      fillRatio: result.simResult?.fillRatio,
      slippageBps: result.simResult?.slippageBps,
    };

    try {
      await this.redis.publish('results:btc5m_momentum', JSON.stringify(tradeEvent));
      await this.redis.lpush('trades:history', JSON.stringify(tradeEvent));
      await this.redis.ltrim('trades:history', 0, 499);
    } catch (error) {
      logger.error('Failed to publish trade event to Redis');
    }

    // Store window state
    await this.storeWindowState(
      windowTs, true, decision.direction, pnl, won,
      result.simResult?.fillRatio,
      result.simResult?.slippageBps,
    );

    const stats = this.riskManager.getStats();
    logger.info('Window complete', {
      won,
      pnl: pnl.toFixed(4),
      winRate: (stats.winRate * 100).toFixed(1) + '%',
      dailyProfit: stats.dailyProfit.toFixed(2),
      consecutiveLosses: stats.consecutiveLosses,
    });
  }

  private async storeWindowState(
    windowTs: number,
    traded: boolean,
    direction?: string,
    pnl?: Decimal,
    won?: boolean,
    fillRatio?: number,
    slippageBps?: number,
  ): Promise<void> {
    try {
      const dirResult = this.binanceFeed.getDirection(windowTs);
      await this.redis.hmset('btc5m_momentum:window:current', {
        timestamp: windowTs.toString(),
        traded: traded.toString(),
        direction: direction || '',
        deltaBps: dirResult?.deltaBps.toFixed(2) || '0',
        btcOpenPrice: dirResult?.openPrice.toFixed(2) || '0',
        btcCurrentPrice: dirResult?.currentPrice.toFixed(2) || '0',
        pnl: pnl?.toFixed(4) || '0',
        won: (won ?? false).toString(),
        fillRatio: (fillRatio ?? 0).toString(),
        slippageBps: (slippageBps ?? 0).toString(),
      });
    } catch {
      // Non-critical
    }
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

  /**
   * Sleep that can be interrupted by shutdown.
   */
  private async sleepInterruptible(ms: number): Promise<void> {
    const interval = 1000; // Check every second
    let remaining = ms;

    while (remaining > 0 && this.isRunning) {
      const sleepTime = Math.min(remaining, interval);
      await new Promise((resolve) => setTimeout(resolve, sleepTime));
      remaining -= sleepTime;
    }
  }

  async stop(): Promise<void> {
    logger.info('Stopping momentum bot...');
    this.isRunning = false;
    this.sessionReporter.printFinalSummary();
    this.binanceFeed.disconnect();

    try {
      await this.redis.quit();
    } catch {
      // Already closed
    }

    logger.info('Momentum bot stopped');
  }
}

// --- Entry point ---

async function main(): Promise<void> {
  const bot = new BTC5MMomentumBot();

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
