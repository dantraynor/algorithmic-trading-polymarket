import { getRedis, createSubscriber } from '@/lib/redis';
import { readAlphaData } from '@/lib/stream-readers/alpha';
import { createSSEResponse } from '@/lib/sse';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const redis = getRedis();
  const sub = createSubscriber();

  await sub.subscribe('results:alpha');

  return createSSEResponse(request, (emit, onCleanup) => {
    // Pub/sub: filter trade results for sports vertical
    const onMessage = (_channel: string, message: string) => {
      try {
        const trade = JSON.parse(message);
        // Fix #5: check trade.strategy instead of non-existent trade.source / trade.vertical
        if (
          trade.strategy === 'alpha-sports' ||
          trade.strategy === 'sports' ||
          trade.strategy === 'sports-signals'
        ) {
          emit('trade_event', { trade });
        }
      } catch {
        // Ignore malformed messages
      }
    };
    sub.on('message', onMessage);

    // Poll alpha data every 5s, filtered to sports positions
    const alphaInterval = setInterval(async () => {
      try {
        const alphaData = await readAlphaData(redis);
        const sportsPositions = alphaData.positions.filter(
          (p) => p.source === 'sports',
        );
        emit('sports_data', {
          stats: alphaData.stats,
          portfolio: alphaData.portfolio,
          positions: sportsPositions,
        });
      } catch {
        // Redis unavailable
      }
    }, 5000);

    // Send initial data immediately
    readAlphaData(redis)
      .then((alphaData) => {
        const sportsPositions = alphaData.positions.filter(
          (p) => p.source === 'sports',
        );
        emit('sports_data', {
          stats: alphaData.stats,
          portfolio: alphaData.portfolio,
          positions: sportsPositions,
        });
      })
      .catch(() => {});

    // Cleanup on disconnect
    onCleanup(() => {
      clearInterval(alphaInterval);
      sub.removeListener('message', onMessage);
      sub.unsubscribe().catch(() => {});
      sub.quit().catch(() => {});
    });
  });
}
