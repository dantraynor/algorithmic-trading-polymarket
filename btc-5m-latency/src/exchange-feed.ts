/**
 * Exchange Feed - Dual WebSocket manager for Binance and Coinbase.
 * Produces a median BTC price from both feeds and maintains a rolling returns
 * buffer for volatility calculation.
 */

import WebSocket from 'ws';
import Decimal from 'decimal.js';
import { AggregatedPrice } from './types';
import { logger } from './logger';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

const MAX_CACHED_WINDOWS = 5;
const HEALTH_TIMEOUT_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 30000;
const MAX_RECONNECT_DELAY_MS = 30000;
const STALE_THRESHOLD_MS = 2000;

interface PriceEntry {
  price: Decimal;
  timestamp: number; // Unix ms
}

export class ExchangeFeed {
  private binanceUrl: string;
  private coinbaseUrl: string;
  private volLookbackSec: number;

  // Binance state
  private binanceWs: WebSocket | null = null;
  private binancePrice: Decimal | null = null;
  private binanceLastMs = 0;
  private binanceConnected = false;
  private binanceReconnectAttempts = 0;
  private binanceHeartbeatTimer: NodeJS.Timeout | null = null;
  private binanceReconnectTimer: NodeJS.Timeout | null = null;

  // Coinbase state
  private coinbaseWs: WebSocket | null = null;
  private coinbasePrice: Decimal | null = null;
  private coinbaseLastMs = 0;
  private coinbaseConnected = false;
  private coinbaseReconnectAttempts = 0;
  private coinbaseHeartbeatTimer: NodeJS.Timeout | null = null;
  private coinbaseReconnectTimer: NodeJS.Timeout | null = null;

  // Shared state
  private shouldReconnect = true;
  private priceHistory: PriceEntry[] = [];
  private windowOpenPrices: Map<number, Decimal> = new Map();

  constructor(binanceUrl: string, coinbaseUrl: string, volLookbackSec: number) {
    this.binanceUrl = binanceUrl;
    this.coinbaseUrl = coinbaseUrl;
    this.volLookbackSec = volLookbackSec;
  }

  /**
   * Connect both WebSocket feeds. Resolves when at least one has a price.
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Exchange feed connection timeout (15s)'));
      }, 15000);

      let resolved = false;
      const tryResolve = () => {
        if (!resolved && (this.binancePrice || this.coinbasePrice)) {
          resolved = true;
          clearTimeout(timeout);
          resolve();
        }
      };

      this.connectBinance(tryResolve);
      this.connectCoinbase(tryResolve);
    });
  }

  private connectBinance(onFirstPrice?: () => void): void {
    this.binanceWs = new WebSocket(this.binanceUrl);

    this.binanceWs.on('open', () => {
      this.binanceConnected = true;
      this.binanceReconnectAttempts = 0;
      this.resetHeartbeat('binance');
      logger.info('Binance WebSocket connected', { url: this.binanceUrl });
    });

    this.binanceWs.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        // btcusdt@trade format: { "e": "trade", "p": "price", "q": "quantity", "T": tradeTimeMs }
        if (msg.p) {
          const price = new Decimal(msg.p);
          this.binancePrice = price;
          this.binanceLastMs = Date.now();
          this.recordPrice(price);
          onFirstPrice?.();
        }
      } catch (err) {
        logger.warn('Failed to parse Binance message', { error: (err as Error).message });
      }
      this.resetHeartbeat('binance');
    });

    this.binanceWs.on('close', (code, reason) => {
      this.binanceConnected = false;
      this.clearHeartbeat('binance');
      logger.warn('Binance WebSocket closed', { code, reason: reason.toString() });
      if (this.shouldReconnect) {
        this.scheduleReconnect('binance');
      }
    });

    this.binanceWs.on('error', (err) => {
      logger.error('Binance WebSocket error', { error: err.message });
    });
  }

  private connectCoinbase(onFirstPrice?: () => void): void {
    this.coinbaseWs = new WebSocket(this.coinbaseUrl);

    this.coinbaseWs.on('open', () => {
      this.coinbaseConnected = true;
      this.coinbaseReconnectAttempts = 0;
      this.resetHeartbeat('coinbase');
      logger.info('Coinbase WebSocket connected', { url: this.coinbaseUrl });

      // Subscribe to BTC-USD matches
      this.coinbaseWs!.send(JSON.stringify({
        type: 'subscribe',
        channels: ['matches'],
        product_ids: ['BTC-USD'],
      }));
    });

    this.coinbaseWs.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        // Match messages have type "match" or "last_match"
        if ((msg.type === 'match' || msg.type === 'last_match') && msg.price) {
          const price = new Decimal(msg.price);
          this.coinbasePrice = price;
          this.coinbaseLastMs = Date.now();
          this.recordPrice(price);
          onFirstPrice?.();
        }
      } catch (err) {
        logger.warn('Failed to parse Coinbase message', { error: (err as Error).message });
      }
      this.resetHeartbeat('coinbase');
    });

    this.coinbaseWs.on('close', (code, reason) => {
      this.coinbaseConnected = false;
      this.clearHeartbeat('coinbase');
      logger.warn('Coinbase WebSocket closed', { code, reason: reason.toString() });
      if (this.shouldReconnect) {
        this.scheduleReconnect('coinbase');
      }
    });

    this.coinbaseWs.on('error', (err) => {
      logger.error('Coinbase WebSocket error', { error: err.message });
    });
  }

  /**
   * Get the current aggregated BTC price (median of both feeds).
   * Falls back to single feed if the other is stale.
   */
  getMedianPrice(): AggregatedPrice {
    const now = Date.now();
    const binanceFresh = this.binancePrice && (now - this.binanceLastMs) < STALE_THRESHOLD_MS;
    const coinbaseFresh = this.coinbasePrice && (now - this.coinbaseLastMs) < STALE_THRESHOLD_MS;

    let median: Decimal;
    let stale = false;

    if (binanceFresh && coinbaseFresh) {
      // Average of two = median of two
      median = this.binancePrice!.plus(this.coinbasePrice!).div(2);
    } else if (binanceFresh) {
      median = this.binancePrice!;
    } else if (coinbaseFresh) {
      median = this.coinbasePrice!;
    } else {
      // Both stale — use most recent
      stale = true;
      if (this.binanceLastMs >= this.coinbaseLastMs && this.binancePrice) {
        median = this.binancePrice;
      } else if (this.coinbasePrice) {
        median = this.coinbasePrice;
      } else {
        median = new Decimal(0);
      }
    }

    return {
      median,
      binancePrice: this.binancePrice,
      coinbasePrice: this.coinbasePrice,
      timestamp: now,
      stale,
    };
  }

