import WebSocket from 'ws';
import Decimal from 'decimal.js';

const MAX_CACHED_WINDOWS = 5;
const HEARTBEAT_TIMEOUT_MS = 30000;
const MAX_RECONNECT_DELAY_MS = 30000;
const BINANCE_COMBINED_STREAM_BASE = 'wss://stream.binance.com/stream?streams=';

export type Direction = 'UP' | 'DOWN' | 'FLAT';

export interface DirectionResult {
  direction: Direction;
  deltaBps: number; // Absolute value in basis points (always positive)
  currentPrice: Decimal;
  openPrice: Decimal;
}

// Per-symbol state
interface SymbolState {
  currentPrice: Decimal | null;
  windowOpenPrices: Map<number, Decimal>;
  lastUpdateMs: number;
}

export class MultiBinanceFeed {
  private symbols: string[];
  private minDirectionBps: number;
  private streamUrl: string;
  private ws: WebSocket | null = null;
  private symbolState: Map<string, SymbolState> = new Map();
  private isConnected = false;
  private reconnectAttempts = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shouldReconnect = true;

  constructor(symbols: string[], minDirectionBps: number) {
    this.symbols = symbols.map((s) => s.toLowerCase());
    this.minDirectionBps = minDirectionBps;

    // Initialise per-symbol state
    for (const sym of this.symbols) {
      this.symbolState.set(sym, {
        currentPrice: null,
        windowOpenPrices: new Map(),
        lastUpdateMs: 0,
      });
    }

    // Build combined stream URL: btcusdt@ticker/ethusdt@ticker/...
    const streams = this.symbols.map((s) => `${s}@ticker`).join('/');
    this.streamUrl = `${BINANCE_COMBINED_STREAM_BASE}${streams}`;
  }

  /** Returns the combined stream WebSocket URL */
  getStreamUrl(): string {
    return this.streamUrl;
  }

  /**
   * Public method for updating price without a live WebSocket connection.
   * Used in tests and for injecting prices from external sources.
   */
  updatePrice(symbol: string, price: number): void {
    const sym = symbol.toLowerCase();
    const state = this.symbolState.get(sym);
    if (!state) {
      return;
    }
    state.currentPrice = new Decimal(price);
    state.lastUpdateMs = Date.now();
  }

  /** Record the current price as the window-open price for `windowTimestamp`. */
  recordWindowOpen(symbol: string, windowTimestamp: number): void {
    const sym = symbol.toLowerCase();
    const state = this.symbolState.get(sym);
    if (!state || !state.currentPrice) {
      return;
    }

    state.windowOpenPrices.set(windowTimestamp, state.currentPrice);

    // Prune oldest entries beyond MAX_CACHED_WINDOWS
    if (state.windowOpenPrices.size > MAX_CACHED_WINDOWS) {
      const timestamps = Array.from(state.windowOpenPrices.keys()).sort((a, b) => a - b);
      while (state.windowOpenPrices.size > MAX_CACHED_WINDOWS) {
        state.windowOpenPrices.delete(timestamps.shift()!);
      }
    }
  }

  /**
   * Compute direction for `symbol` relative to the window opened at `windowTimestamp`.
   * Returns null if the symbol is unknown or no price data is available.
   * `deltaBps` is always the absolute value of the move.
   */
  getDirection(symbol: string, windowTimestamp: number): DirectionResult | null {
    const sym = symbol.toLowerCase();
    const state = this.symbolState.get(sym);
    if (!state || !state.currentPrice) {
      return null;
    }

    const openPrice = state.windowOpenPrices.get(windowTimestamp);
    if (!openPrice) {
      return null;
    }

    const delta = state.currentPrice.minus(openPrice);
    const rawDeltaBps = delta.div(openPrice).mul(10000).toNumber();
    const absDeltaBps = Math.abs(rawDeltaBps);

    let direction: Direction;
    if (absDeltaBps < this.minDirectionBps) {
      direction = 'FLAT';
    } else if (rawDeltaBps > 0) {
      direction = 'UP';
    } else {
      direction = 'DOWN';
    }

    return {
      direction,
      deltaBps: absDeltaBps,
      currentPrice: state.currentPrice,
      openPrice,
    };
  }

  /** Get current price for a symbol, or null if unavailable. */
  getCurrentPrice(symbol: string): Decimal | null {
    const state = this.symbolState.get(symbol.toLowerCase());
    return state?.currentPrice ?? null;
  }

  /** Connect to the Binance combined stream WebSocket. */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Binance WebSocket connection timeout (10s)'));
      }, 10000);

      this.ws = new WebSocket(this.streamUrl);
      let resolved = false;

      this.ws.on('open', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.resetHeartbeat();
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          // Combined stream format: { stream: "btcusdt@ticker", data: { c: "65000.00", ... } }
          const msg = JSON.parse(data.toString()) as {
            stream?: string;
            data?: { c?: string };
          };

          if (msg.stream && msg.data?.c) {
            // Extract symbol from stream name e.g. "btcusdt@ticker" → "btcusdt"
            const sym = msg.stream.split('@')[0];
            const state = this.symbolState.get(sym);
            if (state) {
              state.currentPrice = new Decimal(msg.data.c);
              state.lastUpdateMs = Date.now();

              // Resolve on first valid price update
              if (!resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve();
              }
            }
          }
        } catch {
          // Swallow parse errors
        }
        this.resetHeartbeat();
      });

      this.ws.on('close', (code, reason) => {
        this.isConnected = false;
        this.clearHeartbeat();
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          reject(new Error(`Binance WebSocket closed before first price: ${code} ${reason}`));
        }
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      });

      this.ws.on('error', (_err) => {
        // 'close' event will follow, triggering reconnect or rejection
      });
    });
  }

  /** Gracefully close the WebSocket connection. */
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
  }

  private resetHeartbeat(): void {
    this.clearHeartbeat();
    this.heartbeatTimer = setTimeout(() => {
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
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      }
    }, delay);
  }
}
