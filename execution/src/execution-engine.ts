/**
 * Execution Engine - Main orchestrator
 * Listens for arbitrage signals and executes trades
 */

import Redis from 'ioredis';
import { Config, loadConfig } from './config';
import { ClobClient } from './clob-client';
import { Signer } from './signer';
import { ArbitrageSignal, ExecutionResult, SignedOrder } from './types';
import { logger } from './logger';

const KILL_SWITCH_KEY = 'TRADING_ENABLED';
const BALANCE_KEY = 'safe:balance:usdce';
const EXECUTION_STATS_KEY = 'execution:stats';

// Configuration constants
const SIGNAL_MAX_AGE_MS = 100; // Max signal age in milliseconds
const BALANCE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // Check balance every 5 minutes
const BALANCE_DROP_THRESHOLD_PERCENT = 10; // Halt if balance drops more than 10%
const TRADES_BEFORE_BALANCE_CHECK = 10; // Also check balance after N trades
const MARKET_COOLDOWN_MS = 5 * 60 * 1000; // Skip failed markets for 5 minutes

export class ExecutionEngine {
  private config: Config;
  private redis: Redis;
  private clobClient: ClobClient;
  private signer: Signer;
  private isRunning: boolean = false;
  private lastBalanceCheck: number = 0;
  private initialBalance: number = 0;
  private tradesSinceBalanceCheck: number = 0;
  private failedMarkets: Map<string, number> = new Map(); // market_id → cooldown expiry

  constructor(config: Config) {
    this.config = config;
    this.redis = new Redis(config.redisSocketPath);
    this.clobClient = new ClobClient(config);
    this.signer = new Signer(config);
  }

  /**
   * Initialize async dependencies
   */
  async initialize(): Promise<void> {
    // Initialize signer with Redis for nonce persistence
    await this.signer.initRedis(this.redis);
    logger.info('Execution engine initialized');
  }

  /**
   * Start the execution engine
   */
  async start(): Promise<void> {
    logger.info('Starting Execution Engine');

    // Initialize async dependencies
    await this.initialize();

    // Check kill switch
    if (!(await this.isKillSwitchEnabled())) {
      logger.error('Trading is disabled via kill switch');
      return;
    }

    // Initialize balance tracking
    await this.initializeBalanceTracking();

    // Subscribe to arbitrage signals
    this.isRunning = true;
    await this.subscribeToSignals();
  }

  /**
   * Stop the execution engine
   */
  async stop(): Promise<void> {
    logger.info('Stopping Execution Engine');
    this.isRunning = false;
    await this.redis.quit();
  }

  /**
   * Check if kill switch allows trading
   * FAIL-CLOSED: If key is missing or Redis fails, trading is DISABLED
   */
  private async isKillSwitchEnabled(): Promise<boolean> {
    try {
      const value = await this.redis.get(KILL_SWITCH_KEY);
      // Fail-closed: only enable if explicitly set to TRUE
      return value?.toUpperCase() === 'TRUE';
    } catch (error) {
      logger.error('Failed to check kill switch, defaulting to DISABLED:', error);
      return false;
    }
  }

  /**
   * Initialize balance tracking for safety guard
   */
  private async initializeBalanceTracking(): Promise<void> {
    const balance = await this.redis.get(BALANCE_KEY);
    this.initialBalance = parseFloat(balance || '0');
    this.lastBalanceCheck = Date.now();
    logger.info(`Initial balance: ${this.initialBalance} USDCe`);
  }

  /**
   * Balance guard - halt if >10% drop
   * Checks every 5 minutes OR after every 10 trades
   */
  private async checkBalanceGuard(force: boolean = false): Promise<boolean> {
    const now = Date.now();

    // Check if we should run the balance check
    const timeTriggered = now - this.lastBalanceCheck >= BALANCE_CHECK_INTERVAL_MS;
    const tradeTriggered = this.tradesSinceBalanceCheck >= TRADES_BEFORE_BALANCE_CHECK;

    if (!force && !timeTriggered && !tradeTriggered) {
      return true; // Skip check
    }

    const currentBalance = parseFloat((await this.redis.get(BALANCE_KEY)) || '0');

    // Avoid division by zero
    if (this.initialBalance <= 0) {
      this.initialBalance = currentBalance;
      this.lastBalanceCheck = now;
      this.tradesSinceBalanceCheck = 0;
      return true;
    }

    const dropPercent = ((this.initialBalance - currentBalance) / this.initialBalance) * 100;

    if (dropPercent > BALANCE_DROP_THRESHOLD_PERCENT) {
      logger.error(`BALANCE GUARD TRIGGERED: ${dropPercent.toFixed(2)}% drop detected`);
      logger.error(`Initial: ${this.initialBalance}, Current: ${currentBalance}`);
      await this.redis.set(KILL_SWITCH_KEY, 'FALSE');
      return false;
    }

    // Reset counters
    this.lastBalanceCheck = now;
    this.tradesSinceBalanceCheck = 0;

    // Log balance status periodically
    logger.debug(`Balance check passed: ${currentBalance} USDCe (${dropPercent.toFixed(2)}% change)`);

    return true;
  }

