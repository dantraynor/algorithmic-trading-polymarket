/**
 * Trade Executor - Places dual-sided orders on Polymarket CLOB for BTC 5-min box spread arbitrage.
 * Signs EIP-712 typed data orders and submits both UP + DOWN sides.
 */

import axios, { AxiosInstance } from 'axios';
import { ethers, TypedDataDomain, TypedDataField } from 'ethers';
import Decimal from 'decimal.js';
import Redis from 'ioredis';
import crypto from 'crypto';
import {
  Config,
  MarketInfo,
  DualTradeDecision,
  DualTradeResult,
  TradeResult,
  OrderEIP712,
  SignedOrder,
  OrderResponse,
} from './types';
import { logger } from './logger';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

// EIP-712 type definitions (same as execution service)
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

  constructor(config: Config, redis: Redis) {
    this.config = config;
    this.redis = redis;
    this.wallet = new ethers.Wallet(config.privateKey || ethers.hexlify(ethers.randomBytes(32)));

    // BTC 5-min markets are negRisk — use NegRisk CTF Exchange for EIP-712 signing
    this.domain = {
      name: 'Polymarket CTF Exchange',
      version: '1',
      chainId: config.chainId,
      verifyingContract: config.negRiskCtfExchangeAddress || '0xC5d563A36AE78145C45a50134d48A1215220f80a',
    };

    this.secretKey = Buffer.from(config.clobApiSecret, 'base64');

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

    logger.info('Trade executor initialized', {
      dryRun: config.dryRun,
      signer: this.wallet.address,
    });
  }

  /**
   * Execute a dual-sided trade (buy both UP and DOWN tokens).
   */
  async executeDual(decision: DualTradeDecision, market: MarketInfo): Promise<DualTradeResult> {
    const startTime = performance.now();

    logger.info('Executing dual trade', {
      upPrice: decision.upPrice.toFixed(4),
      downPrice: decision.downPrice.toFixed(4),
      shares: decision.shares.toFixed(0),
      combinedCost: decision.combinedCost.toFixed(4),
      guaranteedProfit: decision.guaranteedProfit.toFixed(4),
    });

    if (this.config.dryRun) {
      return this.simulateDualTrade(decision, market, startTime);
    }

    // Execute both sides in parallel for speed
    const [upResult, downResult] = await Promise.all([
      this.executeOneSide(
        decision.upTokenId,
        decision.upPrice,
        decision.shares,
        'UP',
        market.windowTimestamp
      ),
      this.executeOneSide(
        decision.downTokenId,
        decision.downPrice,
        decision.shares,
        'DOWN',
        market.windowTimestamp
      ),
    ]);

    const totalLatencyMs = performance.now() - startTime;
    const bothSucceeded = upResult.success && downResult.success;
    const partialFill = upResult.success !== downResult.success;

    if (partialFill) {
      logger.warn('PARTIAL FILL - only one side executed', {
        upSuccess: upResult.success,
        downSuccess: downResult.success,
        upError: upResult.error,
        downError: downResult.error,
      });
    }

    return {
      success: bothSucceeded,
      upResult,
      downResult,
      combinedCost: decision.combinedCost,
      guaranteedProfit: bothSucceeded ? decision.guaranteedProfit : new Decimal(0),
      shares: decision.shares,
      totalLatencyMs,
      partialFill,
    };
  }

  /**
   * Execute a single side (UP or DOWN) of the arbitrage.
   * Splits into chunks of maxOrderShares if the position is large.
   */
  private async executeOneSide(
    tokenId: string,
    price: Decimal,
    shares: Decimal,
    side: 'UP' | 'DOWN',
    windowTimestamp: number
  ): Promise<TradeResult> {
    const startTime = performance.now();
    const maxChunk = new Decimal(this.config.maxOrderShares);

    if (shares.lte(maxChunk)) {
      // Single order path (existing behavior)
      try {
        const order = await this.signAndSubmitOrder(tokenId, price, shares, 'FOK');
        const elapsed = performance.now() - startTime;

        return {
          success: order.success,
          orderId: order.orderID,
          tokenId,
          side,
          price,
          size: shares,
          error: order.errorMsg,
          latencyMs: elapsed,
          windowTimestamp,
        };
      } catch (error: any) {
        const elapsed = performance.now() - startTime;
        logger.error(`${side} order failed:`, { error: error.message });
        return {
          success: false,
          tokenId,
          side,
          price,
          size: shares,
          error: error.message,
          latencyMs: elapsed,
          windowTimestamp,
        };
      }
    }

    // Split into chunks for large positions, ensuring no chunk is below MIN_SHARES
    const MIN_CHUNK = new Decimal(5); // Polymarket minimum order size
    const chunks: Decimal[] = [];
    let remaining = shares;
    while (remaining.gt(0)) {
      const chunk = Decimal.min(remaining, maxChunk);
      // If this would leave a trailing chunk below minimum, merge it into this one
      const afterThis = remaining.minus(chunk);
      if (afterThis.gt(0) && afterThis.lt(MIN_CHUNK)) {
        chunks.push(remaining); // take everything remaining
        remaining = new Decimal(0);
      } else {
        chunks.push(chunk);
        remaining = afterThis;
      }
    }

    logger.info(`${side} order split into ${chunks.length} chunks`, {
      totalShares: shares.toFixed(0),
      chunkSize: maxChunk.toFixed(0),
    });

    // Submit chunks sequentially to avoid racing for the same liquidity.
    // If a chunk fails, stop early — remaining liquidity is likely gone.
    const results: OrderResponse[] = [];
    let filledShares = new Decimal(0);
    try {
      for (const chunk of chunks) {
        const result = await this.signAndSubmitOrder(tokenId, price, chunk, 'FOK');
        results.push(result);
        if (result.success) {
          filledShares = filledShares.plus(chunk);
        } else {
          // Stop submitting: if this chunk failed, deeper chunks will too
          logger.warn(`${side} chunk failed, aborting remaining ${chunks.length - results.length} chunks`, {
            filled: filledShares.toFixed(0),
            error: result.errorMsg,
          });
          break;
        }
      }

      const elapsed = performance.now() - startTime;
      const allSucceeded = results.length === chunks.length && results.every((r) => r.success);
      const anySucceeded = results.some((r) => r.success);
      const errors = results.filter((r) => !r.success).map((r) => r.errorMsg).join('; ');

      if (!allSucceeded && anySucceeded) {
        logger.warn(`${side} partial chunk fill: ${filledShares.toFixed(0)}/${shares.toFixed(0)} shares filled`);
      }

      return {
        success: allSucceeded,
        orderId: results.find((r) => r.orderID)?.orderID,
        tokenId,
        side,
        price,
        size: filledShares,
        error: errors || undefined,
        latencyMs: elapsed,
        windowTimestamp,
      };
    } catch (error: any) {
      const elapsed = performance.now() - startTime;
      logger.error(`${side} chunked order failed:`, { error: error.message });
      return {
        success: filledShares.gt(0),
        tokenId,
        side,
        price,
        size: filledShares,
        error: error.message,
        latencyMs: elapsed,
        windowTimestamp,
      };
    }
  }

  /**
   * Simulate a dual trade in dry run mode.
   */
  private simulateDualTrade(
    decision: DualTradeDecision,
    market: MarketInfo,
    startTime: number
  ): DualTradeResult {
    const elapsed = performance.now() - startTime;

    const upResult: TradeResult = {
      success: true,
      tokenId: decision.upTokenId,
      side: 'UP',
      price: decision.upPrice,
      size: decision.shares,
      latencyMs: elapsed / 2,
      windowTimestamp: market.windowTimestamp,
    };

    const downResult: TradeResult = {
      success: true,
      tokenId: decision.downTokenId,
      side: 'DOWN',
      price: decision.downPrice,
      size: decision.shares,
      latencyMs: elapsed / 2,
      windowTimestamp: market.windowTimestamp,
    };

    logger.info('[DRY RUN] Simulated dual trade', {
      upPrice: decision.upPrice.toFixed(4),
      downPrice: decision.downPrice.toFixed(4),
      shares: decision.shares.toFixed(0),
      combinedCost: decision.combinedCost.toFixed(4),
      guaranteedProfit: decision.guaranteedProfit.toFixed(4),
    });

    return {
      success: true,
      upResult,
      downResult,
      combinedCost: decision.combinedCost,
      guaranteedProfit: decision.guaranteedProfit,
      shares: decision.shares,
      totalLatencyMs: elapsed,
      partialFill: false,
    };
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
    // FOK orders must have expiration = "0" (only GTD orders use a future timestamp)
    const expiration = '0';
    const nonce = '0'; // Nonce is for on-chain cancellations, not replay protection (salt provides uniqueness)
    // Generate salt as decimal string within JS safe integer range
    const saltBytes = ethers.randomBytes(6); // 48 bits, fits in Number.MAX_SAFE_INTEGER
    const salt = BigInt('0x' + Buffer.from(saltBytes).toString('hex')).toString(10);

    // Price * size in USDC terms (6 decimals)
    // API requires max 2 decimal precision for maker (USDC) → divisible by 10^4
    // API requires max 5 decimal precision for taker (shares) → divisible by 10^1
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

    const signedOrder: SignedOrder = {
      tokenID: tokenId,
      price: price.toFixed(4),
      size: size.toFixed(2),
      side: 'BUY',
      feeRateBps: '0',
      nonce,
      expiration,
      signatureType: this.config.signatureType,
      signature: signature,
    };

    // Rate limit
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
        signature: signature,
      },
      deferExec: false,
      orderType,
      owner: this.config.clobApiKey,
    });

    return response.data;
  }

  /**
   * Get next nonce from Redis.
   */
  private async getNextNonce(): Promise<string> {
    const key = `btc5m:nonce:${this.wallet.address}`;
    const nonce = await this.redis.incr(key);
    return nonce.toString();
  }

  /**
   * HMAC-SHA256 API request signing.
   */
  private signRequest(method: string, path: string, timestamp: string, body: string): string {
    const message = timestamp + method + path + body;
    const hmac = crypto.createHmac('sha256', this.secretKey);
    hmac.update(message);
    return hmac.digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
  }

  /**
   * Sliding window rate limiter (10 req/s).
   */
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
