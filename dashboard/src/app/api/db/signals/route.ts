import { NextRequest, NextResponse } from 'next/server';
import { getRecentSignals } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/db/signals
 *
 * Query params:
 *   ?limit=50      — max rows (default 50)
 *   ?source=sports  — filter by source (sports, crypto, etc.)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10) || 50, 500);
    const source = searchParams.get('source') || undefined;

    const signals = getRecentSignals(limit, source);

    return NextResponse.json(signals);
  } catch (error) {
    console.error('GET /api/db/signals error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch signals' },
      { status: 500 },
    );
  }
}
