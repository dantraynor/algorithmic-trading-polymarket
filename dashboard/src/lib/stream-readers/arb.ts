import type Redis from 'ioredis';
import type { MarketSummary } from '@/lib/types';

/**
 * Read active arbitrage markets and their best bid/ask from Redis.
 * Extracted verbatim from the original stream/route.ts readMarkets().
 */
export async function readArbData(redis: Redis): Promise<{ markets: MarketSummary[] }> {
  const marketIds = await redis.smembers('markets:active');
  if (!marketIds || marketIds.length === 0) return { markets: [] };

  // Limit to first 20 markets to avoid too many Redis queries
  const limited = marketIds.slice(0, 20);

  // Fetch all market hashes in a pipeline
  const marketPipeline = redis.pipeline();
  for (const id of limited) {
    marketPipeline.hgetall(`market:${id}`);
  }
  const marketResults = await marketPipeline.exec();
  if (!marketResults) return { markets: [] };

  // Build list of tokens to query
  const marketsWithTokens: Array<{
    id: string;
    name: string;
    yesTokenId: string;
    noTokenId: string;
  }> = [];

  for (let i = 0; i < limited.length; i++) {
    const [err, hash] = marketResults[i] as [Error | null, Record<string, string>];
    if (err || !hash || !hash.yes_token || !hash.no_token) continue;
    const name =
      hash.market_name ||
      `${limited[i].slice(0, 8)}...${limited[i].slice(-4)}`;
    marketsWithTokens.push({
      id: limited[i],
      name,
      yesTokenId: hash.yes_token,
      noTokenId: hash.no_token,
    });
  }

  if (marketsWithTokens.length === 0) return { markets: [] };

  // Pipeline: for each market, get best bid/ask for YES and NO tokens
  const pricePipeline = redis.pipeline();
  for (const m of marketsWithTokens) {
    // YES best bid (highest score)
    pricePipeline.zrevrange(`ob:${m.yesTokenId}:bids`, 0, 0, 'WITHSCORES');
    // YES best ask (lowest score)
    pricePipeline.zrange(`ob:${m.yesTokenId}:asks`, 0, 0, 'WITHSCORES');
    // NO best bid (highest score)
    pricePipeline.zrevrange(`ob:${m.noTokenId}:bids`, 0, 0, 'WITHSCORES');
    // NO best ask (lowest score)
    pricePipeline.zrange(`ob:${m.noTokenId}:asks`, 0, 0, 'WITHSCORES');
  }
  const priceResults = await pricePipeline.exec();
  if (!priceResults) return { markets: [] };

  // Build market summaries (size pipeline removed — MarketSummary has no size fields)
  const markets: MarketSummary[] = [];
  for (let i = 0; i < marketsWithTokens.length; i++) {
    const m = marketsWithTokens[i];
    const baseIdx = i * 4;

    const yesBidRes = priceResults[baseIdx] as [Error | null, string[]];
    const yesAskRes = priceResults[baseIdx + 1] as [Error | null, string[]];
    const noBidRes = priceResults[baseIdx + 2] as [Error | null, string[]];
    const noAskRes = priceResults[baseIdx + 3] as [Error | null, string[]];

    const yesBestBid =
      !yesBidRes[0] && yesBidRes[1]?.length >= 2
        ? parseFloat(yesBidRes[1][1])
        : 0;
    const yesBestAsk =
      !yesAskRes[0] && yesAskRes[1]?.length >= 2
        ? parseFloat(yesAskRes[1][1])
        : 0;
    const noBestBid =
      !noBidRes[0] && noBidRes[1]?.length >= 2
        ? parseFloat(noBidRes[1][1])
        : 0;
    const noBestAsk =
      !noAskRes[0] && noAskRes[1]?.length >= 2
        ? parseFloat(noAskRes[1][1])
        : 0;

    const sum = yesBestAsk + noBestAsk;
    const edge = 1.0 - sum;

    markets.push({
      id: m.id,
      name: m.name,
      yesTokenId: m.yesTokenId,
      noTokenId: m.noTokenId,
      yesBestBid,
      yesBestAsk,
      noBestBid,
      noBestAsk,
      sum,
      edge,
    });
  }

  return { markets };
}
