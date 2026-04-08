import { describe, it, expect, beforeEach } from 'vitest';
import { SportsMarketScanner } from '../src/market-scanner';

describe('SportsMarketScanner', () => {
  let scanner: SportsMarketScanner;

  beforeEach(() => {
    scanner = new SportsMarketScanner();
  });

  describe('extractTeamsFromTitle', () => {
    it('extracts teams from "Will the Lakers beat the Celtics?" format', () => {
      const result = scanner.extractTeamsFromTitle('Will the Lakers beat the Celtics?');
      expect(result).toBeDefined();
      expect(result!.team1).toBe('lakers');
      expect(result!.team2).toBe('celtics');
    });

    it('extracts teams from "Lakers vs Celtics" format', () => {
      const result = scanner.extractTeamsFromTitle('Lakers vs Celtics');
      expect(result).toBeDefined();
      expect(result!.team1).toBe('lakers');
      expect(result!.team2).toBe('celtics');
    });

    it('extracts teams from "Lakers vs. Celtics" format', () => {
      const result = scanner.extractTeamsFromTitle('Lakers vs. Celtics');
      expect(result).toBeDefined();
    });

    it('extracts teams from "Will Lakers win against Celtics?" format', () => {
      const result = scanner.extractTeamsFromTitle('Will Lakers win against Celtics?');
      expect(result).toBeDefined();
    });

    it('returns null for non-sports titles', () => {
      const result = scanner.extractTeamsFromTitle('Will CPI exceed 3%?');
      expect(result).toBeNull();
    });

    it('returns null for titles without recognizable pattern', () => {
      const result = scanner.extractTeamsFromTitle('Something random here');
      expect(result).toBeNull();
    });
  });

  describe('matchTeamsToGame', () => {
    it('matches extracted teams to a live game', () => {
      const games = [
        { gameId: '123', homeTeam: 'Los Angeles Lakers', awayTeam: 'Boston Celtics', isLive: true },
        { gameId: '456', homeTeam: 'Miami Heat', awayTeam: 'Chicago Bulls', isLive: true },
      ];
      const match = scanner.matchTeamsToGame('lakers', 'celtics', games as any);
      expect(match).toBeDefined();
      expect(match!.gameId).toBe('123');
    });

    it('returns null when no game matches', () => {
      const games = [
        { gameId: '456', homeTeam: 'Miami Heat', awayTeam: 'Chicago Bulls', isLive: true },
      ];
      const match = scanner.matchTeamsToGame('lakers', 'celtics', games as any);
      expect(match).toBeNull();
    });
  });
});
