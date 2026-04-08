/**
 * Type definitions for the execution engine
 */

export interface ArbitrageSignal {
  market_id: string;
  yes_token_id: string;
  no_token_id: string;
  yes_ask_price: number;
  yes_ask_size: number;
  no_ask_price: number;
  no_ask_size: number;
  combined_prob: number;
  edge: number;
  max_size: number;
  expected_profit: number;
  timestamp_ms: number;
  sequence: number;
}

export interface Order {
  tokenID: string;
  price: string;
  size: string;
  side: 'BUY' | 'SELL';
  feeRateBps: string;
  nonce: string;
  expiration: string;
  signatureType: number;
}

export interface SignedOrder extends Order {
  signature: string;
  // On-chain order fields needed for /orders API
  salt: string;
  maker: string;
  signer: string;
  taker: string;
  makerAmount: string;
  takerAmount: string;
}

export interface BatchOrderRequest {
  orders: SignedOrder[];
}

export interface OrderResponse {
  success: boolean;
  orderID?: string;
  errorMsg?: string;
  transactionHash?: string;
}

export interface BatchOrderResponse {
  success: boolean;
  orders: OrderResponse[];
}

export interface L2Credentials {
  apiKey: string;
  secret: string;
  passphrase: string;
}

export interface EIP712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

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

export interface PositionBalance {
  tokenId: string;
  balance: string;
  marketId: string;
  side: 'YES' | 'NO';
}

export interface SafeBalance {
  usdce: string;
  positions: PositionBalance[];
}
