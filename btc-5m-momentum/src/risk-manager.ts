/**
 * Momentum Risk Manager - Kill switches, daily loss limits, streak breaker.
 * Adapted from btc-5m/risk-manager.ts for directional trading with win/loss tracking.
 */

import Redis from 'ioredis';
import Decimal from 'decimal.js';
import { Config, RiskCheck, MomentumStats, SimulatedTradeResult } from './types';
import { logger } from './logger';

const STATS_KEY = 'btc5m_momentum:stats';
const KILL_SWITCH_KEY = 'BTC_5M_MOMENTUM_TRADING_ENABLED';
const GLOBAL_KILL_SWITCH_KEY = 'TRADING_ENABLED';
const MAX_BET_OVERRIDE_KEY = 'config:btc5m_momentum:max_bet_usdc';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

export class MomentumRiskManager {
  private config: Config;
  private redis: Redis;
  private stats: MomentumStats;
  private pauseUntil: number = 0; // Unix ms timestamp, 0 = not paused

  constructor(config: Config, redis: Redis) {
    this.config = config;
    this.redis = redis;
    this.stats = this.defaultStats();
  }

  async initialize(): Promise<void> {
    try {
      const data = await this.redis.hgetall(STATS_KEY);
      if (data && Object.keys(data).length > 0) {
        this.stats = {
          totalWindows: parseInt(data.totalWindows || '0', 10),
          windowsEvaluated: parseInt(data.windowsEvaluated || '0', 10),
          windowsTraded: parseInt(data.windowsTraded || '0', 10),
          windowsSkipped: parseInt(data.windowsSkipped || '0', 10),
          wins: parseInt(data.wins || '0', 10),
          losses: parseInt(data.losses || '0', 10),
          winRate: parseFloat(data.winRate || '0'),
          totalProfit: new Decimal(data.totalProfit || '0'),
          totalLoss: new Decimal(data.totalLoss || '0'),
          dailyProfit: new Decimal(data.dailyProfit || '0'),
          dailyProfitDate: data.dailyProfitDate || this.todayStr(),
          dailyVolume: new Decimal(data.dailyVolume || '0'),
          consecutiveLosses: parseInt(data.consecutiveLosses || '0', 10),
          maxConsecutiveLosses: parseInt(data.maxConsecutiveLosses || '0', 10),
          lastTradeTime: parseInt(data.lastTradeTime || '0', 10),
          lastTradeDirection: (data.lastTradeDirection as 'UP' | 'DOWN' | '') || '',
          paperFills: parseInt(data.paperFills || '0', 10),
          paperPartialFills: parseInt(data.paperPartialFills || '0', 10),
          paperMissedFills: parseInt(data.paperMissedFills || '0', 10),
          paperAvgFillRatio: parseFloat(data.paperAvgFillRatio || '0'),
          paperAvgSlippageBps: parseFloat(data.paperAvgSlippageBps || '0'),
          paperAvgEntryPrice: parseFloat(data.paperAvgEntryPrice || '0'),
        };

        // Reset daily stats if new day
        if (this.stats.dailyProfitDate !== this.todayStr()) {
          this.stats.dailyProfit = new Decimal(0);
          this.stats.dailyVolume = new Decimal(0);
          this.stats.dailyProfitDate = this.todayStr();
        }
      }

      // Check service kill switch (fail-closed: must be explicitly set to TRUE)
      const killSwitch = await this.redis.get(KILL_SWITCH_KEY);
      if (killSwitch !== 'TRUE') {
        logger.warn(`${KILL_SWITCH_KEY} is not set to TRUE — trading disabled. Set it manually to enable.`);
      }

      logger.info('Momentum risk manager initialized', {
        wins: this.stats.wins,
        losses: this.stats.losses,
        winRate: this.stats.winRate.toFixed(2),
        totalProfit: this.stats.totalProfit.toString(),
        totalLoss: this.stats.totalLoss.toString(),
        dailyProfit: this.stats.dailyProfit.toString(),
        consecutiveLosses: this.stats.consecutiveLosses,
      });
    } catch (error) {
      logger.warn('Failed to load stats from Redis, using defaults');
    }
  }

