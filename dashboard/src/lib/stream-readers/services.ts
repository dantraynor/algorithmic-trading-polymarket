import type Redis from 'ioredis';
import type { ServiceHealth } from '@/lib/types';

/**
 * Check if a service updated recently.
 * Handles both seconds-based (Rust chrono) and milliseconds-based (JS Date.now()) timestamps.
 */
export function isRecent(lastUpdate: string | undefined, isSeconds: boolean, maxAgeMs = 30_000): boolean {
  if (!lastUpdate) return false;
  const ms = isSeconds ? Number(lastUpdate) * 1000 : Number(lastUpdate);
  return Date.now() - ms < maxAgeMs;
}

export async function readServiceHealth(redis: Redis): Promise<ServiceHealth> {
  const pipe = redis.pipeline();

  pipe.hgetall('ingestion:stats');       // 0
  pipe.hgetall('scanner:stats');         // 1
  pipe.hgetall('execution:stats');       // 2
  pipe.hgetall('settlement:stats');      // 3
  pipe.hgetall('btc5m:stats');           // 4
  pipe.hgetall('btc5m:window:current');  // 5
  pipe.hgetall('btc5m_momentum:stats');  // 6
  pipe.hgetall('btc5m_momentum:window:current'); // 7

  const results = await pipe.exec();
  if (!results) {
    return defaultHealth();
  }

  const ingestionStats = (results[0] as [Error | null, Record<string, string>])[1] || {};
  const scannerStats = (results[1] as [Error | null, Record<string, string>])[1] || {};
  const executionStats = (results[2] as [Error | null, Record<string, string>])[1] || {};
  const settlementStats = (results[3] as [Error | null, Record<string, string>])[1] || {};
  const btc5mStats = (results[4] as [Error | null, Record<string, string>])[1] || {};
  const btcWindow = (results[5] as [Error | null, Record<string, string>])[1] || {};
  const momentumStatsRaw = (results[6] as [Error | null, Record<string, string>])[1] || {};
  const momentumWindowRaw = (results[7] as [Error | null, Record<string, string>])[1] || {};

  const now = Date.now();

  return {
    redis: { status: 'up', metric: 'connected' },
    ingestion: {
      status: isRecent(ingestionStats.last_update, true) ? 'up' : 'down',
      metric: `${ingestionStats.messages_received || '0'} msgs`,
    },
    'signal-core': {
      status: isRecent(scannerStats.last_update, false) ? 'up' : 'down',
      metric: `${scannerStats.avg_scan_time_us || '0'}us`,
    },
    execution: {
      status: isRecent(executionStats.last_execution_ms, false) ? 'up' : 'down',
      metric: executionStats.last_execution_ms
        ? `${Math.round((now - Number(executionStats.last_execution_ms)) / 1000)}s ago`
        : 'idle',
    },
    settlement: {
      status: isRecent(settlementStats.last_merge_ms, false) ? 'up' : 'down',
      metric: settlementStats.last_merge_ms
        ? `${Math.round((now - Number(settlementStats.last_merge_ms)) / 1000)}s ago`
        : 'idle',
    },
    'btc-5m': {
      status: isRecent(btc5mStats.lastScanTime || btc5mStats.lastTradeTime, false, 360_000) ? 'up' : 'down',
      metric: btcWindow.bestDirection || 'waiting',
    },
    'btc-5m-momentum': {
      status: isRecent(momentumStatsRaw.lastTradeTime, false, 360_000) ? 'up' : 'down',
      metric: momentumWindowRaw.direction || 'waiting',
    },
  };
}

function defaultHealth(): ServiceHealth {
  const down = { status: 'down' as const, metric: 'unknown' };
  return {
    redis: down,
    ingestion: down,
    'signal-core': down,
    execution: down,
    settlement: down,
    'btc-5m': down,
    'btc-5m-momentum': down,
  };
}
