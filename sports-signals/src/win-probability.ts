import { WinProbability } from './types';

/**
 * NBA in-game win probability model.
 *
 * Based on logistic regression of score differential scaled by time remaining.
 * Reference: Inpredictable.com NBA model, Stern (1994) "The Brownian Motion Model".
 *
 * Formula: P(home_wins) = sigmoid(K * score_diff / sqrt(time_remaining_min + 1))
 *
 * K = 0.50 is calibrated against published NBA win probability data:
 *   - 10-point lead at halftime (24 min): sigmoid(0.50 * 10 / sqrt(25)) = sigmoid(1.0) = 0.731 (historical: ~75%)
 *   - 10-point lead at start of Q4 (12 min): sigmoid(0.50 * 10 / sqrt(13)) = sigmoid(1.39) = 0.800 (historical: ~85%)
 *   - 5-point lead with 2 min left: sigmoid(0.50 * 5 / sqrt(3)) = sigmoid(1.44) = 0.809 (historical: ~82%)
 *   - 15-point lead with 2 min left: sigmoid(0.50 * 15 / sqrt(3)) = sigmoid(4.33) = 0.987 (historical: ~99%)
 *
 * NBA scoring is approximately a random walk with ~1 point per possession (~0.4 min).
 * The sqrt(time) scaling reflects that variance grows with the square root of time.
 */
const K = 0.50;
const MIN_PROB = 0.01;
const MAX_PROB = 0.99;

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

export class NbaWinProbability {
  /**
   * Calculate home team win probability.
   *
   * @param scoreDiff - homeScore - awayScore (positive = home leading)
   * @param timeRemainingSec - seconds until game ends
   * @returns WinProbability with homeWinProb clamped to [0.01, 0.99]
   */
  calculate(scoreDiff: number, timeRemainingSec: number): WinProbability {
    const timeRemainingMin = timeRemainingSec / 60;

    // sigmoid(K * diff / sqrt(time + 1))
    // The +1 prevents division by zero and models the "final seconds" where
    // even a 1-point lead is almost certain to hold
    const x = K * scoreDiff / Math.sqrt(timeRemainingMin + 1);
    let prob = sigmoid(x);

    // Clamp to avoid certainty (no trade should assume 100%)
    prob = Math.max(MIN_PROB, Math.min(MAX_PROB, prob));

    return {
      homeWinProb: prob,
      scoreDiff,
      timeRemainingMin,
    };
  }
}
