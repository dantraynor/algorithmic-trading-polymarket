import Decimal from 'decimal.js';
import { MomentumSignal } from '../momentum-signal';
import { BinanceFeed } from '../binance-feed';
import { OrderbookChecker } from '../orderbook-checker';
import { Config, MarketInfo } from '../types';

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

const testMarket: MarketInfo = {
  slug: 'btc-updown-5m-1700000000',
  conditionId: '0xabc',
  upTokenId: 'token-up-123',
  downTokenId: 'token-down-456',
  windowTimestamp: 1700000000,
  windowCloseTimestamp: 1700000300,
};

function createMocks() {
  const binanceFeed = {
    getDirection: jest.fn(),
  } as unknown as BinanceFeed;

  const orderbookChecker = {
    fetchOrderBook: jest.fn(),
    getAvailableLiquidity: jest.fn(),
  } as unknown as OrderbookChecker;

  const signal = new MomentumSignal(baseConfig, binanceFeed, orderbookChecker);
  return { signal, binanceFeed, orderbookChecker };
}

describe('MomentumSignal', () => {
  describe('evaluate', () => {
    it('returns null when no direction available', async () => {
      const { signal, binanceFeed } = createMocks();
      (binanceFeed.getDirection as jest.Mock).mockReturnValue(null);

      const result = await signal.evaluate(testMarket, 1700000000);
      expect(result).toBeNull();
    });

    it('returns null when direction is FLAT', async () => {
      const { signal, binanceFeed } = createMocks();
      (binanceFeed.getDirection as jest.Mock).mockReturnValue({
        direction: 'FLAT',
        deltaBps: 2,
        currentPrice: new Decimal('100002'),
        openPrice: new Decimal('100000'),
      });

      const result = await signal.evaluate(testMarket, 1700000000);
      expect(result).toBeNull();
    });

    it('returns null when orderbook has no asks', async () => {
      const { signal, binanceFeed, orderbookChecker } = createMocks();
      (binanceFeed.getDirection as jest.Mock).mockReturnValue({
        direction: 'UP',
        deltaBps: 10,
        currentPrice: new Decimal('100100'),
        openPrice: new Decimal('100000'),
      });
      (orderbookChecker.fetchOrderBook as jest.Mock).mockResolvedValue({
        asks: [],
        bids: [],
        fetchedAt: Date.now(),
      });

      const result = await signal.evaluate(testMarket, 1700000000);
      expect(result).toBeNull();
    });

    it('returns null when best ask is below minEntryPrice', async () => {
      const { signal, binanceFeed, orderbookChecker } = createMocks();
      (binanceFeed.getDirection as jest.Mock).mockReturnValue({
        direction: 'UP',
        deltaBps: 10,
        currentPrice: new Decimal('100100'),
        openPrice: new Decimal('100000'),
      });
      (orderbookChecker.fetchOrderBook as jest.Mock).mockResolvedValue({
        asks: [{ price: '0.70', size: '50' }], // Below 0.85 threshold
        bids: [],
        fetchedAt: Date.now(),
      });

      const result = await signal.evaluate(testMarket, 1700000000);
      expect(result).toBeNull();
    });

    it('returns null when best ask is above maxEntryPrice', async () => {
      const { signal, binanceFeed, orderbookChecker } = createMocks();
      (binanceFeed.getDirection as jest.Mock).mockReturnValue({
        direction: 'UP',
        deltaBps: 10,
        currentPrice: new Decimal('100100'),
        openPrice: new Decimal('100000'),
      });
      (orderbookChecker.fetchOrderBook as jest.Mock).mockResolvedValue({
        asks: [{ price: '0.98', size: '50' }], // Above 0.95 threshold
        bids: [],
        fetchedAt: Date.now(),
      });

      const result = await signal.evaluate(testMarket, 1700000000);
      expect(result).toBeNull();
    });

    it('returns null when insufficient liquidity', async () => {
      const { signal, binanceFeed, orderbookChecker } = createMocks();
      (binanceFeed.getDirection as jest.Mock).mockReturnValue({
        direction: 'UP',
        deltaBps: 10,
        currentPrice: new Decimal('100100'),
        openPrice: new Decimal('100000'),
      });
      (orderbookChecker.fetchOrderBook as jest.Mock).mockResolvedValue({
        asks: [{ price: '0.90', size: '50' }],
        bids: [],
        fetchedAt: Date.now(),
      });
      (orderbookChecker.getAvailableLiquidity as jest.Mock).mockReturnValue(null);

      const result = await signal.evaluate(testMarket, 1700000000);
      expect(result).toBeNull();
    });

    it('returns MomentumDecision for UP direction with good liquidity', async () => {
      const { signal, binanceFeed, orderbookChecker } = createMocks();
      (binanceFeed.getDirection as jest.Mock).mockReturnValue({
        direction: 'UP',
        deltaBps: 10,
        currentPrice: new Decimal('100100'),
        openPrice: new Decimal('100000'),
      });
      (orderbookChecker.fetchOrderBook as jest.Mock).mockResolvedValue({
        asks: [{ price: '0.90', size: '50' }],
        bids: [],
        fetchedAt: Date.now(),
      });
      (orderbookChecker.getAvailableLiquidity as jest.Mock).mockReturnValue({
        availableShares: new Decimal('50'),
        vwapPrice: new Decimal('0.90'),
        worstPrice: new Decimal('0.90'),
        totalCost: new Decimal('45'),
      });

      const result = await signal.evaluate(testMarket, 1700000000);
      expect(result).not.toBeNull();
      expect(result!.direction).toBe('UP');
      expect(result!.tokenId).toBe('token-up-123');
      expect(result!.entryPrice.toNumber()).toBe(0.9);
      expect(result!.shares.toNumber()).toBe(50);
      expect(result!.expectedProfit.toNumber()).toBeCloseTo(5, 1); // (1 - 0.90) * 50 = 5
      expect(result!.deltaBps).toBe(10);
    });

    it('selects DOWN token for DOWN direction', async () => {
      const { signal, binanceFeed, orderbookChecker } = createMocks();
      (binanceFeed.getDirection as jest.Mock).mockReturnValue({
        direction: 'DOWN',
        deltaBps: -15,
        currentPrice: new Decimal('99850'),
        openPrice: new Decimal('100000'),
      });
      (orderbookChecker.fetchOrderBook as jest.Mock).mockResolvedValue({
        asks: [{ price: '0.92', size: '30' }],
        bids: [],
        fetchedAt: Date.now(),
      });
      (orderbookChecker.getAvailableLiquidity as jest.Mock).mockReturnValue({
        availableShares: new Decimal('30'),
        vwapPrice: new Decimal('0.92'),
        worstPrice: new Decimal('0.92'),
        totalCost: new Decimal('27.6'),
      });

      const result = await signal.evaluate(testMarket, 1700000000);
      expect(result).not.toBeNull();
      expect(result!.direction).toBe('DOWN');
      expect(result!.tokenId).toBe('token-down-456');
    });

    it('caps shares when totalCost exceeds maxBetUsdc', async () => {
      const { signal, binanceFeed, orderbookChecker } = createMocks();
      (binanceFeed.getDirection as jest.Mock).mockReturnValue({
        direction: 'UP',
        deltaBps: 10,
        currentPrice: new Decimal('100100'),
        openPrice: new Decimal('100000'),
      });
      (orderbookChecker.fetchOrderBook as jest.Mock).mockResolvedValue({
        asks: [{ price: '0.90', size: '200' }],
        bids: [],
        fetchedAt: Date.now(),
      });
      (orderbookChecker.getAvailableLiquidity as jest.Mock).mockReturnValue({
        availableShares: new Decimal('200'),
        vwapPrice: new Decimal('0.90'),
        worstPrice: new Decimal('0.90'),
        totalCost: new Decimal('180'), // Exceeds maxBetUsdc of 100
      });

      const result = await signal.evaluate(testMarket, 1700000000);
      expect(result).not.toBeNull();
      // Scaled down: 200 * (100/180) ≈ 111.11
      expect(result!.shares.toNumber()).toBeLessThanOrEqual(112);
      expect(result!.totalCost.toNumber()).toBeLessThanOrEqual(101);
    });
  });
});
