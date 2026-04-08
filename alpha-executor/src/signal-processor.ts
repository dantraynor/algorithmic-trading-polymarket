import { createLogger, format, transports } from 'winston';
import { AlphaSignal, PortfolioState, RiskCheckResult } from '../../shared/src/alpha-types';
import { kellyBetSize } from './kelly';
import { PortfolioRiskManager } from './risk-manager';
import { PositionManager } from './position-manager';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const DEDUP_WINDOW_MS = 5_000;

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export class SignalProcessor {
  private recentSignals = new Map<string, { signalId: string; confidence: number; timestamp: number }>();
  private takerFeeBps: number;

  constructor(
    private riskManager: PortfolioRiskManager,
    private positionManager: PositionManager,
    takerFeeBps: number = 0,
  ) {
    this.takerFeeBps = takerFeeBps;
  }

  validateSignal(signal: AlphaSignal): ValidationResult {
    const age = Date.now() - signal.timestampMs;
    if (age > signal.ttlMs) {
      return { valid: false, reason: `stale signal: age ${age}ms > ttl ${signal.ttlMs}ms` };
    }

    if (signal.edge <= 0 || signal.confidence <= signal.currentAsk) {
      return { valid: false, reason: `no edge: confidence ${signal.confidence} <= ask ${signal.currentAsk}` };
    }

    if (signal.availableLiquidity <= 0) {
      return { valid: false, reason: 'no liquidity' };
    }

    return { valid: true };
  }

  isDuplicate(signal: AlphaSignal): boolean {
    const existing = this.recentSignals.get(signal.marketId);
    if (!existing) return false;

    const age = Date.now() - existing.timestamp;
    if (age > DEDUP_WINDOW_MS) {
      this.recentSignals.delete(signal.marketId);
      return false;
    }

    return true;
  }

  recordSignal(signal: AlphaSignal): void {
    this.recentSignals.set(signal.marketId, {
      signalId: signal.id,
      confidence: signal.confidence,
      timestamp: Date.now(),
    });
  }

  calculateBetSize(signal: AlphaSignal, state: PortfolioState): number {
    const config = this.riskManager.getPhaseConfig(state.phase);

    const rawSize = kellyBetSize(
      signal.confidence,
      signal.currentAsk,
      state.availableCapital,
      config.kellyMultiplier,
      config.maxPerTradePct,
      signal.availableLiquidity,
      this.takerFeeBps,
    );

    return Math.floor(rawSize);
  }

  async processSignal(
    signal: AlphaSignal,
    state: PortfolioState,
  ): Promise<{ action: 'execute'; size: number } | { action: 'reject'; reason: string }> {
    const validation = this.validateSignal(signal);
    if (!validation.valid) {
      return { action: 'reject', reason: validation.reason! };
    }

    if (this.isDuplicate(signal)) {
      return { action: 'reject', reason: 'duplicate signal for market' };
    }

    if (await this.positionManager.hasPosition(signal.marketId)) {
      return { action: 'reject', reason: 'already have position in this market' };
    }

    const size = this.calculateBetSize(signal, state);
    if (size <= 0) {
      return { action: 'reject', reason: 'bet size too small after Kelly sizing' };
    }

    // Get unrealized sports exposure for loss limit check
    let unrealizedSportsExposure: number | undefined;
    if (signal.source === 'sports') {
      unrealizedSportsExposure = await this.positionManager.getVerticalExposure('sports');
    }

    const riskResult = await this.riskManager.runAllChecks(state, size, signal.source, unrealizedSportsExposure);
    if (!riskResult.allowed) {
      return { action: 'reject', reason: riskResult.reason! };
    }

    const finalSize = riskResult.adjustedSize ?? size;
    if (finalSize <= 0) {
      return { action: 'reject', reason: 'size reduced to 0 by risk limits' };
    }

    this.recordSignal(signal);
    return { action: 'execute', size: finalSize };
  }

  pruneStaleEntries(): void {
    const now = Date.now();
    for (const [key, entry] of this.recentSignals) {
      if (now - entry.timestamp > DEDUP_WINDOW_MS) {
        this.recentSignals.delete(key);
      }
    }
  }
}
