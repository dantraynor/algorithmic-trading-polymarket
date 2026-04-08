import Decimal from 'decimal.js';
import { BinanceFeed } from '../binance-feed';

// We test the price/direction logic without a real WebSocket connection.
// BinanceFeed's internal state can be set via recordWindowOpen and
// by accessing private fields through 'as any'.

function createFeed(minDirectionBps = 5): BinanceFeed {
  return new BinanceFeed('wss://fake', minDirectionBps);
}

function setCurrentPrice(feed: BinanceFeed, price: string): void {
  (feed as any).currentPrice = new Decimal(price);
  (feed as any).lastUpdateMs = Date.now();
  (feed as any).isConnected = true;
}

describe('BinanceFeed', () => {
  describe('getDirection', () => {
    it('returns null when no open price recorded', () => {
      const feed = createFeed();
      setCurrentPrice(feed, '100000');
      expect(feed.getDirection(1700000000)).toBeNull();
    });

    it('returns null when no current price', () => {
      const feed = createFeed();
      // No setCurrentPrice call
      (feed as any).windowOpenPrices.set(1700000000, new Decimal('100000'));
      expect(feed.getDirection(1700000000)).toBeNull();
    });

    it('returns UP when price increased beyond threshold', () => {
      const feed = createFeed(5);
      (feed as any).windowOpenPrices.set(1700000000, new Decimal('100000'));
      (feed as any).currentPrice = new Decimal('100060'); // +60 = 6 bps (above 5 bps threshold)

      const result = feed.getDirection(1700000000);
      expect(result).not.toBeNull();
      expect(result!.direction).toBe('UP');
      expect(result!.deltaBps).toBeCloseTo(6.0, 1); // 60/100000 * 10000 = 6 bps
    });

    it('returns UP for strong upward move', () => {
      const feed = createFeed(5);
      (feed as any).windowOpenPrices.set(1700000000, new Decimal('100000'));
      (feed as any).currentPrice = new Decimal('100100'); // +100 = 10 bps

      const result = feed.getDirection(1700000000);
      expect(result!.direction).toBe('UP');
      expect(result!.deltaBps).toBeCloseTo(10.0, 1);
    });

    it('returns DOWN when price decreased beyond threshold', () => {
      const feed = createFeed(5);
      (feed as any).windowOpenPrices.set(1700000000, new Decimal('100000'));
      (feed as any).currentPrice = new Decimal('99900'); // -100 = -10 bps

      const result = feed.getDirection(1700000000);
      expect(result!.direction).toBe('DOWN');
      expect(result!.deltaBps).toBeCloseTo(-10.0, 1);
    });

    it('returns FLAT when movement is below threshold', () => {
      const feed = createFeed(5);
      (feed as any).windowOpenPrices.set(1700000000, new Decimal('100000'));
      (feed as any).currentPrice = new Decimal('100002'); // +2 = 0.2 bps

      const result = feed.getDirection(1700000000);
      expect(result!.direction).toBe('FLAT');
    });

    it('returns FLAT when price unchanged', () => {
      const feed = createFeed(5);
      (feed as any).windowOpenPrices.set(1700000000, new Decimal('100000'));
      (feed as any).currentPrice = new Decimal('100000');

      const result = feed.getDirection(1700000000);
      expect(result!.direction).toBe('FLAT');
      expect(result!.deltaBps).toBe(0);
    });
  });

  describe('recordWindowOpen', () => {
    it('stores the current price as window open', () => {
      const feed = createFeed();
      setCurrentPrice(feed, '98765.43');
      feed.recordWindowOpen(1700000000);

      const stored = (feed as any).windowOpenPrices.get(1700000000);
      expect(stored.toString()).toBe('98765.43');
    });

    it('does not record when no current price', () => {
      const feed = createFeed();
      feed.recordWindowOpen(1700000000);
      expect((feed as any).windowOpenPrices.size).toBe(0);
    });

    it('prunes old entries beyond MAX_CACHED_WINDOWS', () => {
      const feed = createFeed();
      setCurrentPrice(feed, '100000');

      // Record 6 windows (max is 5)
      for (let i = 0; i < 6; i++) {
        feed.recordWindowOpen(1700000000 + i * 300);
      }

      expect((feed as any).windowOpenPrices.size).toBe(5);
      // Oldest should be pruned
      expect((feed as any).windowOpenPrices.has(1700000000)).toBe(false);
      expect((feed as any).windowOpenPrices.has(1700000300)).toBe(true);
    });
  });

  describe('isHealthy', () => {
    it('returns false when not connected', () => {
      const feed = createFeed();
      expect(feed.isHealthy()).toBe(false);
    });

    it('returns true when connected with recent update', () => {
      const feed = createFeed();
      setCurrentPrice(feed, '100000');
      expect(feed.isHealthy()).toBe(true);
    });

    it('returns false when last update is stale', () => {
      const feed = createFeed();
      (feed as any).isConnected = true;
      (feed as any).lastUpdateMs = Date.now() - 10000; // 10s ago
      expect(feed.isHealthy()).toBe(false);
    });
  });
});
