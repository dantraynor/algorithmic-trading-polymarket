import { describe, it, expect, beforeEach } from 'vitest';
import { CryptoMarketScanner } from '../src/market-scanner';

describe('CryptoMarketScanner', () => {
  let scanner: CryptoMarketScanner;

  beforeEach(() => {
    scanner = new CryptoMarketScanner();
  });

  describe('slugToAsset', () => {
    it('extracts btc from btc-updown-5m slug', () => {
      expect(scanner.slugToAsset('btc-updown-5m-1234567890')).toBe('btcusdt');
    });
    it('extracts eth from eth-updown-5m slug', () => {
      expect(scanner.slugToAsset('eth-updown-5m-1234567890')).toBe('ethusdt');
    });
    it('extracts sol from sol-updown-5m slug', () => {
      expect(scanner.slugToAsset('sol-updown-5m-1234567890')).toBe('solusdt');
    });
    it('returns null for non-crypto slug', () => {
      expect(scanner.slugToAsset('nba-game-lakers-celtics')).toBeNull();
    });
  });

  describe('getCurrentWindowTimestamp', () => {
    it('floors to nearest 5-minute boundary', () => {
      const fakeNow = Math.floor(new Date('2026-03-17T12:07:30Z').getTime() / 1000);
      const ts = scanner.getCurrentWindowTimestamp(fakeNow);
      expect(ts % 300).toBe(0);
      expect(ts).toBeLessThanOrEqual(fakeNow);
      expect(fakeNow - ts).toBeLessThan(300);
    });
  });

  describe('isInEntryWindow', () => {
    it('returns true when within entry window', () => {
      expect(scanner.isInEntryWindow(1000, 1060, 30, 250)).toBe(true);
    });
    it('returns false before entry starts', () => {
      expect(scanner.isInEntryWindow(1000, 1020, 30, 250)).toBe(false);
    });
    it('returns false after entry ends', () => {
      expect(scanner.isInEntryWindow(1000, 1260, 30, 250)).toBe(false);
    });
  });
});
