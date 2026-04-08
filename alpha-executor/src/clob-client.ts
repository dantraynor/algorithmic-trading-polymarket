/**
 * CLOB API Client for Polymarket
 * Handles order submission and order book fetching.
 *
 * Matches HMAC signing pattern from execution/src/clob-client.ts.
 * Uses sliding-window rate limiter (10 req/s).
 */

import axios, { AxiosInstance } from 'axios';
import crypto from 'crypto';
import { createLogger, format, transports } from 'winston';
import { SignedOrder } from './signer';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

// Rate limiting configuration
const RATE_LIMIT_REQUESTS_PER_SECOND = 10;
const RATE_LIMIT_WINDOW_MS = 1000;

export interface OrderResponse {
  success: boolean;
  orderID?: string;
  errorMsg?: string;
  transactionHash?: string;
}

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface OrderBook {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
}

export interface ClobClientConfig {
  clobApiUrl: string;
  clobApiKey: string;
  clobApiSecret: string;
  clobPassphrase: string;
  signerAddress: string;
}

export class AlphaClobClient {
  private client: AxiosInstance;
  private secretKey: Buffer;
  private apiKey: string;
  private passphrase: string;
  private signerAddress: string;
  private requestTimestamps: number[] = [];

  constructor(config: ClobClientConfig) {
    this.apiKey = config.clobApiKey;
    this.passphrase = config.clobPassphrase;
    this.signerAddress = config.signerAddress;
    this.secretKey = Buffer.from(config.clobApiSecret, 'base64');

    this.client = axios.create({
      baseURL: config.clobApiUrl,
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for HMAC authentication
    this.client.interceptors.request.use((request) => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = this.signRequest(
        request.method?.toUpperCase() || 'GET',
        request.url || '',
        timestamp,
        request.data ? JSON.stringify(request.data) : '',
      );

      request.headers['POLY_ADDRESS'] = this.signerAddress;
      request.headers['POLY_API_KEY'] = this.apiKey;
      request.headers['POLY_TIMESTAMP'] = timestamp;
      request.headers['POLY_SIGNATURE'] = signature;
      request.headers['POLY_PASSPHRASE'] = this.passphrase;

      return request;
    });

    // Add response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        logger.debug('API Response', {
          status: response.status,
          url: response.config.url,
        });
        return response;
      },
      (error) => {
        logger.error('API Error', {
          status: error.response?.status,
          url: error.config?.url,
          data: error.response?.data,
          message: error.response?.data?.message || error.message,
        });
        throw error;
      },
    );

    logger.info('Alpha CLOB Client initialized', { baseURL: config.clobApiUrl });
  }

  /**
   * Sign API request using HMAC-SHA256 with URL-safe base64 encoding.
   * Message format: timestamp + method + path + body
   */
  private signRequest(
    method: string,
    path: string,
    timestamp: string,
    body: string,
  ): string {
    const message = timestamp + method + path + body;
    const hmac = crypto.createHmac('sha256', this.secretKey);
    hmac.update(message);
    return hmac.digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  /**
   * Sliding-window rate limiter: max 10 requests per second.
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();

    // Clean old timestamps outside the window
    this.requestTimestamps = this.requestTimestamps.filter(
      (ts) => now - ts < RATE_LIMIT_WINDOW_MS,
    );

    if (this.requestTimestamps.length >= RATE_LIMIT_REQUESTS_PER_SECOND) {
      const oldestTimestamp = this.requestTimestamps[0];
      const waitTime = RATE_LIMIT_WINDOW_MS - (now - oldestTimestamp);

      if (waitTime > 0) {
        logger.debug(`Rate limiting: waiting ${waitTime}ms`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      // Clean again after waiting
      this.requestTimestamps = this.requestTimestamps.filter(
        (ts) => Date.now() - ts < RATE_LIMIT_WINDOW_MS,
      );
    }

    this.requestTimestamps.push(Date.now());
  }

  /**
   * Submit a single order to the CLOB.
   * Body format matches execution/src/clob-client.ts: { order, owner, orderType }
   */
  async submitOrder(order: SignedOrder): Promise<OrderResponse> {
    const startTime = performance.now();

    try {
      await this.waitForRateLimit();

      const response = await this.client.post<OrderResponse>('/order', {
        order: {
          salt: parseInt(order.salt, 10),
          maker: order.maker,
          signer: order.signer,
          taker: order.taker,
          tokenId: order.tokenId,
          makerAmount: order.makerAmount,
          takerAmount: order.takerAmount,
          side: order.side,
          expiration: order.expiration,
          nonce: order.nonce,
          feeRateBps: order.feeRateBps,
          signatureType: parseInt(order.signatureType, 10),
          signature: order.signature,
        },
        owner: this.apiKey,
        orderType: 'FOK',
        deferExec: false,
      });

      const elapsed = performance.now() - startTime;
      logger.info(`Order submitted in ${elapsed.toFixed(2)}ms`, {
        success: response.data.success,
        orderID: response.data.orderID,
      });

      return response.data;
    } catch (error: any) {
      const elapsed = performance.now() - startTime;
      const errorMsg =
        error.response?.data?.error ||
        error.response?.data?.message ||
        error.message;
      logger.error(`Order submission failed in ${elapsed.toFixed(2)}ms`, {
        error: errorMsg,
      });
      return { success: false, errorMsg };
    }
  }

  /**
   * Fetch order book for a given token ID.
   * Returns asks and bids sorted by price.
   */
  async fetchOrderBook(tokenId: string): Promise<OrderBook> {
    try {
      await this.waitForRateLimit();

      const response = await this.client.get<OrderBook>('/book', {
        params: { token_id: tokenId },
      });

      return response.data;
    } catch (error: any) {
      logger.error(`Failed to fetch order book for ${tokenId}:`, {
        error: error.message,
      });
      return { asks: [], bids: [] };
    }
  }

  /**
   * Health check for the API.
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.client.get('/health');
      return response.status === 200;
    } catch {
      return false;
    }
  }
}