  /**
   * Compute rolling standard deviation of BTC price over the lookback period.
   * Used as sigma for the probability model.
   */
  getRollingStddev(): Decimal {
    const now = Date.now();
    const cutoff = now - (this.volLookbackSec * 1000);

    // Filter to entries within lookback window
    const recent = this.priceHistory.filter(e => e.timestamp >= cutoff);

    // Require at least 30s of data (not just 2 ticks) to avoid near-zero vol after restart
    const MIN_VOL_SAMPLES = 50;
    const MIN_VOL_DURATION_MS = 30000;
    if (recent.length < MIN_VOL_SAMPLES) {
      return new Decimal(0);
    }
    const dataSpanMs = recent[recent.length - 1].timestamp - recent[0].timestamp;
    if (dataSpanMs < MIN_VOL_DURATION_MS) {
      return new Decimal(0);
    }

    // Compute log-returns
    const returns: number[] = [];
    for (let i = 1; i < recent.length; i++) {
      const logReturn = Math.log(recent[i].price.div(recent[i - 1].price).toNumber());
      returns.push(logReturn);
    }

    if (returns.length < 2) {
      return new Decimal(0);
    }

    // Standard deviation of log-returns
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
    const stddev = Math.sqrt(variance);

    // Scale: this is per-tick stddev. Convert to price-level vol for the full window.
    // Multiply by sqrt(N) where N = number of ticks in the lookback period to get total vol,
    // then multiply by current price to get dollar vol.
    // Actually, for our model we need the standard deviation of BTC *price* over the window,
    // not log-return stddev. Approximate: price_vol = stddev_returns * current_price * sqrt(N_per_window)
    // But simpler: use the stddev of price levels directly from the lookback period.
    const prices = recent.map(e => e.price.toNumber());
    const priceMean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const priceVariance = prices.reduce((sum, p) => sum + (p - priceMean) ** 2, 0) / (prices.length - 1);
    const priceStddev = Math.sqrt(priceVariance);

    return new Decimal(priceStddev);
  }

