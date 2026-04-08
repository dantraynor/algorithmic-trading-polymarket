/**
 * Latency Signal - Core strategy brain for latency arbitrage.
 * Called on every tick aggregation (100ms). Computes true probability of UP outcome
 * based on exchange price vs Chainlink oracle price, then checks if Polymarket
 * orderbook is mispriced.
 */

import Decimal from 'decimal.js';
import { Config, MarketInfo, LatencyTradeDecision, OrderBookSnapshot, Direction } from './types';
import { ExchangeFeed } from './exchange-feed';
import { ChainlinkOracle } from './chainlink-oracle';
import { OrderbookChecker } from './orderbook-checker';
import { estimateProbability, computeKellySize } from './probability-model';
import { logger } from './logger';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

const ORDERBOOK_CACHE_MS = 500; // Cache orderbooks for 500ms to avoid CLOB API spam

export class LatencySignal {
  private config: Config;
  private exchangeFeed: ExchangeFeed;
  private chainlinkOracle: ChainlinkOracle;
  private orderbookChecker: OrderbookChecker;

  // Per-window position tracking
  private windowTs: number = 0;
  private upSpent: Decimal = new Decimal(0);
  private downSpent: Decimal = new Decimal(0);

  // Orderbook cache
  private upBookCache: OrderBookSnapshot | null = null;
  private downBookCache: OrderBookSnapshot | null = null;

  constructor(
    config: Config,
    exchangeFeed: ExchangeFeed,
    chainlinkOracle: ChainlinkOracle,
    orderbookChecker: OrderbookChecker,
  ) {
    this.config = config;
    this.exchangeFeed = exchangeFeed;
    this.chainlinkOracle = chainlinkOracle;
    this.orderbookChecker = orderbookChecker;
  }

  /**
   * Reset position tracking for a new window.
   */
  resetWindow(windowTs: number): void {
    this.windowTs = windowTs;
    this.upSpent = new Decimal(0);
    this.downSpent = new Decimal(0);
    this.upBookCache = null;
    this.downBookCache = null;
  }

  /**
   * Record a fill to update per-window position tracking.
   */
  recordFill(side: Direction, cost: Decimal): void {
    if (side === 'UP') {
      this.upSpent = this.upSpent.plus(cost);
    } else {
      this.downSpent = this.downSpent.plus(cost);
    }
  }

