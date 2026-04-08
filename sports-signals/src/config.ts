export interface SportsSignalsConfig {
  redisSocketPath: string;
  clobApiUrl: string;
  minEntryPrice: number;
  maxEntryPrice: number;
  minEdgeBps: number;
  scanIntervalMs: number;
  scorePollingIntervalMs: number;
  espnBaseUrl: string;
  // NCAA-specific config
  ncaaMinEntryPrice: number;
  ncaaMaxEntryPrice: number;
  ncaaMinEdgeBps: number;
  ncaaMaxPositionUsdc: number;
  ncaaMinTimeRemainingSec: number;
  ncaaScoreStaleMs: number;
}

export function loadConfig(): SportsSignalsConfig {
  return {
    redisSocketPath: process.env.REDIS_SOCKET_PATH || '/var/run/redis/redis.sock',
    clobApiUrl: process.env.CLOB_API_URL || 'https://clob.polymarket.com',
    minEntryPrice: parseFloat(process.env.SPORTS_MIN_ENTRY_PRICE || '0.10'),
    maxEntryPrice: parseFloat(process.env.SPORTS_MAX_ENTRY_PRICE || '0.95'),
    minEdgeBps: parseInt(process.env.SPORTS_MIN_EDGE_BPS || '500'),
    scanIntervalMs: parseInt(process.env.SPORTS_SCAN_INTERVAL_MS || '10000'),
    scorePollingIntervalMs: parseInt(process.env.SPORTS_SCORE_POLLING_MS || '5000'),
    espnBaseUrl: process.env.ESPN_API_URL || 'https://site.api.espn.com',
    // NCAA-specific config
    ncaaMinEntryPrice: parseFloat(process.env.NCAA_MIN_ENTRY_PRICE || '0.10'),
    ncaaMaxEntryPrice: parseFloat(process.env.NCAA_MAX_ENTRY_PRICE || '0.90'),
    ncaaMinEdgeBps: parseInt(process.env.NCAA_MIN_EDGE_BPS || '500'),
    ncaaMaxPositionUsdc: parseFloat(process.env.NCAA_MAX_POSITION_USDC || '200'),
    ncaaMinTimeRemainingSec: parseInt(process.env.NCAA_MIN_TIME_REMAINING_SEC || '240'),
    ncaaScoreStaleMs: parseInt(process.env.NCAA_SCORE_STALE_MS || '15000'),
  };
}
