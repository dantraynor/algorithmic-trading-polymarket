import type Redis from 'ioredis';
import type { AlphaStreamState, OpenPosition } from '@/lib/types';

const ALPHA_STATS_KEY = 'alpha:stats';
const PORTFOLIO_PEAK_KEY = 'portfolio:peak_capital';
const PORTFOLIO_REALIZED_PNL_KEY = 'portfolio:realized_pnl';
const PORTFOLIO_DAILY_LOSS_KEY = 'portfolio:daily_loss';
const POSITIONS_EXPOSURE_KEY = 'positions:total_exposure';
const POSITIONS_BY_VERTICAL_PREFIX = 'positions:by_vertical:';
const POSITIONS_PREFIX = 'positions:open:';

const VERTICALS = ['crypto', 'sports', 'econ', 'news', 'arbitrage'] as const;

// Module-level cache: when multiple SSE routes (crypto, sports, positions) all
// call readAlphaData every 5s, only one actual Redis read happens per 3s window.
let alphaCache: { data: AlphaStreamState; ts: number } | null = null;
const ALPHA_CACHE_TTL_MS = 3000;

/**
 * Read alpha platform data: stats, portfolio state, and open positions.
 * Results are cached in-memory for 3 seconds to deduplicate concurrent reads.
 */
export async function readAlphaData(redis: Redis): Promise<AlphaStreamState> {
  if (alphaCache && Date.now() - alphaCache.ts < ALPHA_CACHE_TTL_MS) {
    return alphaCache.data;
  }

  // Phase 1: Fetch stats and portfolio keys
  const pipe = redis.pipeline();

  pipe.hgetall(ALPHA_STATS_KEY);         // 0
  pipe.get(POSITIONS_EXPOSURE_KEY);      // 1
  pipe.get(PORTFOLIO_PEAK_KEY);          // 2
  pipe.get(PORTFOLIO_REALIZED_PNL_KEY);  // 3
  pipe.get(PORTFOLIO_DAILY_LOSS_KEY);    // 4

  // Fetch market IDs for each vertical
  for (const vertical of VERTICALS) {
    pipe.smembers(POSITIONS_BY_VERTICAL_PREFIX + vertical); // 5-9
  }

  const results = await pipe.exec();
  if (!results) {
    return emptyAlphaState();
  }

  const alphaStats = (results[0] as [Error | null, Record<string, string>])[1] || {};
  const totalExposure = parseFloat((results[1] as [Error | null, string | null])[1] || '0');
  const peakCapital = parseFloat((results[2] as [Error | null, string | null])[1] || '0');
  const realizedPnl = parseFloat((results[3] as [Error | null, string | null])[1] || '0');
  const dailyLoss = parseFloat((results[4] as [Error | null, string | null])[1] || '0');

  // Collect all market IDs across verticals
  const marketIdsByVertical: Record<string, string[]> = {};
  for (let i = 0; i < VERTICALS.length; i++) {
    const vertical = VERTICALS[i];
    const marketIds = (results[5 + i] as [Error | null, string[]])[1] || [];
    marketIdsByVertical[vertical] = marketIds;
  }

  // Phase 2: Fetch all open positions
  const allMarketIds: Array<{ vertical: string; marketId: string }> = [];
  for (const vertical of VERTICALS) {
    for (const marketId of marketIdsByVertical[vertical]) {
      allMarketIds.push({ vertical, marketId });
    }
  }

  const positions: OpenPosition[] = [];

  if (allMarketIds.length > 0) {
    const posPipe = redis.pipeline();
    for (const entry of allMarketIds) {
      posPipe.get(POSITIONS_PREFIX + entry.marketId);
    }
    const posResults = await posPipe.exec();

    if (posResults) {
      for (let i = 0; i < allMarketIds.length; i++) {
        const [err, raw] = posResults[i] as [Error | null, string | null];
        if (err || !raw) continue;
        try {
          const pos = JSON.parse(raw);
          positions.push({
            marketId: pos.marketId,
            tokenId: pos.tokenId,
            direction: pos.direction,
            shares: pos.shares,
            entryPrice: pos.entryPrice,
            entryCost: pos.entryCost,
            entryTime: pos.entryTime,
            source: pos.source,
            signalId: pos.signalId,
            resolutionTime: pos.resolutionTime,
          });
        } catch {
          // Skip malformed position data
        }
      }
    }
  }

  const result: AlphaStreamState = {
    stats: alphaStats,
    portfolio: {
      totalExposure,
      peakCapital,
      realizedPnl,
      dailyLoss,
    },
    positions,
  };

  alphaCache = { data: result, ts: Date.now() };
  return result;
}

function emptyAlphaState(): AlphaStreamState {
  return {
    stats: {},
    portfolio: {
      totalExposure: 0,
      peakCapital: 0,
      realizedPnl: 0,
      dailyLoss: 0,
    },
    positions: [],
  };
}