  /**
   * Evaluate whether a latency trade opportunity exists right now.
   * Called every tickAggregationMs (100ms).
   */
  async evaluate(
    market: MarketInfo,
    windowTs: number,
    timeRemainingSec: number,
  ): Promise<LatencyTradeDecision | null> {
    // 1. Get current aggregated BTC price
    const aggPrice = this.exchangeFeed.getMedianPrice();
    if (aggPrice.stale || aggPrice.median.isZero()) {
      return null;
    }

    // 2. Get price to beat (Chainlink at window open)
    const priceToBeat = this.chainlinkOracle.getWindowPrice(windowTs);
    if (!priceToBeat) {
      return null;
    }

    // 3. Compute delta and probability
    const delta = aggPrice.median.minus(priceToBeat);
    const rollingVol = this.exchangeFeed.getRollingStddev();

    if (rollingVol.isZero()) {
      return null; // Need vol data before we can estimate probability
    }

    // Volatility floor: skip choppy/range-bound markets where vol is too low
    // to produce meaningful directional signals.
    // Analysis: all trades with <$15 rolling vol were losses in choppy regimes.
    if (rollingVol.lt(this.config.minVolatility)) {
      return null;
    }

    // Minimum absolute delta: skip when price hasn't moved enough from priceToBeat.
    // Analysis: trades where BTC moved <$10 from priceToBeat were 100% losses (-$1,300+).
    if (delta.abs().lt(this.config.minDelta)) {
      return null;
    }

    const prob = estimateProbability(delta, timeRemainingSec, rollingVol);

    // 4. Check z-score threshold — skip if price move is not statistically significant
    if (prob.zScore.abs().lt(this.config.minZScore)) {
      return null;
    }

    // 5. Lock to one side per window — once we have a position, don't trade the opposite
    let sides: { side: Direction; trueProb: Decimal; tokenId: string; spent: Decimal }[] = [
      { side: 'UP', trueProb: prob.trueProb, tokenId: market.upTokenId, spent: this.upSpent },
      { side: 'DOWN', trueProb: new Decimal(1).minus(prob.trueProb), tokenId: market.downTokenId, spent: this.downSpent },
    ];

    if (this.upSpent.gt(0)) {
      sides = sides.filter(s => s.side === 'UP');
    } else if (this.downSpent.gt(0)) {
      sides = sides.filter(s => s.side === 'DOWN');
    }

    for (const { side, trueProb, tokenId, spent } of sides) {
      // Quick filter: skip if no possible edge
      const minEdge = new Decimal(this.config.minEdge);
      if (trueProb.lt(minEdge.plus(0.01))) {
        // trueProb too low to have edge over any reasonable ask
        continue;
      }

      // Check position limit
      const remaining = new Decimal(this.config.maxPositionPerWindow).minus(spent);
      if (remaining.lte(0)) continue;

      // Fetch orderbook (with caching)
      const book = await this.getCachedOrderBook(side, tokenId);
      if (book.asks.length === 0) continue;

      const bestAsk = new Decimal(book.asks[0].price);
      const edge = trueProb.minus(bestAsk);

      // Check minimum edge
      if (edge.lt(minEdge)) continue;

      // Max price we'll pay: trueProb - edgeBuffer
      const maxPrice = trueProb.minus(this.config.edgeBuffer);
      if (maxPrice.lte(0) || maxPrice.lt(bestAsk)) continue;

      // Kelly sizing
      const kellyDollars = computeKellySize(
        edge,
        bestAsk,
        this.config.kellyMultiplier,
        this.config.bankroll,
        this.config.maxPositionPerWindow,
        spent,
      );

      if (kellyDollars.lte(0)) continue;

      // Convert dollars to shares at bestAsk price
      let targetShares = kellyDollars.div(bestAsk).toDecimalPlaces(2, Decimal.ROUND_DOWN);

      // Check book depth
      const liquidity = this.orderbookChecker.getAvailableLiquidity(
        book.asks,
        maxPrice,
        targetShares,
      );

      if (!liquidity) continue;

      // Check minimum book depth in USD
      const bookDepthUsdc = liquidity.totalCost;
      if (bookDepthUsdc.lt(this.config.minBookDepthUsdc)) continue;

      // Use available shares (may be less than target)
      const shares = liquidity.availableShares;
      const totalCost = liquidity.totalCost;

      logger.info('Latency signal TRIGGERED', {
        side,
        trueProb: trueProb.toFixed(4),
        bestAsk: bestAsk.toFixed(4),
        edge: edge.toFixed(4),
        maxPrice: maxPrice.toFixed(4),
        kellyDollars: kellyDollars.toFixed(2),
        shares: shares.toFixed(2),
        totalCost: totalCost.toFixed(2),
        delta: delta.toFixed(2),
        timeRemaining: timeRemainingSec.toFixed(0),
        zScore: prob.zScore.toFixed(2),
      });

      return {
        side,
        tokenId,
        edge,
        trueProb,
        marketPrice: bestAsk,
        maxPrice: liquidity.worstPrice, // Use actual worst fill price as FOK limit
        kellyDollars,
        shares,
        totalCost,
        timestamp: Date.now(),
      };
    }

    return null;
  }

  private async getCachedOrderBook(
    side: Direction,
    tokenId: string,
  ): Promise<OrderBookSnapshot> {
    const now = Date.now();
    const cache = side === 'UP' ? this.upBookCache : this.downBookCache;

    if (cache && (now - cache.fetchedAt) < ORDERBOOK_CACHE_MS) {
      return cache;
    }

    const book = await this.orderbookChecker.fetchOrderBook(tokenId);

    if (side === 'UP') {
      this.upBookCache = book;
    } else {
      this.downBookCache = book;
    }

    return book;
  }
}
