import { NextRequest, NextResponse } from 'next/server';
import { getRecentTrades } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/db/trades
 *
 * Query params:
 *   ?limit=50         — max rows (default 50)
 *   ?strategy=btc-5m-latency  — filter by strategy
 *   ?dry_run=0        — 0 = live only, 1 = paper only (omit for both)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 500);
    const strategy = searchParams.get('strategy') || undefined;
    const dryRunParam = searchParams.get('dry_run');
    const dryRun = dryRunParam !== null ? dryRunParam === '1' : undefined;

    const trades = getRecentTrades(limit, strategy, dryRun);

    return NextResponse.json(trades);
  } catch (error) {
    console.error('GET /api/db/trades error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch trades' },
      { status: 500 },
    );
  }
}
