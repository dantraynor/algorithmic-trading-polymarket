/**
 * Trade Executor - Places single-side orders on Polymarket CLOB for momentum trades.
 * Adapted from btc-5m/trade-executor.ts: single-side only, same EIP-712 signing.
 */

import axios, { AxiosInstance } from 'axios';
import { ethers, TypedDataDomain, TypedDataField } from 'ethers';
import Decimal from 'decimal.js';
import Redis from 'ioredis';
import crypto from 'crypto';
import { Config, MomentumDecision, SingleTradeResult, OrderEIP712, OrderResponse } from './types';
import { PaperSimulator } from './paper-simulator';
import { OrderbookChecker } from './orderbook-checker';
import { logger } from './logger';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

const ORDER_TYPES: Record<string, TypedDataField[]> = {
  Order: [
    { name: 'salt', type: 'uint256' },
    { name: 'maker', type: 'address' },
    { name: 'signer', type: 'address' },
    { name: 'taker', type: 'address' },
    { name: 'tokenId', type: 'uint256' },
    { name: 'makerAmount', type: 'uint256' },
    { name: 'takerAmount', type: 'uint256' },
    { name: 'expiration', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'feeRateBps', type: 'uint256' },
    { name: 'side', type: 'uint8' },
    { name: 'signatureType', type: 'uint8' },
  ],
};

const USDC_DECIMALS = 6;
const SHARE_DECIMALS = 6;

export class TradeExecutor {
  private config: Config;
  private redis: Redis;
  private wallet: ethers.Wallet;
  private domain: TypedDataDomain;
  private client: AxiosInstance;
  private requestTimestamps: number[] = [];
  private secretKey: Buffer;
  private paperSimulator?: PaperSimulator;

  constructor(config: Config, redis: Redis, orderbookChecker?: OrderbookChecker) {
    this.config = config;
    this.redis = redis;
    this.wallet = new ethers.Wallet(config.privateKey || ethers.hexlify(ethers.randomBytes(32)));

    // BTC 5-min markets are negRisk
    this.domain = {
      name: 'Polymarket CTF Exchange',
      version: '1',
      chainId: config.chainId,
      verifyingContract: config.negRiskCtfExchangeAddress || '0xC5d563A36AE78145C45a50134d48A1215220f80a',
    };

    this.secretKey = Buffer.from(config.clobApiSecret || '', 'base64');

    this.client = axios.create({
      baseURL: config.clobApiUrl,
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
    });

    // Auth interceptor
    this.client.interceptors.request.use((request) => {
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const sig = this.signRequest(
        request.method?.toUpperCase() || 'GET',
        request.url || '',
        timestamp,
        request.data ? JSON.stringify(request.data) : ''
      );
      request.headers['POLY_ADDRESS'] = this.wallet.address;
      request.headers['POLY_API_KEY'] = config.clobApiKey;
      request.headers['POLY_TIMESTAMP'] = timestamp;
      request.headers['POLY_SIGNATURE'] = sig;
      request.headers['POLY_PASSPHRASE'] = config.clobPassphrase;
      return request;
    });

    if (config.dryRun && orderbookChecker) {
      this.paperSimulator = new PaperSimulator(orderbookChecker);
    }

    logger.info('Trade executor initialized', {
      dryRun: config.dryRun,
      signer: this.wallet.address,
    });
  }

  /**
   * Execute a single-side momentum trade.
   */
  async executeSingle(decision: MomentumDecision): Promise<SingleTradeResult> {
    const startTime = performance.now();

    logger.info('Executing momentum trade', {
      direction: decision.direction,
      entryPrice: decision.entryPrice.toFixed(4),
      shares: decision.shares.toFixed(2),
      totalCost: decision.totalCost.toFixed(2),
      expectedProfit: decision.expectedProfit.toFixed(2),
    });

    if (this.config.dryRun) {
      if (!this.paperSimulator) {
        logger.error('Dry-run mode but PaperSimulator not initialized — refusing to hit live API');
        return {
          success: false,
          tokenId: decision.tokenId,
          direction: decision.direction,
          price: decision.entryPrice,
          size: new Decimal(0),
          error: 'PaperSimulator not initialized',
          latencyMs: performance.now() - startTime,
        };
      }
      const simResult = await this.paperSimulator.simulateFill(decision);
      return {
        success: simResult.success,
        tokenId: decision.tokenId,
        direction: decision.direction,
        price: simResult.fillPrice,
        size: simResult.fillShares,
        latencyMs: simResult.latencyMs,
        simResult,
      };
    }

    const maxChunk = new Decimal(this.config.maxOrderShares);

    if (decision.shares.lte(maxChunk)) {
      // Single order
      try {
        const order = await this.signAndSubmitOrder(
          decision.tokenId,
          decision.entryPrice,
          decision.shares,
          'FOK'
        );
        const elapsed = performance.now() - startTime;

        return {
          success: order.success,
          orderId: order.orderID,
          tokenId: decision.tokenId,
          direction: decision.direction,
          price: decision.entryPrice,
          size: decision.shares,
          error: order.errorMsg,
          latencyMs: elapsed,
        };
      } catch (error: any) {
        const elapsed = performance.now() - startTime;
        logger.error(`${decision.direction} order failed:`, { error: error.message });
        return {
          success: false,
          tokenId: decision.tokenId,
          direction: decision.direction,
          price: decision.entryPrice,
          size: new Decimal(0),
          error: error.message,
          latencyMs: elapsed,
        };
      }
    }

    // Chunked execution for large positions
    return this.executeChunked(decision, maxChunk, startTime);
  }

