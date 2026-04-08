/**
 * CLOB API Client for Polymarket
 * Handles order submission via HTTP/2
 */

import axios, { AxiosInstance } from 'axios';
import { Config } from './config';
import { SignedOrder, BatchOrderResponse, OrderResponse } from './types';
import { logger } from './logger';
import crypto from 'crypto';
import { ethers } from 'ethers';

// Rate limiting configuration
const RATE_LIMIT_REQUESTS_PER_SECOND = 10; // Conservative limit
const RATE_LIMIT_WINDOW_MS = 1000;

export class ClobClient {
  private client: AxiosInstance;
  private config: Config;
  private requestTimestamps: number[] = [];
  private rateLimitQueue: Array<() => void> = [];
  private signerAddress: string;
  private secretKey: Buffer;

  constructor(config: Config) {
    this.config = config;
    this.signerAddress = new ethers.Wallet(config.privateKey).address;
    this.secretKey = Buffer.from(config.clobApiSecret, 'base64');

    this.client = axios.create({
      baseURL: config.clobApiUrl,
      timeout: 10000, // 10 second timeout (increased for reliability)
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for authentication
    this.client.interceptors.request.use((request) => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signature = this.signRequest(
        request.method?.toUpperCase() || 'GET',
        request.url || '',
        timestamp,
        request.data ? JSON.stringify(request.data) : ''
      );

      request.headers['POLY_ADDRESS'] = this.signerAddress;
      request.headers['POLY_API_KEY'] = config.clobApiKey;
      request.headers['POLY_TIMESTAMP'] = timestamp;
      request.headers['POLY_SIGNATURE'] = signature;
      request.headers['POLY_PASSPHRASE'] = config.clobPassphrase;

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
      }
    );

    logger.info('CLOB Client initialized', { baseURL: config.clobApiUrl });
  }

  /**
   * Rate limiter - ensures we don't exceed API rate limits
   * Returns a promise that resolves when it's safe to make a request
   */
  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();

    // Clean old timestamps outside the window
    this.requestTimestamps = this.requestTimestamps.filter(
      (ts) => now - ts < RATE_LIMIT_WINDOW_MS
    );

    if (this.requestTimestamps.length >= RATE_LIMIT_REQUESTS_PER_SECOND) {
      // Calculate how long to wait
      const oldestTimestamp = this.requestTimestamps[0];
      const waitTime = RATE_LIMIT_WINDOW_MS - (now - oldestTimestamp);

      if (waitTime > 0) {
        logger.debug(`Rate limiting: waiting ${waitTime}ms`);
        await new Promise((resolve) => setTimeout(resolve, waitTime));
      }

      // Clean again after waiting
      this.requestTimestamps = this.requestTimestamps.filter(
        (ts) => Date.now() - ts < RATE_LIMIT_WINDOW_MS
      );
    }

    // Record this request
    this.requestTimestamps.push(Date.now());
  }

  /**
   * Sign API request using HMAC-SHA256
   */
  private signRequest(
    method: string,
    path: string,
    timestamp: string,
    body: string
  ): string {
    const message = timestamp + method + path + body;
    const hmac = crypto.createHmac('sha256', this.secretKey);
    hmac.update(message);
    return hmac.digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  /**
   * Submit a batch of orders atomically
   * Uses FOK (Fill or Kill) - if any order can't be filled, all are killed
   */
  async submitBatchOrders(orders: SignedOrder[]): Promise<BatchOrderResponse> {
    const startTime = performance.now();

    if (orders.length === 0) {
      return { success: false, orders: [] };
    }

    if (orders.length > this.config.maxBatchSize) {
      logger.error(`Batch size ${orders.length} exceeds maximum ${this.config.maxBatchSize}`);
      return {
        success: false,
        orders: [{ success: false, errorMsg: 'Batch size exceeded' }],
      };
    }

    try {
      // Apply rate limiting before making request
      await this.waitForRateLimit();

      logger.info(`Submitting batch of ${orders.length} FOK orders`);

      const response = await this.client.post<BatchOrderResponse>('/orders',
        orders.map((o) => ({
          order: {
            salt: parseInt(o.salt, 10),
            maker: o.maker,
            signer: o.signer,
            taker: o.taker,
            tokenId: o.tokenID,
            makerAmount: o.makerAmount,
            takerAmount: o.takerAmount,
            side: o.side,
            expiration: o.expiration,
            nonce: o.nonce,
            feeRateBps: o.feeRateBps,
            signatureType: o.signatureType,
            signature: o.signature,
          },
          deferExec: false,
          orderType: 'FOK',
          owner: this.config.clobApiKey,
        })),
      );

      const elapsed = performance.now() - startTime;

      // The API returns an array of order responses directly
      const orderResponses: OrderResponse[] = Array.isArray(response.data)
        ? response.data
        : response.data.orders || [];

      const allSuccess = orderResponses.every((o: any) => o.success && !o.errorMsg);

      logger.info(`Batch order response in ${elapsed.toFixed(2)}ms`, {
        success: allSuccess,
        orderCount: orderResponses.length,
      });

      return { success: allSuccess, orders: orderResponses };
    } catch (error: any) {
      const elapsed = performance.now() - startTime;
      logger.error(`Batch order failed in ${elapsed.toFixed(2)}ms`, {
        message: error.message,
        responseData: error.response?.data,
      });

      const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message;
      return {
        success: false,
        orders: [{ success: false, errorMsg }],
      };
    }
  }

  /**
   * Submit a single order
   */
  async submitOrder(order: SignedOrder): Promise<OrderResponse> {
    const startTime = performance.now();

    try {
      // Apply rate limiting before making request
      await this.waitForRateLimit();

      const response = await this.client.post<OrderResponse>('/order', {
        order: {
          salt: parseInt(order.salt, 16) || order.salt,
          maker: order.maker,
          signer: order.signer,
          taker: order.taker,
          tokenId: order.tokenID,
          makerAmount: order.makerAmount,
          takerAmount: order.takerAmount,
          side: order.side,
          expiration: order.expiration,
          nonce: order.nonce,
          feeRateBps: order.feeRateBps,
          signatureType: order.signatureType,
          signature: order.signature,
        },
        deferExec: false,
        orderType: 'FOK',
        owner: this.config.clobApiKey,
      });

      const elapsed = performance.now() - startTime;
      logger.info(`Order submitted in ${elapsed.toFixed(2)}ms`, {
        success: response.data.success,
        orderID: response.data.orderID,
      });

      return response.data;
    } catch (error: any) {
      logger.error('Order submission failed:', error.message);
      return { success: false, errorMsg: error.message };
    }
  }

  /**
   * Cancel an order by ID
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    try {
      await this.client.delete(`/order/${orderId}`);
      logger.info(`Order ${orderId} cancelled`);
      return true;
    } catch (error: any) {
      logger.error(`Failed to cancel order ${orderId}:`, error.message);
      return false;
    }
  }

  /**
   * Get current positions
   */
  async getPositions(): Promise<any[]> {
    try {
      const response = await this.client.get('/positions');
      return response.data;
    } catch (error: any) {
      logger.error('Failed to fetch positions:', error.message);
      return [];
    }
  }

  /**
   * Get market info by condition ID
   */
  async getMarket(conditionId: string): Promise<any> {
    try {
      const response = await this.client.get(`/markets/${conditionId}`);
      return response.data;
    } catch (error: any) {
      logger.error(`Failed to fetch market ${conditionId}:`, error.message);
      return null;
    }
  }

  /**
   * Health check for the API
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
