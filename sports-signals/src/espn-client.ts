import axios from 'axios';
import { createLogger, format, transports } from 'winston';
import { GameScore } from './types';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const NBA_QUARTER_MINUTES = 12;
const NBA_OVERTIME_MINUTES = 5;
const NBA_QUARTERS = 4;

const NCAA_HALF_MINUTES = 20;
const NCAA_HALVES = 2;
const NCAA_OVERTIME_MINUTES = 5;

export class EspnClient {
  private lastNbaFetch = 0;
  private lastNcaaFetch = 0;
  private minIntervalMs = 2000; // Don't poll more than every 2s

  constructor(private baseUrl: string = 'https://site.api.espn.com') {}

  /**
   * Fetch today's NBA scoreboard from ESPN.
   * Returns all games with current scores.
   */
  async fetchNbaScoreboard(): Promise<GameScore[]> {
    const now = Date.now();
    if (now - this.lastNbaFetch < this.minIntervalMs) {
      await new Promise(r => setTimeout(r, this.minIntervalMs - (now - this.lastNbaFetch)));
    }
    this.lastNbaFetch = Date.now();

    try {
      const res = await axios.get(
        `${this.baseUrl}/apis/site/v2/sports/basketball/nba/scoreboard`,
        { timeout: 5000 },
      );

      const events = res.data?.events || [];
      const games: GameScore[] = [];

      for (const event of events) {
        const game = this.parseEvent(event);
        if (game) games.push(game);
      }

      return games;
    } catch (err: any) {
      logger.error('ESPN scoreboard fetch failed', { error: err.message });
      return [];
    }
  }

