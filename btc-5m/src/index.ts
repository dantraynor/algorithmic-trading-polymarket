/**
 * BTC 5-Minute Box Spread Arbitrage
 * Buys both UP and DOWN tokens when combined cost < $1.00 for guaranteed profit.
 *
 * Each window:
 * 1. Discover market (Gamma API) → get UP/DOWN token IDs
 * 2. Wait until entry window (30-250s into window)
 * 3. Scan order books for both sides
 * 4. If combined ask < threshold → execute both sides
 * 5. Record guaranteed profit
 */

import Redis from 'ioredis';
import Decimal from 'decimal.js';
import { loadConfig } from './config';
import { logger } from './logger';
import { MarketDiscovery } from './market-discovery';
import { ArbScanner } from './arb-scanner';
import { TradeExecutor } from './trade-executor';
import { RiskManager } from './risk-manager';
import { Config, MarketInfo, ArbitrageOpportunity, DualTradeDecision } from './types';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

const WINDOW_DURATION_SEC = 300; // 5 minutes
const MIN_SHARES = 5; // Polymarket minimum

class BTC5MArbBot {
  private config: Config;
  private redis: Redis;
  private marketDiscovery: MarketDiscovery;
  private arbScanner: ArbScanner;
  private tradeExecutor: TradeExecutor;
  private riskManager: RiskManager;
  private isRunning = false;

  constructor() {
    this.config = loadConfig();
    this.redis = new Redis(this.config.redisSocketPath);
    this.marketDiscovery = new MarketDiscovery(this.config);
    this.arbScanner = new ArbScanner(this.config);
    this.tradeExecutor = new TradeExecutor(this.config, this.redis);
    this.riskManager = new RiskManager(this.config, this.redis);
  }

  async start(): Promise<void> {
    logger.info('=== BTC 5-Minute Box Spread Arbitrage ===');
    logger.info(`Mode: ${this.config.dryRun ? 'DRY RUN (paper trading)' : 'LIVE TRADING'}`);
    logger.info(`Max position: $${this.config.maxPositionUsdc} USDC per side`);
    logger.info(`Min edge: ${this.config.minEdgeBps} bps (${(this.config.minEdgeBps / 100).toFixed(1)}%)`);
    logger.info(`Max combined cost: $${this.config.maxCombinedCost}`);
    logger.info(`Max order chunk: ${this.config.maxOrderShares} shares`);
    logger.info(`Entry window: ${this.config.entryStartSec}s - ${this.config.entryEndSec}s into window`);

    await this.riskManager.initialize();

    this.isRunning = true;
    await this.mainLoop();
  }