  private async executeChunked(
    decision: MomentumDecision,
    maxChunk: Decimal,
    startTime: number,
  ): Promise<SingleTradeResult> {
    const MIN_CHUNK = new Decimal(5);
    const chunks: Decimal[] = [];
    let remaining = decision.shares;

    while (remaining.gt(0)) {
      const chunk = Decimal.min(remaining, maxChunk);
      const afterThis = remaining.minus(chunk);
      if (afterThis.gt(0) && afterThis.lt(MIN_CHUNK)) {
        chunks.push(remaining);
        remaining = new Decimal(0);
      } else {
        chunks.push(chunk);
        remaining = afterThis;
      }
    }

    logger.info(`Order split into ${chunks.length} chunks`, {
      totalShares: decision.shares.toFixed(2),
      chunkSize: maxChunk.toFixed(0),
    });

    let filledShares = new Decimal(0);
    let lastOrderId: string | undefined;

    try {
      for (const chunk of chunks) {
        const result = await this.signAndSubmitOrder(
          decision.tokenId,
          decision.entryPrice,
          chunk,
          'FOK'
        );
        if (result.success) {
          filledShares = filledShares.plus(chunk);
          lastOrderId = result.orderID || lastOrderId;
        } else {
          logger.warn(`Chunk failed, aborting remaining`, {
            filled: filledShares.toFixed(2),
            error: result.errorMsg,
          });
          break;
        }
      }

      const elapsed = performance.now() - startTime;
      return {
        success: filledShares.gt(0),
        orderId: lastOrderId,
        tokenId: decision.tokenId,
        direction: decision.direction,
        price: decision.entryPrice,
        size: filledShares,
        latencyMs: elapsed,
      };
    } catch (error: any) {
      const elapsed = performance.now() - startTime;
      return {
        success: filledShares.gt(0),
        tokenId: decision.tokenId,
        direction: decision.direction,
        price: decision.entryPrice,
        size: filledShares,
        error: error.message,
        latencyMs: elapsed,
      };
    }
  }

  /**
   * Sign and submit an order to the CLOB.
   */
  private async signAndSubmitOrder(
    tokenId: string,
    price: Decimal,
    size: Decimal,
    orderType: string
  ): Promise<OrderResponse> {
    const expiration = '0';
    const nonce = '0';
    const saltBytes = ethers.randomBytes(6);
    const salt = BigInt('0x' + Buffer.from(saltBytes).toString('hex')).toString(10);

    const multiplier = new Decimal(10).pow(USDC_DECIMALS);
    const makerRaw = price.mul(size).mul(multiplier).floor();
    const makerAmount = makerRaw.divToInt(10000).times(10000).toFixed(0);
    const takerRaw = size.mul(new Decimal(10).pow(SHARE_DECIMALS)).floor();
    const takerAmount = takerRaw.divToInt(10).times(10).toFixed(0);

    const orderData: OrderEIP712 = {
      salt,
      maker: this.config.signatureType === 2 ? (this.config.gnosisSafeAddress || this.wallet.address) : this.wallet.address,
      signer: this.wallet.address,
      taker: ethers.ZeroAddress,
      tokenId,
      makerAmount,
      takerAmount,
      expiration,
      nonce,
      feeRateBps: '0',
      side: 0, // BUY
      signatureType: this.config.signatureType,
    };

    const signature = await this.wallet.signTypedData(this.domain, ORDER_TYPES, orderData);

    await this.waitForRateLimit();

    const response = await this.client.post<OrderResponse>('/order', {
      order: {
        salt: parseInt(salt, 10),
        maker: orderData.maker,
        signer: orderData.signer,
        taker: orderData.taker,
        tokenId,
        makerAmount,
        takerAmount,
        side: 'BUY',
        expiration,
        nonce,
        feeRateBps: '0',
        signatureType: this.config.signatureType,
        signature,
      },
      deferExec: false,
      orderType,
      owner: this.config.clobApiKey,
    });

    return response.data;
  }

  private signRequest(method: string, path: string, timestamp: string, body: string): string {
    const message = timestamp + method + path + body;
    const hmac = crypto.createHmac('sha256', this.secretKey);
    hmac.update(message);
    return hmac.digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter((ts) => now - ts < 1000);

    if (this.requestTimestamps.length >= 10) {
      const wait = 1000 - (now - this.requestTimestamps[0]);
      if (wait > 0) {
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
      this.requestTimestamps = this.requestTimestamps.filter((ts) => Date.now() - ts < 1000);
    }

    this.requestTimestamps.push(Date.now());
  }
}
