/**
 * EIP-712 Signing for Polymarket Orders
 * Supports BUY and SELL sides, EOA (Type 0) and Gnosis Safe (Type 2)
 *
 * Matches patterns from execution/src/signer.ts but uses ethers v6
 * (signTypedData, not _signTypedData).
 */

import { ethers, TypedDataDomain, TypedDataField } from 'ethers';
import Decimal from 'decimal.js';
import { randomBytes } from 'crypto';

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

const USDC_DECIMALS = 6;
const SHARE_DECIMALS = 6;

export interface OrderEIP712 {
  salt: string;
  maker: string;
  signer: string;
  taker: string;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  expiration: string;
  nonce: string;
  feeRateBps: string;
  side: number;
  signatureType: number;
}

export interface SignedOrder {
  salt: string;
  maker: string;
  signer: string;
  taker: string;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  expiration: string;
  nonce: string;
  feeRateBps: string;
  side: string;
  signatureType: string;
  signature: string;
}

export class AlphaSigner {
  private wallet: ethers.Wallet;
  private gnosisSafeAddress: string;
  private signatureType: number;
  private ctfDomain: TypedDataDomain;
  private negRiskDomain: TypedDataDomain;

  constructor(
    privateKey: string,
    gnosisSafeAddress: string,
    chainId: number,
    ctfExchangeAddress: string,
    negRiskCtfExchangeAddress: string,
    signatureType: number = 0,
  ) {
    this.wallet = new ethers.Wallet(privateKey);
    this.gnosisSafeAddress = gnosisSafeAddress;
    this.signatureType = signatureType;

    this.ctfDomain = {
      name: 'Polymarket CTF Exchange',
      version: '1',
      chainId,
      verifyingContract: ctfExchangeAddress,
    };

    this.negRiskDomain = {
      name: 'Polymarket CTF Exchange',
      version: '1',
      chainId,
      verifyingContract: negRiskCtfExchangeAddress,
    };
  }

  /**
   * Get the EOA signer address.
   */
  getAddress(): string {
    return this.wallet.address;
  }

  /**
   * Get the maker address (depends on signatureType).
   */
  private getMaker(): string {
    return this.signatureType === 2
      ? this.gnosisSafeAddress
      : this.wallet.address;
  }

  /**
   * Generate a unique salt using Node crypto randomBytes.
   * 6 bytes = 48 bits, well within Number.MAX_SAFE_INTEGER (2^53).
   * Polymarket API parses salt with parseInt(salt, 10).
   */
  private generateSalt(): string {
    const bytes = randomBytes(6);
    const saltNum = BigInt('0x' + bytes.toString('hex'));
    return saltNum.toString(10);
  }

  /**
   * Compute USDC amount on-chain (price * size * 1e6), rounded to nearest 10000.
   */
  private computeUsdcAmount(price: number, size: number): string {
    const multiplier = new Decimal(10).pow(USDC_DECIMALS);
    const raw = new Decimal(price).times(new Decimal(size)).times(multiplier).floor();
    return raw.divToInt(10000).times(10000).toFixed(0);
  }

  /**
   * Compute shares amount on-chain (size * 1e6), rounded to nearest 10.
   */
  private computeSharesAmount(size: number): string {
    const multiplier = new Decimal(10).pow(SHARE_DECIMALS);
    const raw = new Decimal(size).times(multiplier).floor();
    return raw.divToInt(10).times(10).toFixed(0);
  }

  /**
   * Sign an EIP-712 order using ethers v6 signTypedData.
   */
  private async signTypedData(
    orderData: OrderEIP712,
    negRisk: boolean,
  ): Promise<string> {
    const domain = negRisk ? this.negRiskDomain : this.ctfDomain;
    return this.wallet.signTypedData(domain, ORDER_TYPES, orderData);
  }

  /**
   * Create and sign a BUY order.
   * BUY side=0: makerAmount=USDC, takerAmount=shares
   */
  async signBuyOrder(
    tokenId: string,
    price: number,
    size: number,
    negRisk: boolean = false,
  ): Promise<SignedOrder> {
    const salt = this.generateSalt();
    const makerAmount = this.computeUsdcAmount(price, size);
    const takerAmount = this.computeSharesAmount(size);

    const orderData: OrderEIP712 = {
      salt,
      maker: this.getMaker(),
      signer: this.wallet.address,
      taker: ethers.ZeroAddress,
      tokenId,
      makerAmount,
      takerAmount,
      expiration: '0',
      nonce: '0',
      feeRateBps: '0',
      side: 0,
      signatureType: this.signatureType,
    };

    const signature = await this.signTypedData(orderData, negRisk);

    return {
      salt,
      maker: orderData.maker,
      signer: orderData.signer,
      taker: orderData.taker,
      tokenId,
      makerAmount,
      takerAmount,
      expiration: '0',
      nonce: '0',
      feeRateBps: '0',
      side: '0',
      signatureType: this.signatureType.toString(),
      signature,
    };
  }

  /**
   * Create and sign a SELL order.
   * SELL side=1: makerAmount=shares, takerAmount=USDC
   */
  async signSellOrder(
    tokenId: string,
    price: number,
    size: number,
    negRisk: boolean = false,
  ): Promise<SignedOrder> {
    const salt = this.generateSalt();
    const sharesAmount = this.computeSharesAmount(size);
    const usdcAmount = this.computeUsdcAmount(price, size);

    const orderData: OrderEIP712 = {
      salt,
      maker: this.getMaker(),
      signer: this.wallet.address,
      taker: ethers.ZeroAddress,
      tokenId,
      makerAmount: sharesAmount,
      takerAmount: usdcAmount,
      expiration: '0',
      nonce: '0',
      feeRateBps: '0',
      side: 1,
      signatureType: this.signatureType,
    };

    const signature = await this.signTypedData(orderData, negRisk);

    return {
      salt,
      maker: orderData.maker,
      signer: orderData.signer,
      taker: orderData.taker,
      tokenId,
      makerAmount: sharesAmount,
      takerAmount: usdcAmount,
      expiration: '0',
      nonce: '0',
      feeRateBps: '0',
      side: '1',
      signatureType: this.signatureType.toString(),
      signature,
    };
  }
}