  async canTrade(): Promise<RiskCheck> {
    // 1. Global kill switch
    const globalEnabled = await this.checkKillSwitch(GLOBAL_KILL_SWITCH_KEY);
    if (!globalEnabled) {
      return { allowed: false, reason: 'Global kill switch disabled' };
    }

    // 2. Momentum-specific kill switch
    const momentumEnabled = await this.checkKillSwitch(KILL_SWITCH_KEY);
    if (!momentumEnabled) {
      return { allowed: false, reason: 'Momentum kill switch disabled' };
    }

    // 3. Daily loss limit
    this.checkDailyReset();
    if (this.stats.dailyProfit.neg().gte(this.config.maxDailyLossUsdc)) {
      await this.redis.set(KILL_SWITCH_KEY, 'FALSE');
      return {
        allowed: false,
        reason: `Daily loss limit reached: ${this.stats.dailyProfit.toFixed(2)} (limit: -$${this.config.maxDailyLossUsdc})`,
      };
    }

    // 4. Consecutive loss streak pause
    if (this.pauseUntil > Date.now()) {
      const remainingMin = Math.ceil((this.pauseUntil - Date.now()) / 60000);
      return {
        allowed: false,
        reason: `Streak pause active: ${remainingMin} minutes remaining (${this.stats.consecutiveLosses} consecutive losses)`,
      };
    }

    return { allowed: true };
  }

  /**
   * Record a completed momentum trade with its outcome.
   */
  async recordTrade(
    direction: 'UP' | 'DOWN',
    entryPrice: Decimal,
    shares: Decimal,
    won: boolean,
    simResult?: SimulatedTradeResult,
  ): Promise<void> {
    this.checkDailyReset();

    const volume = entryPrice.mul(shares);
    let pnl: Decimal;

    if (won) {
      pnl = new Decimal(1).minus(entryPrice).mul(shares);
      this.stats.wins++;
      this.stats.totalProfit = this.stats.totalProfit.plus(pnl);
      this.stats.consecutiveLosses = 0;
    } else {
      pnl = entryPrice.mul(shares).neg();
      this.stats.losses++;
      this.stats.totalLoss = this.stats.totalLoss.plus(pnl.abs());
      this.stats.consecutiveLosses++;

      if (this.stats.consecutiveLosses > this.stats.maxConsecutiveLosses) {
        this.stats.maxConsecutiveLosses = this.stats.consecutiveLosses;
      }

      // Trigger streak pause
      if (this.stats.consecutiveLosses >= this.config.maxConsecutiveLosses) {
        this.pauseUntil = Date.now() + (this.config.streakPauseMinutes * 60 * 1000);
        logger.warn('Streak pause triggered', {
          consecutiveLosses: this.stats.consecutiveLosses,
          pauseMinutes: this.config.streakPauseMinutes,
          pauseUntil: new Date(this.pauseUntil).toISOString(),
        });
      }
    }

    this.stats.windowsTraded++;
    this.stats.dailyProfit = this.stats.dailyProfit.plus(pnl);
    this.stats.dailyVolume = this.stats.dailyVolume.plus(volume);
    this.stats.lastTradeTime = Date.now();
    this.stats.lastTradeDirection = direction;

    // Update win rate
    const totalTrades = this.stats.wins + this.stats.losses;
    this.stats.winRate = totalTrades > 0 ? this.stats.wins / totalTrades : 0;

    // Track paper trading fill quality
    if (simResult) {
      this.stats.paperFills++;
      if (simResult.partialFill) {
        this.stats.paperPartialFills++;
      }
      const fillCount = new Decimal(this.stats.paperFills);
      this.stats.paperAvgFillRatio = new Decimal(this.stats.paperAvgFillRatio)
        .plus(new Decimal(simResult.fillRatio).minus(this.stats.paperAvgFillRatio).div(fillCount))
        .toNumber();
      this.stats.paperAvgSlippageBps = new Decimal(this.stats.paperAvgSlippageBps)
        .plus(new Decimal(simResult.slippageBps).minus(this.stats.paperAvgSlippageBps).div(fillCount))
        .toNumber();
      this.stats.paperAvgEntryPrice = new Decimal(this.stats.paperAvgEntryPrice)
        .plus(simResult.fillPrice.minus(this.stats.paperAvgEntryPrice).div(fillCount))
        .toNumber();
    }

    await this.persistStats();

    logger.info('Momentum trade recorded', {
      direction,
      won,
      pnl: pnl.toFixed(4),
      entryPrice: entryPrice.toFixed(4),
      shares: shares.toFixed(2),
      winRate: (this.stats.winRate * 100).toFixed(1) + '%',
      dailyProfit: this.stats.dailyProfit.toFixed(2),
      consecutiveLosses: this.stats.consecutiveLosses,
    });

    // Win rate warning (informational, not auto-halt)
    if (totalTrades >= 20 && this.stats.winRate < 0.55) {
      logger.warn('Win rate below 55% threshold', {
        winRate: (this.stats.winRate * 100).toFixed(1) + '%',
        totalTrades,
        wins: this.stats.wins,
        losses: this.stats.losses,
      });
    }
  }

