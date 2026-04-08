import { getRedis } from '@/lib/redis';
import { readCoreStats } from '@/lib/stream-readers/core';
import { readServiceHealth } from '@/lib/stream-readers/services';
import { createSSEResponse } from '@/lib/sse';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const redis = getRedis();

  return createSSEResponse(request, (emit, onCleanup) => {
    // Poll stats + health every 2s
    const interval = setInterval(async () => {
      try {
        const [coreStats, serviceHealth] = await Promise.all([
          readCoreStats(redis),
          readServiceHealth(redis),
        ]);
        emit('stats_tick', coreStats);
        emit('service_health', serviceHealth);
      } catch {
        // Redis unavailable
      }
    }, 2000);

    // Send initial data immediately
    Promise.all([readCoreStats(redis), readServiceHealth(redis)])
      .then(([coreStats, serviceHealth]) => {
        emit('stats_tick', coreStats);
        emit('service_health', serviceHealth);
      })
      .catch(() => {});

    // Cleanup on disconnect
    onCleanup(() => {
      clearInterval(interval);
    });
  });
}