  /**
   * Record the BTC price at the start of a 5-min window.
   */
  recordWindowOpen(windowTimestamp: number): void {
    const price = this.getMedianPrice();
    if (price.median.isZero()) {
      logger.warn('Cannot record window open: no current price');
      return;
    }

    this.windowOpenPrices.set(windowTimestamp, price.median);
    logger.info('Recorded window open price', {
      windowTimestamp,
      btcPrice: price.median.toFixed(2),
    });

    // Prune old entries
    if (this.windowOpenPrices.size > MAX_CACHED_WINDOWS) {
      const timestamps = Array.from(this.windowOpenPrices.keys()).sort((a, b) => a - b);
      while (this.windowOpenPrices.size > MAX_CACHED_WINDOWS) {
        this.windowOpenPrices.delete(timestamps.shift()!);
      }
    }
  }

  getWindowOpenPrice(windowTimestamp: number): Decimal | null {
    return this.windowOpenPrices.get(windowTimestamp) || null;
  }

  isHealthy(): boolean {
    const now = Date.now();
    const binanceOk = this.binanceConnected && (now - this.binanceLastMs) < HEALTH_TIMEOUT_MS;
    const coinbaseOk = this.coinbaseConnected && (now - this.coinbaseLastMs) < HEALTH_TIMEOUT_MS;
    return binanceOk || coinbaseOk;
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearHeartbeat('binance');
    this.clearHeartbeat('coinbase');

    if (this.binanceReconnectTimer) {
      clearTimeout(this.binanceReconnectTimer);
      this.binanceReconnectTimer = null;
    }
    if (this.coinbaseReconnectTimer) {
      clearTimeout(this.coinbaseReconnectTimer);
      this.coinbaseReconnectTimer = null;
    }

    if (this.binanceWs) {
      this.binanceWs.close();
      this.binanceWs = null;
    }
    if (this.coinbaseWs) {
      this.coinbaseWs.close();
      this.coinbaseWs = null;
    }

    this.binanceConnected = false;
    this.coinbaseConnected = false;
    logger.info('Exchange feeds disconnected');
  }

  private recordPrice(price: Decimal): void {
    const now = Date.now();
    this.priceHistory.push({ price, timestamp: now });

    // Prune entries older than lookback window (with 2x buffer)
    const cutoff = now - (this.volLookbackSec * 2000);
    while (this.priceHistory.length > 0 && this.priceHistory[0].timestamp < cutoff) {
      this.priceHistory.shift();
    }
  }

  private resetHeartbeat(exchange: 'binance' | 'coinbase'): void {
    this.clearHeartbeat(exchange);
    const timer = setTimeout(() => {
      logger.warn(`${exchange} heartbeat timeout, forcing reconnect`);
      const ws = exchange === 'binance' ? this.binanceWs : this.coinbaseWs;
      if (ws) ws.terminate();
    }, HEARTBEAT_TIMEOUT_MS);

    if (exchange === 'binance') {
      this.binanceHeartbeatTimer = timer;
    } else {
      this.coinbaseHeartbeatTimer = timer;
    }
  }

  private clearHeartbeat(exchange: 'binance' | 'coinbase'): void {
    const timer = exchange === 'binance' ? this.binanceHeartbeatTimer : this.coinbaseHeartbeatTimer;
    if (timer) {
      clearTimeout(timer);
      if (exchange === 'binance') {
        this.binanceHeartbeatTimer = null;
      } else {
        this.coinbaseHeartbeatTimer = null;
      }
    }
  }

  private scheduleReconnect(exchange: 'binance' | 'coinbase'): void {
    const attempts = exchange === 'binance' ? this.binanceReconnectAttempts : this.coinbaseReconnectAttempts;
    const delay = Math.min(100 * Math.pow(2, attempts), MAX_RECONNECT_DELAY_MS);

    if (exchange === 'binance') {
      this.binanceReconnectAttempts++;
    } else {
      this.coinbaseReconnectAttempts++;
    }

    logger.info(`Scheduling ${exchange} reconnect`, { attempt: attempts + 1, delayMs: delay });

    const timer = setTimeout(async () => {
      try {
        if (exchange === 'binance') {
          this.connectBinance();
        } else {
          this.connectCoinbase();
        }
      } catch (err) {
        logger.error(`${exchange} reconnect failed`, { error: (err as Error).message });
        if (this.shouldReconnect) {
          this.scheduleReconnect(exchange);
        }
      }
    }, delay);

    if (exchange === 'binance') {
      this.binanceReconnectTimer = timer;
    } else {
      this.coinbaseReconnectTimer = timer;
    }
  }
}
