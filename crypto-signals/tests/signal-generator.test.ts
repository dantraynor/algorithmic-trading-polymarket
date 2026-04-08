import { describe, it, expect, beforeEach } from 'vitest';
import { CryptoSignalGenerator } from '../src/signal-generator';

describe('CryptoSignalGenerator', () => {
  let generator: CryptoSignalGenerator;

  beforeEach(() => {
    generator = new CryptoSignalGenerator({
      minEntryPrice: 0.10,
      maxEntryPrice: 0.95,
      minEdgeBps: 500,
    });
  });

  describe('calculateConfidence', () => {
    it('returns higher confidence for larger moves with less time', () => {
      const conf1 = generator.calculateConfidence(50, 60);
      const conf2 = generator.calculateConfidence(50, 10);
      expect(conf2).toBeGreaterThan(conf1);
    });
    it('returns higher confidence for larger moves', () => {
      const conf1 = generator.calculateConfidence(20, 30);
      const conf2 = generator.calculateConfidence(100, 30);
      expect(conf2).toBeGreaterThan(conf1);
    });
    it('returns value between 0.5 and 1.0', () => {
      const conf = generator.calculateConfidence(100, 10);
      expect(conf).toBeGreaterThanOrEqual(0.5);
      expect(conf).toBeLessThanOrEqual(1.0);
    });
    it('returns ~0.5 for very small moves', () => {
      const conf = generator.calculateConfidence(1, 200);
      expect(conf).toBeLessThan(0.55);
    });
  });

  describe('shouldEmitSignal', () => {
    it('emits when confidence exceeds ask price plus min edge', () => {
      const result = generator.shouldEmitSignal(0.90, 0.80);
      expect(result).toBe(true);
    });
    it('does not emit when edge below minimum', () => {
      const result = generator.shouldEmitSignal(0.82, 0.80);
      expect(result).toBe(false);
    });
    it('does not emit when ask outside price range', () => {
      const result = generator.shouldEmitSignal(0.99, 0.98);
      expect(result).toBe(false);
    });
  });
});
