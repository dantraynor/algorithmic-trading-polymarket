import { NextRequest, NextResponse } from 'next/server';
import { getPositions } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * GET /api/db/positions
 *
 * Query params:
 *   ?status=open    — filter by status (open, closed, expired)
 *   ?source=sports  — filter by source (sports, crypto, etc.)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') || undefined;
    const source = searchParams.get('source') || undefined;

    const positions = getPositions(status, source);

    return NextResponse.json(positions);
  } catch (error) {
    console.error('GET /api/db/positions error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch positions' },
      { status: 500 },
    );
  }
}
