import { NextRequest, NextResponse } from 'next/server';
import { getDailyStats } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/db/stats
 *
 * Query params:
 *   ?date=2026-03-19  — filter by date (YYYY-MM-DD), omit for all dates
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const date = searchParams.get('date') || undefined;

    const stats = getDailyStats(date);

    return NextResponse.json(stats);
  } catch (error) {
    console.error('GET /api/db/stats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 },
    );
  }
}
