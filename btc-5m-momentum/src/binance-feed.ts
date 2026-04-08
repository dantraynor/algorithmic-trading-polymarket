import WebSocket from 'ws';
import Decimal from 'decimal.js';
import { DirectionResult, Direction } from './types';
import { logger } from './logger';

const MAX_CACHED_WINDOWS = 5;
const HEALTH_TIMEOUT_MS = 5000;
const HEARTBEAT_TIMEOUT_MS = 30000;
const MAX_RECONNECT_DELAY_MS = 30000;

export class BinanceFeed {
  private url: string;
  private minDirectionBps: number;
  private ws: WebSocket | null = null;
  private currentPrice: Decimal | null = null;
  private windowOpenPrices: Map<number, Decimal> = new Map();
  private lastUpdateMs = 0;
  private isConnected = false;
  private reconnectAttempts = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnect = true;

  constructor(url: string, minDirectionBps: number) {
    this.url = url;
    this.minDirectionBps = minDirectionBps;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Binance WebSocket connection timeout (10s)'));
      }, 10000);

      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.resetHeartbeat();
        logger.info('Binance WebSocket connected', { url: this.url });
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.c) {
            this.currentPrice = new Decimal(msg.c);
            this.lastUpdateMs = Date.now();

            // Resolve on first price
            if (timeout) {
              clearTimeout(timeout);
              resolve();
            }
          }
        } catch (err) {
          logger.warn('Failed to parse Binance message', { error: (err as Error).message });
        }
        this.resetHeartbeat();
      });

      this.ws.on('close', (code, reason) => {
        this.isConnected = false;
        this.clearHeartbeat();
        logger.warn('Binance WebSocket closed', { code, reason: reason.toString() });
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (err) => {
        logger.error('Binance WebSocket error', { error: err.message });
        // 'close' event will follow, triggering reconnect
      });
    });
  }

  recordWindowOpen(windowTimestamp: number): void {
    if (!this.currentPrice) {
      logger.warn('Cannot record window open: no current price');
      return;
    }

    this.windowOpenPrices.set(windowTimestamp, this.currentPrice);
    logger.info('Recorded window open price', {
      windowTimestamp,
      btcPrice: this.currentPrice.toFixed(2),
    });

    // Prune old entries
    if (this.windowOpenPrices.size > MAX_CACHED_WINDOWS) {
      const timestamps = Array.from(this.windowOpenPrices.keys()).sort((a, b) => a - b);
      while (this.windowOpenPrices.size > MAX_CACHED_WINDOWS) {
        this.windowOpenPrices.delete(timestamps.shift()!);
      }
    }
  }

  getDirection(windowTimestamp: number): DirectionResult | null {
    const openPrice = this.windowOpenPrices.get(windowTimestamp);
    if (!openPrice || !this.currentPrice) {
      return null;
    }

    const delta = this.currentPrice.minus(openPrice);
    const deltaBps = delta.div(openPrice).mul(10000).toNumber();
    const absDeltaBps = Math.abs(deltaBps);

    let direction: Direction;
    if (absDeltaBps < this.minDirectionBps) {
      direction = 'FLAT';
    } else if (deltaBps > 0) {
      direction = 'UP';
    } else {
      direction = 'DOWN';
    }

    return {
      direction,
      deltaBps,
      currentPrice: this.currentPrice,
      openPrice,
    };
  }

  getCurrentPrice(): Decimal | null {
    return this.currentPrice;
  }

  isHealthy(): boolean {
    return this.isConnected && (Date.now() - this.lastUpdateMs) < HEALTH_TIMEOUT_MS;
  }

  disconnect(): void {
    this.shouldReconnect = false;
    this.clearHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    logger.info('Binance WebSocket disconnected');
  }

  private resetHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
      logger.warn('Binance heartbeat timeout, forcing reconnect');
      if (this.ws) {
        this.ws.terminate();
      }
    }, HEARTBEAT_TIMEOUT_MS);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      100 * Math.pow(2, this.reconnectAttempts),
      MAX_RECONNECT_DELAY_MS
    );
    this.reconnectAttempts++;

    logger.info('Scheduling Binance reconnect', {
      attempt: this.reconnectAttempts,
      delayMs: delay,
    });

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (err) {
        logger.error('Binance reconnect failed', { error: (err as Error).message });
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      }
    }, delay);
  }
}