  /**
   * Subscribe to arbitrage signals from Redis pub/sub
   */
  private async subscribeToSignals(): Promise<void> {
    const subscriber = this.redis.duplicate();
    await subscriber.subscribe(this.config.signalChannel);

    logger.info(`Subscribed to ${this.config.signalChannel}`);

    subscriber.on('message', async (channel, message) => {
      if (!this.isRunning) return;

      try {
        const signal: ArbitrageSignal = JSON.parse(message);
        await this.processSignal(signal);
      } catch (error) {
        logger.error('Failed to process signal:', error);
      }
    });

    // Keep alive
    while (this.isRunning) {
      // Check kill switch
      if (!(await this.isKillSwitchEnabled())) {
        logger.warn('Kill switch disabled, pausing execution');
        await this.sleep(1000);
        continue;
      }

      // Check balance guard
      if (!(await this.checkBalanceGuard())) {
        logger.error('Balance guard triggered, halting execution');
        this.isRunning = false;
        break;
      }

      await this.sleep(this.config.killSwitchCheckInterval);
    }

    await subscriber.unsubscribe();
    await subscriber.quit();
  }

  /**
   * Verify current prices haven't moved beyond acceptable slippage
   * Returns true if prices are still within bounds
   */
  private async verifySlippage(signal: ArbitrageSignal): Promise<{ valid: boolean; reason?: string }> {
    try {
      // Get current best asks from Redis
      const yesAskKey = `ob:${signal.yes_token_id}:asks`;
      const noAskKey = `ob:${signal.no_token_id}:asks`;

      const [yesAskData, noAskData] = await Promise.all([
        this.redis.zrange(yesAskKey, 0, 0, 'WITHSCORES'),
        this.redis.zrange(noAskKey, 0, 0, 'WITHSCORES'),
      ]);

      if (yesAskData.length < 2 || noAskData.length < 2) {
        return { valid: false, reason: 'Order book data unavailable' };
      }

      const currentYesAsk = parseFloat(yesAskData[1]);
      const currentNoAsk = parseFloat(noAskData[1]);

      // Calculate price movement in basis points
      const yesSlippageBps = Math.abs((currentYesAsk - signal.yes_ask_price) / signal.yes_ask_price) * 10000;
      const noSlippageBps = Math.abs((currentNoAsk - signal.no_ask_price) / signal.no_ask_price) * 10000;

      const maxSlippage = Math.max(yesSlippageBps, noSlippageBps);

      // Hot-reload: check Redis for dashboard-set override
      let maxSlippageBps = this.config.maxSlippageBps;
      try {
        const override = await this.redis.get('config:execution:max_slippage_bps');
        if (override) {
          maxSlippageBps = parseInt(override, 10);
        }
      } catch {
        // Fall through to config default
      }

      if (maxSlippage > maxSlippageBps) {
        return {
          valid: false,
          reason: `Slippage ${maxSlippage.toFixed(0)}bps exceeds max ${maxSlippageBps}bps`,
        };
      }

      // Also verify the arbitrage opportunity still exists
      const currentTotal = currentYesAsk + currentNoAsk;
      if (currentTotal >= 1.0) {
        return {
          valid: false,
          reason: `Arbitrage opportunity gone: YES(${currentYesAsk}) + NO(${currentNoAsk}) = ${currentTotal}`,
        };
      }

      return { valid: true };
    } catch (error) {
      logger.warn('Failed to verify slippage, proceeding with caution:', error);
      // On error, allow execution but log warning
      return { valid: true };
    }
  }

