import type Redis from 'ioredis';
import type { BtcStreamState, BtcWindow, MomentumDashboardStats, StrategyStats } from '@/lib/types';

/**
 * Read all BTC strategy data: btc-5m, btc-5m-momentum, btc-5m-latency.
 */
export async function readBtcData(redis: Redis): Promise<BtcStreamState> {
  const pipe = redis.pipeline();

  pipe.hgetall('btc5m:stats');                    // 0
  pipe.hgetall('btc5m:window:current');            // 1
  pipe.hgetall('btc5m_momentum:stats');            // 2
  pipe.hgetall('btc5m_momentum:window:current');   // 3
  pipe.get('btc5m_momentum:dry_run');              // 4
  pipe.hgetall('btc5m_latency:stats');             // 5
  pipe.hgetall('btc5m_latency:window:current');    // 6

  const results = await pipe.exec();
  if (!results) {
    return emptyBtcState();
  }

  const btc5mStats = (results[0] as [Error | null, Record<string, string>])[1] || {};
  const btc5mWindow = (results[1] as [Error | null, Record<string, string>])[1] || {};
  const momentumStatsRaw = (results[2] as [Error | null, Record<string, string>])[1] || {};
  const momentumWindowRaw = (results[3] as [Error | null, Record<string, string>])[1] || {};
  const momentumDryRun = (results[4] as [Error | null, string | null])[1];
  const latencyStatsRaw = (results[5] as [Error | null, Record<string, string>])[1] || {};
  const latencyWindowRaw = (results[6] as [Error | null, Record<string, string>])[1] || {};

  // BTC 5M stats
  const btc5m: BtcStreamState['btc5m'] = {
    stats: parseBtcStats(btc5mStats),
    window: parseWindow(btc5mWindow),
  };

  // Momentum stats
  const hasMomentum = Object.keys(momentumStatsRaw).length > 0;
  const momentumStats: MomentumDashboardStats | null = hasMomentum
    ? {
        dryRun: momentumDryRun === 'true',
        wins: parseInt(momentumStatsRaw.wins || '0', 10),
        losses: parseInt(momentumStatsRaw.losses || '0', 10),
        winRate: parseFloat(momentumStatsRaw.winRate || '0'),
        dailyProfit: parseFloat(momentumStatsRaw.dailyProfit || '0'),
        dailyVolume: parseFloat(momentumStatsRaw.dailyVolume || '0'),
        consecutiveLosses: parseInt(momentumStatsRaw.consecutiveLosses || '0', 10),
        avgFillRatio: parseFloat(momentumStatsRaw.paperAvgFillRatio || '0'),
        avgSlippageBps: parseFloat(momentumStatsRaw.paperAvgSlippageBps || '0'),
        partialFills: parseInt(momentumStatsRaw.paperPartialFills || '0', 10),
        missedFills: parseInt(momentumStatsRaw.paperMissedFills || '0', 10),
        windowDirection: momentumWindowRaw.direction || '',
        windowDeltaBps: parseFloat(momentumWindowRaw.deltaBps || '0'),
        windowTraded: momentumWindowRaw.traded === 'true',
      }
    : null;

  // Latency stats
  const btc5mLatency: BtcStreamState['btc5mLatency'] = {
    stats: parseLatencyStats(latencyStatsRaw),
    window: parseWindow(latencyWindowRaw),
  };

  return {
    btc5m,
    btc5mMomentum: {
      stats: momentumStats,
      window: parseWindow(momentumWindowRaw),
    },
    btc5mLatency,
  };
}

function parseBtcStats(raw: Record<string, string>): StrategyStats {
  return {
    wins: parseInt(raw.wins || '0', 10),
    losses: parseInt(raw.losses || '0', 10),
    winRate: parseFloat(raw.winRate || '0'),
    totalTrades: parseInt(raw.totalTrades || '0', 10),
    dailyProfit: parseFloat(raw.dailyPnl || '0'),
    dailyVolume: parseFloat(raw.dailyVolume || '0'),
    totalPnl: parseFloat(raw.totalPnl || '0'),
    consecutiveLosses: parseInt(raw.consecutiveLosses || '0', 10),
    lastTradeTime: parseInt(raw.lastTradeTime || '0', 10),
  };
}

function parseLatencyStats(raw: Record<string, string>): StrategyStats {
  return {
    wins: parseInt(raw.wins || '0', 10),
    losses: parseInt(raw.losses || '0', 10),
    winRate: parseFloat(raw.winRate || '0'),
    totalTrades: parseInt(raw.totalTrades || '0', 10),
    dailyProfit: parseFloat(raw.dailyProfit || '0'),
    dailyVolume: parseFloat(raw.dailyVolume || '0'),
    totalPnl: parseFloat(raw.totalProfit || '0') - parseFloat(raw.totalLoss || '0'),
    consecutiveLosses: parseInt(raw.consecutiveLosses || '0', 10),
    lastTradeTime: parseInt(raw.lastTradeTime || '0', 10),
  };
}

function parseWindow(raw: Record<string, string>): BtcWindow | null {
  if (!raw.timestamp) return null;
  return {
    timestamp: parseInt(raw.timestamp, 10),
    direction: raw.bestDirection || raw.direction || 'NONE',
    confidence: parseFloat(raw.bestConfidence || raw.confidence || '0'),
    openPrice: parseFloat(raw.openPrice || '0'),
  };
}

function emptyBtcState(): BtcStreamState {
  const emptyStats: StrategyStats = {
    wins: 0, losses: 0, winRate: 0, totalTrades: 0,
    dailyProfit: 0, dailyVolume: 0, totalPnl: 0,
    consecutiveLosses: 0, lastTradeTime: 0,
  };
  return {
    btc5m: { stats: emptyStats, window: null },
    btc5mMomentum: { stats: null, window: null },
    btc5mLatency: { stats: { ...emptyStats }, window: null },
  };
}