  /**
   * Parse a single ESPN event into a GameScore.
   * Public for testing.
   */
  parseEvent(event: any): GameScore | null {
    try {
      const competition = event.competitions?.[0];
      if (!competition) return null;

      const competitors = competition.competitors || [];
      const home = competitors.find((c: any) => c.homeAway === 'home');
      const away = competitors.find((c: any) => c.homeAway === 'away');
      if (!home || !away) return null;

      const status = competition.status;
      const statusName = status?.type?.name || '';
      const isComplete = status?.type?.completed === true;
      const isLive = statusName === 'STATUS_IN_PROGRESS' || statusName === 'STATUS_HALFTIME';
      const period = status?.period || 0;
      const displayClock = status?.displayClock || '0:00';

      const timeRemainingMs = this.parseNbaTimeRemaining(period, displayClock, isLive, isComplete);

      return {
        gameId: String(event.id),
        league: 'NBA',
        homeTeam: home.team?.displayName || '',
        awayTeam: away.team?.displayName || '',
        homeScore: parseInt(home.score || '0', 10),
        awayScore: parseInt(away.score || '0', 10),
        quarter: period,
        timeRemainingMs,
        isLive,
        isComplete,
        lastUpdated: Date.now(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Calculate total game time remaining in milliseconds.
   * NBA: 4 quarters x 12 minutes + overtime (5 min each).
   */
  private parseNbaTimeRemaining(
    period: number,
    displayClock: string,
    isLive: boolean,
    isComplete: boolean,
  ): number {
    if (isComplete || !isLive) return 0;

    // Parse "M:SS" or "MM:SS" format
    const parts = displayClock.split(':');
    const minutes = parseInt(parts[0] || '0', 10);
    const seconds = parseInt(parts[1] || '0', 10);
    const clockRemainingMs = (minutes * 60 + seconds) * 1000;

    // Remaining full quarters after current
    let remainingFullQuarters: number;
    if (period <= NBA_QUARTERS) {
      remainingFullQuarters = NBA_QUARTERS - period;
      return clockRemainingMs + remainingFullQuarters * NBA_QUARTER_MINUTES * 60 * 1000;
    } else {
      // Overtime — just clock remaining in current OT period
      return clockRemainingMs;
    }
  }

  // ── NCAA Methods ──────────────────────────────────────────────────────

  /**
   * Fetch today's NCAA men's basketball scoreboard from ESPN.
   * Uses groups=100 to filter to tournament games only.
   */
  async fetchNcaaScoreboard(): Promise<GameScore[]> {
    const now = Date.now();
    if (now - this.lastNcaaFetch < this.minIntervalMs) {
      await new Promise(r => setTimeout(r, this.minIntervalMs - (now - this.lastNcaaFetch)));
    }
    this.lastNcaaFetch = Date.now();

    try {
      const res = await axios.get(
        `${this.baseUrl}/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard`,
        {
          params: { groups: 100, limit: 50 },
          timeout: 5000,
        },
      );

      const events = res.data?.events || [];
      const games: GameScore[] = [];

      for (const event of events) {
        const game = this.parseNcaaEvent(event);
        if (game) games.push(game);
      }

      return games;
    } catch (err: any) {
      logger.error('ESPN NCAA scoreboard fetch failed', { error: err.message });
      return [];
    }
  }

  /**
   * Parse a single ESPN NCAA event into a GameScore.
   * Public for testing.
   */
  parseNcaaEvent(event: any): GameScore | null {
    try {
      const competition = event.competitions?.[0];
      if (!competition) return null;

      const competitors = competition.competitors || [];
      const home = competitors.find((c: any) => c.homeAway === 'home');
      const away = competitors.find((c: any) => c.homeAway === 'away');
      if (!home || !away) return null;

      const status = competition.status;
      const statusName = status?.type?.name || '';
      const isComplete = status?.type?.completed === true;
      const isLive = statusName === 'STATUS_IN_PROGRESS' || statusName === 'STATUS_HALFTIME';
      const period = status?.period || 0;
      const displayClock = status?.displayClock || '0:00';
      const isOvertime = period > NCAA_HALVES;

      const timeRemainingMs = this.parseNcaaTimeRemaining(period, displayClock, isLive, isComplete);

      // Try to extract pregame spread from odds
      let pregameSpread: number | undefined;
      try {
        const odds = competition.odds;
        if (Array.isArray(odds) && odds.length > 0) {
          const details = odds[0].details;
          if (typeof details === 'string') {
            // details format: "DUKE -6.5" or "KAN -3.0"
            const spreadMatch = details.match(/([-+]?\d+\.?\d*)\s*$/);
            if (spreadMatch) {
              const spreadVal = parseFloat(spreadMatch[1]);
              // Determine if the spread team is home or away
              const spreadTeamAbbr = details.replace(/([-+]?\d+\.?\d*)\s*$/, '').trim();
              const homeAbbr = (home.team?.abbreviation || '').toUpperCase();
              const awayAbbr = (away.team?.abbreviation || '').toUpperCase();
              if (spreadTeamAbbr.toUpperCase() === homeAbbr) {
                // Home team is favored, spread is negative from their perspective
                pregameSpread = -spreadVal; // Convert: "DUKE -6.5" -> home favored by 6.5
              } else if (spreadTeamAbbr.toUpperCase() === awayAbbr) {
                pregameSpread = spreadVal; // Away team favored
              }
            }
          }
          // Also try spread number directly
          if (pregameSpread === undefined && odds[0].spread !== undefined) {
            pregameSpread = parseFloat(odds[0].spread);
          }
        }
      } catch {
        // Spread extraction is best-effort
      }

      return {
        gameId: String(event.id),
        league: 'NCAAM',
        homeTeam: home.team?.displayName || '',
        awayTeam: away.team?.displayName || '',
        homeScore: parseInt(home.score || '0', 10),
        awayScore: parseInt(away.score || '0', 10),
        quarter: period,
        period,
        timeRemainingMs,
        isLive,
        isComplete,
        lastUpdated: Date.now(),
        pregameSpread,
        isOvertime,
      };
    } catch {
      return null;
    }
  }

  /**
   * Calculate total game time remaining in milliseconds for NCAA.
   * NCAA: 2 halves x 20 minutes + overtime (5 min each).
   */
  private parseNcaaTimeRemaining(
    period: number,
    displayClock: string,
    isLive: boolean,
    isComplete: boolean,
  ): number {
    if (isComplete || !isLive) return 0;

    // Parse "M:SS" or "MM:SS" format
    const parts = displayClock.split(':');
    const minutes = parseInt(parts[0] || '0', 10);
    const seconds = parseInt(parts[1] || '0', 10);
    const clockRemainingMs = (minutes * 60 + seconds) * 1000;

    if (period === 1) {
      // First half: clock time + full second half (20 min)
      return clockRemainingMs + NCAA_HALF_MINUTES * 60 * 1000;
    } else if (period === 2) {
      // Second half: just clock time
      return clockRemainingMs;
    } else {
      // Overtime: just clock remaining in current OT period
      return clockRemainingMs;
    }
  }
}

