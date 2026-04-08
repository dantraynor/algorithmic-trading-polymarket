import Decimal from 'decimal.js';
import { MomentumRiskManager } from '../risk-manager';
import { Config } from '../types';

const baseConfig: Config = {
  clobApiUrl: 'https://fake',
  clobApiKey: '',
  clobApiSecret: '',
  clobPassphrase: '',
  gammaApiUrl: 'https://fake',
  privateKey: '',
  gnosisSafeAddress: '',
  signatureType: 0,
  negRiskCtfExchangeAddress: '',
  chainId: 137,
  redisSocketPath: '/tmp/redis.sock',
  binanceWsUrl: 'wss://fake',
  entrySecondsBefore: 10,
  minDirectionBps: 5,
  minEntryPrice: 0.85,
  maxEntryPrice: 0.95,
  maxBetUsdc: 100,
  maxOrderShares: 80,
  maxDailyLossUsdc: 300,
  maxConsecutiveLosses: 5,
  streakPauseMinutes: 30,
  dryRun: true,
};

// Mock Redis
function createMockRedis() {
  const store: Record<string, string> = {
    TRADING_ENABLED: 'TRUE',
    BTC_5M_MOMENTUM_TRADING_ENABLED: 'TRUE',
  };
  const hashStore: Record<string, Record<string, string>> = {};

  return {
    get: jest.fn(async (key: string) => store[key] || null),
    set: jest.fn(async (key: string, value: string) => { store[key] = value; }),
    hgetall: jest.fn(async (key: string) => hashStore[key] || {}),
    hmset: jest.fn(async (key: string, data: Record<string, string>) => {
      hashStore[key] = { ...(hashStore[key] || {}), ...data };
    }),
    _store: store,
    _hashStore: hashStore,
  };
}

