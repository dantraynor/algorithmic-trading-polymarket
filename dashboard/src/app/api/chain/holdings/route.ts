import { getRedis } from '@/lib/redis';
import { loadChainHoldingsSnapshot } from '@/lib/chain/tracking';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const redis = getRedis();
    const snapshot = await loadChainHoldingsSnapshot(redis);

    if (snapshot.trackedWallets.length === 0) {
      return NextResponse.json({
        holdings: [],
        trackedWallets: [],
        trackedTokenIds: [],
        usdceBalance: '0',
        error: 'No tracked wallets configured',
      });
    }

    return NextResponse.json(snapshot);
  } catch (error) {
    console.error('Failed to fetch on-chain holdings:', error);
    return NextResponse.json(
      {
        holdings: [],
        trackedWallets: [],
        trackedTokenIds: [],
        usdceBalance: '0',
        error: 'Failed to fetch holdings',
      },
      { status: 500 },
    );
  }
}
