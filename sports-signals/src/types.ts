export interface GameScore {
  gameId: string;
  league: string;        // 'NBA' | 'NCAAM'
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  quarter: number;        // 1-4 for NBA, 1-2 for NCAA (halves)
  timeRemainingMs: number;
  isLive: boolean;
  isComplete: boolean;
  lastUpdated: number;
  // NCAA-specific
  period?: number;         // alias for quarter in NCAA context (half 1 or 2)
  pregameSpread?: number;  // home team spread from ESPN pickcenter
  isOvertime?: boolean;
}

export interface SportsMarketInfo {
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  gameId: string;
  slug: string;
  gameStartTime?: number;
  negRisk: boolean;
}

export interface WinProbability {
  homeWinProb: number;
  scoreDiff: number;
  timeRemainingMin: number;
}
