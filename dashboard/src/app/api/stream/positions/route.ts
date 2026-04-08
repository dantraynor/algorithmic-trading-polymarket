import { getRedis } from '@/lib/redis';
import { readAlphaData } from '@/lib/stream-readers/alpha';
import { loadChainHoldingsSnapshot } from '@/lib/chain/tracking';
import { createSSEResponse } from '@/lib/sse';
import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const redis = getRedis();

  return createSSEResponse(request, (emit, onCleanup) => {
    // Poll alpha positions every 5s
    const positionsInterval = setInterval(async () => {
      try {
        const alphaData = await readAlphaData(redis);
        emit('positions_data', {
          positions: alphaData.positions,
          portfolio: alphaData.portfolio,
        });
      } catch {
        // Redis unavailable
      }
    }, 5000);

    // Poll on-chain holdings every 30s — call getCachedHoldings directly
    // instead of going through an HTTP round-trip to /api/chain/holdings.
    const holdingsInterval = setInterval(async () => {
      try {
        const alphaData = await readAlphaData(redis);
        const tokenIds = alphaData.positions.map((p) => p.tokenId).filter(Boolean);
        const snapshot = await loadChainHoldingsSnapshot(redis, tokenIds);
        emit('chain_holdings', snapshot);
      } catch {
        // Holdings fetch failed
      }
    }, 30000);

    // Send initial data immediately
    readAlphaData(redis)
      .then((alphaData) => {
        emit('positions_data', {
          positions: alphaData.positions,
          portfolio: alphaData.portfolio,
        });
      })
      .catch(() => {});

    // Initial holdings fetch — direct call, no HTTP round-trip
    (async () => {
      try {
        const alphaData = await readAlphaData(redis);
        const tokenIds = alphaData.positions.map((p) => p.tokenId).filter(Boolean);
        const snapshot = await loadChainHoldingsSnapshot(redis, tokenIds);
        emit('chain_holdings', snapshot);
      } catch {
        // Holdings fetch failed
      }
    })();

    // Cleanup on disconnect
    onCleanup(() => {
      clearInterval(positionsInterval);
      clearInterval(holdingsInterval);
    });
  });
}
