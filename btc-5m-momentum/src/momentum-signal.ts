/**
 * Momentum Signal - Evaluates whether to enter a directional trade.
 * Checks BTC spot price direction, then verifies Polymarket orderbook
 * has acceptable entry prices and sufficient liquidity.
 */

import Decimal from 'decimal.js';
import { Config, MarketInfo, MomentumDecision } from './types';
import { BinanceFeed } from './binance-feed';
import { OrderbookChecker } from './orderbook-checker';
import { logger } from './logger';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

export class MomentumSignal {
  private config: Config;
  private binanceFeed: BinanceFeed;
  private orderbookChecker: OrderbookChecker;

  constructor(config: Config, binanceFeed: BinanceFeed, orderbookChecker: OrderbookChecker) {
    this.config = config;
    this.binanceFeed = binanceFeed;
    this.orderbookChecker = orderbookChecker;
  }

  /**
   * Evaluate whether to enter a momentum trade for the given window.
   * Returns a MomentumDecision if all criteria are met, null otherwise.
   */
  async evaluate(market: MarketInfo, windowTimestamp: number): Promise<MomentumDecision | null> {
    // 1. Get BTC direction
    const directionResult = this.binanceFeed.getDirection(windowTimestamp);
    if (!directionResult) {
      logger.debug('No direction available (missing open price or current price)');
      return null;
    }

    const { direction, deltaBps, currentPrice, openPrice } = directionResult;

    logger.info('Direction evaluated', {
      direction,
      deltaBps: deltaBps.toFixed(2),
      btcOpen: openPrice.toFixed(2),
      btcCurrent: currentPrice.toFixed(2),
    });

    // 2. Skip flat/indecisive moves
    if (direction === 'FLAT') {
      logger.debug(`FLAT: |deltaBps| ${Math.abs(deltaBps).toFixed(1)} < threshold ${this.config.minDirectionBps}`);
      return null;
    }

    // 3. Determine which token to buy
    const tokenId = direction === 'UP' ? market.upTokenId : market.downTokenId;

    // 4. Fetch orderbook for the target side only
    const book = await this.orderbookChecker.fetchOrderBook(tokenId);
    if (book.asks.length === 0) {
      logger.debug('No asks available in orderbook');
      return null;
    }

    // 5. Check best ask price is in our entry range
    const bestAskPrice = new Decimal(book.asks[0].price);
    const minEntryPrice = new Decimal(this.config.minEntryPrice);
    const maxEntryPrice = new Decimal(this.config.maxEntryPrice);

    if (bestAskPrice.lt(minEntryPrice)) {
      logger.debug(`Best ask ${bestAskPrice.toFixed(4)} < min entry ${minEntryPrice.toFixed(2)}: too cheap, market uncertain`);
      return null;
    }

    if (bestAskPrice.gt(maxEntryPrice)) {
      logger.debug(`Best ask ${bestAskPrice.toFixed(4)} > max entry ${maxEntryPrice.toFixed(2)}: too expensive, low edge`);
      return null;
    }

    // 6. Check liquidity
    const maxBetUsdc = new Decimal(this.config.maxBetUsdc);
    // Max shares we can buy at the worst acceptable price
    const maxShares = maxBetUsdc.div(minEntryPrice).toDecimalPlaces(2, Decimal.ROUND_DOWN);

    const liquidity = this.orderbookChecker.getAvailableLiquidity(
      book.asks,
      maxEntryPrice,
      maxShares,
    );

    if (!liquidity) {
      logger.debug('Insufficient liquidity (< 5 shares at acceptable prices)');
      return null;
    }

    // 7. Cap by max bet USDC
    let shares = liquidity.availableShares;
    let totalCost = liquidity.totalCost;
    if (totalCost.gt(maxBetUsdc)) {
      // Scale down shares to fit within budget
      const ratio = maxBetUsdc.div(totalCost);
      shares = shares.mul(ratio).toDecimalPlaces(2, Decimal.ROUND_DOWN);
      totalCost = shares.mul(liquidity.vwapPrice);
    }

    const expectedProfit = new Decimal(1).minus(liquidity.worstPrice).mul(shares);
    const expectedLoss = liquidity.worstPrice.mul(shares);

    const decision: MomentumDecision = {
      direction,
      tokenId,
      entryPrice: liquidity.worstPrice,
      shares,
      totalCost,
      expectedProfit,
      expectedLoss,
      deltaBps,
    };

    logger.info('Momentum signal TRIGGERED', {
      direction,
      deltaBps: deltaBps.toFixed(2),
      entryPrice: liquidity.worstPrice.toFixed(4),
      shares: shares.toFixed(2),
      totalCost: totalCost.toFixed(2),
      expectedProfit: expectedProfit.toFixed(2),
      expectedLoss: expectedLoss.toFixed(2),
      riskReward: expectedProfit.div(expectedLoss).toFixed(2),
    });

    return decision;
  }
}