  async recordSkip(simResult?: SimulatedTradeResult): Promise<void> {
    this.stats.windowsSkipped++;
    if (simResult?.missedFill) {
      this.stats.paperMissedFills++;
    }
    await this.persistStats();
  }

  async recordWindow(): Promise<void> {
    this.stats.totalWindows++;
    this.stats.windowsEvaluated++;
    await this.persistStats();
  }

  /**
   * Get max bet per window (supports hot-reload via Redis).
   */
  async getMaxBetUsdc(): Promise<Decimal> {
    const configMax = new Decimal(this.config.maxBetUsdc);
    try {
      const override = await this.redis.get(MAX_BET_OVERRIDE_KEY);
      if (override) {
        return Decimal.min(new Decimal(override), configMax);
      }
    } catch {
      // Fall through
    }
    return configMax;
  }

  getStats(): MomentumStats {
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
      this.stats.dailyProfitDate = today;
      // Reset streak pause on new day
      this.pauseUntil = 0;
      this.stats.consecutiveLosses = 0;
    }
  }

  private async persistStats(): Promise<void> {
    try {
      await this.redis.hmset(STATS_KEY, {
        totalWindows: this.stats.totalWindows.toString(),
        windowsEvaluated: this.stats.windowsEvaluated.toString(),
        windowsTraded: this.stats.windowsTraded.toString(),
        windowsSkipped: this.stats.windowsSkipped.toString(),
        wins: this.stats.wins.toString(),
        losses: this.stats.losses.toString(),
        winRate: this.stats.winRate.toString(),
        totalProfit: this.stats.totalProfit.toString(),
        totalLoss: this.stats.totalLoss.toString(),
        dailyProfit: this.stats.dailyProfit.toString(),
        dailyProfitDate: this.stats.dailyProfitDate,
        dailyVolume: this.stats.dailyVolume.toString(),
        consecutiveLosses: this.stats.consecutiveLosses.toString(),
        maxConsecutiveLosses: this.stats.maxConsecutiveLosses.toString(),
        lastTradeTime: this.stats.lastTradeTime.toString(),
        lastTradeDirection: this.stats.lastTradeDirection,
        paperFills: this.stats.paperFills.toString(),
        paperPartialFills: this.stats.paperPartialFills.toString(),
        paperMissedFills: this.stats.paperMissedFills.toString(),
        paperAvgFillRatio: this.stats.paperAvgFillRatio.toString(),
        paperAvgSlippageBps: this.stats.paperAvgSlippageBps.toString(),
        paperAvgEntryPrice: this.stats.paperAvgEntryPrice.toString(),
      });
    } catch (error) {
      logger.error('Failed to persist stats to Redis');
    }
  }

  private todayStr(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private defaultStats(): MomentumStats {
    return {
      totalWindows: 0,
      windowsEvaluated: 0,
      windowsTraded: 0,
      windowsSkipped: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalProfit: new Decimal(0),
      totalLoss: new Decimal(0),
      dailyProfit: new Decimal(0),
      dailyProfitDate: this.todayStr(),
      dailyVolume: new Decimal(0),
      consecutiveLosses: 0,
      maxConsecutiveLosses: 0,
      lastTradeTime: 0,
      lastTradeDirection: '',
      paperFills: 0,
      paperPartialFills: 0,
      paperMissedFills: 0,
      paperAvgFillRatio: 0,
      paperAvgSlippageBps: 0,
      paperAvgEntryPrice: 0,
    };
  }
}