  /**
   * Process an arbitrage signal and execute trades
   */
  private async processSignal(signal: ArbitrageSignal): Promise<ExecutionResult> {
    const startTime = performance.now();
    logger.info(`Processing signal for market ${signal.market_id}`, {
      edge: signal.edge,
      expectedProfit: signal.expected_profit,
    });

    try {
      // Skip markets in cooldown (e.g., stale orderbooks)
      const cooldownExpiry = this.failedMarkets.get(signal.market_id);
      if (cooldownExpiry && Date.now() < cooldownExpiry) {
        return this.createFailedResult('Market in cooldown', startTime);
      }
      this.failedMarkets.delete(signal.market_id);

      // Validate signal freshness (max 100ms old)
      const signalAge = Date.now() - signal.timestamp_ms;
      if (signalAge > SIGNAL_MAX_AGE_MS) {
        logger.warn(`Signal too old: ${signalAge}ms`);
        return this.createFailedResult('Signal too old', startTime);
      }

      // Validate profit threshold
      if (signal.expected_profit < this.config.minProfitThreshold) {
        logger.debug(`Profit below threshold: ${signal.expected_profit}`);
        return this.createFailedResult('Profit below threshold', startTime);
      }

      // Verify slippage before execution
      const slippageCheck = await this.verifySlippage(signal);
      if (!slippageCheck.valid) {
        logger.warn(`Slippage check failed: ${slippageCheck.reason}`);
        return this.createFailedResult(slippageCheck.reason || 'Slippage check failed', startTime);
      }

      // Calculate execution size (min of max_size and our position limit)
      const execSize = Math.min(signal.max_size, this.config.maxPositionSize);

      // Create and sign orders
      const orders = await this.createArbitrageOrders(signal, execSize);

      // Submit batch orders atomically
      const response = await this.clobClient.submitBatchOrders(orders);

      const elapsed = performance.now() - startTime;

      if (response.success) {
        const result: ExecutionResult = {
          success: true,
          yesOrderId: response.orders[0]?.orderID,
          noOrderId: response.orders[1]?.orderID,
          executedSize: execSize,
          totalCost: (signal.yes_ask_price + signal.no_ask_price) * execSize,
          expectedProfit: signal.expected_profit,
          latencyMs: elapsed,
        };

        logger.info(`Arbitrage executed successfully`, result);
        await this.recordExecution(result, signal);

        // Increment trade counter for balance guard
        this.tradesSinceBalanceCheck++;

        return result;
      } else {
        const errorMsg = response.orders[0]?.errorMsg || 'Unknown error';
        logger.warn(`Batch order failed`, { response });

        // Cooldown markets with non-existent orderbooks (stale/expired)
        if (errorMsg.includes('does not exist')) {
          this.failedMarkets.set(signal.market_id, Date.now() + MARKET_COOLDOWN_MS);
          logger.info(`Market ${signal.market_id} cooled down for 5 minutes`);
        }

        return this.createFailedResult(errorMsg, startTime);
      }
    } catch (error: any) {
      logger.error('Execution error:', error);
      return this.createFailedResult(error.message, startTime);
    }
  }

  /**
   * Create signed orders for both YES and NO sides
   */
  private async createArbitrageOrders(
    signal: ArbitrageSignal,
    size: number
  ): Promise<SignedOrder[]> {
    const orders = await this.signer.signBatchOrders([
      {
        tokenId: signal.yes_token_id,
        price: signal.yes_ask_price,
        size,
        side: 'BUY',
      },
      {
        tokenId: signal.no_token_id,
        price: signal.no_ask_price,
        size,
        side: 'BUY',
      },
    ]);

    return orders;
  }

  /**
   * Record execution stats and publish trade result for dashboard
   */
  private async recordExecution(result: ExecutionResult, signal: ArbitrageSignal): Promise<void> {
    await this.redis.hincrby(EXECUTION_STATS_KEY, 'total_executions', 1);
    await this.redis.hincrbyfloat(EXECUTION_STATS_KEY, 'total_profit', result.expectedProfit);
    await this.redis.hset(EXECUTION_STATS_KEY, 'last_execution_ms', Date.now());

    // Publish and persist trade result for dashboard
    const tradeEvent = JSON.stringify({
      strategy: 'arbitrage',
      market: signal.market_id,
      side: 'BOX',
      yesPrice: signal.yes_ask_price,
      noPrice: signal.no_ask_price,
      size: result.totalCost,
      pnl: result.expectedProfit,
      timestamp: Date.now(),
    });
    await this.redis.publish('results:execution', tradeEvent);
    await this.redis.lpush('trades:history', tradeEvent);
    await this.redis.ltrim('trades:history', 0, 999);
  }

  /**
   * Create a failed execution result
   */
  private createFailedResult(error: string, startTime: number): ExecutionResult {
    return {
      success: false,
      error,
      executedSize: 0,
      totalCost: 0,
      expectedProfit: 0,
      latencyMs: performance.now() - startTime,
    };
  }

  /**
   * Helper sleep function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
