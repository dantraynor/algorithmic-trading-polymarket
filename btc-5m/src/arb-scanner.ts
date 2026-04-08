/**
 * Arbitrage Scanner - Detects box spread opportunities on BTC 5-min markets.
 * Fetches CLOB order books for both UP and DOWN tokens, walks both ask sides
 * simultaneously using a liquidity-driven sweep, and determines the optimal
 * position size where the running combined VWAP stays profitable.
 */

import axios, { AxiosInstance } from 'axios';
import Decimal from 'decimal.js';
import { Config, ArbitrageOpportunity, OrderBookLevel, OrderBookSnapshot } from './types';
import { logger } from './logger';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

const MIN_SHARES = 5; // Polymarket minimum order size

interface OptimalFill {
  shares: Decimal;
  upAvgPrice: Decimal;
  downAvgPrice: Decimal;
  upWorstPrice: Decimal; // Highest ask level touched on UP side
  downWorstPrice: Decimal; // Highest ask level touched on DOWN side
  upTotalCost: Decimal;
  downTotalCost: Decimal;
  combinedCost: Decimal; // upAvgPrice + downAvgPrice (per-share)
  edge: Decimal; // 1.00 - combinedCost
}

export class ArbScanner {
  private config: Config;
  private bookClient: AxiosInstance;

  constructor(config: Config) {
    this.config = config;

    // /book endpoint is public (no auth needed)
    this.bookClient = axios.create({
      baseURL: config.clobApiUrl,
      timeout: 5000,
    });
  }

