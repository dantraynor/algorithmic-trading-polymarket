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

export interface LiquidityResult {
  availableShares: Decimal;
  vwapPrice: Decimal; // Volume-weighted average fill price
  worstPrice: Decimal; // Highest ask level touched (FOK limit price)
  totalCost: Decimal; // Total USDC needed
}

// --- Exchange Feed ---

export type Direction = 'UP' | 'DOWN';

export interface AggregatedPrice {
  median: Decimal;
  binancePrice: Decimal | null;
  coinbasePrice: Decimal | null;
  timestamp: number;
  stale: boolean; // True if both feeds are stale (> 2s old)
}

// --- Chainlink Oracle ---

export interface ChainlinkPrice {
  price: Decimal;
  roundId: string;
  updatedAt: number; // Unix seconds of last on-chain update
  fetchedAt: number; // Unix ms when we polled
}

// --- Probability Model ---

export interface ProbabilityEstimate {
  trueProb: Decimal; // Estimated probability of UP outcome
  delta: Decimal; // Current BTC price - price_to_beat
  rollingVol: Decimal; // 5-min window sigma (not annualized)
  remainingVol: Decimal; // sigma * sqrt(timeRemaining / 300)
  zScore: Decimal; // delta / remainingVol
  timeRemaining: number; // Seconds left in window
}

// --- Latency Signal ---

export interface LatencyTradeDecision {
  side: Direction;
  tokenId: string;
  edge: Decimal; // trueProb - marketPrice
  trueProb: Decimal;
  marketPrice: Decimal; // Best ask on Polymarket
  maxPrice: Decimal; // trueProb - EDGE_BUFFER (limit price ceiling)
  kellyDollars: Decimal; // Kelly-sized dollar amount
  shares: Decimal; // Actual shares to buy
  totalCost: Decimal;
  timestamp: number;
}

// --- Trade Execution ---

export interface TradeOrder {
  tokenId: string;
  side: Direction;
  limitPrice: Decimal; // Worst acceptable fill price
  shares: Decimal;
}

export interface SingleTradeResult {
  success: boolean;
  orderId?: string;
  orderIds?: string[];
  tokenId: string;
  side: Direction;
  price: Decimal;
  size: Decimal;
  error?: string;
  latencyMs: number;
  simResult?: SimulatedTradeResult;
}

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

// --- Window P&L ---

export interface WindowFill {
  timestamp: number;
  side: Direction;
  tokenId: string;
  shares: Decimal;
  price: Decimal;
  cost: Decimal;
  edge: Decimal;
  orderIds: string[];
}

export interface WindowFillInput {
  timestamp?: number;
  side: Direction;
  tokenId: string;
  shares: Decimal;
  price: Decimal;
  edge: Decimal;
  orderIds?: string[];
}

export interface WindowPnL {
  windowTimestamp: number;
  marketSlug?: string;
  conditionId?: string;
  upTokenId?: string;
  downTokenId?: string;
  priceToBeat: Decimal;
  finalChainlinkPrice: Decimal | null;
  outcome: Direction | null; // null if pending
  upSharesHeld: Decimal;
  upAvgCost: Decimal;
  downSharesHeld: Decimal;
  downAvgCost: Decimal;
  grossPnl: Decimal;
  numTrades: number;
  totalVolume: Decimal;
  maxEdgeSeen: Decimal;
  avgEdgeAtFill: Decimal;
  timeOfFirstTrade: number | null;
  timeOfLastTrade: number | null;
  fills: WindowFill[];
}

// --- Risk Manager ---

export interface RiskCheck {
  allowed: boolean;
  reason?: string;
}

export interface LatencyStats {
  totalWindows: number;
  windowsTraded: number;
  windowsSkipped: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: Decimal;
  totalLoss: Decimal;
  sessionPnl: Decimal;
  dailyProfit: Decimal;
  dailyProfitDate: string; // YYYY-MM-DD
  dailyVolume: Decimal;
  totalTrades: number;
  avgEdgeAtFill: Decimal;
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  oracleDivergenceEvents: number;
  lastTradeTime: number;
  // Paper trading fill quality
  paperFills: number;
  paperPartialFills: number;
  paperMissedFills: number;
  paperAvgFillRatio: number;
  paperAvgSlippageBps: number;
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
  chainId: number;

  // Redis
  redisSocketPath: string;

  // Exchange feeds
  binanceWsUrl: string;
  coinbaseWsUrl: string;

  // Chainlink
  chainlinkPollIntervalMs: number;
  chainlinkRpcUrl: string;
  chainlinkAggregator: string;

  // Strategy
  minEdge: number; // 0.08 = 8% probability advantage
  minZScore: number; // Minimum absolute z-score to trigger (e.g. 1.0)
  edgeBuffer: number; // 0.02 = don't pay more than trueProb - buffer
  kellyMultiplier: number; // 0.25 = quarter-Kelly
  maxPositionPerWindow: number; // Max $ per window per side
  volLookbackSec: number; // Rolling vol lookback
  tickAggregationMs: number; // Aggregate ticks before recomputing
  minTimeRemaining: number; // Stop trading with < N seconds
  maxTimeRemaining: number; // Don't trade in first N seconds
  maxOrderShares: number; // Chunk size for order splitting

  // Risk
  maxSessionDrawdown: number; // Cumulative P&L pause threshold
  maxDailyLossUsdc: number;
  trendThreshold: number; // Reduce sizing if BTC moves > $N in window
  oracleDivergenceLimit: number; // Halt if chainlink vs exchange > $N
  oracleDivergenceDurationMs: number; // For how long divergence must persist
  minBookDepthUsdc: number; // Skip if book depth < $N per level
  minVolatility: number; // Skip if rolling vol < $N (choppy/range-bound regime)
  minDelta: number; // Skip if |BTC price - priceToBeat| < $N (noise filter)
  maxConsecutiveLosses: number;
  streakPauseMinutes: number;
  bankroll: number; // For Kelly sizing

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
