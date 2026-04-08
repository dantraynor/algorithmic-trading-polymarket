/**
 * Probability Model - Core mathematical engine for latency arbitrage.
 * Estimates true probability of UP outcome based on BTC price delta and time remaining.
 * Uses Normal CDF (Abramowitz & Stegun) and Kelly criterion for sizing.
 * Pure math — no I/O, no side effects.
 */

import Decimal from 'decimal.js';
import { ProbabilityEstimate } from './types';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

/**
 * Standard normal CDF using Zelen & Severo (1964) rational approximation.
 * Based on Abramowitz & Stegun 26.2.17. Accuracy: ~1e-5.
 * No external dependency needed.
 */
export function normalCdf(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;

  // For x >= 0: Phi(x) = 1 - phi(x) * (b1*t + b2*t^2 + b3*t^3 + b4*t^4 + b5*t^5)
  // where phi(x) = exp(-x^2/2) / sqrt(2*pi), t = 1 / (1 + p*x)
  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;

  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const phi = Math.exp(-absX * absX / 2) / Math.sqrt(2 * Math.PI);
  const poly = ((((b5 * t + b4) * t + b3) * t + b2) * t + b1) * t;
  const cdf = 1.0 - phi * poly;

  return x >= 0 ? cdf : 1.0 - cdf;
}

/**
 * Estimate the true probability that BTC finishes above the Price to Beat.
 *
 * Model: BTC price follows a random walk with recent realized volatility.
 * P(final >= price_to_beat) = Phi(delta / remaining_vol)
 *
 * @param delta - current BTC price minus price_to_beat (positive = above)
 * @param timeRemainingSec - seconds left in the 5-min window
 * @param rollingVol - rolling standard deviation of BTC price over the vol lookback period
 */
export function estimateProbability(
  delta: Decimal,
  timeRemainingSec: number,
  rollingVol: Decimal,
): ProbabilityEstimate {
  const WINDOW_DURATION = 300;

  // Remaining volatility: scale by sqrt of remaining fraction of window
  const timeRatio = Math.max(0, timeRemainingSec / WINDOW_DURATION);
  const remainingVol = rollingVol.mul(Math.sqrt(timeRatio));

  let trueProb: Decimal;
  let zScore: Decimal;

  if (remainingVol.isZero() || timeRemainingSec <= 0) {
    // No time left or zero vol: outcome is determined
    trueProb = delta.gte(0) ? new Decimal(1) : new Decimal(0);
    zScore = delta.gte(0) ? new Decimal(8) : new Decimal(-8);
  } else {
    zScore = delta.div(remainingVol);
    trueProb = new Decimal(normalCdf(zScore.toNumber()));
  }

  return {
    trueProb,
    delta,
    rollingVol,
    remainingVol,
    zScore,
    timeRemaining: timeRemainingSec,
  };
}

/**
 * Kelly criterion position sizing for binary outcomes.
 *
 * For a binary bet paying $1 on win:
 *   kelly_fraction = edge / (1 - market_price)
 *
 * We use fractional Kelly (kellyMultiplier) to reduce variance.
 *
 * @param edge - trueProb minus marketPrice (must be positive)
 * @param marketPrice - current best ask on Polymarket
 * @param kellyMultiplier - fraction of full Kelly (e.g., 0.25 = quarter-Kelly)
 * @param bankroll - total capital available
 * @param maxPerWindow - max dollars per window per side
 * @param alreadySpent - dollars already committed this window on this side
 */
export function computeKellySize(
  edge: Decimal,
  marketPrice: Decimal,
  kellyMultiplier: number,
  bankroll: number,
  maxPerWindow: number,
  alreadySpent: Decimal,
): Decimal {
  if (edge.lte(0)) return new Decimal(0);

  const denominator = new Decimal(1).minus(marketPrice);
  if (denominator.lte(0)) return new Decimal(0);

  const kellyFraction = edge.div(denominator).mul(kellyMultiplier);
  const dollarSize = kellyFraction.mul(bankroll);

  // Cap by remaining budget for this window/side
  const remaining = new Decimal(maxPerWindow).minus(alreadySpent);
  if (remaining.lte(0)) return new Decimal(0);

  return Decimal.min(dollarSize, remaining);
}
