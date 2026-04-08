import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignalProcessor } from '../src/signal-processor';
import { PortfolioRiskManager } from '../src/risk-manager';
import { PositionManager } from '../src/position-manager';
import { AlphaSignal, PortfolioState } from '../../shared/src/alpha-types';

class MockRedis {
  private store = new Map<string, string>();
  private sets = new Map<string, Set<string>>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async set(key: string, value: string) { this.store.set(key, value); }
  async del(key: string) { this.store.delete(key); this.sets.delete(key); }
  async sadd(key: string, ...members: string[]) {
    if (!this.sets.has(key)) this.sets.set(key, new Set());
    members.forEach(m => this.sets.get(key)!.add(m));
  }
  async srem(key: string, ...members: string[]) {
    if (this.sets.has(key)) members.forEach(m => this.sets.get(key)!.delete(m));
  }
  async smembers(key: string) { return Array.from(this.sets.get(key) ?? []); }
  async scard(key: string) { return (this.sets.get(key) ?? new Set()).size; }
  async incrbyfloat(key: string, amount: number) {
    const current = parseFloat(this.store.get(key) ?? '0');
    const next = current + amount;
    this.store.set(key, next.toString());
    return next.toString();
  }
}

describe('Integration: Signal → Risk → Size → Execute Decision', () => {
  let redis: MockRedis;
  let riskManager: PortfolioRiskManager;
  let positionManager: PositionManager;
  let processor: SignalProcessor;

  beforeEach(() => {
    redis = new MockRedis();
    riskManager = new PortfolioRiskManager(redis as any);
    positionManager = new PositionManager(redis as any);
    processor = new SignalProcessor(riskManager, positionManager, 0);
  });

  function makeSignal(overrides: Partial<AlphaSignal> = {}): AlphaSignal {
    return {
      id: 'integration-test-1',
      source: 'crypto',
      marketId: 'market-btc-5m-12345',
      tokenId: 'token-up-abc',
      direction: 'YES',
      confidence: 0.90,
      currentAsk: 0.75,
      edge: 0.15,
      availableLiquidity: 5000,
      urgency: 'immediate',
      ttlMs: 500,
      timestampMs: Date.now(),
      metadata: { asset: 'btcusdt', direction: 'UP' },
      ...overrides,
    };
  }

  it('approves a valid signal with correct Kelly sizing in Phase 1', async () => {
    const state: PortfolioState = {
      safeBalance: 3_000,
      totalExposure: 0,
      availableCapital: 3_000,
      peakCapital: 3_000,
      realizedPnl: 0,
      dailyLoss: 0,
      phase: 1,
      positionCount: 0,
    };

    const signal = makeSignal();
    const result = await processor.processSignal(signal, state);

    expect(result.action).toBe('execute');
    if (result.action === 'execute') {
      // Phase 1: Kelly mult=0.25, max per trade=10%
      // kelly_fraction = (0.90-0.75)/(1-0.75) = 0.15/0.25 = 0.60
      // raw = 3000 * 0.60 * 0.25 = 450
      // phase cap: 3000 * 0.10 = 300
      // final: min(450, 300, 5000) = 300
      expect(result.size).toBe(300);
    }
  });

  it('rejects signal when drawdown breaker triggered', async () => {
    const state: PortfolioState = {
      safeBalance: 2_400, // 20% drawdown from peak
      totalExposure: 0,
      availableCapital: 2_400,
      peakCapital: 3_000,
      realizedPnl: -600,
      dailyLoss: 600,
      phase: 1,
      positionCount: 0,
    };

    const signal = makeSignal();
    const result = await processor.processSignal(signal, state);

    expect(result.action).toBe('reject');
    if (result.action === 'reject') {
      expect(result.reason).toContain('drawdown');
    }
  });

  it('rejects duplicate signal for same market', async () => {
    const state: PortfolioState = {
      safeBalance: 10_000,
      totalExposure: 0,
      availableCapital: 10_000,
      peakCapital: 10_000,
      realizedPnl: 0,
      dailyLoss: 0,
      phase: 2,
      positionCount: 0,
    };

    const signal = makeSignal();
    const result1 = await processor.processSignal(signal, state);
    expect(result1.action).toBe('execute');

    const signal2 = makeSignal({ id: 'different-id' });
    const result2 = await processor.processSignal(signal2, state);
    expect(result2.action).toBe('reject');
    if (result2.action === 'reject') {
      expect(result2.reason).toContain('duplicate');
    }
  });

  it('rejects signal when existing position in market', async () => {
    const state: PortfolioState = {
      safeBalance: 10_000,
      totalExposure: 500,
      availableCapital: 9_500,
      peakCapital: 10_000,
      realizedPnl: 0,
      dailyLoss: 0,
      phase: 2,
      positionCount: 1,
    };

    await positionManager.openPosition({
      marketId: 'market-btc-5m-12345',
      tokenId: 'token-up-abc',
      direction: 'YES',
      shares: 50,
      entryPrice: 0.80,
      entryCost: 40,
      entryTime: Date.now(),
      source: 'crypto',
      signalId: 'old-signal',
    });

    const signal = makeSignal();
    const result = await processor.processSignal(signal, state);
    expect(result.action).toBe('reject');
    if (result.action === 'reject') {
      expect(result.reason).toContain('already have position');
    }
  });
});
