import { describe, it, expect } from 'vitest';
import { NcaaWinProbability } from '../src/ncaa-win-probability';

describe('NcaaWinProbability', () => {
  const model = new NcaaWinProbability();

  describe('calculate — no pregame spread', () => {
    it('returns ~0.50 for tied game at tipoff with no spread', () => {
      // Score diff = 0, full 40 minutes remaining, no spread
      const prob = model.calculate(0, 40 * 60, 0);
      expect(prob.homeWinProb).toBeCloseTo(0.50, 1);
    });

    it('returns ~0.50 for tied game at halftime with no spread', () => {
      // Score diff = 0, 20 minutes remaining, no spread
      const prob = model.calculate(0, 20 * 60, 0);
      expect(prob.homeWinProb).toBeCloseTo(0.50, 1);
    });

    it('returns high probability for large lead at halftime', () => {
      // Up 15 with 20 minutes remaining
      const prob = model.calculate(15, 20 * 60, 0);
      expect(prob.homeWinProb).toBeGreaterThan(0.80);
    });

    it('returns very high probability for large lead with 5 minutes left', () => {
      // Up 15 with 5 minutes remaining
      const prob = model.calculate(15, 5 * 60, 0);
      expect(prob.homeWinProb).toBeGreaterThan(0.95);
    });

    it('returns low probability when trailing by 20 with 10 minutes left', () => {
      // Down 20 with 10 minutes remaining
      const prob = model.calculate(-20, 10 * 60, 0);
      expect(prob.homeWinProb).toBeLessThan(0.10);
    });

    it('same lead matters more with less time remaining', () => {
      const early = model.calculate(10, 30 * 60, 0); // 10pt lead, 30 min left
      const late = model.calculate(10, 5 * 60, 0);   // 10pt lead, 5 min left
      expect(late.homeWinProb).toBeGreaterThan(early.homeWinProb);
    });

    it('returns inverse probabilities for opposite score diffs', () => {
      const probUp = model.calculate(10, 20 * 60, 0);
      const probDown = model.calculate(-10, 20 * 60, 0);
      expect(probUp.homeWinProb + probDown.homeWinProb).toBeCloseTo(1.0, 2);
    });
  });

  describe('calculate — with pregame spread', () => {
    it('pregame spread shifts probability at tipoff', () => {
      // Home team favored by 10 points at tipoff (tied game)
      const withSpread = model.calculate(0, 40 * 60, 10);
      const noSpread = model.calculate(0, 40 * 60, 0);
      expect(withSpread.homeWinProb).toBeGreaterThan(noSpread.homeWinProb);
    });

    it('pregame spread effect fades with time', () => {
      // Same spread, but compare at tipoff vs late game
      const atTipoff = model.calculate(0, 40 * 60, 10);
      const lateGame = model.calculate(0, 2 * 60, 10);
      // At tipoff the spread has full effect; late in game it is nearly gone
      // Both should be > 0.50 for favored team, but tipoff effect is stronger
      const tipoffEdge = atTipoff.homeWinProb - 0.50;
      const lateEdge = lateGame.homeWinProb - 0.50;
      expect(tipoffEdge).toBeGreaterThan(lateEdge);
    });

    it('spread has negligible effect at buzzer', () => {
      // Tied game with 1 second left — spread should barely matter
      const prob = model.calculate(0, 1, 10);
      // Should be very close to 0.50 since the score is tied
      expect(prob.homeWinProb).toBeCloseTo(0.50, 0);
    });

    it('negative spread (away favored) lowers home win prob', () => {
      const awayFavored = model.calculate(0, 40 * 60, -7);
      const noSpread = model.calculate(0, 40 * 60, 0);
      expect(awayFavored.homeWinProb).toBeLessThan(noSpread.homeWinProb);
    });
  });

  describe('calculate — at buzzer', () => {
    it('converges to MAX_PROB when home is leading at 0 time', () => {
      const prob = model.calculate(5, 0, 0);
      expect(prob.homeWinProb).toBe(0.99);
    });

    it('converges to MIN_PROB when home is trailing at 0 time', () => {
      const prob = model.calculate(-5, 0, 0);
      expect(prob.homeWinProb).toBe(0.01);
    });

    it('returns 0.50 for tied game at 0 time', () => {
      const prob = model.calculate(0, 0, 0);
      expect(prob.homeWinProb).toBe(0.50);
    });
  });

  describe('calculate — overtime', () => {
    it('handles overtime (time > 40 min equivalent)', () => {
      // OT: 5 extra minutes, score diff = 3
      // timeRemainingSec = 5 * 60 = 300 (OT period)
      const prob = model.calculate(3, 300, 0);
      expect(prob.homeWinProb).toBeGreaterThan(0.60);
      expect(prob.homeWinProb).toBeLessThan(0.95);
    });

    it('OT time fraction is capped at max game length', () => {
      // timeFraction uses max(0, timeRemainingSec / 2400)
      // 300s / 2400 = 0.125 — reasonable fraction
      const prob = model.calculate(0, 300, 0);
      expect(prob.homeWinProb).toBeCloseTo(0.50, 1);
    });
  });

  describe('calculate — edge cases', () => {
    it('clamps to [0.01, 0.99] range', () => {
      // Extreme lead
      const prob = model.calculate(50, 60, 0);
      expect(prob.homeWinProb).toBeLessThanOrEqual(0.99);
      expect(prob.homeWinProb).toBeGreaterThanOrEqual(0.01);
    });

    it('negative time is treated as 0', () => {
      // Negative time should not break the model
      const prob = model.calculate(5, -10, 0);
      expect(prob.homeWinProb).toBe(0.99);
    });

    it('returns correct timeRemainingMin in result', () => {
      const prob = model.calculate(5, 600, 0);
      expect(prob.timeRemainingMin).toBe(10);
    });

    it('returns correct scoreDiff in result', () => {
      const prob = model.calculate(-7, 600, 0);
      expect(prob.scoreDiff).toBe(-7);
    });
  });
});
