import { describe, it, expect, beforeEach } from 'vitest';
import { MultiBinanceFeed } from '../src/binance-feed';

describe('MultiBinanceFeed', () => {
  let feed: MultiBinanceFeed;

  beforeEach(() => {
    feed = new MultiBinanceFeed(['btcusdt', 'ethusdt', 'solusdt'], 5);
  });

  it('builds correct combined stream URL', () => {
    const url = feed.getStreamUrl();
    expect(url).toContain('stream?streams=');
    expect(url).toContain('btcusdt@ticker');
    expect(url).toContain('ethusdt@ticker');
    expect(url).toContain('solusdt@ticker');
  });

  it('records window open price for a symbol', () => {
    feed.updatePrice('btcusdt', 65000.50);
    feed.recordWindowOpen('btcusdt', 1000);
    const dir = feed.getDirection('btcusdt', 1000);
    expect(dir).toBeDefined();
    expect(dir!.openPrice.toNumber()).toBe(65000.50);
  });

  it('calculates direction UP when price rises', () => {
    feed.updatePrice('btcusdt', 65000);
    feed.recordWindowOpen('btcusdt', 1000);
    feed.updatePrice('btcusdt', 65100);
    const dir = feed.getDirection('btcusdt', 1000);
    expect(dir!.direction).toBe('UP');
    expect(dir!.deltaBps).toBeGreaterThan(5);
  });

  it('calculates direction DOWN when price falls', () => {
    feed.updatePrice('btcusdt', 65000);
    feed.recordWindowOpen('btcusdt', 1000);
    feed.updatePrice('btcusdt', 64900);
    const dir = feed.getDirection('btcusdt', 1000);
    expect(dir!.direction).toBe('DOWN');
  });

  it('returns FLAT when move is below threshold', () => {
    feed.updatePrice('btcusdt', 65000);
    feed.recordWindowOpen('btcusdt', 1000);
    feed.updatePrice('btcusdt', 65002);
    const dir = feed.getDirection('btcusdt', 1000);
    expect(dir!.direction).toBe('FLAT');
  });

  it('tracks multiple symbols independently', () => {
    feed.updatePrice('btcusdt', 65000);
    feed.updatePrice('ethusdt', 3000);
    feed.recordWindowOpen('btcusdt', 1000);
    feed.recordWindowOpen('ethusdt', 1000);
    feed.updatePrice('btcusdt', 65100);
    feed.updatePrice('ethusdt', 2990);
    expect(feed.getDirection('btcusdt', 1000)!.direction).toBe('UP');
    expect(feed.getDirection('ethusdt', 1000)!.direction).toBe('DOWN');
  });

  it('returns null for unknown symbol', () => {
    const dir = feed.getDirection('unknown', 1000);
    expect(dir).toBeNull();
  });
});