  /**
   * Main loop - processes one 5-minute window at a time.
   */
  private async mainLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.processWindow();
      } catch (error: any) {
        logger.error('Window processing error:', { error: error.message });
      }

      await this.waitForNextWindow();
    }
  }

  /**
   * Process a single 5-minute window.
   */
  private async processWindow(): Promise<void> {
    const windowTs = this.marketDiscovery.getCurrentWindowTimestamp();
    const secsRemaining = this.marketDiscovery.getSecondsRemaining();
    const secsIntoWindow = WINDOW_DURATION_SEC - secsRemaining;

    logger.info(`\n--- Window ${windowTs} ---`);
    logger.info(`${secsIntoWindow.toFixed(0)}s into window, ${secsRemaining.toFixed(0)}s remaining`);

    // 1. Discover market
    const market = await this.marketDiscovery.discoverCurrentMarket();
    if (!market) {
      logger.warn('Market not found, skipping window');
      await this.riskManager.recordSkip();
      return;
    }

    logger.info(`UP token: ${market.upTokenId.slice(0, 20)}...`);
    logger.info(`DOWN token: ${market.downTokenId.slice(0, 20)}...`);

    // 2. Wait until entry window starts
    const windowStartMs = market.windowTimestamp * 1000;
    const scanStartMs = windowStartMs + (this.config.entryStartSec * 1000);
    const scanEndMs = windowStartMs + (this.config.entryEndSec * 1000);
    const now = Date.now();

    if (now < scanStartMs) {
      const waitMs = scanStartMs - now;
      logger.info(`Waiting ${(waitMs / 1000).toFixed(0)}s until scan window opens...`);
      await this.sleep(waitMs);
    }

    if (Date.now() >= scanEndMs) {
      logger.info('Arrived too late for this window, skipping');
      await this.riskManager.recordSkip();
      return;
    }

    // 3. Scan loop
    let traded = false;
    let bestOpportunity: ArbitrageOpportunity | null = null;
    let scanCount = 0;

    while (this.isRunning && !traded && Date.now() < scanEndMs) {
      const scanStart = Date.now();
      scanCount++;

      // Risk check
      const riskCheck = await this.riskManager.canTrade();
      if (!riskCheck.allowed) {
        logger.info(`Trading blocked: ${riskCheck.reason}`);
        break;
      }

      // Scan both order books (with hot-reloadable position cap from Redis)
      const maxPos = await this.riskManager.getMaxPositionUsdc();
      const opportunity = await this.arbScanner.scan(market.upTokenId, market.downTokenId, maxPos);

      if (opportunity) {
        // Track best opportunity seen
        if (!bestOpportunity || opportunity.edgeBps > bestOpportunity.edgeBps) {
          bestOpportunity = opportunity;
        }

        // Scanner already computed optimal shares constrained by liquidity,
        // profitability threshold, and maxPositionUsdc cap
        const shares = opportunity.optimalShares;

        if (shares.gte(MIN_SHARES)) {
          const decision: DualTradeDecision = {
            upTokenId: market.upTokenId,
            downTokenId: market.downTokenId,
            // Use worst (highest) ask price as FOK limit — VWAP would fail
            // against deeper levels since FOK requires price >= ask at each level
            upPrice: opportunity.upWorstPrice,
            downPrice: opportunity.downWorstPrice,
            shares,
            combinedCost: opportunity.combinedCost,
            guaranteedProfit: opportunity.edge.mul(shares),
          };

          // Execute
          const result = await this.tradeExecutor.executeDual(decision, market);

          if (result.success || result.partialFill) {
            // For partial fills, estimate loss as the cost of the filled side
            // (worst case: the token settles to $0, losing the entire cost)
            let profit: Decimal;
            if (result.partialFill) {
              const filled = result.upResult.success ? result.upResult : result.downResult;
              profit = filled.price.mul(filled.size).neg();
            } else {
              profit = result.guaranteedProfit;
            }

            const volume = decision.combinedCost.mul(decision.shares);
            await this.riskManager.recordArbTrade(
              profit,
              volume,
              opportunity.edgeBps,
              result.partialFill
            );

            logger.info(`Trade complete`, {
              success: result.success,
              partialFill: result.partialFill,
              combinedCost: result.combinedCost.toFixed(4),
              profit: profit.toFixed(4),
              shares: result.shares.toFixed(0),
              latencyMs: result.totalLatencyMs.toFixed(1),
            });

            // Publish trade result for dashboard
            const tradeEvent = JSON.stringify({
              strategy: 'btc-5m',
              market: `BTC ${windowTs}`,
              price: decision.combinedCost.toString(),
              size: decision.shares.toString(),
              pnl: profit.toString(),
              timestamp: Date.now(),
            });
            await this.redis.publish('results:btc5m', tradeEvent);
            await this.redis.lpush('trades:history', tradeEvent);
            await this.redis.ltrim('trades:history', 0, 499);

            traded = true;
          } else {
            logger.warn('Both sides failed to execute', {
              upError: result.upResult.error,
              downError: result.downResult.error,
            });
          }
        }
      }

      if (!traded) {
        const elapsed = Date.now() - scanStart;
        const sleepMs = Math.max(0, this.config.scanIntervalMs - elapsed);
        if (sleepMs > 0) await this.sleep(sleepMs);
      }
    }

    if (!traded) {
      const reason = bestOpportunity
        ? `Best edge: ${bestOpportunity.edgeBps.toFixed(0)} bps (combined: ${bestOpportunity.combinedCost.toFixed(4)})`
        : `No opportunity found in ${scanCount} scans`;
      logger.info(`Window ${windowTs} skipped. ${reason}`);
      await this.riskManager.recordSkip();
    }

    await this.riskManager.recordWindow();

    // Store window result in Redis for monitoring
    await this.redis.hset('btc5m:window:current', {
      timestamp: windowTs.toString(),
      traded: traded.toString(),
      scans: scanCount.toString(),
      bestEdgeBps: bestOpportunity?.edgeBps.toFixed(0) || '0',
      bestCombinedCost: bestOpportunity?.combinedCost.toFixed(4) || 'N/A',
    });

    // Pre-discover next market for cache warming
    this.marketDiscovery.discoverNextMarket().catch(() => {});
  }

  /**
   * Wait for the next 5-minute window to begin.
   */
  private async waitForNextWindow(): Promise<void> {
    const nextWindowStart = this.marketDiscovery.getNextWindowTimestamp() * 1000;
    const waitMs = Math.max(0, nextWindowStart - Date.now()) + 1000; // +1s buffer

    if (waitMs > 0) {
      logger.info(`Waiting ${(waitMs / 1000).toFixed(0)}s for next window...`);
      await this.sleep(waitMs);
    }
  }

  /**
   * Graceful shutdown.
   */
  async stop(): Promise<void> {
    logger.info('Shutting down...');
    this.isRunning = false;
    await this.redis.quit();
    logger.info('Shutdown complete');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// --- Entry Point ---

async function main(): Promise<void> {
  const bot = new BTC5MArbBot();

  const shutdown = async () => {
    await bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await bot.start();
  } catch (error: any) {
    logger.error('Fatal error:', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

main();
