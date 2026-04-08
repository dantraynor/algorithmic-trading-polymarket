/**
 * Type definitions for settlement service
 */

export interface Position {
  tokenId: string;
  balance: bigint;
  marketId: string;
  conditionId: string;
  outcomeIndex: number;
}

export interface MarketPosition {
  marketId: string;
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
  yesBalance: bigint;
  noBalance: bigint;
}

export interface BoxPosition {
  marketId: string;
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
  mergeableAmount: bigint;
  remainingYes: bigint;
  remainingNo: bigint;
}

export interface MergeRequest {
  conditionId: string;
  amount: bigint;
  partition: number[];
}

export interface RelayerTransaction {
  to: string;
  data: string;
  value: string;
  operation: number;
}

export interface RelayerResponse {
  success: boolean;
  transactionHash?: string;
  errorMessage?: string;
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

export interface SafeTransaction {
  to: string;
  value: string;
  data: string;
  operation: number;
  safeTxGas: string;
  baseGas: string;
  gasPrice: string;
  gasToken: string;
  refundReceiver: string;
  nonce: number;
}
