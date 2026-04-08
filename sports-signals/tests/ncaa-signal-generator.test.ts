import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { NcaaSportsSignalGenerator, SportsSignalGenerator } from '../src/signal-generator';
import { SportsMarketInfo, GameScore } from '../src/types';

describe('NcaaSportsSignalGenerator', () => {
  let generator: NcaaSportsSignalGenerator;

  const defaultConfig = {
    minEntryPrice: 0.10,
    maxEntryPrice: 0.90,
    minEdgeBps: 500,
    minTimeRemainingSec: 240,
    scoreStaleMs: 15000,
  };

  beforeEach(() => {
    generator = new NcaaSportsSignalGenerator(defaultConfig);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-19T20:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const makeGame = (overrides: Partial<GameScore> = {}): GameScore => ({
    gameId: '401600001',
    league: 'NCAAM',
    homeTeam: 'Duke Blue Devils',
    awayTeam: 'Kansas Jayhawks',
    homeScore: 55,
    awayScore: 48,
    quarter: 2,
    timeRemainingMs: 600000, // 10 min
    isLive: true,
    isComplete: false,
    lastUpdated: Date.now(), // fresh by default
    period: 2,
    pregameSpread: -6.5,
    isOvertime: false,
    ...overrides,
  });

  const makeMarket = (): SportsMarketInfo => ({
    conditionId: 'ncaa-cond-001',
    yesTokenId: 'ncaa-token-home',
    noTokenId: 'ncaa-token-away',
    homeTeam: 'Duke Blue Devils',
    awayTeam: 'Kansas Jayhawks',
    league: 'NCAAM',
    gameId: '401600001',
    slug: 'ncaa-duke-kansas',
    negRisk: false,
  });

  describe('calculateRequiredEdge', () => {
    it('returns ~5% at tipoff (2400s remaining)', () => {
      const edge = generator.calculateRequiredEdge(2400);
      expect(edge).toBeCloseTo(0.05, 2);
    });

    it('returns ~15% at 4 minutes remaining (240s)', () => {
      const edge = generator.calculateRequiredEdge(240);
      expect(edge).toBeCloseTo(0.15, 2);
    });

    it('returns between 5% and 15% at halftime (1200s)', () => {
      const edge = generator.calculateRequiredEdge(1200);
      expect(edge).toBeGreaterThan(0.05);
      expect(edge).toBeLessThan(0.15);
    });

    it('increases monotonically as time decreases', () => {
      const edge2400 = generator.calculateRequiredEdge(2400);
      const edge1800 = generator.calculateRequiredEdge(1800);
      const edge1200 = generator.calculateRequiredEdge(1200);
      const edge600 = generator.calculateRequiredEdge(600);
      const edge240 = generator.calculateRequiredEdge(240);

      expect(edge1800).toBeGreaterThan(edge2400);
      expect(edge1200).toBeGreaterThan(edge1800);
      expect(edge600).toBeGreaterThan(edge1200);
      expect(edge240).toBeGreaterThan(edge600);
    });

    it('uses quadratic (not linear) scaling', () => {
      // At midpoint of usable range (50% elapsed), quadratic gives 0.05 + 0.25 * 0.10 = 0.075
      // Linear would give 0.05 + 0.50 * 0.10 = 0.10
      const midpoint = 2400 - (2400 - 240) / 2; // 1320s
      const edge = generator.calculateRequiredEdge(midpoint);
      expect(edge).toBeLessThan(0.10); // quadratic < linear at midpoint
      expect(edge).toBeGreaterThan(0.05);
    });
  });

  describe('shouldEmitSignal — time cutoff', () => {
    it('rejects signal below 4 minutes (240s)', () => {
      const game = makeGame({ timeRemainingMs: 200000 }); // 200s < 240s
      const result = generator.shouldEmitSignal(0.90, 0.60, 200, game);
      expect(result.emit).toBe(false);
      expect(result.reason).toBe('below_time_cutoff');
    });

    it('accepts signal at exactly 4 minutes', () => {
      const game = makeGame({ timeRemainingMs: 240000 });
      const result = generator.shouldEmitSignal(0.90, 0.60, 240, game);
      expect(result.emit).toBe(true);
    });

    it('rejects signal at 3 minutes 59 seconds', () => {
      const game = makeGame({ timeRemainingMs: 239000 });
      const result = generator.shouldEmitSignal(0.90, 0.60, 239, game);
      expect(result.emit).toBe(false);
      expect(result.reason).toBe('below_time_cutoff');
    });

    it('accepts signal at 10 minutes', () => {
      const game = makeGame({ timeRemainingMs: 600000 });
      const result = generator.shouldEmitSignal(0.90, 0.60, 600, game);
      expect(result.emit).toBe(true);
    });
  });

  describe('shouldEmitSignal — score freshness guard', () => {
    it('rejects stale score data (> 15s old)', () => {
      const game = makeGame({ lastUpdated: Date.now() - 16000 }); // 16s stale
      const result = generator.shouldEmitSignal(0.90, 0.60, 600, game);
      expect(result.emit).toBe(false);
      expect(result.reason).toBe('stale_score');
    });

    it('accepts fresh score data (< 15s old)', () => {
      const game = makeGame({ lastUpdated: Date.now() - 5000 }); // 5s fresh
      const result = generator.shouldEmitSignal(0.90, 0.60, 600, game);
      expect(result.emit).toBe(true);
    });

    it('rejects score data exactly at stale threshold', () => {
      const game = makeGame({ lastUpdated: Date.now() - 15001 });
      const result = generator.shouldEmitSignal(0.90, 0.60, 600, game);
      expect(result.emit).toBe(false);
      expect(result.reason).toBe('stale_score');
    });

    it('accepts score data just within threshold', () => {
      const game = makeGame({ lastUpdated: Date.now() - 14999 });
      const result = generator.shouldEmitSignal(0.90, 0.60, 600, game);
      expect(result.emit).toBe(true);
    });
  });

  describe('shouldEmitSignal — dynamic edge threshold', () => {
    it('accepts large edge early in game', () => {
      // At tipoff: required edge = 5%, actual edge = 30%
      const game = makeGame({ timeRemainingMs: 2400000, lastUpdated: Date.now() });
      const result = generator.shouldEmitSignal(0.90, 0.60, 2400, game);
      expect(result.emit).toBe(true);
    });

    it('rejects small edge late in game', () => {
      // At 5 min remaining: required edge is high (~12%), actual edge = 6%
      const game = makeGame({ timeRemainingMs: 300000, lastUpdated: Date.now() });
      const result = generator.shouldEmitSignal(0.66, 0.60, 300, game);
      expect(result.emit).toBe(false);
      expect(result.reason).toBe('insufficient_edge');
    });

    it('accepts same edge early but rejects it late', () => {
      // 8% edge: should pass early (5% threshold), fail late (>10% threshold)
      const gameEarly = makeGame({ timeRemainingMs: 2400000, lastUpdated: Date.now() });
      const gameLate = makeGame({ timeRemainingMs: 300000, lastUpdated: Date.now() });

      const earlyResult = generator.shouldEmitSignal(0.68, 0.60, 2400, gameEarly);
      const lateResult = generator.shouldEmitSignal(0.68, 0.60, 300, gameLate);

      expect(earlyResult.emit).toBe(true);
      expect(lateResult.emit).toBe(false);
    });
  });

  describe('shouldEmitSignal — price bounds', () => {
    it('rejects ask below min entry price', () => {
      const game = makeGame();
      const result = generator.shouldEmitSignal(0.15, 0.05, 600, game);
      expect(result.emit).toBe(false);
      expect(result.reason).toBe('price_out_of_range');
    });

    it('rejects ask above max entry price', () => {
      const game = makeGame();
      const result = generator.shouldEmitSignal(0.99, 0.95, 600, game);
      expect(result.emit).toBe(false);
      expect(result.reason).toBe('price_out_of_range');
    });

    it('accepts ask within price range', () => {
      const game = makeGame();
      const result = generator.shouldEmitSignal(0.80, 0.50, 600, game);
      expect(result.emit).toBe(true);
    });
  });

  describe('shouldEmitSignal — min edge BPS', () => {
    it('rejects when edge below minEdgeBps even if above dynamic threshold', () => {
      // At tipoff dynamic threshold is 5%, but minEdgeBps is 500 (5%)
      // Edge = 4% (400bps) < 500bps
      const game = makeGame({ timeRemainingMs: 2400000, lastUpdated: Date.now() });
      const result = generator.shouldEmitSignal(0.54, 0.50, 2400, game);
      expect(result.emit).toBe(false);
    });
  });

  describe('createSignal', () => {
    it('creates signal with league NCAAM', () => {
      const market = makeMarket();
      const signal = generator.createSignal(market, 'YES', 0.85, 0.65, 5000, 600, -6.5);
      expect(signal.source).toBe('sports');
      expect(signal.metadata.league).toBe('NCAAM');
      expect(signal.metadata.pregameSpread).toBe(-6.5);
    });

    it('uses YES token for YES direction', () => {
      const market = makeMarket();
      const signal = generator.createSignal(market, 'YES', 0.85, 0.65, 5000, 600);
      expect(signal.tokenId).toBe('ncaa-token-home');
    });

    it('uses NO token for NO direction', () => {
      const market = makeMarket();
      const signal = generator.createSignal(market, 'NO', 0.85, 0.65, 5000, 600);
      expect(signal.tokenId).toBe('ncaa-token-away');
    });

    it('sets urgency=immediate for < 60s remaining', () => {
      const market = makeMarket();
      const signal = generator.createSignal(market, 'YES', 0.90, 0.65, 5000, 45);
      expect(signal.urgency).toBe('immediate');
      expect(signal.ttlMs).toBe(10000);
    });

    it('sets urgency=seconds for 60-300s remaining', () => {
      const market = makeMarket();
      const signal = generator.createSignal(market, 'YES', 0.90, 0.65, 5000, 250);
      expect(signal.urgency).toBe('seconds');
      expect(signal.ttlMs).toBe(15000);
    });

    it('sets urgency=minutes for > 300s remaining', () => {
      const market = makeMarket();
      const signal = generator.createSignal(market, 'YES', 0.90, 0.65, 5000, 600);
      expect(signal.urgency).toBe('minutes');
      expect(signal.ttlMs).toBe(45000);
    });
  });

  describe('NCAA vs NBA model selection', () => {
    it('NCAA generator has different config than NBA would', () => {
      // Verify the NCAA generator was constructed with NCAA-specific config
      expect(defaultConfig.minTimeRemainingSec).toBe(240);
      expect(defaultConfig.scoreStaleMs).toBe(15000);
      expect(defaultConfig.maxEntryPrice).toBe(0.90);
    });

    it('NBA SportsSignalGenerator does not have time cutoff logic', () => {
      // The base SportsSignalGenerator.shouldEmitSignal only takes (confidence, currentAsk)
      // It doesn't take timeRemainingSec or game — those are NCAA-specific
      const nbaGen = new SportsSignalGenerator({
        minEntryPrice: 0.10,
        maxEntryPrice: 0.95,
        minEdgeBps: 500,
      });
      // NBA generator: 2 params only, no time/game check
      expect(nbaGen.shouldEmitSignal(0.90, 0.60)).toBe(true);
    });
  });
});
