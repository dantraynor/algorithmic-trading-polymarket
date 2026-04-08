import { describe, it, expect } from 'vitest';
import { kellyBetSize, kellyFraction } from '../src/kelly';

describe('kellyFraction', () => {
  it('calculates correct fraction for high confidence', () => {
    const f = kellyFraction(0.95, 0.80);
    expect(f).toBeCloseTo(0.75, 4);
  });

  it('calculates correct fraction for moderate confidence', () => {
    const f = kellyFraction(0.70, 0.50);
    expect(f).toBeCloseTo(0.40, 4);
  });

  it('returns 0 when no edge (confidence <= ask)', () => {
    const f = kellyFraction(0.50, 0.60);
    expect(f).toBe(0);
  });

  it('returns 0 when confidence equals ask', () => {
    const f = kellyFraction(0.80, 0.80);
    expect(f).toBe(0);
  });

  it('handles edge case of very low ask price', () => {
    const f = kellyFraction(0.99, 0.10);
    expect(f).toBeCloseTo(0.9889, 3);
  });
});

describe('kellyBetSize', () => {
  it('applies Kelly multiplier to raw fraction', () => {
    const bet = kellyBetSize(0.95, 0.80, 10_000, 0.50);
    expect(bet).toBeCloseTo(3750, 0);
  });

  it('caps at maxBetPct of bankroll', () => {
    const bet = kellyBetSize(0.95, 0.80, 10_000, 0.50, 0.10);
    expect(bet).toBe(1000);
  });

  it('caps at available liquidity', () => {
    const bet = kellyBetSize(0.95, 0.80, 10_000, 0.50, 1.0, 500);
    expect(bet).toBe(500);
  });

  it('returns 0 for no edge', () => {
    const bet = kellyBetSize(0.50, 0.60, 10_000, 0.50);
    expect(bet).toBe(0);
  });

  it('subtracts taker fee from edge', () => {
    const bet = kellyBetSize(0.60, 0.55, 10_000, 0.50, 1.0, Infinity, 200);
    expect(bet).toBeCloseTo(333, 0);
  });

  it('returns 0 when fee eliminates edge', () => {
    const bet = kellyBetSize(0.56, 0.55, 10_000, 0.50, 1.0, Infinity, 200);
    expect(bet).toBe(0);
  });
});
