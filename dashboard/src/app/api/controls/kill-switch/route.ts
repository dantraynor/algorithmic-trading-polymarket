import { getRedis } from '@/lib/redis';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const { enabled } = await req.json();
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }
    const redis = getRedis();
    await redis.set('TRADING_ENABLED', enabled ? 'TRUE' : 'FALSE');
    return NextResponse.json({ ok: true, tradingEnabled: enabled });
  } catch (error) {
    console.error('Failed to toggle kill switch:', error);
    return NextResponse.json({ error: 'Failed to toggle kill switch' }, { status: 500 });
  }
}
