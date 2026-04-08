export interface CryptoSignalsConfig {
  redisSocketPath: string;
  binanceSymbols: string[];
  minDirectionBps: number;
  minEntryPrice: number;
  maxEntryPrice: number;
  minEdgeBps: number;
  scanIntervalMs: number;
  entryStartSec: number;
  entryEndSec: number;
  clobApiUrl: string;
}

export function loadConfig(): CryptoSignalsConfig {
  return {
    redisSocketPath: process.env.REDIS_SOCKET_PATH || '/var/run/redis/redis.sock',
    binanceSymbols: (process.env.CRYPTO_BINANCE_SYMBOLS || 'btcusdt,ethusdt,solusdt').split(','),
    minDirectionBps: parseInt(process.env.CRYPTO_MIN_DIRECTION_BPS || '5'),
    minEntryPrice: parseFloat(process.env.CRYPTO_MIN_ENTRY_PRICE || '0.10'),
    maxEntryPrice: parseFloat(process.env.CRYPTO_MAX_ENTRY_PRICE || '0.95'),
    minEdgeBps: parseInt(process.env.CRYPTO_MIN_EDGE_BPS || '500'),
    scanIntervalMs: parseInt(process.env.CRYPTO_SCAN_INTERVAL_MS || '500'),
    entryStartSec: parseInt(process.env.CRYPTO_ENTRY_START_SEC || '30'),
    entryEndSec: parseInt(process.env.CRYPTO_ENTRY_END_SEC || '250'),
    clobApiUrl: process.env.CLOB_API_URL || 'https://clob.polymarket.com',
  };
}
