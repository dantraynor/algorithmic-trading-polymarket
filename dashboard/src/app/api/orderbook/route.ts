import { getRedis } from '@/lib/redis';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface Level {
  price: string;
  size: string;
}

async function getOrderBookLevels(
  tokenId: string,
): Promise<{ bids: Level[]; asks: Level[] }> {
  const redis = getRedis();

  // Get top 5 bids (highest first) and top 5 asks (lowest first)
  const [bidEntries, askEntries] = await Promise.all([
    redis.zrevrange(`ob:${tokenId}:bids`, 0, 4, 'WITHSCORES'),
    redis.zrange(`ob:${tokenId}:asks`, 0, 4, 'WITHSCORES'),
  ]);

  // bidEntries / askEntries are [member, score, member, score, ...]
  const bidPrices: string[] = [];
  const askPrices: string[] = [];

  for (let i = 1; i < bidEntries.length; i += 2) {
    bidPrices.push(bidEntries[i]);
  }
  for (let i = 1; i < askEntries.length; i += 2) {
    askPrices.push(askEntries[i]);
  }

  // Pipeline: get sizes for all price levels
  const pipeline = redis.pipeline();
  for (const price of bidPrices) {
    pipeline.hget(`ob:${tokenId}:bids:sizes`, price);
  }
  for (const price of askPrices) {
    pipeline.hget(`ob:${tokenId}:asks:sizes`, price);
  }

  const sizeResults = await pipeline.exec();
  if (!sizeResults) {
    return { bids: [], asks: [] };
  }

  const bids: Level[] = [];
  for (let i = 0; i < bidPrices.length; i++) {
    const [err, size] = sizeResults[i] as [Error | null, string | null];
    bids.push({
      price: bidPrices[i],
      size: !err && size ? size : '0',
    });
  }

  const asks: Level[] = [];
  for (let i = 0; i < askPrices.length; i++) {
    const [err, size] = sizeResults[bidPrices.length + i] as [Error | null, string | null];
    asks.push({
      price: askPrices[i],
      size: !err && size ? size : '0',
    });
  }

  return { bids, asks };
}

export async function GET(request: NextRequest) {
  const marketId = request.nextUrl.searchParams.get('market');

  if (!marketId) {
    return NextResponse.json(
      { error: 'Missing required parameter: market' },
      { status: 400 },
    );
  }

  const redis = getRedis();
  const marketHash = await redis.hgetall(`market:${marketId}`);

  if (!marketHash || !marketHash.yes_token || !marketHash.no_token) {
    return NextResponse.json(
      { error: 'Market not found' },
      { status: 404 },
    );
  }

  const [yes, no] = await Promise.all([
    getOrderBookLevels(marketHash.yes_token),
    getOrderBookLevels(marketHash.no_token),
  ]);

  return NextResponse.json({ yes, no });
}