  /**
   * Scan both order books for an arbitrage opportunity.
   * Returns null if no profitable opportunity exists.
   */
  async scan(
    upTokenId: string,
    downTokenId: string,
    maxPositionUsdcOverride?: Decimal,
  ): Promise<ArbitrageOpportunity | null> {
    // Fetch both books in parallel
    const [upBook, downBook] = await Promise.all([
      this.fetchOrderBook(upTokenId),
      this.fetchOrderBook(downTokenId),
    ]);

    if (upBook.asks.length === 0 || downBook.asks.length === 0) {
      logger.debug('One or both order books empty, skipping');
      return null;
    }

    const maxCombinedCost = new Decimal(this.config.maxCombinedCost);
    const maxPositionUsdc = maxPositionUsdcOverride ?? new Decimal(this.config.maxPositionUsdc);

    const fill = this.findOptimalFill(upBook.asks, downBook.asks, maxCombinedCost, maxPositionUsdc);

    if (!fill) {
      logger.debug('No profitable fill found across order books');
      return null;
    }

    const edgeBps = fill.edge.mul(10000).toNumber();

    if (edgeBps < this.config.minEdgeBps) {
      logger.debug(`Edge ${edgeBps.toFixed(0)} bps < min ${this.config.minEdgeBps} bps`);
      return null;
    }

    const opportunity: ArbitrageOpportunity = {
      upAskPrice: fill.upAvgPrice,
      downAskPrice: fill.downAvgPrice,
      upWorstPrice: fill.upWorstPrice,
      downWorstPrice: fill.downWorstPrice,
      combinedCost: fill.combinedCost,
      edge: fill.edge,
      edgeBps,
      optimalShares: fill.shares,
      totalUpCost: fill.upTotalCost,
      totalDownCost: fill.downTotalCost,
      timestamp: Date.now(),
    };

    logger.info('Arbitrage opportunity found', {
      upAsk: fill.upAvgPrice.toFixed(4),
      downAsk: fill.downAvgPrice.toFixed(4),
      combined: fill.combinedCost.toFixed(4),
      edgeBps: edgeBps.toFixed(0),
      optimalShares: fill.shares.toFixed(0),
      totalCost: fill.upTotalCost.plus(fill.downTotalCost).toFixed(2),
    });

    return opportunity;
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
        .filter((a: { price: string; size: string }) => parseFloat(a.price) > 0 && parseFloat(a.size) > 0)
        .sort((a: { price: string }, b: { price: string }) => parseFloat(a.price) - parseFloat(b.price));

      const bids: OrderBookLevel[] = (data?.bids || [])
        .filter((b: { price: string; size: string }) => parseFloat(b.price) > 0 && parseFloat(b.size) > 0)
        .sort((a: { price: string }, b: { price: string }) => parseFloat(b.price) - parseFloat(a.price));

      return { asks, bids, fetchedAt: Date.now() };
    } catch (error: any) {
      logger.warn(`Failed to fetch order book for ${tokenId.slice(0, 20)}...`, {
        error: error.message,
      });
      return { asks: [], bids: [], fetchedAt: Date.now() };
    }
  }

  /**
   * Walk both ask sides simultaneously to find the maximum position size
   * where the running combined VWAP stays below maxCombinedCost.
   *
   * Level-stepping algorithm: advances whichever side exhausts its current
   * level first, checking profitability at each step. When adding a full
   * level would push combined cost over the threshold, binary-searches
   * within that level to find the exact cutoff.
   */
  private findOptimalFill(
    upAsks: OrderBookLevel[],
    downAsks: OrderBookLevel[],
    maxCombinedCost: Decimal,
    maxPositionUsdc: Decimal,
  ): OptimalFill | null {
    const maxLevels = this.config.maxBookLevels;
    const upLevels = upAsks.slice(0, maxLevels);
    const downLevels = downAsks.slice(0, maxLevels);

    if (upLevels.length === 0 || downLevels.length === 0) return null;

    // Check if even the best prices (level 0) are profitable
    const bestUpPrice = new Decimal(upLevels[0].price);
    const bestDownPrice = new Decimal(downLevels[0].price);
    if (bestUpPrice.plus(bestDownPrice).gte(maxCombinedCost)) return null;

    let totalShares = new Decimal(0);
    let upCost = new Decimal(0);
    let downCost = new Decimal(0);
    let upWorstPrice = bestUpPrice; // Track highest ask level touched per side
    let downWorstPrice = bestDownPrice;

    let upIdx = 0;
    let downIdx = 0;
    let upConsumed = new Decimal(0); // shares consumed at current up level
    let downConsumed = new Decimal(0); // shares consumed at current down level

    while (upIdx < upLevels.length && downIdx < downLevels.length) {
      const upPrice = new Decimal(upLevels[upIdx].price);
      const downPrice = new Decimal(downLevels[downIdx].price);
      const upAvailable = new Decimal(upLevels[upIdx].size).minus(upConsumed);
      const downAvailable = new Decimal(downLevels[downIdx].size).minus(downConsumed);

      // How many shares this step can contribute (thinner side)
      let stepShares = Decimal.min(upAvailable, downAvailable);

      // Check position cap: would adding these shares exceed max USDC per side?
      const projectedUpCost = upCost.plus(stepShares.mul(upPrice));
      const projectedDownCost = downCost.plus(stepShares.mul(downPrice));
      const maxSideCost = Decimal.max(projectedUpCost, projectedDownCost);

      if (maxSideCost.gt(maxPositionUsdc)) {
        // Cap by the tighter side
        const upRoom = maxPositionUsdc.minus(upCost);
        const downRoom = maxPositionUsdc.minus(downCost);
        const maxSharesByUp = upRoom.div(upPrice).toDecimalPlaces(2, Decimal.ROUND_DOWN);
        const maxSharesByDown = downRoom.div(downPrice).toDecimalPlaces(2, Decimal.ROUND_DOWN);
        stepShares = Decimal.min(stepShares, maxSharesByUp, maxSharesByDown);

        if (stepShares.lte(0)) break;

        // Add capped shares and stop
        totalShares = totalShares.plus(stepShares);
        upCost = upCost.plus(stepShares.mul(upPrice));
        downCost = downCost.plus(stepShares.mul(downPrice));
        upWorstPrice = upPrice;
        downWorstPrice = downPrice;
        break;
      }

      // Check profitability: would adding these shares push combined VWAP over threshold?
      const newShares = totalShares.plus(stepShares);
      const newUpCost = upCost.plus(stepShares.mul(upPrice));
      const newDownCost = downCost.plus(stepShares.mul(downPrice));
      const combinedVWAP = newUpCost.plus(newDownCost).div(newShares);

      if (combinedVWAP.gte(maxCombinedCost)) {
        // Binary search within this step to find exact cutoff
        const cutoff = this.binarySearchCutoff(
          totalShares, upCost, downCost,
          upPrice, downPrice,
          stepShares, maxCombinedCost,
        );

        if (cutoff.gt(0)) {
          totalShares = totalShares.plus(cutoff);
          upCost = upCost.plus(cutoff.mul(upPrice));
          downCost = downCost.plus(cutoff.mul(downPrice));
          upWorstPrice = upPrice;
          downWorstPrice = downPrice;
        }
        break;
      }

      // Add full step
      totalShares = newShares;
      upCost = newUpCost;
      downCost = newDownCost;
      upWorstPrice = upPrice;
      downWorstPrice = downPrice;

      // Advance consumed counters and level indices
      upConsumed = upConsumed.plus(stepShares);
      downConsumed = downConsumed.plus(stepShares);

      if (upConsumed.gte(new Decimal(upLevels[upIdx].size))) {
        upIdx++;
        upConsumed = new Decimal(0);
      }
      if (downConsumed.gte(new Decimal(downLevels[downIdx].size))) {
        downIdx++;
        downConsumed = new Decimal(0);
      }
    }

    if (totalShares.lt(MIN_SHARES)) return null;

    const upAvgPrice = upCost.div(totalShares);
    const downAvgPrice = downCost.div(totalShares);
    const combinedCost = upAvgPrice.plus(downAvgPrice);
    const edge = new Decimal(1).minus(combinedCost);

    return {
      shares: totalShares,
      upAvgPrice,
      downAvgPrice,
      upWorstPrice,
      downWorstPrice,
      upTotalCost: upCost,
      downTotalCost: downCost,
      combinedCost,
      edge,
    };
  }

  /**
   * Binary search to find the maximum number of additional shares (up to maxShares)
   * at the given prices that keep the combined VWAP below the threshold.
   */
  private binarySearchCutoff(
    existingShares: Decimal,
    existingUpCost: Decimal,
    existingDownCost: Decimal,
    upPrice: Decimal,
    downPrice: Decimal,
    maxShares: Decimal,
    maxCombinedCost: Decimal,
  ): Decimal {
    // Polymarket supports 2 decimal places for shares
    const step = new Decimal('0.01');
    let lo = new Decimal(0);
    let hi = maxShares;

    // Quick check: can we add even the minimum?
    const minAdd = step;
    const testShares = existingShares.plus(minAdd);
    const testCost = existingUpCost.plus(minAdd.mul(upPrice))
      .plus(existingDownCost.plus(minAdd.mul(downPrice)));
    if (testCost.div(testShares).gte(maxCombinedCost)) {
      return new Decimal(0);
    }

    while (hi.minus(lo).gt(step)) {
      const mid = lo.plus(hi).div(2).toDecimalPlaces(2, Decimal.ROUND_DOWN);
      const newShares = existingShares.plus(mid);
      const newTotalCost = existingUpCost.plus(mid.mul(upPrice))
        .plus(existingDownCost.plus(mid.mul(downPrice)));
      const vwap = newTotalCost.div(newShares);

      if (vwap.lt(maxCombinedCost)) {
        lo = mid;
      } else {
        hi = mid;
      }
    }

    return lo;
  }
}
