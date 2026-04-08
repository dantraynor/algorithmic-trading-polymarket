import { getRedis } from '@/lib/redis';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Generic Redis key toggle endpoint.
 * POST { key: string, enabled: boolean }
 * Sets the Redis key to 'TRUE' or 'FALSE'.
 *
 * Only allows known kill-switch keys to prevent arbitrary Redis writes.
 */

const ALLOWED_KEYS = new Set([
  'TRADING_ENABLED',
  'BTC_5M_TRADING_ENABLED',
  'BTC_5M_LATENCY_TRADING_ENABLED',
  'BTC_5M_MOMENTUM_TRADING_ENABLED',
  'ALPHA_TRADING_ENABLED',
  'CRYPTO_SIGNALS_ENABLED',
  'SPORTS_SIGNALS_ENABLED',
]);

export async function POST(req: NextRequest) {
  try {
    const { key, enabled } = await req.json();

    if (typeof key !== 'string' || !key) {
      return NextResponse.json({ error: 'key must be a non-empty string' }, { status: 400 });
    }
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }
    if (!ALLOWED_KEYS.has(key)) {
      return NextResponse.json({ error: `key '${key}' is not an allowed kill-switch key` }, { status: 400 });
    }

    const redis = getRedis();
    await redis.set(key, enabled ? 'TRUE' : 'FALSE');
    return NextResponse.json({ ok: true, key, enabled });
  } catch (error) {
    console.error('Failed to toggle key:', error);
    return NextResponse.json({ error: 'Failed to toggle key' }, { status: 500 });
  }
}
