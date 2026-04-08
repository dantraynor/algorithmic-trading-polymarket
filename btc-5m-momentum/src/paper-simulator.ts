/**
 * Paper Simulator - Order-book-driven fill simulation for dry-run mode.
 * Re-fetches fresh order book and delegates to OrderbookChecker.getAvailableLiquidity()
 * to simulate realistic fills including partial fills and slippage.
 */

import Decimal from 'decimal.js';
import { MomentumDecision, SimulatedTradeResult } from './types';
import { OrderbookChecker } from './orderbook-checker';
import { logger } from './logger';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

export class PaperSimulator {
  private orderbookChecker: OrderbookChecker;

  constructor(orderbookChecker: OrderbookChecker) {
    this.orderbookChecker = orderbookChecker;
  }

  async simulateFill(decision: MomentumDecision): Promise<SimulatedTradeResult> {
    const startTime = performance.now();

    // Re-fetch fresh book to simulate latency drift
    const book = await this.orderbookChecker.fetchOrderBook(decision.tokenId);
    const asks = book.asks;

    // Empty book → missed fill
    if (asks.length === 0) {
      return this.missedResult(decision, performance.now() - startTime);
    }

    const bestAskPrice = new Decimal(asks[0].price);

    // Delegate to existing liquidity walk
    const liquidity = this.orderbookChecker.getAvailableLiquidity(
      asks,
      decision.entryPrice,
      decision.shares,
    );

    // getAvailableLiquidity returns null if < 5 shares
    if (!liquidity) {
      return this.missedResult(decision, performance.now() - startTime, bestAskPrice);
    }

    const fillShares = liquidity.availableShares;
    const fillPrice = liquidity.vwapPrice;
    const partialFill = fillShares.lt(decision.shares);
    const fillRatio = fillShares.div(decision.shares).toNumber();

    // Count ask levels consumed
    let levelsConsumed = 0;
    let counted = new Decimal(0);
    for (const level of asks) {
      const price = new Decimal(level.price);
      if (price.gt(decision.entryPrice)) break;
      levelsConsumed++;
      counted = counted.plus(new Decimal(level.size));
      if (counted.gte(fillShares)) break;
    }

    // Slippage: (VWAP - bestAsk) / bestAsk * 10000 bps
    const slippageBps = bestAskPrice.gt(0)
      ? fillPrice.minus(bestAskPrice).div(bestAskPrice).mul(10000).toNumber()
      : 0;

    const elapsed = performance.now() - startTime;

    const result: SimulatedTradeResult = {
      success: true,
      fillShares,
      requestedShares: decision.shares,
      fillPrice,
      requestedPrice: decision.entryPrice,
      slippageBps,
      fillRatio,
      partialFill,
      missedFill: false,
      bookDepthLevels: levelsConsumed,
      bestAskPrice,
      totalCost: liquidity.totalCost,
      latencyMs: elapsed,
    };

    logger.info('[PAPER] Fill simulation', {
      requested: decision.shares.toFixed(2),
      filled: fillShares.toFixed(2),
      fillRatio: (fillRatio * 100).toFixed(0) + '%',
      vwap: fillPrice.toFixed(4),
      bestAsk: bestAskPrice.toFixed(4),
      slippageBps: slippageBps.toFixed(1),
      levelsConsumed,
    });

    return result;
  }

  private missedResult(
    decision: MomentumDecision,
    latencyMs: number,
    bestAskPrice?: Decimal,
  ): SimulatedTradeResult {
    logger.info('[PAPER] Missed fill — insufficient liquidity', {
      tokenId: decision.tokenId.slice(0, 20) + '...',
      direction: decision.direction,
    });

    return {
      success: false,
      fillShares: new Decimal(0),
      requestedShares: decision.shares,
      fillPrice: new Decimal(0),
      requestedPrice: decision.entryPrice,
      slippageBps: 0,
      fillRatio: 0,
      partialFill: false,
      missedFill: true,
      bookDepthLevels: 0,
      bestAskPrice: bestAskPrice || new Decimal(0),
      totalCost: new Decimal(0),
      latencyMs,
    };
  }
}
