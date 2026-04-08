/**
 * Risk Manager - Kill switches, daily loss limits, partial fill protection.
 * Simplified for arbitrage (no directional win/loss tracking).
 */

import Redis from 'ioredis';
import Decimal from 'decimal.js';
import { Config, RiskCheck, ArbTradingStats } from './types';
import { logger } from './logger';

const STATS_KEY = 'btc5m:stats';
const BTC_KILL_SWITCH_KEY = 'BTC_5M_TRADING_ENABLED';
const GLOBAL_KILL_SWITCH_KEY = 'TRADING_ENABLED';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

export class RiskManager {
  private config: Config;
  private redis: Redis;
  private stats: ArbTradingStats;

  constructor(config: Config, redis: Redis) {
    this.config = config;
    this.redis = redis;
    this.stats = {
      totalWindows: 0,
      windowsScanned: 0,
      windowsTraded: 0,
      windowsSkipped: 0,
      totalPairsTraded: 0,
      totalVolume: new Decimal(0),
      totalProfit: new Decimal(0),
      dailyProfit: new Decimal(0),
      dailyProfitDate: this.todayStr(),
      dailyVolume: new Decimal(0),
      averageEdgeBps: 0,
      partialFills: 0,
      dailyPartialFills: 0,
      lastTradeTime: 0,
      lastScanTime: 0,
    };
  }

  /**
   * Load stats from Redis on startup.
   */
  async initialize(): Promise<void> {
    try {
      const data = await this.redis.hgetall(STATS_KEY);
      if (data && Object.keys(data).length > 0) {
        this.stats = {
          totalWindows: parseInt(data.totalWindows || '0', 10),
          windowsScanned: parseInt(data.windowsScanned || '0', 10),
          windowsTraded: parseInt(data.windowsTraded || '0', 10),
          windowsSkipped: parseInt(data.windowsSkipped || '0', 10),
          totalPairsTraded: parseInt(data.totalPairsTraded || '0', 10),
          totalVolume: new Decimal(data.totalVolume || '0'),
          totalProfit: new Decimal(data.totalProfit || '0'),
          dailyProfit: new Decimal(data.dailyProfit || '0'),
          dailyProfitDate: data.dailyProfitDate || this.todayStr(),
          dailyVolume: new Decimal(data.dailyVolume || '0'),
          averageEdgeBps: parseFloat(data.averageEdgeBps || '0'),
          partialFills: parseInt(data.partialFills || '0', 10),
          dailyPartialFills: parseInt(data.dailyPartialFills || '0', 10),
          lastTradeTime: parseInt(data.lastTradeTime || '0', 10),
          lastScanTime: parseInt(data.lastScanTime || '0', 10),
        };

        // Reset daily stats if new day
        if (this.stats.dailyProfitDate !== this.todayStr()) {
          this.stats.dailyProfit = new Decimal(0);
          this.stats.dailyVolume = new Decimal(0);
          this.stats.dailyPartialFills = 0;
          this.stats.dailyProfitDate = this.todayStr();
        }
      }

      // Ensure BTC 5M kill switch is set
      const btcSwitch = await this.redis.get(BTC_KILL_SWITCH_KEY);
      if (btcSwitch === null) {
        await this.redis.set(BTC_KILL_SWITCH_KEY, 'TRUE');
        logger.info('Initialized BTC_5M_TRADING_ENABLED = TRUE');
      }

      logger.info('Risk manager initialized', {
        totalPairsTraded: this.stats.totalPairsTraded,
        totalProfit: this.stats.totalProfit.toString(),
        dailyProfit: this.stats.dailyProfit.toString(),
        partialFills: this.stats.partialFills,
      });
    } catch (error) {
      logger.warn('Failed to load stats from Redis, using defaults');
    }
  }

