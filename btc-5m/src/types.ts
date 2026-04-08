import Decimal from 'decimal.js';

// --- Market Discovery ---

export interface MarketInfo {
  slug: string;
  conditionId: string;
  upTokenId: string;
  downTokenId: string;
  windowTimestamp: number; // Unix seconds, start of 5-min window
  windowCloseTimestamp: number; // windowTimestamp + 300
}

// --- Order Book ---

export interface OrderBookLevel {
  price: string; // Raw string from CLOB API — parse to Decimal for calculations
  size: string;
}

export interface OrderBookSnapshot {
  asks: OrderBookLevel[]; // Sorted by price ascending
  bids: OrderBookLevel[]; // Sorted by price descending
  fetchedAt: number; // Unix ms timestamp
}

// --- Arbitrage Scanning ---

export interface ArbitrageOpportunity {
  upAskPrice: Decimal; // Weighted avg fill price for UP side
  downAskPrice: Decimal; // Weighted avg fill price for DOWN side
  upWorstPrice: Decimal; // Highest ask level touched on UP side (FOK limit price)
  downWorstPrice: Decimal; // Highest ask level touched on DOWN side (FOK limit price)
  combinedCost: Decimal; // upAskPrice + downAskPrice
  edge: Decimal; // 1.00 - combinedCost
  edgeBps: number; // edge in basis points
  optimalShares: Decimal; // Max shares where running combined VWAP stays profitable
  totalUpCost: Decimal; // Total USDC needed for UP side
  totalDownCost: Decimal; // Total USDC needed for DOWN side
  timestamp: number;
}

// --- Trade Execution ---

export interface DualTradeDecision {
  upTokenId: string;
  downTokenId: string;
  upPrice: Decimal;
  downPrice: Decimal;
  shares: Decimal;
  combinedCost: Decimal;
  guaranteedProfit: Decimal; // (1.00 - combinedCost) * shares
}

export interface TradeResult {
  success: boolean;
  orderId?: string;
  tokenId: string;
  side: 'UP' | 'DOWN';
  price: Decimal;
  size: Decimal;
  error?: string;
  latencyMs: number;
  windowTimestamp: number;
}

export interface DualTradeResult {
  success: boolean; // true only if BOTH sides filled
  upResult: TradeResult;
  downResult: TradeResult;
  combinedCost: Decimal;
  guaranteedProfit: Decimal;
  shares: Decimal;
  totalLatencyMs: number;
  partialFill: boolean; // true if only one side filled
}

// --- Risk Manager ---

export interface RiskCheck {
  allowed: boolean;
  reason?: string;
}

export interface ArbTradingStats {
  totalWindows: number;
  windowsScanned: number;
  windowsTraded: number;
  windowsSkipped: number;
  totalPairsTraded: number;
  totalVolume: Decimal; // Total USDC spent
  totalProfit: Decimal; // Total guaranteed profit
  dailyProfit: Decimal;
  dailyProfitDate: string; // YYYY-MM-DD
  dailyVolume: Decimal;
  averageEdgeBps: number;
  partialFills: number;
  dailyPartialFills: number;
  lastTradeTime: number;
  lastScanTime: number;
}

// --- Config ---

export interface Config {
  // Polymarket CLOB
  clobApiUrl: string;
  clobApiKey: string;
  clobApiSecret: string;
  clobPassphrase: string;
  gammaApiUrl: string;

  // Wallet & Signing
  privateKey: string;
  gnosisSafeAddress: string;
  signatureType: number;
  ctfExchangeAddress: string;
  negRiskCtfExchangeAddress: string;
  chainId: number;

  // Redis
  redisSocketPath: string;

  // Strategy
  maxPositionUsdc: number; // Max USDC per side per window (risk cap)
  maxOrderShares: number; // Chunk size for order splitting
  minEdgeBps: number; // Min edge in basis points to execute
  maxCombinedCost: number; // Hard ceiling on UP+DOWN cost (< 1.00)
  scanIntervalMs: number; // Order book poll interval
  entryStartSec: number; // Start scanning N seconds into window
  entryEndSec: number; // Stop scanning N seconds into window
  maxBookLevels: number; // Max order book levels to walk

  // Risk
  maxDailyLossUsdc: number; // Absolute daily loss cap (partial fill protection)

  // Safety
  dryRun: boolean;
  killSwitchCheckIntervalMs: number;
}

// --- EIP-712 Order Types (reused from execution service) ---

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
  tokenID: string;
  price: string;
  size: string;
  side: 'BUY' | 'SELL';
  feeRateBps: string;
  nonce: string;
  expiration: string;
  signatureType: number;
  signature: string;
}

export interface OrderResponse {
  success: boolean;
  orderID?: string;
  errorMsg?: string;
}
