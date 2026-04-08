import axios from 'axios';
import { createLogger, format, transports } from 'winston';
import { SportsMarketInfo, GameScore } from './types';
import { findTeam } from './team-mappings';
import { matchNcaaTeam, extractNcaaTeamsFromTitle } from './ncaa-team-mappings';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

// Patterns for extracting teams from Polymarket market titles
// Use ([\w\s]+?) for multi-word team names like "Trail Blazers", "Golden State"
const BEAT_PATTERN = /will\s+(?:the\s+)?([\w\s]+?)\s+beat\s+(?:the\s+)?([\w\s]+?)[\s?]*$/i;
const VS_PATTERN = /([\w\s]+?)\s+vs\.?\s+([\w\s]+?)[\s?]*$/i;
const WIN_AGAINST_PATTERN = /will\s+(?:the\s+)?([\w\s]+?)\s+win\s+(?:against|over)\s+(?:the\s+)?([\w\s]+?)[\s?]*$/i;

export class SportsMarketScanner {
  private cache = new Map<string, SportsMarketInfo>();

  /**
   * Extract two team names from a Polymarket market title.
   */
  extractTeamsFromTitle(title: string): { team1: string; team2: string } | null {
    for (const pattern of [BEAT_PATTERN, WIN_AGAINST_PATTERN, VS_PATTERN]) {
      const match = title.match(pattern);
      if (match) {
        return { team1: match[1].toLowerCase(), team2: match[2].toLowerCase() };
      }
    }
    return null;
  }

  /**
   * Match extracted team names against live games.
   * Uses team-mappings for fuzzy matching (alias support).
   */
  matchTeamsToGame(
    team1: string,
    team2: string,
    games: GameScore[],
  ): GameScore | null {
    const teamInfo1 = findTeam(team1);
    const teamInfo2 = findTeam(team2);

    for (const game of games) {
      const homeInfo = findTeam(game.homeTeam);
      const awayInfo = findTeam(game.awayTeam);
      if (!homeInfo || !awayInfo) continue;

      // Check both orderings: (team1=home, team2=away) or (team1=away, team2=home)
      const match1 = (teamInfo1?.espnId === homeInfo.espnId && teamInfo2?.espnId === awayInfo.espnId);
      const match2 = (teamInfo1?.espnId === awayInfo.espnId && teamInfo2?.espnId === homeInfo.espnId);

      if (match1 || match2) return game;

      // Fallback: substring matching on team names
      const homeLower = game.homeTeam.toLowerCase();
      const awayLower = game.awayTeam.toLowerCase();
      if ((homeLower.includes(team1) && awayLower.includes(team2)) ||
          (homeLower.includes(team2) && awayLower.includes(team1))) {
        return game;
      }
    }

    return null;
  }

  /**
   * Discover active sports markets from Polymarket.
   * Queries Gamma API for markets with sports-related tags.
   */
  async discoverMarkets(games: GameScore[]): Promise<SportsMarketInfo[]> {
    const markets: SportsMarketInfo[] = [];

    try {
      // Query Gamma API for active NBA markets
      const res = await axios.get(`${GAMMA_API_URL}/markets`, {
        params: {
          active: true,
          closed: false,
          tag: 'nba',
          limit: 100,
        },
        timeout: 10_000,
      });

      const gammaMarkets = Array.isArray(res.data) ? res.data : [];

      for (const gm of gammaMarkets) {
        const title = gm.question || gm.title || '';
        const teams = this.extractTeamsFromTitle(title);
        if (!teams) continue;

        const matchedGame = this.matchTeamsToGame(teams.team1, teams.team2, games);
        if (!matchedGame) continue;

        const tokenIds: string[] = JSON.parse(gm.clobTokenIds || '[]');
        const outcomes: string[] = JSON.parse(gm.outcomes || '[]');

        if (tokenIds.length < 2 || outcomes.length < 2) continue;

        // Determine which token is home-wins (YES) vs away-wins (NO)
        // The first team in "Will X beat Y?" is typically the YES outcome
        const yesIdx = 0;
        const noIdx = 1;

        // Determine which team from the title is the home team
        const team1IsHome = matchedGame.homeTeam.toLowerCase().includes(teams.team1);
        const yesTokenId = team1IsHome ? tokenIds[yesIdx] : tokenIds[noIdx];
        const noTokenId = team1IsHome ? tokenIds[noIdx] : tokenIds[yesIdx];

        const conditionId = gm.conditionId || gm.condition_id || '';
        if (!conditionId) continue;

        const cacheKey = conditionId;
        if (this.cache.has(cacheKey)) {
          markets.push(this.cache.get(cacheKey)!);
          continue;
        }

        const info: SportsMarketInfo = {
          conditionId,
          yesTokenId,
          noTokenId,
          homeTeam: matchedGame.homeTeam,
          awayTeam: matchedGame.awayTeam,
          league: 'NBA',
          gameId: matchedGame.gameId,
          slug: gm.slug || '',
          negRisk: gm.negRisk === true, // Read from Gamma API response
        };

        this.cache.set(cacheKey, info);
        markets.push(info);
      }
    } catch (err: any) {
      logger.error('Gamma API sports market fetch failed', { error: err.message });
    }

    return markets;
  }

