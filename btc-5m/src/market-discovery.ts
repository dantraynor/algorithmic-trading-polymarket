/**
 * Market Discovery - Finds the current 5-minute BTC Up/Down market on Polymarket
 * Markets are deterministically located using Unix timestamps.
 */

import axios from 'axios';
import { MarketInfo, Config } from './types';
import { logger } from './logger';

const WINDOW_DURATION_SEC = 300; // 5 minutes

export class MarketDiscovery {
  private config: Config;
  private cache: Map<number, MarketInfo> = new Map();

  constructor(config: Config) {
    this.config = config;
  }

  /**
   * Get the current 5-minute window timestamp (floored to nearest 5 min)
   */
  getCurrentWindowTimestamp(): number {
    const nowSec = Math.floor(Date.now() / 1000);
    return nowSec - (nowSec % WINDOW_DURATION_SEC);
  }

  /**
   * Get the next window timestamp
   */
  getNextWindowTimestamp(): number {
    return this.getCurrentWindowTimestamp() + WINDOW_DURATION_SEC;
  }

  /**
   * Seconds remaining in the current window
   */
  getSecondsRemaining(): number {
    const nowSec = Date.now() / 1000;
    const windowClose = this.getCurrentWindowTimestamp() + WINDOW_DURATION_SEC;
    return Math.max(0, windowClose - nowSec);
  }

  /**
   * Discover the market for a given window timestamp
   * Uses Gamma API to find market metadata and token IDs
   */
  async discoverMarket(windowTimestamp: number): Promise<MarketInfo | null> {
    // Check cache first
    const cached = this.cache.get(windowTimestamp);
    if (cached) return cached;

    const slug = `btc-updown-5m-${windowTimestamp}`;

    try {
      const response = await axios.get(`${this.config.gammaApiUrl}/events`, {
        params: { slug },
        timeout: 5000,
      });

      const events = response.data;
      if (!events || events.length === 0) {
        logger.warn(`No market found for slug: ${slug}`);
        return null;
      }

      const event = events[0];
      const markets = event.markets;

      if (!markets || markets.length === 0) {
        logger.warn(`Event found but no markets for slug: ${slug}`);
        return null;
      }

      const market = markets[0];
      const tokenIds: string[] = JSON.parse(market.clobTokenIds || '[]');

      if (tokenIds.length < 2) {
        logger.error(`Market has fewer than 2 tokens: ${slug}`, { tokenIds });
        return null;
      }

      // Token order: determine UP/DOWN from outcomes array
      const outcomes: string[] = JSON.parse(market.outcomes || '["Up","Down"]');
      const upIndex = outcomes.findIndex(
        (o: string) => o.toLowerCase() === 'up' || o.toLowerCase() === 'yes'
      );
      const downIndex = outcomes.findIndex(
        (o: string) => o.toLowerCase() === 'down' || o.toLowerCase() === 'no'
      );

      if (upIndex < 0 || downIndex < 0) {
        logger.warn(`Unexpected outcome labels for ${slug}: ${JSON.stringify(outcomes)}. Using default token ordering [0]=UP, [1]=DOWN.`);
      }
      if (upIndex >= 0 && downIndex >= 0 && upIndex === downIndex) {
        logger.error(`UP and DOWN matched the same outcome index for ${slug}`, { outcomes });
        return null;
      }

      const marketInfo: MarketInfo = {
        slug,
        conditionId: market.conditionId || market.condition_id || '',
        upTokenId: tokenIds[upIndex >= 0 ? upIndex : 0],
        downTokenId: tokenIds[downIndex >= 0 ? downIndex : 1],
        windowTimestamp,
        windowCloseTimestamp: windowTimestamp + WINDOW_DURATION_SEC,
      };

      // Cache it
      this.cache.set(windowTimestamp, marketInfo);

      // Prune old cache entries (keep last 5)
      if (this.cache.size > 5) {
        const oldest = Math.min(...this.cache.keys());
        this.cache.delete(oldest);
      }

      logger.info(`Market discovered: ${slug}`, {
        conditionId: marketInfo.conditionId,
        upTokenId: marketInfo.upTokenId.slice(0, 20) + '...',
        downTokenId: marketInfo.downTokenId.slice(0, 20) + '...',
      });

      return marketInfo;
    } catch (error: any) {
      if (error.response?.status === 404) {
        logger.debug(`Market not yet available: ${slug}`);
      } else {
        logger.error(`Failed to discover market: ${slug}`, { error: error.message });
      }
      return null;
    }
  }

  /**
   * Discover the current window's market
   */
  async discoverCurrentMarket(): Promise<MarketInfo | null> {
    return this.discoverMarket(this.getCurrentWindowTimestamp());
  }

  /**
   * Pre-discover the next window's market (for faster readiness)
   */
  async discoverNextMarket(): Promise<MarketInfo | null> {
    return this.discoverMarket(this.getNextWindowTimestamp());
  }
}
