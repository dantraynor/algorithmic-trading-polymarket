import { getRedis, createSubscriber } from '@/lib/redis';
import { readBtcData } from '@/lib/stream-readers/btc';
import { readAlphaData } from '@/lib/stream-readers/alpha';
import { createSSEResponse } from '@/lib/sse';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const redis = getRedis();
  const sub = createSubscriber();

  await sub.subscribe(
    'results:btc5m',
    'results:btc5m_momentum',
    'results:btc5m_latency',
    'results:alpha',
  );

  return createSSEResponse(request, (emit, onCleanup) => {
    // Pub/sub: trade results
    const onMessage = (channel: string, message: string) => {
      try {
        const trade = JSON.parse(message);
        emit('trade_event', { channel, trade });
      } catch {
        // Ignore malformed messages
      }
    };
    sub.on('message', onMessage);

    // Poll BTC data every 1s
    const btcInterval = setInterval(async () => {
      try {
        const btcData = await readBtcData(redis);
        emit('btc_data', btcData);
      } catch {
        // Redis unavailable
      }
    }, 1000);

    // Poll alpha data every 5s
    const alphaInterval = setInterval(async () => {
      try {
        const alphaData = await readAlphaData(redis);
        emit('alpha_data', alphaData);
      } catch {
        // Redis unavailable
      }
    }, 5000);

    // Send initial data immediately
    Promise.all([readBtcData(redis), readAlphaData(redis)])
      .then(([btcData, alphaData]) => {
        emit('btc_data', btcData);
        emit('alpha_data', alphaData);
      })
      .catch(() => {});

    // Cleanup on disconnect
    onCleanup(() => {
      clearInterval(btcInterval);
      clearInterval(alphaInterval);
      sub.removeListener('message', onMessage);
      sub.unsubscribe().catch(() => {});
      sub.quit().catch(() => {});
    });
  });
}
