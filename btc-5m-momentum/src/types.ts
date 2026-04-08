import Decimal from 'decimal.js';

// --- Market Discovery (reused from btc-5m) ---

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

// --- Momentum Signal ---

export type Direction = 'UP' | 'DOWN' | 'FLAT';

export interface DirectionResult {
  direction: Direction;
  deltaBps: number; // Price movement in basis points (can be negative)
  currentPrice: Decimal;
  openPrice: Decimal;
}

export interface LiquidityResult {
  availableShares: Decimal;
  vwapPrice: Decimal; // Volume-weighted average fill price
  worstPrice: Decimal; // Highest ask level touched (FOK limit price)
  totalCost: Decimal; // Total USDC needed
}

export interface MomentumDecision {
  direction: 'UP' | 'DOWN';
  tokenId: string;
  entryPrice: Decimal; // Worst ask price (FOK limit)
  shares: Decimal;
  totalCost: Decimal;
  expectedProfit: Decimal; // (1.00 - entryPrice) * shares
  expectedLoss: Decimal; // entryPrice * shares (if direction reverses)
  deltaBps: number; // BTC price movement that triggered the signal
}

// --- Trade Execution ---

export interface SingleTradeResult {
  success: boolean;
  orderId?: string;
  tokenId: string;
  direction: 'UP' | 'DOWN';
  price: Decimal;
  size: Decimal;
  error?: string;
  latencyMs: number;
  simResult?: SimulatedTradeResult;
}

// --- Paper Trading Simulation ---

export interface SimulatedTradeResult {
  success: boolean;
  fillShares: Decimal;
  requestedShares: Decimal;
  fillPrice: Decimal;
  requestedPrice: Decimal;
  slippageBps: number;
  fillRatio: number;
  partialFill: boolean;
  missedFill: boolean;
  bookDepthLevels: number;
  bestAskPrice: Decimal;
  totalCost: Decimal;
  latencyMs: number;
}

// --- Risk Manager ---

export interface RiskCheck {
  allowed: boolean;
  reason?: string;
}

export interface MomentumStats {
  totalWindows: number;
  windowsEvaluated: number;
  windowsTraded: number;
  windowsSkipped: number;
  wins: number;
  losses: number;
  winRate: number; // wins / (wins + losses), 0 if no trades
  totalProfit: Decimal;
  totalLoss: Decimal;
  dailyProfit: Decimal;
  dailyProfitDate: string; // YYYY-MM-DD
  dailyVolume: Decimal;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  lastTradeTime: number;
  lastTradeDirection: 'UP' | 'DOWN' | '';
  // Paper trading fill quality
  paperFills: number;
  paperPartialFills: number;
  paperMissedFills: number;
  paperAvgFillRatio: number;
  paperAvgSlippageBps: number;
  paperAvgEntryPrice: number;
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
  negRiskCtfExchangeAddress: string;
  chainId: number;

  // Redis
  redisSocketPath: string;

  // Binance
  binanceWsUrl: string;

  // Strategy
  entrySecondsBefore: number; // Evaluate at T-N seconds before window close
  minDirectionBps: number; // Min BTC price movement to consider decisive
  minEntryPrice: number; // Min contract price to buy (e.g., 0.85)
  maxEntryPrice: number; // Max contract price to buy (e.g., 0.95)
  maxBetUsdc: number; // Max USDC per window
  maxOrderShares: number; // Chunk size for order splitting

  // Risk
  maxDailyLossUsdc: number;
  maxConsecutiveLosses: number;
  streakPauseMinutes: number;

  // Safety
  dryRun: boolean;
}

// --- EIP-712 Order Types ---

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

export interface OrderResponse {
  success: boolean;
  orderID?: string;
  errorMsg?: string;
}
