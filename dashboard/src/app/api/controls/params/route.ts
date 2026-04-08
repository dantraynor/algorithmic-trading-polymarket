import { getRedis } from '@/lib/redis';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { betSize, maxSlippage } = await req.json();
    const redis = getRedis();

    if (betSize !== undefined) {
      const size = Number(betSize);
      if (!Number.isFinite(size) || size < 1 || size > 10000) {
        return NextResponse.json({ error: 'maxPositionUsdc must be between 1 and 10000 USDC' }, { status: 400 });
      }
      await redis.set('config:btc5m:max_position_usdc', String(size));
    }
    if (maxSlippage !== undefined) {
      const bps = Number(maxSlippage);
      if (!Number.isFinite(bps) || bps < 1 || bps > 500) {
        return NextResponse.json({ error: 'maxSlippage must be between 1 and 500 bps' }, { status: 400 });
      }
      await redis.set('config:execution:max_slippage_bps', String(Math.round(bps)));
    }

    return NextResponse.json({ ok: true, betSize, maxSlippage });
  } catch (error) {
    console.error('Failed to update params:', error);
    return NextResponse.json({ error: 'Failed to update params' }, { status: 500 });
  }
}
