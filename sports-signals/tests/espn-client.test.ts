import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EspnClient } from '../src/espn-client';
import { GameScore } from '../src/types';

// Mock axios
vi.mock('axios');

describe('EspnClient', () => {
  let client: EspnClient;

  beforeEach(() => {
    client = new EspnClient('https://site.api.espn.com');
  });

  describe('parseScoreboard', () => {
    it('parses a live NBA game from ESPN response', () => {
      const espnEvent = {
        id: '401584701',
        competitions: [{
          competitors: [
            {
              homeAway: 'home',
              team: { displayName: 'Los Angeles Lakers', abbreviation: 'LAL' },
              score: '98',
            },
            {
              homeAway: 'away',
              team: { displayName: 'Boston Celtics', abbreviation: 'BOS' },
              score: '92',
            },
          ],
          status: {
            type: { name: 'STATUS_IN_PROGRESS', completed: false },
            period: 4,
            displayClock: '3:45',
          },
        }],
      };

      const game = client.parseEvent(espnEvent);
      expect(game).toBeDefined();
      expect(game!.gameId).toBe('401584701');
      expect(game!.homeTeam).toBe('Los Angeles Lakers');
      expect(game!.awayTeam).toBe('Boston Celtics');
      expect(game!.homeScore).toBe(98);
      expect(game!.awayScore).toBe(92);
      expect(game!.quarter).toBe(4);
      expect(game!.isLive).toBe(true);
      expect(game!.isComplete).toBe(false);
    });

    it('parses time remaining from display clock', () => {
      const espnEvent = {
        id: '123',
        competitions: [{
          competitors: [
            { homeAway: 'home', team: { displayName: 'Team A', abbreviation: 'TA' }, score: '50' },
            { homeAway: 'away', team: { displayName: 'Team B', abbreviation: 'TB' }, score: '48' },
          ],
          status: {
            type: { name: 'STATUS_IN_PROGRESS', completed: false },
            period: 3,
            displayClock: '8:30',
          },
        }],
      };

      const game = client.parseEvent(espnEvent);
      expect(game).toBeDefined();
      // Q3 with 8:30 left: remaining = (8*60+30) + 12*60 (Q4) = 510 + 720 = 1230 seconds
      // NBA quarter = 12 minutes
      expect(game!.timeRemainingMs).toBeCloseTo(1230 * 1000, -3);
    });

    it('returns isComplete=true for finished games', () => {
      const espnEvent = {
        id: '123',
        competitions: [{
          competitors: [
            { homeAway: 'home', team: { displayName: 'Team A', abbreviation: 'TA' }, score: '110' },
            { homeAway: 'away', team: { displayName: 'Team B', abbreviation: 'TB' }, score: '105' },
          ],
          status: {
            type: { name: 'STATUS_FINAL', completed: true },
            period: 4,
            displayClock: '0:00',
          },
        }],
      };

      const game = client.parseEvent(espnEvent);
      expect(game!.isComplete).toBe(true);
      expect(game!.isLive).toBe(false);
    });

    it('returns isLive=false for scheduled games', () => {
      const espnEvent = {
        id: '123',
        competitions: [{
          competitors: [
            { homeAway: 'home', team: { displayName: 'Team A', abbreviation: 'TA' }, score: '0' },
            { homeAway: 'away', team: { displayName: 'Team B', abbreviation: 'TB' }, score: '0' },
          ],
          status: {
            type: { name: 'STATUS_SCHEDULED', completed: false },
            period: 0,
            displayClock: '0:00',
          },
        }],
      };

      const game = client.parseEvent(espnEvent);
      expect(game!.isLive).toBe(false);
      expect(game!.isComplete).toBe(false);
    });
  });
});
