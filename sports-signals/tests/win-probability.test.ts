import { describe, it, expect } from 'vitest';
import { NbaWinProbability } from '../src/win-probability';

describe('NbaWinProbability', () => {
  const model = new NbaWinProbability();

  describe('calculate', () => {
    it('returns ~0.50 for tied game at halftime', () => {
      // Score diff = 0, ~24 minutes remaining
      const prob = model.calculate(0, 24 * 60);
      expect(prob.homeWinProb).toBeCloseTo(0.50, 1);
    });

    it('returns high probability for large lead late in game', () => {
      // Up 15 with 2 minutes left
      // sigmoid(0.50 * 15 / sqrt(3)) = sigmoid(4.33) ≈ 0.987
      const prob = model.calculate(15, 2 * 60);
      expect(prob.homeWinProb).toBeGreaterThan(0.95);
    });

    it('returns moderate probability for small lead mid-game', () => {
      // Up 5 with 12 minutes left (start of Q4)
      // sigmoid(0.50 * 5 / sqrt(13)) = sigmoid(0.694) ≈ 0.667
      const prob = model.calculate(5, 12 * 60);
      expect(prob.homeWinProb).toBeGreaterThan(0.60);
      expect(prob.homeWinProb).toBeLessThan(0.80);
    });

    it('returns low probability when trailing significantly', () => {
      // Down 20 with 5 minutes left
      // sigmoid(0.50 * -20 / sqrt(6)) = sigmoid(-4.08) ≈ 0.017
      const prob = model.calculate(-20, 5 * 60);
      expect(prob.homeWinProb).toBeLessThan(0.05);
    });

    it('returns exactly 0.50 for tied game regardless of time', () => {
      // No score differential means no directional edge
      const prob1 = model.calculate(0, 48 * 60);
      const prob2 = model.calculate(0, 1 * 60);
      expect(prob1.homeWinProb).toBeCloseTo(0.50, 1);
      expect(prob2.homeWinProb).toBeCloseTo(0.50, 1);
    });

    it('returns inverse probabilities for opposite score diffs', () => {
      const probUp = model.calculate(10, 10 * 60);
      const probDown = model.calculate(-10, 10 * 60);
      expect(probUp.homeWinProb + probDown.homeWinProb).toBeCloseTo(1.0, 2);
    });

    it('clamps to [0.01, 0.99] to avoid certainty', () => {
      // Extreme case: up 50 with 10 seconds left
      const prob = model.calculate(50, 10);
      expect(prob.homeWinProb).toBeLessThanOrEqual(0.99);
      expect(prob.homeWinProb).toBeGreaterThanOrEqual(0.01);
    });

    it('same lead matters more with less time remaining', () => {
      const early = model.calculate(10, 30 * 60); // 10pt lead, 30 min left
      const late = model.calculate(10, 5 * 60);   // 10pt lead, 5 min left
      expect(late.homeWinProb).toBeGreaterThan(early.homeWinProb);
    });
  });
});
