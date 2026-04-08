/**
 * Shared type definitions
 */

// Market Types
export interface Market {
  id: string;
  conditionId: string;
  questionId: string;
  tokens: TokenPair;
  minOrderSize: number;
  isNegRisk: boolean;
  active: boolean;
  createdAt: number;
  endDate?: number;
}

export interface TokenPair {
  yes: Token;
  no: Token;
}

export interface Token {
  tokenId: string;
  outcome: 'YES' | 'NO';
}

// Order Book Types
export interface PriceLevel {
  price: number;
  size: number;
}

export interface OrderBook {
  tokenId: string;
  bids: PriceLevel[];
  asks: PriceLevel[];
  bestBid?: PriceLevel;
  bestAsk?: PriceLevel;
  timestamp: number;
  sequence: number;
}

// Signal Types
export interface ArbitrageSignal {
  marketId: string;
  yesTokenId: string;
  noTokenId: string;
  yesAskPrice: number;
  yesAskSize: number;
  noAskPrice: number;
  noAskSize: number;
  combinedProb: number;
  edge: number;
  maxSize: number;
  expectedProfit: number;
  timestampMs: number;
  sequence: number;
}

// Execution Types
export interface ExecutionRequest {
  signal: ArbitrageSignal;
  maxPositionSize: number;
  slippageBps: number;
}

export interface ExecutionResult {
  success: boolean;
  yesOrderId?: string;
  noOrderId?: string;
  error?: string;
  executedSize: number;
  totalCost: number;
  expectedProfit: number;
  actualProfit?: number;
  latencyMs: number;
}

// Settlement Types
export interface BoxPosition {
  marketId: string;
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
  mergeableAmount: bigint;
  remainingYes: bigint;
  remainingNo: bigint;
}

export interface SettlementResult {
  success: boolean;
  marketId: string;
  mergedAmount: bigint;
  usdceReturned: bigint;
  transactionHash?: string;
  error?: string;
  latencyMs: number;
}

// Health & Stats Types
export interface ServiceHealth {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastHeartbeat: number;
  uptime: number;
  errors: number;
}

export interface ScannerStats {
  totalScans: number;
  opportunitiesFound: number;
  signalsSent: number;
  avgScanTimeUs: number;
  maxScanTimeUs: number;
  lastOpportunityMs?: number;
}

export interface ExecutionStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  totalProfit: number;
  avgLatencyMs: number;
  lastExecutionMs?: number;
}

export interface SettlementStats {
  totalMerges: number;
  totalUsdceReturned: number;
  lastMergeMs?: number;
}
