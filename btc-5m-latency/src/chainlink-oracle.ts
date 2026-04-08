/**
 * Chainlink Oracle - Reads BTC/USD price from Chainlink aggregator on Polygon.
 * This is the resolution oracle for Polymarket 5-minute binary markets.
 * We poll it to know the "Price to Beat" at window open and to detect oracle staleness.
 */

import { ethers } from 'ethers';
import Decimal from 'decimal.js';
import { ChainlinkPrice } from './types';
import { logger } from './logger';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

// Minimal ABI for Chainlink AggregatorV3Interface
const AGGREGATOR_ABI = [
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
];

const MAX_CACHED_WINDOWS = 10;

export class ChainlinkOracle {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private pollIntervalMs: number;
  private pollTimer: NodeJS.Timeout | null = null;
  private oracleDecimals: number = 8; // BTC/USD standard

  private currentPrice: ChainlinkPrice | null = null;
  private windowPrices: Map<number, Decimal> = new Map();

  constructor(rpcUrl: string, aggregatorAddress: string, pollIntervalMs: number) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.contract = new ethers.Contract(aggregatorAddress, AGGREGATOR_ABI, this.provider);
    this.pollIntervalMs = pollIntervalMs;
  }

  async start(): Promise<void> {
    // Fetch decimals once
    try {
      this.oracleDecimals = Number(await this.contract.decimals());
      logger.info('Chainlink oracle decimals', { decimals: this.oracleDecimals });
    } catch (error: any) {
      logger.warn('Failed to fetch Chainlink decimals, using default 8', { error: error.message });
    }

    // Initial fetch
    await this.poll();

    // Start polling
    this.pollTimer = setInterval(() => {
      this.poll().catch(err => {
        logger.error('Chainlink poll error', { error: err.message });
      });
    }, this.pollIntervalMs);

    logger.info('Chainlink oracle started', {
      pollIntervalMs: this.pollIntervalMs,
      currentPrice: this.currentPrice?.price.toFixed(2) || 'unknown',
    });
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    logger.info('Chainlink oracle stopped');
  }

  /**
   * Get the latest known Chainlink price.
   */
  getPrice(): ChainlinkPrice | null {
    return this.currentPrice;
  }

  /**
   * Record and return the Chainlink price at window open (the "Price to Beat").
   * If already recorded for this window, returns the cached value.
   */
  recordWindowPrice(windowTimestamp: number): Decimal | null {
    const cached = this.windowPrices.get(windowTimestamp);
    if (cached) return cached;

    if (!this.currentPrice) return null;

    this.windowPrices.set(windowTimestamp, this.currentPrice.price);

    // Prune old entries
    if (this.windowPrices.size > MAX_CACHED_WINDOWS) {
      const oldest = Math.min(...this.windowPrices.keys());
      this.windowPrices.delete(oldest);
    }

    logger.info('Recorded Chainlink window price (Price to Beat)', {
      windowTimestamp,
      price: this.currentPrice.price.toFixed(2),
      roundId: this.currentPrice.roundId,
    });

    return this.currentPrice.price;
  }

  /**
   * Get the cached Price to Beat for a window.
   */
  getWindowPrice(windowTimestamp: number): Decimal | null {
    return this.windowPrices.get(windowTimestamp) || null;
  }

  private async poll(): Promise<void> {
    try {
      const [roundId, answer, , updatedAt] = await this.contract.latestRoundData();

      const divisor = new Decimal(10).pow(this.oracleDecimals);
      const price = new Decimal(answer.toString()).div(divisor);

      this.currentPrice = {
        price,
        roundId: roundId.toString(),
        updatedAt: Number(updatedAt),
        fetchedAt: Date.now(),
      };
    } catch (error: any) {
      logger.error('Failed to fetch Chainlink price', { error: error.message });
    }
  }
}
