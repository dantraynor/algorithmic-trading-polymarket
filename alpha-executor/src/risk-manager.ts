import { createLogger, format, transports } from 'winston';
import {
  Phase,
  PhaseConfig,
  PHASE_CONFIGS,
  PortfolioState,
  RiskCheckResult,
  SignalSource,
} from '../../shared/src/alpha-types';
import {
  PHASE_2_THRESHOLD,
  PHASE_3_THRESHOLD,
  PORTFOLIO_PEAK_KEY,
  PORTFOLIO_DAILY_LOSS_KEY,
  PORTFOLIO_DAILY_LOSS_DATE_KEY,
} from '../../shared/src/constants';
import { PositionManager } from './position-manager';
import Redis from 'ioredis';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const PER_MARKET_CAP = 0.30;
const DAILY_LOSS_LIMIT = 0.10;

/** Vertical exposure caps as fraction of safeBalance */
const VERTICAL_CAPS: Partial<Record<SignalSource, number>> = {
  crypto: 0.50,  // BTC/ETH/SOL correlation 0.75-0.90
  sports: 0.40,  // long-duration settlement risk
};

/** Minimum windows traded before phase-up transitions */
const MIN_WINDOWS_FOR_PHASE_UP: Record<string, number> = {
  '1->2': 50,
  '2->3': 200,
};

/** Redis key for btc-5m-latency stats (shared EOA exposure) */
const BTC5M_LATENCY_STATS_KEY = 'btc5m_latency:stats';

/** Fraction of open sports exposure counted as potential loss */
const UNREALIZED_LOSS_HAIRCUT = 0.50;

export class PortfolioRiskManager {
  private positionManager: PositionManager | null = null;

  constructor(private redis: Redis) {}

  setPositionManager(pm: PositionManager): void {
    this.positionManager = pm;
  }

  determinePhase(capital: number, totalWindowsTraded: number = 0): Phase {
    if (capital >= PHASE_3_THRESHOLD) {
      if (totalWindowsTraded < MIN_WINDOWS_FOR_PHASE_UP['2->3']) {
        logger.info('Phase 3 capital reached but insufficient windows', {
          capital, totalWindowsTraded, required: MIN_WINDOWS_FOR_PHASE_UP['2->3'],
        });
        return 2;
      }
      return 3;
    }
    if (capital >= PHASE_2_THRESHOLD) {
      if (totalWindowsTraded < MIN_WINDOWS_FOR_PHASE_UP['1->2']) {
        logger.info('Phase 2 capital reached but insufficient windows', {
          capital, totalWindowsTraded, required: MIN_WINDOWS_FOR_PHASE_UP['1->2'],
        });
        return 1;
      }
      return 2;
    }
    return 1;
  }

  getPhaseConfig(phase: Phase): PhaseConfig {
    return PHASE_CONFIGS[phase];
  }

  async checkExposureCap(state: PortfolioState, tradeSize: number): Promise<RiskCheckResult> {
    const config = this.getPhaseConfig(state.phase);

    // Subtract btc-5m-latency exposure from available balance (shared EOA)
    let btc5mExposure = 0;
    try {
      const dailyVolStr = await this.redis.hget(BTC5M_LATENCY_STATS_KEY, 'dailyVolume');
      btc5mExposure = dailyVolStr ? parseFloat(dailyVolStr) : 0;
      if (btc5mExposure > 0) {
        logger.info('Accounting for btc-5m-latency exposure', { btc5mExposure });
      }
    } catch (err) {
      logger.warn('Failed to read btc-5m-latency stats, continuing without adjustment', { err });
    }

    const effectiveBalance = Math.max(0, state.safeBalance - btc5mExposure);
    const maxExposure = effectiveBalance * config.maxExposureRatio;
    const remainingRoom = maxExposure - state.totalExposure;
    // Minimum viable position: half of the per-trade cap for this phase
    const minViableSize = effectiveBalance * config.maxPerTradePct * 0.5;

    if (remainingRoom <= 0) {
      return { allowed: false, reason: `exposure cap reached: ${state.totalExposure.toFixed(0)}/${maxExposure.toFixed(0)} (btc5m reserve: ${btc5mExposure.toFixed(0)})` };
    }

    if (state.totalExposure + tradeSize > maxExposure) {
      if (remainingRoom < minViableSize) {
        return { allowed: false, reason: `exposure cap: remaining room ${remainingRoom.toFixed(0)} below minimum viable size ${minViableSize.toFixed(0)}` };
      }
      return { allowed: true, adjustedSize: Math.floor(remainingRoom) };
    }

    return { allowed: true };
  }

  checkPerTradeCap(state: PortfolioState, tradeSize: number): RiskCheckResult {
    const config = this.getPhaseConfig(state.phase);
    const maxTrade = state.safeBalance * config.maxPerTradePct;

    if (tradeSize > maxTrade) {
      return { allowed: true, adjustedSize: Math.floor(maxTrade) };
    }

    return { allowed: true };
  }

  checkPerMarketCap(state: PortfolioState, tradeSize: number): RiskCheckResult {
    const maxMarket = state.safeBalance * PER_MARKET_CAP;

    if (tradeSize > maxMarket) {
      return { allowed: false, reason: `per-market cap exceeded: ${tradeSize.toFixed(0)} > ${maxMarket.toFixed(0)}` };
    }

    return { allowed: true };
  }

