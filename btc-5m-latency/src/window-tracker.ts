/**
 * Window Tracker - Per-window P&L tracking and settlement.
 * Maintains detailed metrics per the latency arb strategy spec.
 */

import Decimal from 'decimal.js';
import { MarketInfo, WindowFillInput, WindowPnL } from './types';
import { logger } from './logger';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

const MAX_WINDOWS = 10;

export class WindowTracker {
  private windows: Map<number, WindowPnL> = new Map();
  private edgeSumAtFill: Decimal = new Decimal(0); // Running sum for avg calc
  private edgeFillCount: number = 0;

  /**
   * Initialize a new 5-min window for tracking.
   */
  startWindow(windowTs: number, priceToBeat: Decimal, market?: MarketInfo): void {
    const pnl: WindowPnL = {
      windowTimestamp: windowTs,
      marketSlug: market?.slug,
      conditionId: market?.conditionId,
      upTokenId: market?.upTokenId,
      downTokenId: market?.downTokenId,
      priceToBeat,
      finalChainlinkPrice: null,
      outcome: null,
      upSharesHeld: new Decimal(0),
      upAvgCost: new Decimal(0),
      downSharesHeld: new Decimal(0),
      downAvgCost: new Decimal(0),
      grossPnl: new Decimal(0),
      numTrades: 0,
      totalVolume: new Decimal(0),
      maxEdgeSeen: new Decimal(0),
      avgEdgeAtFill: new Decimal(0),
      timeOfFirstTrade: null,
      timeOfLastTrade: null,
      fills: [],
    };

    this.windows.set(windowTs, pnl);
    this.edgeSumAtFill = new Decimal(0);
    this.edgeFillCount = 0;

    // Prune old windows
    if (this.windows.size > MAX_WINDOWS) {
      const oldest = Math.min(...this.windows.keys());
      this.windows.delete(oldest);
    }
  }

  /**
   * Record a fill within the current window.
   */
  recordFill(
    windowTs: number,
    fill: WindowFillInput,
  ): void {
    const w = this.windows.get(windowTs);
    if (!w) {
      logger.warn('recordFill: window not found', { windowTs });
      return;
    }

    const cost = fill.shares.mul(fill.price);
    const now = fill.timestamp ?? Date.now();

    if (fill.side === 'UP') {
      // Update weighted average cost
      const totalShares = w.upSharesHeld.plus(fill.shares);
      if (totalShares.gt(0)) {
        w.upAvgCost = w.upAvgCost.mul(w.upSharesHeld).plus(cost).div(totalShares);
      }
      w.upSharesHeld = totalShares;
    } else {
      const totalShares = w.downSharesHeld.plus(fill.shares);
      if (totalShares.gt(0)) {
        w.downAvgCost = w.downAvgCost.mul(w.downSharesHeld).plus(cost).div(totalShares);
      }
      w.downSharesHeld = totalShares;
    }

    w.numTrades++;
    w.totalVolume = w.totalVolume.plus(cost);

    if (fill.edge.gt(w.maxEdgeSeen)) {
      w.maxEdgeSeen = fill.edge;
    }

    // Running average of edge at fill
    this.edgeSumAtFill = this.edgeSumAtFill.plus(fill.edge);
    this.edgeFillCount++;
    w.avgEdgeAtFill = this.edgeSumAtFill.div(this.edgeFillCount);

    if (!w.timeOfFirstTrade) {
      w.timeOfFirstTrade = now;
    }
    w.timeOfLastTrade = now;
    w.fills.push({
      timestamp: now,
      side: fill.side,
      tokenId: fill.tokenId,
      shares: fill.shares,
      price: fill.price,
      cost,
      edge: fill.edge,
      orderIds: fill.orderIds || [],
    });
  }

  /**
   * Settle a window after it closes. Determines outcome and P&L.
   */
  settleWindow(windowTs: number, finalChainlinkPrice: Decimal): WindowPnL {
    const w = this.windows.get(windowTs);
    if (!w) {
      logger.warn('settleWindow: window not found, creating empty', { windowTs });
      return {
        windowTimestamp: windowTs,
        marketSlug: undefined,
        conditionId: undefined,
        upTokenId: undefined,
        downTokenId: undefined,
        priceToBeat: new Decimal(0),
        finalChainlinkPrice,
        outcome: null,
        upSharesHeld: new Decimal(0),
        upAvgCost: new Decimal(0),
        downSharesHeld: new Decimal(0),
        downAvgCost: new Decimal(0),
        grossPnl: new Decimal(0),
        numTrades: 0,
        totalVolume: new Decimal(0),
        maxEdgeSeen: new Decimal(0),
        avgEdgeAtFill: new Decimal(0),
        timeOfFirstTrade: null,
        timeOfLastTrade: null,
        fills: [],
      };
    }

    w.finalChainlinkPrice = finalChainlinkPrice;

    // Outcome: UP if final >= price_to_beat, DOWN otherwise
    w.outcome = finalChainlinkPrice.gte(w.priceToBeat) ? 'UP' : 'DOWN';

    // P&L: winning side shares * $1.00 - total volume spent
    const upPayout = w.outcome === 'UP' ? w.upSharesHeld : new Decimal(0);
    const downPayout = w.outcome === 'DOWN' ? w.downSharesHeld : new Decimal(0);
    w.grossPnl = upPayout.plus(downPayout).minus(w.totalVolume);

    logger.info('Window settled', {
      windowTimestamp: windowTs,
      outcome: w.outcome,
      priceToBeat: w.priceToBeat.toFixed(2),
      finalPrice: finalChainlinkPrice.toFixed(2),
      upShares: w.upSharesHeld.toFixed(2),
      downShares: w.downSharesHeld.toFixed(2),
      grossPnl: w.grossPnl.toFixed(4),
      numTrades: w.numTrades,
      totalVolume: w.totalVolume.toFixed(2),
    });

    return w;
  }

  /**
   * Check if any trades were placed in the current window.
   */
  hasTraded(windowTs: number): boolean {
    const w = this.windows.get(windowTs);
    return w ? w.numTrades > 0 : false;
  }

  getCurrentWindow(windowTs: number): WindowPnL | null {
    return this.windows.get(windowTs) || null;
  }
}
