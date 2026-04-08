/**
 * EIP-712 Signing for Polymarket Orders
 * Supports Gnosis Safe (Signature Type 2)
 */

import { ethers, TypedDataDomain, TypedDataField } from 'ethers';
import Decimal from 'decimal.js';
import { Config } from './config';
import { Order, SignedOrder, OrderEIP712 } from './types';
import { logger } from './logger';

// Configure Decimal.js for financial precision
Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

// EIP-712 type definitions for Polymarket orders
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

export class Signer {
  private wallet: ethers.Wallet;
  private config: Config;
  private ctfDomain: TypedDataDomain;
  private negRiskDomain: TypedDataDomain;
  private redis: import('ioredis').default | null = null;

  constructor(config: Config) {
    this.config = config;
    this.wallet = new ethers.Wallet(config.privateKey);

    this.ctfDomain = {
      name: 'Polymarket CTF Exchange',
      version: '1',
      chainId: config.chainId,
      verifyingContract: config.ctfExchangeAddress,
    };

    this.negRiskDomain = {
      name: 'Polymarket CTF Exchange',
      version: '1',
      chainId: config.chainId,
      verifyingContract: config.negRiskCtfExchangeAddress,
    };

    logger.info(`Signer initialized for address: ${this.wallet.address}`);
  }

  /**
   * Initialize Redis connection for nonce persistence
   */
  async initRedis(redis: import('ioredis').default): Promise<void> {
    this.redis = redis;
    logger.info('Signer Redis connection initialized for nonce persistence');
  }

  /**
   * Get the signer's address
   */
  getAddress(): string {
    return this.wallet.address;
  }

  /**
   * Generate a unique salt for the order
   */
  private generateSalt(): string {
    // Generate salt as decimal string within JS safe integer range
    // The Polymarket API parses salt with parseInt(salt, 10) so it must fit in Number
    const bytes = ethers.randomBytes(6); // 48 bits, well within Number.MAX_SAFE_INTEGER (2^53)
    const saltNum = BigInt('0x' + Buffer.from(bytes).toString('hex'));
    return saltNum.toString(10);
  }

  /**
   * Get next nonce from Redis for persistence across restarts
   * Uses atomic INCR to prevent race conditions
   */
  private async getNextNonce(): Promise<string> {
    const NONCE_KEY = `signer:nonce:${this.wallet.address}`;

    if (!this.redis) {
      throw new Error('Redis not initialized for nonce management. Call initRedis() first.');
    }

    const nonce = await this.redis.incr(NONCE_KEY);
    return nonce.toString();
  }

  /**
   * Convert price to on-chain amount format
   * Polymarket uses 6 decimals for USDC
   * Uses Decimal.js for precise financial calculations
   */
  private priceToAmount(price: number, size: number, isMakerAmount: boolean): string {
    const USDC_DECIMALS = 6;
    const SHARE_DECIMALS = 6;

    // Use Decimal.js for precise arithmetic - avoids floating point errors
    const priceDecimal = new Decimal(price);
    const sizeDecimal = new Decimal(size);

    if (isMakerAmount) {
      // Maker provides USDC = price * size
      // API requires max 2 decimal precision → raw amount must be divisible by 10^4
      const multiplier = new Decimal(10).pow(USDC_DECIMALS);
      const amount = priceDecimal.times(sizeDecimal).times(multiplier).floor();
      const rounded = amount.divToInt(10000).times(10000);
      return rounded.toFixed(0);
    } else {
      // Taker provides shares = size
      // API requires max 5 decimal precision → raw amount must be divisible by 10^1
      const multiplier = new Decimal(10).pow(SHARE_DECIMALS);
      const amount = sizeDecimal.times(multiplier).floor();
      const rounded = amount.divToInt(10).times(10);
      return rounded.toFixed(0);
    }
  }

  /**
   * Create and sign an order for a BUY operation
   */
  async signBuyOrder(
    tokenId: string,
    price: number,
    size: number,
    negRisk: boolean = false
  ): Promise<SignedOrder> {
    // FOK orders must have expiration = "0" (only GTD orders use a future timestamp)
    const expiration = '0';
    const nonce = '0'; // Nonce is for on-chain cancellations, not replay protection (salt provides uniqueness)
    const salt = this.generateSalt();

    // For BUY: maker provides USDC, receives shares
    const makerAmount = this.priceToAmount(price, size, true);
    const takerAmount = this.priceToAmount(price, size, false);

    const orderData: OrderEIP712 = {
      salt,
      maker: this.config.signatureType === 2 ? (this.config.gnosisSafeAddress || this.wallet.address) : this.wallet.address,
      signer: this.wallet.address,
      taker: ethers.ZeroAddress, // Open order
      tokenId,
      makerAmount,
      takerAmount,
      expiration,
      nonce,
      feeRateBps: '0', // Maker fee
      side: 0, // BUY = 0
      signatureType: this.config.signatureType,
    };

    logger.debug('Signing BUY order', { tokenId, price, size, expiration });

    const signature = await this.signTypedData(orderData, negRisk);

    return {
      tokenID: tokenId,
      price: price.toFixed(4),
      size: size.toFixed(2),
      side: 'BUY',
      feeRateBps: '0',
      nonce,
      expiration,
      signatureType: this.config.signatureType,
      signature,
      // On-chain fields for /orders API
      salt,
      maker: orderData.maker,
      signer: orderData.signer,
      taker: orderData.taker,
      makerAmount,
      takerAmount,
    };
  }

  /**
   * Sign the order using EIP-712
   */
  private async signTypedData(orderData: OrderEIP712, negRisk: boolean = false): Promise<string> {
    const startTime = performance.now();
    const domain = negRisk ? this.negRiskDomain : this.ctfDomain;

    try {
      const signature = await this.wallet.signTypedData(
        domain,
        ORDER_TYPES,
        orderData
      );

      const elapsed = performance.now() - startTime;
      logger.debug(`EIP-712 signature generated in ${elapsed.toFixed(2)}ms`);

      return signature;
    } catch (error) {
      logger.error('Failed to sign order:', error);
      throw error;
    }
  }

  /**
   * Sign a batch of orders for atomic execution
   */
  async signBatchOrders(
    orders: Array<{ tokenId: string; price: number; size: number; side: 'BUY' | 'SELL' }>,
    negRisk: boolean = false
  ): Promise<SignedOrder[]> {
    const startTime = performance.now();
    const signedOrders: SignedOrder[] = [];

    for (const order of orders) {
      if (order.side === 'BUY') {
        signedOrders.push(await this.signBuyOrder(order.tokenId, order.price, order.size, negRisk));
      }
      // Add SELL order signing if needed
    }

    const elapsed = performance.now() - startTime;
    logger.info(`Signed ${orders.length} orders in ${elapsed.toFixed(2)}ms`);

    return signedOrders;
  }

  /**
   * Derive L2 credentials from the private key
   * This is used for API authentication
   */
  deriveL2Credentials(): { apiKey: string; secret: string; passphrase: string } {
    // L2 credentials are derived from signing a specific message
    // The actual implementation depends on Polymarket's specification
    return {
      apiKey: this.config.clobApiKey,
      secret: this.config.clobApiSecret,
      passphrase: this.config.clobPassphrase,
    };
  }
}
