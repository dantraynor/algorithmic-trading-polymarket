import type Redis from 'ioredis';
import { getRedis, createSubscriber } from '@/lib/redis';
import { readCoreStats } from '@/lib/stream-readers/core';
import { readServiceHealth } from '@/lib/stream-readers/services';
import { readArbData } from '@/lib/stream-readers/arb';
import { createSSEResponse } from '@/lib/sse';
import type { TradeEvent, DashboardStats, CoreStreamState } from '@/lib/types';
import { STRATEGIES, ALL_STRATEGY_IDS } from '@/lib/strategy-registry';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Read lightweight dashboard stats (balance, pnl, win rate, trade count, messages).
 * This is a fast read that runs every 1s to keep the stats strip alive.
 */
async function readDashboardStats(redis: Redis): Promise<{
  coreState: CoreStreamState;
  stats: DashboardStats;
}> {
  const pipe = redis.pipeline();
  pipe.hgetall('execution:stats');    // 0
  pipe.hgetall('btc5m:stats');        // 1
  pipe.hgetall('ingestion:stats');    // 2

  // Run both in parallel instead of sequentially
  const [coreState, pipeResults] = await Promise.all([
    readCoreStats(redis),
    pipe.exec(),
  ]);

  if (!pipeResults) {
    return {
      coreState,
      stats: {
        balance: coreState.balance,
        todayPnl: 0,
        totalPnl: 0,
        winRate: 0,
        totalTrades: 0,
        maxDrawdown: 0,
        messagesIngested: 0,
      },
    };
  }

  const executionStats = (pipeResults[0] as [Error | null, Record<string, string>])[1] || {};
  const btc5mStats = (pipeResults[1] as [Error | null, Record<string, string>])[1] || {};
  const ingestionStats = (pipeResults[2] as [Error | null, Record<string, string>])[1] || {};

  const totalPnlArb = parseFloat(executionStats.total_profit || '0');
  const totalPnlBtc = parseFloat(btc5mStats.totalPnl || '0');
  const totalTradesArb = parseInt(executionStats.total_executions || '0', 10);
  const totalTradesBtc = parseInt(btc5mStats.totalTrades || '0', 10);

  return {
    coreState,
    stats: {
      balance: coreState.balance,
      todayPnl: parseFloat(btc5mStats.dailyPnl || '0'),
      totalPnl: totalPnlArb + totalPnlBtc,
      winRate: parseFloat(btc5mStats.winRate || '0'),
      totalTrades: totalTradesArb + totalTradesBtc,
      maxDrawdown: 0,
      messagesIngested: parseInt(ingestionStats.messages_received || '0', 10),
    },
  };
}

export async function GET(request: NextRequest) {
  const redis = getRedis();

  // Create a dedicated subscriber per SSE connection
  const sub = createSubscriber();

  // Subscribe to all strategy result channels (deduplicated)
  const channels = ALL_STRATEGY_IDS.map((id) => STRATEGIES[id].resultsChannel);
  const uniqueChannels = [...new Set(channels)];
  await sub.subscribe(...uniqueChannels);

  return createSSEResponse(request, (emit, onCleanup) => {
    /* ── Trade events via pub/sub ──────────────────────────────────── */

    const onMessage = (_channel: string, message: string) => {
      try {
        const trade: TradeEvent = JSON.parse(message);
        emit('trade_event', trade);
      } catch (err) {
        console.error('Failed to parse trade event:', err);
      }
    };
    sub.on('message', onMessage);

    /* ── Initial backfill: trade history ───────────────────────────── */

    redis.lrange('trades:history', 0, 99).then((tradeHistory) => {
      const trades = tradeHistory
        .map((t: string) => { try { return JSON.parse(t); } catch { return null; } })
        .filter(Boolean);
      emit('trade_backfill', trades);
    }).catch((err) => console.error('Failed to backfill trades:', err));

    /* ── Periodic: stats tick (every 1s) ───────────────────────────── */

    const statsInterval = setInterval(async () => {
      try {
        const { coreState, stats } = await readDashboardStats(redis);
        emit('stats_tick', {
          balance: coreState.balance,
          killSwitches: coreState.killSwitches,
          configOverrides: coreState.configOverrides,
          stats,
        });
      } catch (err) {
        console.error('Failed to read stats:', err);
        emit('stats_tick', { stale: true });
      }
    }, 1000);

    /* ── Periodic: market snapshot (every 2s) ──────────────────────── */

    const marketInterval = setInterval(async () => {
      try {
        const arbData = await readArbData(redis);
        emit('market_snapshot', arbData);
      } catch (err) {
        console.error('Failed to read arb data:', err);
      }
    }, 2000);

    /* ── Periodic: service health (every 5s) ───────────────────────── */

    const healthInterval = setInterval(async () => {
      try {
        const services = await readServiceHealth(redis);
        emit('service_health', { services });
      } catch (err) {
        console.error('Failed to read service health:', err);
      }
    }, 5000);

    /* ── Initial load: fire all events immediately ─────────────────── */

    (async () => {
      try {
        const [dashData, arbData, services] = await Promise.all([
          readDashboardStats(redis),
          readArbData(redis),
          readServiceHealth(redis),
        ]);

        emit('stats_tick', {
          balance: dashData.coreState.balance,
          killSwitches: dashData.coreState.killSwitches,
          configOverrides: dashData.coreState.configOverrides,
          stats: dashData.stats,
        });
        emit('market_snapshot', arbData);
        emit('service_health', { services });
      } catch (err) {
        console.error('Failed to send initial state:', err);
      }
    })();

    /* ── Cleanup on client disconnect ──────────────────────────────── */

    onCleanup(() => {
      clearInterval(statsInterval);
      clearInterval(marketInterval);
      clearInterval(healthInterval);
      sub.removeListener('message', onMessage);
      sub.unsubscribe().catch(() => {});
      sub.quit().catch(() => {});
    });
  });
}
