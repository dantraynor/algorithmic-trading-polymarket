import { describe, it, expect } from 'vitest';
import { EspnClient } from '../src/espn-client';
import { NbaWinProbability } from '../src/win-probability';
import { SportsSignalGenerator } from '../src/signal-generator';
import { SportsMarketScanner } from '../src/market-scanner';
import { SportsMarketInfo, GameScore } from '../src/types';

describe('Integration: Live Score → Win Prob → Signal Emission', () => {
  const espn = new EspnClient();
  const winModel = new NbaWinProbability();
  const generator = new SportsSignalGenerator({
    minEntryPrice: 0.10,
    maxEntryPrice: 0.95,
    minEdgeBps: 500,
  });
  const scanner = new SportsMarketScanner();

  it('full pipeline: parse game → calculate probability → decide signal', () => {
    // Simulate a Q4 game: Lakers 105, Celtics 92, 3:00 left
    const espnEvent = {
      id: '401584701',
      competitions: [{
        competitors: [
          { homeAway: 'home', team: { displayName: 'Los Angeles Lakers', abbreviation: 'LAL' }, score: '105' },
          { homeAway: 'away', team: { displayName: 'Boston Celtics', abbreviation: 'BOS' }, score: '92' },
        ],
        status: {
          type: { name: 'STATUS_IN_PROGRESS', completed: false },
          period: 4,
          displayClock: '3:00',
        },
      }],
    };

    const game = espn.parseEvent(espnEvent)!;
    expect(game.isLive).toBe(true);
    expect(game.homeScore).toBe(105);
    expect(game.awayScore).toBe(92);

    // Calculate win probability: +13 with ~3 min left
    const timeRemainingSec = game.timeRemainingMs / 1000;
    const prob = winModel.calculate(game.homeScore - game.awayScore, timeRemainingSec);
    expect(prob.homeWinProb).toBeGreaterThan(0.95); // 13-point lead with 3 min → very high

    // Check if signal should emit (depends on hypothetical ask price)
    // If Polymarket has Lakers YES at $0.85, edge = 0.97 - 0.85 = 0.12 = 1200bps > 500bps → emit
    expect(generator.shouldEmitSignal(prob.homeWinProb, 0.85)).toBe(true);

    // If ask is $0.96, edge = 0.01 = 100bps < 500bps → don't emit
    expect(generator.shouldEmitSignal(prob.homeWinProb, 0.96)).toBe(false);

    // Create signal
    const market: SportsMarketInfo = {
      conditionId: 'cond-nba-123',
      yesTokenId: 'token-lakers-yes',
      noTokenId: 'token-lakers-no',
      homeTeam: 'Los Angeles Lakers',
      awayTeam: 'Boston Celtics',
      league: 'NBA',
      gameId: '401584701',
      slug: 'nba-lakers-celtics',
      negRisk: false,
    };

    const signal = generator.createSignal(
      market, 'YES', prob.homeWinProb, 0.85, 3000, timeRemainingSec,
    );

    expect(signal.source).toBe('sports');
    expect(signal.edge).toBeGreaterThan(0.05);
    expect(signal.confidence).toBeGreaterThan(0.95);
    expect(signal.urgency).toBe('minutes'); // 3 minutes (180s) left → > 120s threshold → 'minutes'
  });

  it('team extraction pipeline: title → teams → game match', () => {
    const title = 'Will the Lakers beat the Celtics?';
    const teams = scanner.extractTeamsFromTitle(title);
    expect(teams).toBeDefined();

    const games: GameScore[] = [
      {
        gameId: '123', league: 'NBA',
        homeTeam: 'Los Angeles Lakers', awayTeam: 'Boston Celtics',
        homeScore: 100, awayScore: 95, quarter: 4,
        timeRemainingMs: 180000, isLive: true, isComplete: false,
        lastUpdated: Date.now(),
      },
    ];

    const match = scanner.matchTeamsToGame(teams!.team1, teams!.team2, games);
    expect(match).toBeDefined();
    expect(match!.gameId).toBe('123');
  });
});
