/**
 * Latency Risk Manager - Kill switches, daily/session loss limits, oracle divergence,
 * trend regime detection, and per-window position tracking.
 */

import Redis from 'ioredis';
import Decimal from 'decimal.js';
import { Config, RiskCheck, LatencyStats, WindowPnL, SimulatedTradeResult, Direction } from './types';
import { logger } from './logger';

const STATS_KEY = 'btc5m_latency:stats';
const KILL_SWITCH_KEY = 'BTC_5M_LATENCY_TRADING_ENABLED';
const GLOBAL_KILL_SWITCH_KEY = 'TRADING_ENABLED';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

export class LatencyRiskManager {
  private config: Config;
  private redis: Redis;
  private stats: LatencyStats;
  private pauseUntil: number = 0;

  // Oracle divergence tracking
  private divergenceStartMs: number = 0;
  private divergenceActive: boolean = false;

  // Per-window position
  private currentWindowTs: number = 0;
  private windowUpSpent: Decimal = new Decimal(0);
  private windowDownSpent: Decimal = new Decimal(0);

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
          windowsTraded: parseInt(data.windowsTraded || '0', 10),
          windowsSkipped: parseInt(data.windowsSkipped || '0', 10),
          wins: parseInt(data.wins || '0', 10),
          losses: parseInt(data.losses || '0', 10),
          winRate: parseFloat(data.winRate || '0'),
          totalProfit: new Decimal(data.totalProfit || '0'),
          totalLoss: new Decimal(data.totalLoss || '0'),
          sessionPnl: new Decimal(0), // Reset on each start
          dailyProfit: new Decimal(data.dailyProfit || '0'),
          dailyProfitDate: data.dailyProfitDate || this.todayStr(),
          dailyVolume: new Decimal(data.dailyVolume || '0'),
          totalTrades: parseInt(data.totalTrades || '0', 10),
          avgEdgeAtFill: new Decimal(data.avgEdgeAtFill || '0'),
          consecutiveLosses: parseInt(data.consecutiveLosses || '0', 10),
          maxConsecutiveLosses: parseInt(data.maxConsecutiveLosses || '0', 10),
          oracleDivergenceEvents: parseInt(data.oracleDivergenceEvents || '0', 10),
          lastTradeTime: parseInt(data.lastTradeTime || '0', 10),
          paperFills: parseInt(data.paperFills || '0', 10),
          paperPartialFills: parseInt(data.paperPartialFills || '0', 10),
          paperMissedFills: parseInt(data.paperMissedFills || '0', 10),
          paperAvgFillRatio: parseFloat(data.paperAvgFillRatio || '0'),
          paperAvgSlippageBps: parseFloat(data.paperAvgSlippageBps || '0'),
        };

        // Reset daily stats if new day
        if (this.stats.dailyProfitDate !== this.todayStr()) {
          this.stats.dailyProfit = new Decimal(0);
          this.stats.dailyVolume = new Decimal(0);
          this.stats.dailyProfitDate = this.todayStr();
        }
      }

      const killSwitch = await this.redis.get(KILL_SWITCH_KEY);
      if (killSwitch !== 'TRUE') {
        logger.warn(`${KILL_SWITCH_KEY} is not set to TRUE — trading disabled. Set it manually to enable.`);
      }

      logger.info('Latency risk manager initialized', {
        wins: this.stats.wins,
        losses: this.stats.losses,
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

    // 2. Latency-specific kill switch
    const latencyEnabled = await this.checkKillSwitch(KILL_SWITCH_KEY);
    if (!latencyEnabled) {
      return { allowed: false, reason: 'Latency kill switch disabled' };
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

    // 4. Session drawdown
    if (this.stats.sessionPnl.neg().gte(this.config.maxSessionDrawdown)) {
      return {
        allowed: false,
        reason: `Session drawdown limit reached: ${this.stats.sessionPnl.toFixed(2)} (limit: -$${this.config.maxSessionDrawdown})`,
      };
    }

    // 5. Consecutive loss streak pause
    if (this.pauseUntil > Date.now()) {
      const remainingMin = Math.ceil((this.pauseUntil - Date.now()) / 60000);
      return {
        allowed: false,
        reason: `Streak pause active: ${remainingMin} minutes remaining (${this.stats.consecutiveLosses} consecutive losses)`,
      };
    }

    // 6. Oracle divergence halt
    if (this.divergenceActive) {
      return {
        allowed: false,
        reason: 'Oracle divergence detected — halting until resolved',
      };
    }

    return { allowed: true };
  }

  /**
   * Check for oracle divergence between exchange price and Chainlink.
   * Called periodically from the main loop.
   */
  checkOracleDivergence(exchangePrice: Decimal, chainlinkPrice: Decimal): void {
    const divergence = exchangePrice.minus(chainlinkPrice).abs();

    if (divergence.gte(this.config.oracleDivergenceLimit)) {
      if (this.divergenceStartMs === 0) {
        this.divergenceStartMs = Date.now();
        logger.warn('Oracle divergence detected', {
          divergence: divergence.toFixed(2),
          limit: this.config.oracleDivergenceLimit,
        });
      }

      const elapsed = Date.now() - this.divergenceStartMs;
      if (elapsed >= this.config.oracleDivergenceDurationMs && !this.divergenceActive) {
        this.divergenceActive = true;
        this.stats.oracleDivergenceEvents++;
        logger.error('Oracle divergence HALT triggered', {
          divergence: divergence.toFixed(2),
          durationMs: elapsed,
        });
      }
    } else {
      // Divergence resolved
      if (this.divergenceActive) {
        logger.info('Oracle divergence resolved');
        this.divergenceActive = false;
      }
      this.divergenceStartMs = 0;
    }
  }

  /**
   * Get Kelly multiplier adjustment for trend regimes.
   * Returns 0.5 if BTC has moved more than trendThreshold in the current window,
   * 1.0 otherwise.
   */
  getTrendMultiplier(windowOpenPrice: Decimal, currentPrice: Decimal): number {
    const move = currentPrice.minus(windowOpenPrice).abs();
    if (move.gte(this.config.trendThreshold)) {
      logger.debug('Trend regime detected, reducing Kelly', {
        btcMove: move.toFixed(2),
        threshold: this.config.trendThreshold,
      });
      return 0.5;
    }
    return 1.0;
  }

  /**
   * Reset per-window position tracking.
   */
  resetWindowPosition(windowTs: number): void {
    this.currentWindowTs = windowTs;
    this.windowUpSpent = new Decimal(0);
    this.windowDownSpent = new Decimal(0);
  }

  /**
   * Record a fill for per-window position tracking.
   */
  addWindowPosition(side: Direction, cost: Decimal): void {
    if (side === 'UP') {
      this.windowUpSpent = this.windowUpSpent.plus(cost);
    } else {
      this.windowDownSpent = this.windowDownSpent.plus(cost);
    }
  }

  getWindowPosition(side: Direction): Decimal {
    return side === 'UP' ? this.windowUpSpent : this.windowDownSpent;
  }

  /**
   * Record a completed window with its P&L.
   */
  async recordWindowResult(pnl: WindowPnL): Promise<void> {
    this.checkDailyReset();

    if (pnl.numTrades === 0) {
      this.stats.windowsSkipped++;
    } else {
      this.stats.windowsTraded++;
      this.stats.totalTrades += pnl.numTrades;
      this.stats.dailyVolume = this.stats.dailyVolume.plus(pnl.totalVolume);
      this.stats.lastTradeTime = pnl.timeOfLastTrade || Date.now();

      if (pnl.grossPnl.gte(0)) {
        this.stats.wins++;
        this.stats.totalProfit = this.stats.totalProfit.plus(pnl.grossPnl);
        this.stats.consecutiveLosses = 0;
      } else {
        this.stats.losses++;
        this.stats.totalLoss = this.stats.totalLoss.plus(pnl.grossPnl.abs());
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
          });
        }
      }

      this.stats.dailyProfit = this.stats.dailyProfit.plus(pnl.grossPnl);
      this.stats.sessionPnl = this.stats.sessionPnl.plus(pnl.grossPnl);

      // Update win rate
      const totalDecisions = this.stats.wins + this.stats.losses;
      this.stats.winRate = totalDecisions > 0 ? this.stats.wins / totalDecisions : 0;

      // Update avg edge
      if (!pnl.avgEdgeAtFill.isZero()) {
        const n = new Decimal(this.stats.windowsTraded);
        this.stats.avgEdgeAtFill = this.stats.avgEdgeAtFill
          .plus(pnl.avgEdgeAtFill.minus(this.stats.avgEdgeAtFill).div(n));
      }
    }

    this.stats.totalWindows++;
    await this.persistStats();
  }

  /**
   * Record paper trading fill quality metrics.
   */
  recordPaperFill(simResult: SimulatedTradeResult): void {
    this.stats.paperFills++;
    if (simResult.partialFill) this.stats.paperPartialFills++;
    if (simResult.missedFill) this.stats.paperMissedFills++;

    const n = new Decimal(this.stats.paperFills);
    this.stats.paperAvgFillRatio = new Decimal(this.stats.paperAvgFillRatio)
      .plus(new Decimal(simResult.fillRatio).minus(this.stats.paperAvgFillRatio).div(n))
      .toNumber();
    this.stats.paperAvgSlippageBps = new Decimal(this.stats.paperAvgSlippageBps)
      .plus(new Decimal(simResult.slippageBps).minus(this.stats.paperAvgSlippageBps).div(n))
      .toNumber();
  }

  getStats(): LatencyStats {
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
      });
      this.stats.dailyProfit = new Decimal(0);
      this.stats.dailyVolume = new Decimal(0);
      this.stats.dailyProfitDate = today;
      this.pauseUntil = 0;
      this.stats.consecutiveLosses = 0;
    }
  }

  private async persistStats(): Promise<void> {
    try {
      await this.redis.hmset(STATS_KEY, {
        totalWindows: this.stats.totalWindows.toString(),
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
        totalTrades: this.stats.totalTrades.toString(),
        avgEdgeAtFill: this.stats.avgEdgeAtFill.toString(),
        consecutiveLosses: this.stats.consecutiveLosses.toString(),
        maxConsecutiveLosses: this.stats.maxConsecutiveLosses.toString(),
        oracleDivergenceEvents: this.stats.oracleDivergenceEvents.toString(),
        lastTradeTime: this.stats.lastTradeTime.toString(),
        paperFills: this.stats.paperFills.toString(),
        paperPartialFills: this.stats.paperPartialFills.toString(),
        paperMissedFills: this.stats.paperMissedFills.toString(),
        paperAvgFillRatio: this.stats.paperAvgFillRatio.toString(),
        paperAvgSlippageBps: this.stats.paperAvgSlippageBps.toString(),
      });
    } catch (error) {
      logger.error('Failed to persist stats to Redis');
    }
  }

  private todayStr(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private defaultStats(): LatencyStats {
    return {
      totalWindows: 0,
      windowsTraded: 0,
      windowsSkipped: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalProfit: new Decimal(0),
      totalLoss: new Decimal(0),
      sessionPnl: new Decimal(0),
      dailyProfit: new Decimal(0),
      dailyProfitDate: this.todayStr(),
      dailyVolume: new Decimal(0),
      totalTrades: 0,
      avgEdgeAtFill: new Decimal(0),
      consecutiveLosses: 0,
      maxConsecutiveLosses: 0,
      oracleDivergenceEvents: 0,
      lastTradeTime: 0,
      paperFills: 0,
      paperPartialFills: 0,
      paperMissedFills: 0,
      paperAvgFillRatio: 0,
      paperAvgSlippageBps: 0,
    };
  }
}