  /**
   * Check if trading is allowed right now.
   */
  async canTrade(): Promise<RiskCheck> {
    // 1. Global kill switch
    const globalEnabled = await this.checkKillSwitch(GLOBAL_KILL_SWITCH_KEY);
    if (!globalEnabled) {
      return { allowed: false, reason: 'Global kill switch disabled' };
    }

    // 2. BTC-specific kill switch
    const btcEnabled = await this.checkKillSwitch(BTC_KILL_SWITCH_KEY);
    if (!btcEnabled) {
      return { allowed: false, reason: 'BTC 5M kill switch disabled' };
    }

    // 3. Daily loss limit (from partial fills or slippage)
    this.checkDailyReset();
    if (this.stats.dailyProfit.neg().gte(this.config.maxDailyLossUsdc)) {
      await this.redis.set(BTC_KILL_SWITCH_KEY, 'FALSE');
      return {
        allowed: false,
        reason: `Daily loss limit reached: ${this.stats.dailyProfit.toString()} (limit: -$${this.config.maxDailyLossUsdc})`,
      };
    }

    // 4. Partial fill circuit breaker
    if (this.stats.dailyPartialFills >= 3) {
      return {
        allowed: false,
        reason: `Too many partial fills today: ${this.stats.dailyPartialFills} (max: 3)`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a completed arbitrage trade.
   */
  async recordArbTrade(profit: Decimal, volume: Decimal, edgeBps: number, partialFill: boolean): Promise<void> {
    this.checkDailyReset();

    this.stats.totalPairsTraded++;
    this.stats.windowsTraded++;
    this.stats.totalVolume = this.stats.totalVolume.plus(volume);
    this.stats.totalProfit = this.stats.totalProfit.plus(profit);
    this.stats.dailyProfit = this.stats.dailyProfit.plus(profit);
    this.stats.dailyVolume = this.stats.dailyVolume.plus(volume);
    this.stats.lastTradeTime = Date.now();

    if (partialFill) {
      this.stats.partialFills++;
      this.stats.dailyPartialFills++;
    }

    // Running average of edge
    const totalTrades = this.stats.totalPairsTraded;
    this.stats.averageEdgeBps =
      ((this.stats.averageEdgeBps * (totalTrades - 1)) + edgeBps) / totalTrades;

    await this.persistStats();

    logger.info('Arb trade recorded', {
      profit: profit.toFixed(4),
      volume: volume.toFixed(2),
      edgeBps: edgeBps.toFixed(0),
      partialFill,
      totalProfit: this.stats.totalProfit.toFixed(2),
      dailyProfit: this.stats.dailyProfit.toFixed(2),
      avgEdgeBps: this.stats.averageEdgeBps.toFixed(0),
    });
  }

  /**
   * Record a skipped window (no opportunity found).
   */
  async recordSkip(): Promise<void> {
    this.stats.windowsSkipped++;
    await this.persistStats();
  }

  /**
   * Record a scanned window.
   */
  async recordWindow(): Promise<void> {
    this.stats.totalWindows++;
    this.stats.windowsScanned++;
    this.stats.lastScanTime = Date.now();
    await this.persistStats();
  }

  /**
   * Get current max position size per side in USDC.
   * Supports hot-reload via Redis key override from dashboard.
   */
  async getMaxPositionUsdc(): Promise<Decimal> {
    const configMax = new Decimal(this.config.maxPositionUsdc);
    try {
      const override = await this.redis.get('config:btc5m:max_position_usdc');
      if (override) {
        // Clamp: Redis override cannot exceed the config-defined cap
        return Decimal.min(new Decimal(override), configMax);
      }
    } catch {
      // Fall through to config default
    }
    return configMax;
  }

  getStats(): ArbTradingStats {
    return { ...this.stats };
  }

  private async checkKillSwitch(key: string): Promise<boolean> {
    try {
      const value = await this.redis.get(key);
      return value?.toUpperCase() === 'TRUE';
    } catch {
      logger.error(`Failed to check kill switch ${key}, defaulting to DISABLED`);
      return false;
    }
  }

  private checkDailyReset(): void {
    const today = this.todayStr();
    if (this.stats.dailyProfitDate !== today) {
      logger.info('New day, resetting daily stats', {
        previousDailyProfit: this.stats.dailyProfit.toString(),
        previousDailyVolume: this.stats.dailyVolume.toString(),
      });
      this.stats.dailyProfit = new Decimal(0);
      this.stats.dailyVolume = new Decimal(0);
      this.stats.dailyPartialFills = 0;
      this.stats.dailyProfitDate = today;
    }
  }

  private async persistStats(): Promise<void> {
    try {
      await this.redis.hmset(STATS_KEY, {
        totalWindows: this.stats.totalWindows.toString(),
        windowsScanned: this.stats.windowsScanned.toString(),
        windowsTraded: this.stats.windowsTraded.toString(),
        windowsSkipped: this.stats.windowsSkipped.toString(),
        totalPairsTraded: this.stats.totalPairsTraded.toString(),
        totalVolume: this.stats.totalVolume.toString(),
        totalProfit: this.stats.totalProfit.toString(),
        dailyProfit: this.stats.dailyProfit.toString(),
        dailyProfitDate: this.stats.dailyProfitDate,
        dailyVolume: this.stats.dailyVolume.toString(),
        averageEdgeBps: this.stats.averageEdgeBps.toString(),
        partialFills: this.stats.partialFills.toString(),
        dailyPartialFills: this.stats.dailyPartialFills.toString(),
        lastTradeTime: this.stats.lastTradeTime.toString(),
        lastScanTime: this.stats.lastScanTime.toString(),
      });
    } catch (error) {
      logger.error('Failed to persist stats to Redis');
    }
  }

  private todayStr(): string {
    return new Date().toISOString().slice(0, 10);
  }
}
