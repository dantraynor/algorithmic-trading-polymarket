import { describe, it, expect, beforeEach } from 'vitest';
import { PositionManager } from '../src/position-manager';
import { PositionRecord, SignalSource } from '../../shared/src/alpha-types';

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

function makePosition(overrides: Partial<PositionRecord> = {}): PositionRecord {
  return {
    marketId: 'market-1',
    tokenId: 'token-1',
    direction: 'YES',
    shares: 100,
    entryPrice: 0.80,
    entryCost: 80,
    entryTime: Date.now(),
    source: 'crypto',
    signalId: 'sig-1',
    ...overrides,
  };
}

describe('PositionManager', () => {
  let pm: PositionManager;
  let redis: MockRedis;

  beforeEach(() => {
    redis = new MockRedis();
    pm = new PositionManager(redis as any);
  });

  it('opens and retrieves a position', async () => {
    const pos = makePosition();
    await pm.openPosition(pos);
    const retrieved = await pm.getPosition('market-1');
    expect(retrieved).toBeDefined();
    expect(retrieved!.tokenId).toBe('token-1');
    expect(retrieved!.shares).toBe(100);
  });

  it('tracks total exposure after opening', async () => {
    await pm.openPosition(makePosition({ entryCost: 80 }));
    await pm.openPosition(makePosition({ marketId: 'market-2', entryCost: 50 }));
    const exposure = await pm.getTotalExposure();
    expect(exposure).toBe(130);
  });

  it('reduces exposure after closing', async () => {
    await pm.openPosition(makePosition({ entryCost: 80 }));
    await pm.closePosition('market-1');
    const exposure = await pm.getTotalExposure();
    expect(exposure).toBe(0);
  });

  it('tracks positions by vertical', async () => {
    await pm.openPosition(makePosition({ source: 'crypto' }));
    await pm.openPosition(makePosition({ marketId: 'm2', source: 'crypto' }));
    const markets = await pm.getPositionsByVertical('crypto');
    expect(markets).toHaveLength(2);
  });

  it('checks if position exists for market', async () => {
    await pm.openPosition(makePosition());
    expect(await pm.hasPosition('market-1')).toBe(true);
    expect(await pm.hasPosition('market-2')).toBe(false);
  });

  it('getVerticalExposure sums costs for one vertical', async () => {
    await pm.openPosition(makePosition({ source: 'crypto', entryCost: 80 }));
    await pm.openPosition(makePosition({ marketId: 'm2', source: 'crypto', entryCost: 60 }));
    await pm.openPosition(makePosition({ marketId: 'm3', source: 'sports', entryCost: 100 }));
    const cryptoExposure = await pm.getVerticalExposure('crypto');
    expect(cryptoExposure).toBe(140);
  });
});
