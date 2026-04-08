/**
 * CryptoMarketScanner - Discovers 5-minute Up/Down markets for BTC, ETH, SOL
 * Generalizes btc-5m-momentum/src/market-discovery.ts to multi-asset.
 */

import axios from 'axios';

const WINDOW_DURATION_SEC = 300; // 5 minutes
const MAX_CACHE_ENTRIES = 20;
const GAMMA_API_URL = 'https://gamma-api.polymarket.com';

export interface CryptoMarketInfo {
  slug: string;
  asset: string; // e.g. 'btcusdt'
  conditionId: string;
  upTokenId: string;
  downTokenId: string;
  windowTimestamp: number;
  windowCloseTimestamp: number;
}

// Supported slug prefixes and their Binance asset symbols
const SLUG_PREFIX_MAP: Record<string, string> = {
  btc: 'btcusdt',
  eth: 'ethusdt',
  sol: 'solusdt',
};

export class CryptoMarketScanner {
  // Cache keyed by `${asset}:${windowTimestamp}`
  private cache: Map<string, CryptoMarketInfo> = new Map();

  /**
   * Extract the Binance asset symbol from a Polymarket slug.
   * e.g. 'btc-updown-5m-1234567890' → 'btcusdt'
   * Returns null for non-matching slugs.
   */
  slugToAsset(slug: string): string | null {
    for (const [prefix, asset] of Object.entries(SLUG_PREFIX_MAP)) {
      if (slug.startsWith(`${prefix}-updown-`)) {
        return asset;
      }
    }
    return null;
  }

  /**
   * Floor `nowSeconds` (or current time) to the nearest 5-minute boundary.
   */
  getCurrentWindowTimestamp(nowSeconds?: number): number {
    const now = nowSeconds ?? Math.floor(Date.now() / 1000);
    return now - (now % WINDOW_DURATION_SEC);
  }

  /**
   * Return the timestamp of the next 5-minute window.
   */
  getNextWindowTimestamp(): number {
    return this.getCurrentWindowTimestamp() + WINDOW_DURATION_SEC;
  }

  /**
   * Check whether `currentTimeSeconds` falls within the entry window.
   *
   * @param windowTimestamp  - Start of the 5-minute window (seconds)
   * @param currentTimeSeconds - Current unix time (seconds)
   * @param entryStartSec    - Seconds after window open when entry is allowed
   * @param entryEndSec      - Seconds after window open when entry closes
   */
  isInEntryWindow(
    windowTimestamp: number,
    currentTimeSeconds: number,
    entryStartSec: number,
    entryEndSec: number,
  ): boolean {
    const elapsed = currentTimeSeconds - windowTimestamp;
    return elapsed >= entryStartSec && elapsed < entryEndSec;
  }

  /**
   * Discover all supported asset markets for the given window timestamp.
   *
   * @param windowTimestamp - 5-minute window start (unix seconds)
   * @param assets          - Optional subset of assets (default: all supported)
   * @returns Map of asset → CryptoMarketInfo (only discovered markets included)
   */
  async discoverMarkets(
    windowTimestamp: number,
    assets?: string[],
  ): Promise<Map<string, CryptoMarketInfo>> {
    const targetAssets = assets ?? Object.values(SLUG_PREFIX_MAP);
    const result = new Map<string, CryptoMarketInfo>();

    await Promise.all(
      targetAssets.map(async (asset) => {
        const cacheKey = `${asset}:${windowTimestamp}`;
        const cached = this.cache.get(cacheKey);
        if (cached) {
          result.set(asset, cached);
          return;
        }

        // Derive the slug prefix from the asset symbol (reverse lookup)
        const prefix = Object.entries(SLUG_PREFIX_MAP).find(([, v]) => v === asset)?.[0];
        if (!prefix) return;

        const slug = `${prefix}-updown-5m-${windowTimestamp}`;
        const info = await this.fetchMarket(slug, asset, windowTimestamp);
        if (info) {
          result.set(asset, info);
          this.cacheMarket(cacheKey, info);
        }
      }),
    );

    return result;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async fetchMarket(
    slug: string,
    asset: string,
    windowTimestamp: number,
  ): Promise<CryptoMarketInfo | null> {
    try {
      const response = await axios.get(`${GAMMA_API_URL}/events`, {
        params: { slug },
        timeout: 5000,
      });

      const events = response.data;
      if (!events || events.length === 0) return null;

      const event = events[0];
      const markets = event.markets;
      if (!markets || markets.length === 0) return null;

      const market = markets[0];
      const tokenIds: string[] = JSON.parse(market.clobTokenIds || '[]');
      if (tokenIds.length < 2) return null;

      const outcomes: string[] = JSON.parse(market.outcomes || '["Up","Down"]');
      const upIndex = outcomes.findIndex(
        (o) => o.toLowerCase() === 'up' || o.toLowerCase() === 'yes',
      );
      const downIndex = outcomes.findIndex(
        (o) => o.toLowerCase() === 'down' || o.toLowerCase() === 'no',
      );

      if (upIndex >= 0 && downIndex >= 0 && upIndex === downIndex) return null;

      const info: CryptoMarketInfo = {
        slug,
        asset,
        conditionId: market.conditionId || market.condition_id || '',
        upTokenId: tokenIds[upIndex >= 0 ? upIndex : 0],
        downTokenId: tokenIds[downIndex >= 0 ? downIndex : 1],
        windowTimestamp,
        windowCloseTimestamp: windowTimestamp + WINDOW_DURATION_SEC,
      };

      return info;
    } catch {
      return null;
    }
  }

  private cacheMarket(key: string, info: CryptoMarketInfo): void {
    this.cache.set(key, info);

    // Prune cache to MAX_CACHE_ENTRIES — remove oldest by insertion order
    if (this.cache.size > MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
  }
}