  clearCache(): void {
    this.cache.clear();
  }

  // ── NCAA Market Discovery ─────────────────────────────────────────────

  /**
   * Match extracted NCAA team names against live games.
   * Uses fuzzy matching via ncaa-team-mappings.
   */
  matchNcaaTeamsToGame(
    team1: string,
    team2: string,
    games: GameScore[],
  ): GameScore | null {
    for (const game of games) {
      const homeLower = game.homeTeam.toLowerCase();
      const awayLower = game.awayTeam.toLowerCase();
      const t1 = team1.toLowerCase();
      const t2 = team2.toLowerCase();

      // Check both orderings: (team1=home, team2=away) or (team1=away, team2=home)
      const match1 = (homeLower.includes(t1) || t1.includes(homeLower.split(' ')[0])) &&
                     (awayLower.includes(t2) || t2.includes(awayLower.split(' ')[0]));
      const match2 = (homeLower.includes(t2) || t2.includes(homeLower.split(' ')[0])) &&
                     (awayLower.includes(t1) || t1.includes(awayLower.split(' ')[0]));

      if (match1 || match2) return game;
    }

    return null;
  }

  /**
   * Discover active NCAA March Madness markets from Polymarket.
   * Queries Gamma API for events tagged with NCAA/March Madness.
   */
  async discoverNcaaMarkets(games: GameScore[]): Promise<SportsMarketInfo[]> {
    const markets: SportsMarketInfo[] = [];

    try {
      // Query Gamma API for active NCAA basketball markets
      const res = await axios.get(`${GAMMA_API_URL}/events`, {
        params: {
          tag_id: 100149,
          active: true,
          closed: false,
          limit: 100,
        },
        timeout: 10_000,
      });

      const gammaEvents = Array.isArray(res.data) ? res.data : [];

      for (const event of gammaEvents) {
        // Each event may contain multiple markets
        const eventMarkets = event.markets || [];
        for (const gm of eventMarkets) {
          const title = gm.question || gm.groupItemTitle || event.title || '';
          const teams = this.extractTeamsFromTitle(title) || extractNcaaTeamsFromTitle(title);
          if (!teams) continue;

          const matchedGame = this.matchNcaaTeamsToGame(teams.team1, teams.team2, games);
          if (!matchedGame) continue;

          const tokenIds: string[] = typeof gm.clobTokenIds === 'string'
            ? JSON.parse(gm.clobTokenIds)
            : (gm.clobTokenIds || []);
          const outcomes: string[] = typeof gm.outcomes === 'string'
            ? JSON.parse(gm.outcomes)
            : (gm.outcomes || []);

          if (tokenIds.length < 2 || outcomes.length < 2) continue;

          // Determine which token is home-wins (YES) vs away-wins (NO)
          const yesIdx = 0;
          const noIdx = 1;

          // Determine which team from the title is the home team
          const team1IsHome = matchNcaaTeam(teams.team1, matchedGame.homeTeam);
          const yesTokenId = team1IsHome ? tokenIds[yesIdx] : tokenIds[noIdx];
          const noTokenId = team1IsHome ? tokenIds[noIdx] : tokenIds[yesIdx];

          const conditionId = gm.conditionId || gm.condition_id || '';
          if (!conditionId) continue;

          const cacheKey = `ncaa:${conditionId}`;
          if (this.cache.has(cacheKey)) {
            markets.push(this.cache.get(cacheKey)!);
            continue;
          }

          const info: SportsMarketInfo = {
            conditionId,
            yesTokenId,
            noTokenId,
            homeTeam: matchedGame.homeTeam,
            awayTeam: matchedGame.awayTeam,
            league: 'NCAAM',
            gameId: matchedGame.gameId,
            slug: gm.slug || event.slug || '',
            negRisk: gm.negRisk === true,
          };

          this.cache.set(cacheKey, info);
          markets.push(info);
        }
      }
    } catch (err: any) {
      logger.error('Gamma API NCAA market fetch failed', { error: err.message });
    }

    return markets;
  }
}
