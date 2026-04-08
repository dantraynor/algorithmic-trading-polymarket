import { WinProbability } from './types';

/**
 * NCAA in-game win probability model (Bayesian score-based).
 *
 * Uses Normal CDF approach calibrated on 4,000+ NCAA games.
 * sigma = 17.2 controls how quickly the model converges to certainty.
 *
 * The pregame spread acts as a Bayesian prior that fades as the game progresses.
 * At tipoff: outputs pregame-implied probability.
 * At buzzer: converges to outcome based on score alone.
 */
const SIGMA = 17.2;
const TOTAL_GAME_SEC = 40 * 60; // 2 halves x 20 minutes
const MIN_PROB = 0.01;
const MAX_PROB = 0.99;

// Standard Normal CDF using Abramowitz & Stegun approximation
function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

export class NcaaWinProbability {
  /**
   * Calculate home/favored team win probability.
   *
   * @param scoreDiff - homeScore - awayScore (positive = home leading)
   * @param timeRemainingSec - seconds until game ends (includes OT if applicable)
   * @param pregameSpread - pregame point spread (positive = home favored by N points). Default 0.
   */
  calculate(scoreDiff: number, timeRemainingSec: number, pregameSpread: number = 0): WinProbability {
    const timeRemainingMin = timeRemainingSec / 60;
    const timeFraction = Math.max(0, timeRemainingSec / TOTAL_GAME_SEC);

    // Expected final margin: current score diff + (pregame spread * remaining time fraction)
    // As time runs out, pregame prior fades and live score dominates
    const expectedFinalMargin = scoreDiff + (pregameSpread * timeFraction);

    // Remaining standard deviation shrinks as game progresses
    const remainingStd = SIGMA * Math.sqrt(timeFraction);

    let prob: number;
    if (remainingStd < 0.001) {
      // Game essentially over
      prob = scoreDiff > 0 ? MAX_PROB : (scoreDiff < 0 ? MIN_PROB : 0.50);
    } else {
      prob = normalCDF(expectedFinalMargin / remainingStd);
    }

    prob = Math.max(MIN_PROB, Math.min(MAX_PROB, prob));

    return {
      homeWinProb: prob,
      scoreDiff,
      timeRemainingMin,
    };
  }
}
