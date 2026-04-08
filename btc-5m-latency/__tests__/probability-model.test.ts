import Decimal from 'decimal.js';
import { normalCdf, estimateProbability, computeKellySize } from '../src/probability-model';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

describe('normalCdf', () => {
  it('returns 0.5 for x=0', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
  });

  it('returns ~0.8413 for x=1', () => {
    expect(normalCdf(1)).toBeCloseTo(0.8413, 3);
  });

  it('returns ~0.1587 for x=-1', () => {
    expect(normalCdf(-1)).toBeCloseTo(0.1587, 3);
  });

  it('satisfies symmetry: cdf(x) + cdf(-x) = 1', () => {
    const values = [0.5, 1.0, 1.5, 2.0, 3.0];
    for (const x of values) {
      expect(normalCdf(x) + normalCdf(-x)).toBeCloseTo(1.0, 6);
    }
  });

  it('returns ~0.9772 for x=2', () => {
    expect(normalCdf(2)).toBeCloseTo(0.9772, 3);
  });

  it('returns ~0 for very negative x', () => {
    expect(normalCdf(-8)).toBeCloseTo(0, 10);
    expect(normalCdf(-10)).toBe(0);
  });

  it('returns ~1 for very positive x', () => {
    expect(normalCdf(8)).toBeCloseTo(1, 10);
    expect(normalCdf(10)).toBe(1);
  });
});

describe('estimateProbability', () => {
  it('returns ~0.5 when delta is 0', () => {
    const result = estimateProbability(
      new Decimal(0),
      150, // half the window remaining
      new Decimal(100), // some vol
    );
    expect(result.trueProb.toNumber()).toBeCloseTo(0.5, 3);
    expect(result.zScore.toNumber()).toBeCloseTo(0, 3);
  });

  it('returns close to 1.0 for large positive delta with low vol', () => {
    const result = estimateProbability(
      new Decimal(500), // BTC $500 above price to beat
      30, // 30 seconds left
      new Decimal(50), // moderate vol
    );
    expect(result.trueProb.toNumber()).toBeGreaterThan(0.95);
  });

  it('returns close to 0.0 for large negative delta with low vol', () => {
    const result = estimateProbability(
      new Decimal(-500),
      30,
      new Decimal(50),
    );
    expect(result.trueProb.toNumber()).toBeLessThan(0.05);
  });

  it('returns 1.0 when remaining vol is 0 and delta >= 0', () => {
    const result = estimateProbability(
      new Decimal(10),
      0, // no time remaining
      new Decimal(100),
    );
    expect(result.trueProb.toNumber()).toBe(1);
  });

  it('returns 0.0 when remaining vol is 0 and delta < 0', () => {
    const result = estimateProbability(
      new Decimal(-10),
      0,
      new Decimal(100),
    );
    expect(result.trueProb.toNumber()).toBe(0);
  });

  it('returns 1.0 when vol is zero and delta positive', () => {
    const result = estimateProbability(
      new Decimal(10),
      150,
      new Decimal(0), // zero vol
    );
    expect(result.trueProb.toNumber()).toBe(1);
  });

  it('probability increases as time decreases with positive delta', () => {
    const delta = new Decimal(30);
    const vol = new Decimal(100);

    const early = estimateProbability(delta, 280, vol);
    const late = estimateProbability(delta, 30, vol);

    expect(late.trueProb.toNumber()).toBeGreaterThan(early.trueProb.toNumber());
  });

  it('populates all fields in ProbabilityEstimate', () => {
    const result = estimateProbability(
      new Decimal(50),
      150,
      new Decimal(100),
    );
    expect(result.delta.toNumber()).toBe(50);
    expect(result.rollingVol.toNumber()).toBe(100);
    expect(result.timeRemaining).toBe(150);
    expect(result.remainingVol.toNumber()).toBeGreaterThan(0);
    expect(result.zScore.toNumber()).toBeGreaterThan(0);
  });
});

describe('computeKellySize', () => {
  it('returns 0 for zero edge', () => {
    const result = computeKellySize(
      new Decimal(0),
      new Decimal(0.5),
      0.25,
      10000,
      500,
      new Decimal(0),
    );
    expect(result.toNumber()).toBe(0);
  });

  it('returns 0 for negative edge', () => {
    const result = computeKellySize(
      new Decimal(-0.05),
      new Decimal(0.5),
      0.25,
      10000,
      500,
      new Decimal(0),
    );
    expect(result.toNumber()).toBe(0);
  });

  it('computes quarter-Kelly correctly', () => {
    // edge = 0.10, marketPrice = 0.50
    // kelly = 0.10 / (1 - 0.50) = 0.20
    // quarter-kelly = 0.20 * 0.25 = 0.05
    // dollarSize = 10000 * 0.05 = 500
    const result = computeKellySize(
      new Decimal(0.10),
      new Decimal(0.50),
      0.25,
      10000,
      500,
      new Decimal(0),
    );
    expect(result.toNumber()).toBe(500);
  });

  it('caps at maxPerWindow', () => {
    const result = computeKellySize(
      new Decimal(0.20),
      new Decimal(0.50),
      0.25,
      100000,
      500,
      new Decimal(0),
    );
    expect(result.toNumber()).toBe(500);
  });

  it('subtracts alreadySpent from max', () => {
    const result = computeKellySize(
      new Decimal(0.20),
      new Decimal(0.50),
      0.25,
      100000,
      500,
      new Decimal(400),
    );
    expect(result.toNumber()).toBe(100);
  });

  it('returns 0 when already at position limit', () => {
    const result = computeKellySize(
      new Decimal(0.10),
      new Decimal(0.50),
      0.25,
      10000,
      500,
      new Decimal(500),
    );
    expect(result.toNumber()).toBe(0);
  });

  it('returns 0 when marketPrice is 1.0', () => {
    const result = computeKellySize(
      new Decimal(0.10),
      new Decimal(1.0),
      0.25,
      10000,
      500,
      new Decimal(0),
    );
    expect(result.toNumber()).toBe(0);
  });
});
