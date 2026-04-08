import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SignalProcessor } from '../src/signal-processor';
import { AlphaSignal, PortfolioState } from '../../shared/src/alpha-types';

function makeSignal(overrides: Partial<AlphaSignal> = {}): AlphaSignal {
  return {
    id: 'sig-1',
    source: 'crypto',
    marketId: 'market-1',
    tokenId: 'token-1',
    direction: 'YES',
    confidence: 0.90,
    currentAsk: 0.75,
    edge: 0.15,
    availableLiquidity: 5000,
    urgency: 'immediate',
    ttlMs: 500,
    timestampMs: Date.now(),
    metadata: {},
    ...overrides,
  };
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

describe('SignalProcessor', () => {
  let processor: SignalProcessor;
  let mockRiskManager: any;
  let mockPositionManager: any;

  beforeEach(() => {
    mockRiskManager = {
      runAllChecks: vi.fn().mockReturnValue({ allowed: true }),
      getPhaseConfig: vi.fn().mockReturnValue({
        kellyMultiplier: 0.50,
        maxPerTradePct: 0.20,
        maxExposureRatio: 0.60,
        maxDrawdown: 0.20,
        phase: 2,
      }),
    };
    mockPositionManager = {
      hasPosition: vi.fn().mockResolvedValue(false),
    };
    processor = new SignalProcessor(mockRiskManager, mockPositionManager, 0);
  });

  it('rejects stale signals past TTL', () => {
    const signal = makeSignal({ timestampMs: Date.now() - 1000, ttlMs: 500 });
    const result = processor.validateSignal(signal);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('stale');
  });

  it('accepts fresh signals', () => {
    const signal = makeSignal({ timestampMs: Date.now() });
    const result = processor.validateSignal(signal);
    expect(result.valid).toBe(true);
  });

  it('rejects signals with zero or negative edge', () => {
    const signal = makeSignal({ edge: 0, confidence: 0.50, currentAsk: 0.60 });
    const result = processor.validateSignal(signal);
    expect(result.valid).toBe(false);
  });

  it('deduplicates signals for same market', () => {
    const sig1 = makeSignal({ id: 'a', confidence: 0.85 });
    const sig2 = makeSignal({ id: 'b', confidence: 0.90 });
    processor.recordSignal(sig1);
    expect(processor.isDuplicate(sig2)).toBe(true);
  });

  it('calculates bet size using Kelly', () => {
    const signal = makeSignal({ confidence: 0.95, currentAsk: 0.80, availableLiquidity: 5000 });
    const state = makeState({ availableCapital: 10_000 });
    const size = processor.calculateBetSize(signal, state);
    // kelly_fraction = 0.15/0.20 = 0.75, half Kelly = 10000 * 0.75 * 0.50 = 3750
    // capped by phase max 20% = 2000
    expect(size).toBe(2000);
  });
});
