import { describe, it, expect, beforeEach } from 'vitest';
import { PortfolioRiskManager } from '../src/risk-manager';
import { Phase, PortfolioState } from '../../shared/src/alpha-types';

// Mock Redis for testing (in-memory)
class MockRedis {
  private store = new Map<string, string>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async set(key: string, value: string) { this.store.set(key, value); }
  async hgetall(key: string) { return {}; }
  async hmset(key: string, data: Record<string, string>) {}
  async scard(key: string) { return 0; }
}

function makeState(overrides: Partial<PortfolioState> = {}): PortfolioState {
  return {
    safeBalance: 10_000,
    totalExposure: 0,
    availableCapital: 10_000,
    peakCapital: 10_000,
    realizedPnl: 0,
    dailyLoss: 0,
    phase: 2,
    positionCount: 0,
    ...overrides,
  };
}

describe('PortfolioRiskManager', () => {
  let rm: PortfolioRiskManager;
  let redis: MockRedis;

  beforeEach(() => {
    redis = new MockRedis();
    rm = new PortfolioRiskManager(redis as any);
  });

  describe('determinePhase', () => {
    it('returns phase 1 below $10K', () => {
      expect(rm.determinePhase(3_000)).toBe(1);
      expect(rm.determinePhase(9_999)).toBe(1);
    });

    it('returns phase 2 at $10K-$100K', () => {
      expect(rm.determinePhase(10_000)).toBe(2);
      expect(rm.determinePhase(50_000)).toBe(2);
    });

    it('returns phase 3 at $100K+', () => {
      expect(rm.determinePhase(100_000)).toBe(3);
      expect(rm.determinePhase(500_000)).toBe(3);
    });
  });

  describe('checkExposureCap', () => {
    it('allows trade within exposure cap', () => {
      const state = makeState({ totalExposure: 2_000 });
      const result = rm.checkExposureCap(state, 3_000);
      expect(result.allowed).toBe(true);
    });

    it('rejects trade exceeding exposure cap', () => {
      const state = makeState({ totalExposure: 5_500 });
      const result = rm.checkExposureCap(state, 1_000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('exposure');
    });

    it('adjusts size to fit within cap', () => {
      const state = makeState({ totalExposure: 5_000 });
      const result = rm.checkExposureCap(state, 2_000);
      expect(result.allowed).toBe(true);
      expect(result.adjustedSize).toBe(1_000);
    });
  });

  describe('checkPerMarketCap', () => {
    it('allows trade within per-market cap', () => {
      const state = makeState();
      const result = rm.checkPerMarketCap(state, 2_500);
      expect(result.allowed).toBe(true);
    });

    it('rejects trade exceeding 30% of bankroll', () => {
      const state = makeState();
      const result = rm.checkPerMarketCap(state, 3_500);
      expect(result.allowed).toBe(false);
    });
  });

  describe('checkDrawdown', () => {
    it('allows trade when no drawdown', () => {
      const state = makeState({ peakCapital: 10_000 });
      const result = rm.checkDrawdown(state);
      expect(result.allowed).toBe(true);
    });

    it('halts when drawdown exceeds phase limit', () => {
      const state = makeState({ safeBalance: 7_500, peakCapital: 10_000 });
      const result = rm.checkDrawdown(state);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('drawdown');
    });
  });

  describe('checkDailyLoss', () => {
    it('allows trade when daily loss within limit', () => {
      const state = makeState({ dailyLoss: 500 });
      const result = rm.checkDailyLoss(state);
      expect(result.allowed).toBe(true);
    });

    it('halts when daily loss exceeds 10%', () => {
      const state = makeState({ dailyLoss: 1_100 });
      const result = rm.checkDailyLoss(state);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('daily loss');
    });
  });

  describe('runAllChecks', () => {
    it('passes when all rules satisfied', () => {
      const state = makeState();
      const result = rm.runAllChecks(state, 1_000);
      expect(result.allowed).toBe(true);
    });

    it('fails on first violated rule', () => {
      const state = makeState({ safeBalance: 7_500, peakCapital: 10_000 });
      const result = rm.runAllChecks(state, 1_000);
      expect(result.allowed).toBe(false);
    });
  });
});