  checkDrawdown(state: PortfolioState): RiskCheckResult {
    const config = this.getPhaseConfig(state.phase);
    if (state.peakCapital <= 0) return { allowed: true };

    const drawdown = (state.peakCapital - state.safeBalance) / state.peakCapital;

    if (drawdown >= config.maxDrawdown) {
      return {
        allowed: false,
        reason: `drawdown ${(drawdown * 100).toFixed(1)}% exceeds phase ${state.phase} limit ${(config.maxDrawdown * 100).toFixed(0)}%`,
      };
    }

    return { allowed: true };
  }

  checkDailyLoss(state: PortfolioState): RiskCheckResult {
    const maxDailyLoss = state.safeBalance * DAILY_LOSS_LIMIT;

    if (state.dailyLoss > maxDailyLoss) {
      return {
        allowed: false,
        reason: `daily loss ${state.dailyLoss.toFixed(0)} exceeds limit ${maxDailyLoss.toFixed(0)}`,
      };
    }

    return { allowed: true };
  }

  checkDailyLossWithUnrealized(state: PortfolioState, unrealizedExposure: number): RiskCheckResult {
    const maxDailyLoss = state.safeBalance * DAILY_LOSS_LIMIT;
    const potentialLoss = unrealizedExposure * UNREALIZED_LOSS_HAIRCUT;
    const effectiveLoss = state.dailyLoss + potentialLoss;

    if (effectiveLoss > maxDailyLoss) {
      return {
        allowed: false,
        reason: `daily loss with unrealized ${effectiveLoss.toFixed(0)} exceeds limit ${maxDailyLoss.toFixed(0)} (settled: ${state.dailyLoss.toFixed(0)}, unrealized haircut: ${potentialLoss.toFixed(0)})`,
      };
    }

    return { allowed: true };
  }

  async checkVerticalExposureCap(state: PortfolioState, source: SignalSource): Promise<RiskCheckResult> {
    const cap = VERTICAL_CAPS[source];
    if (cap === undefined) {
      return { allowed: true };
    }

    if (!this.positionManager) {
      logger.warn('PositionManager not set, skipping vertical exposure check');
      return { allowed: true };
    }

    const verticalExposure = await this.positionManager.getVerticalExposure(source);
    const maxVertical = state.safeBalance * cap;

    if (verticalExposure >= maxVertical) {
      return {
        allowed: false,
        reason: `${source} vertical exposure ${verticalExposure.toFixed(0)} >= cap ${maxVertical.toFixed(0)} (${(cap * 100).toFixed(0)}% of balance)`,
      };
    }

    return { allowed: true };
  }

  async runAllChecks(state: PortfolioState, tradeSize: number, source?: SignalSource, unrealizedSportsExposure?: number): Promise<RiskCheckResult> {
    const drawdown = this.checkDrawdown(state);
    if (!drawdown.allowed) return drawdown;

    const daily = this.checkDailyLoss(state);
    if (!daily.allowed) return daily;

    // Include unrealized sports exposure in loss check if provided
    if (unrealizedSportsExposure !== undefined && unrealizedSportsExposure > 0) {
      const dailyUnrealized = this.checkDailyLossWithUnrealized(state, unrealizedSportsExposure);
      if (!dailyUnrealized.allowed) return dailyUnrealized;
    }

    // Check vertical exposure cap (crypto, sports)
    if (source) {
      const vertical = await this.checkVerticalExposureCap(state, source);
      if (!vertical.allowed) return vertical;
    }

    const perMarket = this.checkPerMarketCap(state, tradeSize);
    if (!perMarket.allowed) return perMarket;

    const perTrade = this.checkPerTradeCap(state, tradeSize);
    let adjustedSize = perTrade.adjustedSize ?? tradeSize;

    const exposure = await this.checkExposureCap(state, adjustedSize);
    if (!exposure.allowed) return exposure;
    if (exposure.adjustedSize !== undefined) {
      adjustedSize = exposure.adjustedSize;
    }

    if (adjustedSize !== tradeSize) {
      return { allowed: true, adjustedSize };
    }

    return { allowed: true };
  }

  async updatePeakCapital(currentBalance: number): Promise<void> {
    const peakStr = await this.redis.get(PORTFOLIO_PEAK_KEY);
    const peak = peakStr ? parseFloat(peakStr) : 0;
    if (currentBalance > peak) {
      await this.redis.set(PORTFOLIO_PEAK_KEY, currentBalance.toString());
    }
  }

  async recordDailyLoss(loss: number): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const storedDate = await this.redis.get(PORTFOLIO_DAILY_LOSS_DATE_KEY);

    if (storedDate !== today) {
      await this.redis.set(PORTFOLIO_DAILY_LOSS_KEY, '0');
      await this.redis.set(PORTFOLIO_DAILY_LOSS_DATE_KEY, today);
    }

    const currentStr = await this.redis.get(PORTFOLIO_DAILY_LOSS_KEY);
    const current = currentStr ? parseFloat(currentStr) : 0;
    await this.redis.set(PORTFOLIO_DAILY_LOSS_KEY, (current + loss).toString());
  }
}
