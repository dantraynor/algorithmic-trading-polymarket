/**
 * Orderbook Checker - Fetches and analyzes single-side order book liquidity.
 * Extracted from btc-5m/arb-scanner.ts, simplified for directional trading.
 */

import axios, { AxiosInstance } from 'axios';
import Decimal from 'decimal.js';
import { Config, OrderBookLevel, OrderBookSnapshot, LiquidityResult } from './types';
import { logger } from './logger';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

const MIN_SHARES = new Decimal(5); // Polymarket minimum order size

export class OrderbookChecker {
  private bookClient: AxiosInstance;

  constructor(config: Config) {
    this.bookClient = axios.create({
      baseURL: config.clobApiUrl,
      timeout: 5000,
    });
  }

  /**
   * Fetch order book for a token from the CLOB.
   */
  async fetchOrderBook(tokenId: string): Promise<OrderBookSnapshot> {
    try {
      const response = await this.bookClient.get('/book', {
        params: { token_id: tokenId },
      });

      const data = response.data;
      const asks: OrderBookLevel[] = (data?.asks || [])
        .filter((a: { price: string; size: string }) => new Decimal(a.price).gt(0) && new Decimal(a.size).gt(0))
        .sort((a: { price: string }, b: { price: string }) => new Decimal(a.price).comparedTo(new Decimal(b.price)));

      const bids: OrderBookLevel[] = (data?.bids || [])
        .filter((b: { price: string; size: string }) => new Decimal(b.price).gt(0) && new Decimal(b.size).gt(0))
        .sort((a: { price: string }, b: { price: string }) => new Decimal(b.price).comparedTo(new Decimal(a.price)));

      return { asks, bids, fetchedAt: Date.now() };
    } catch (error: any) {
      logger.warn(`Failed to fetch order book for ${tokenId.slice(0, 20)}...`, {
        error: error.message,
      });
      return { asks: [], bids: [], fetchedAt: Date.now() };
    }
  }

  /**
   * Walk ask levels to determine available liquidity within price and size constraints.
   * Returns null if insufficient liquidity (< MIN_SHARES).
   */
  getAvailableLiquidity(
    asks: OrderBookLevel[],
    maxPrice: Decimal,
    maxShares: Decimal,
  ): LiquidityResult | null {
    if (asks.length === 0) return null;

    let totalShares = new Decimal(0);
    let totalCost = new Decimal(0);
    let worstPrice = new Decimal(0);

    for (const level of asks) {
      const price = new Decimal(level.price);
      const size = new Decimal(level.size);

      // Stop if this level is above our max entry price
      if (price.gt(maxPrice)) break;

      let sharesToTake = size;

      // Cap if adding full level would exceed max shares
      const remaining = maxShares.minus(totalShares);
      if (remaining.lte(0)) break;
      if (sharesToTake.gt(remaining)) {
        sharesToTake = remaining;
      }

      totalShares = totalShares.plus(sharesToTake);
      totalCost = totalCost.plus(sharesToTake.mul(price));
      worstPrice = price;

      if (totalShares.gte(maxShares)) break;
    }

    if (totalShares.lt(MIN_SHARES)) return null;

    const vwapPrice = totalCost.div(totalShares);

    return {
      availableShares: totalShares,
      vwapPrice,
      worstPrice,
      totalCost,
    };
  }
}
