// ─── Existing types (preserved) ───────────────────────────────────────────────

export interface DashboardStats {
  balance: number;
  todayPnl: number;
  totalPnl: number;
  winRate: number;
  totalTrades: number;
  maxDrawdown: number;
  messagesIngested: number;
}

export interface ServiceStatus {
  status: 'up' | 'down';
  metric: string;
}

export interface ServiceHealth {
  redis: ServiceStatus;
  ingestion: ServiceStatus;
  'signal-core': ServiceStatus;
  execution: ServiceStatus;
  settlement: ServiceStatus;
  'btc-5m': ServiceStatus;
  'btc-5m-momentum': ServiceStatus;
}

export interface MomentumDashboardStats {
  dryRun: boolean;
  wins: number;
  losses: number;
  winRate: number;
  dailyProfit: number;
  dailyVolume: number;
  consecutiveLosses: number;
  avgFillRatio: number;
  avgSlippageBps: number;
  partialFills: number;
  missedFills: number;
  windowDirection: string;
  windowDeltaBps: number;
  windowTraded: boolean;
}

export interface BtcWindow {
  timestamp: number;
  direction: string;
  confidence: number;
  openPrice: number;
}

export interface TradeEvent {
  strategy: string;
  market: string;
  direction?: string;
  pnl: number;
  timestamp: number;
  price?: number;
  size?: number;
  won?: boolean;
  fillRatio?: number;
  slippageBps?: number;
  dryRun?: boolean;
}

export interface MarketSummary {
  id: string;
  name: string;
  yesTokenId: string;
  noTokenId: string;
  yesBestBid: number;
  yesBestAsk: number;
  noBestBid: number;
  noBestAsk: number;
  sum: number;
  edge: number;
}

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface OrderBookSide {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

export interface OrderBookData {
  yes: OrderBookSide;
  no: OrderBookSide;
}

export interface LogEntry {
  timestamp: string;
  service: string;
  level: string;
  message: string;
}

export interface DashboardState {
  stats: DashboardStats;
  services: ServiceHealth;
  tradingEnabled: boolean;
  btcTradingEnabled: boolean;
  params: { betSize: number; maxSlippage: number };
  btcWindow: BtcWindow | null;
  momentumStats: MomentumDashboardStats | null;
  trades?: TradeEvent[];
  markets?: MarketSummary[];
}

// ─── New types (Bloomberg v2) ─────────────────────────────────────────────────

/** On-chain token holding (ERC-1155 CTF or ERC-20 USDCe) */
export interface TrackedWallet {
  address: string;
  label: string;
  source: 'wallet' | 'safe' | 'proxy' | 'custom';
}

/** On-chain token holding (ERC-1155 CTF or ERC-20 USDCe) */
export interface TokenHolding {
  tokenId: string;
  balance: number;
  /** Human-readable label, e.g. market name + YES/NO */
  label?: string;
  ownerAddress?: string;
  ownerLabel?: string;
  ownerSource?: TrackedWallet['source'];
  assetType?: 'erc20' | 'erc1155';
}

/** Open position from alpha-executor PositionRecord */
export interface OpenPosition {
  marketId: string;
  tokenId: string;
  direction: 'YES' | 'NO';
  shares: number;
  entryPrice: number;
  entryCost: number;
  entryTime: number;
  source: 'crypto' | 'sports' | 'econ' | 'news' | 'arbitrage';
  signalId: string;
  resolutionTime?: number;
  /** Unrealized P&L (computed from mark price, if available) */
  unrealizedPnl?: number;
}

/** Generic per-strategy stats (covers BTC, latency, momentum, arb) */
export interface StrategyStats {
  wins: number;
  losses: number;
  winRate: number;
  totalTrades: number;
  dailyProfit: number;
  dailyVolume: number;
  totalPnl: number;
  consecutiveLosses: number;
  lastTradeTime: number;
}

/** Core account-level state from Redis */
export interface CoreStreamState {
  balance: number;
  killSwitches: Record<string, boolean>;
  configOverrides: {
    btc5mMaxPosition: number | null;
    btc5mMomentumMaxBet: number | null;
    maxSlippageBps: number | null;
  };
}

/** Service health state for the SSE stream */
export interface ServiceStreamState {
  services: ServiceHealth;
}

/** BTC strategies combined state */
export interface BtcStreamState {
  btc5m: {
    stats: StrategyStats;
    window: BtcWindow | null;
  };
  btc5mMomentum: {
    stats: MomentumDashboardStats | null;
    window: BtcWindow | null;
  };
  btc5mLatency: {
    stats: StrategyStats;
    window: BtcWindow | null;
  };
}

/** Alpha strategies combined state */
export interface AlphaStreamState {
  stats: Record<string, string>;
  portfolio: {
    totalExposure: number;
    peakCapital: number;
    realizedPnl: number;
    dailyLoss: number;
  };
  positions: OpenPosition[];
}