describe('MomentumRiskManager', () => {
  describe('canTrade', () => {
    it('allows trading when all switches enabled', async () => {
      const redis = createMockRedis();
      const rm = new MomentumRiskManager(baseConfig, redis as any);
      await rm.initialize();

      const result = await rm.canTrade();
      expect(result.allowed).toBe(true);
    });

    it('blocks when global kill switch disabled', async () => {
      const redis = createMockRedis();
      redis._store['TRADING_ENABLED'] = 'FALSE';
      const rm = new MomentumRiskManager(baseConfig, redis as any);

      const result = await rm.canTrade();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Global kill switch');
    });

    it('blocks when momentum kill switch disabled', async () => {
      const redis = createMockRedis();
      redis._store['BTC_5M_MOMENTUM_TRADING_ENABLED'] = 'FALSE';
      const rm = new MomentumRiskManager(baseConfig, redis as any);

      const result = await rm.canTrade();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Momentum kill switch');
    });

    it('blocks when global kill switch missing (fail-closed)', async () => {
      const redis = createMockRedis();
      delete redis._store['TRADING_ENABLED'];
      const rm = new MomentumRiskManager(baseConfig, redis as any);

      const result = await rm.canTrade();
      expect(result.allowed).toBe(false);
    });
  });

  describe('recordTrade', () => {
    it('tracks wins correctly', async () => {
      const redis = createMockRedis();
      const rm = new MomentumRiskManager(baseConfig, redis as any);
      await rm.initialize();

      await rm.recordTrade('UP', new Decimal('0.90'), new Decimal('50'), true);

      const stats = rm.getStats();
      expect(stats.wins).toBe(1);
      expect(stats.losses).toBe(0);
      expect(stats.winRate).toBe(1);
      expect(stats.consecutiveLosses).toBe(0);
      // Profit: (1 - 0.90) * 50 = 5
      expect(stats.dailyProfit.toNumber()).toBeCloseTo(5, 2);
    });

    it('tracks losses correctly', async () => {
      const redis = createMockRedis();
      const rm = new MomentumRiskManager(baseConfig, redis as any);
      await rm.initialize();

      await rm.recordTrade('DOWN', new Decimal('0.90'), new Decimal('50'), false);

      const stats = rm.getStats();
      expect(stats.wins).toBe(0);
      expect(stats.losses).toBe(1);
      expect(stats.winRate).toBe(0);
      expect(stats.consecutiveLosses).toBe(1);
      // Loss: -0.90 * 50 = -45
      expect(stats.dailyProfit.toNumber()).toBeCloseTo(-45, 2);
    });

    it('resets consecutive losses on win', async () => {
      const redis = createMockRedis();
      const rm = new MomentumRiskManager(baseConfig, redis as any);
      await rm.initialize();

      await rm.recordTrade('UP', new Decimal('0.90'), new Decimal('10'), false);
      await rm.recordTrade('UP', new Decimal('0.90'), new Decimal('10'), false);
      expect(rm.getStats().consecutiveLosses).toBe(2);

      await rm.recordTrade('UP', new Decimal('0.90'), new Decimal('10'), true);
      expect(rm.getStats().consecutiveLosses).toBe(0);
    });

    it('calculates win rate correctly', async () => {
      const redis = createMockRedis();
      const rm = new MomentumRiskManager(baseConfig, redis as any);
      await rm.initialize();

      await rm.recordTrade('UP', new Decimal('0.90'), new Decimal('10'), true);
      await rm.recordTrade('UP', new Decimal('0.90'), new Decimal('10'), true);
      await rm.recordTrade('UP', new Decimal('0.90'), new Decimal('10'), false);

      const stats = rm.getStats();
      expect(stats.winRate).toBeCloseTo(2 / 3, 4);
    });
  });

  describe('streak pause', () => {
    it('triggers pause after maxConsecutiveLosses', async () => {
      const redis = createMockRedis();
      const config = { ...baseConfig, maxConsecutiveLosses: 3, streakPauseMinutes: 30 };
      const rm = new MomentumRiskManager(config, redis as any);
      await rm.initialize();

      // Record 3 consecutive losses
      for (let i = 0; i < 3; i++) {
        await rm.recordTrade('UP', new Decimal('0.90'), new Decimal('10'), false);
      }

      const result = await rm.canTrade();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Streak pause');
    });

    it('allows trading before maxConsecutiveLosses', async () => {
      const redis = createMockRedis();
      const config = { ...baseConfig, maxConsecutiveLosses: 5 };
      const rm = new MomentumRiskManager(config, redis as any);
      await rm.initialize();

      // Record 4 losses (1 below threshold)
      for (let i = 0; i < 4; i++) {
        await rm.recordTrade('UP', new Decimal('0.90'), new Decimal('10'), false);
      }

      const result = await rm.canTrade();
      expect(result.allowed).toBe(true);
    });
  });

  describe('daily loss cap', () => {
    it('auto-halts when daily loss exceeds cap', async () => {
      const redis = createMockRedis();
      const config = { ...baseConfig, maxDailyLossUsdc: 50 };
      const rm = new MomentumRiskManager(config, redis as any);
      await rm.initialize();

      // Lose $60 (entry 0.90 * 100 shares = $90 lost)
      await rm.recordTrade('UP', new Decimal('0.90'), new Decimal('100'), false);

      const result = await rm.canTrade();
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Daily loss limit');
      // Kill switch should be set to FALSE
      expect(redis.set).toHaveBeenCalledWith('BTC_5M_MOMENTUM_TRADING_ENABLED', 'FALSE');
    });
  });

  describe('paper trading stats', () => {
    it('tracks paper trading stats when simResult is provided', async () => {
      const redis = createMockRedis();
      const rm = new MomentumRiskManager(baseConfig, redis as any);
      await rm.initialize();

      const simResult = {
        success: true,
        fillShares: new Decimal('45'),
        requestedShares: new Decimal('50'),
        fillPrice: new Decimal('0.906'),
        requestedPrice: new Decimal('0.92'),
        slippageBps: 2.5,
        fillRatio: 0.9,
        partialFill: true,
        missedFill: false,
        bookDepthLevels: 3,
        bestAskPrice: new Decimal('0.88'),
        totalCost: new Decimal('40.77'),
        latencyMs: 15,
      };

      await rm.recordTrade('UP', new Decimal('0.906'), new Decimal('45'), true, simResult);

      const stats = rm.getStats();
      expect(stats.paperFills).toBe(1);
      expect(stats.paperPartialFills).toBe(1);
      expect(stats.paperMissedFills).toBe(0);
      expect(stats.paperAvgFillRatio).toBeCloseTo(0.9, 2);
      expect(stats.paperAvgSlippageBps).toBeCloseTo(2.5, 1);
      expect(stats.paperAvgEntryPrice).toBeCloseTo(0.906, 3);
    });

    it('tracks missed fills via recordSkip', async () => {
      const redis = createMockRedis();
      const rm = new MomentumRiskManager(baseConfig, redis as any);
      await rm.initialize();

      const simResult = {
        success: false,
        fillShares: new Decimal('0'),
        requestedShares: new Decimal('50'),
        fillPrice: new Decimal('0'),
        requestedPrice: new Decimal('0.92'),
        slippageBps: 0,
        fillRatio: 0,
        partialFill: false,
        missedFill: true,
        bookDepthLevels: 0,
        bestAskPrice: new Decimal('0'),
        totalCost: new Decimal('0'),
        latencyMs: 5,
      };

      await rm.recordSkip(simResult);

      const stats = rm.getStats();
      expect(stats.paperFills).toBe(0);
      expect(stats.paperMissedFills).toBe(1);
      expect(stats.paperAvgFillRatio).toBe(0);
    });
  });

  describe('window tracking', () => {
    it('increments window and skip counters', async () => {
      const redis = createMockRedis();
      const rm = new MomentumRiskManager(baseConfig, redis as any);
      await rm.initialize();

      await rm.recordWindow();
      await rm.recordSkip();
      await rm.recordWindow();

      const stats = rm.getStats();
      expect(stats.totalWindows).toBe(2);
      expect(stats.windowsEvaluated).toBe(2);
      expect(stats.windowsSkipped).toBe(1);
    });
  });
});
