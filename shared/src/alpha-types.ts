export type SignalSource = 'crypto' | 'sports' | 'econ' | 'news' | 'arbitrage';
export type SignalUrgency = 'immediate' | 'seconds' | 'minutes';
export type TradeDirection = 'YES' | 'NO';
export type TradeSide = 'BUY' | 'SELL';

export interface AlphaSignal {
  id: string;
  source: SignalSource;
  marketId: string;
  tokenId: string;
  direction: TradeDirection;
  confidence: number;
  currentAsk: number;
  edge: number;
  availableLiquidity: number;
  urgency: SignalUrgency;
  ttlMs: number;
  resolutionTime?: number;
  timestampMs: number;
  metadata: Record<string, unknown>;
}

export interface PositionRecord {
  marketId: string;
  tokenId: string;
  direction: TradeDirection;
  shares: number;
  entryPrice: number;
  entryCost: number;
  entryTime: number;
  source: SignalSource;
  signalId: string;
  resolutionTime?: number;
}

export type Phase = 1 | 2 | 3;

export interface PhaseConfig {
  phase: Phase;
  kellyMultiplier: number;
  maxPerTradePct: number;
  maxExposureRatio: number;
  maxDrawdown: number;
}

export const PHASE_CONFIGS: Record<Phase, PhaseConfig> = {
  1: { phase: 1, kellyMultiplier: 0.25, maxPerTradePct: 0.10, maxExposureRatio: 0.40, maxDrawdown: 0.15 },
  2: { phase: 2, kellyMultiplier: 0.50, maxPerTradePct: 0.20, maxExposureRatio: 0.60, maxDrawdown: 0.20 },
  3: { phase: 3, kellyMultiplier: 0.75, maxPerTradePct: 0.30, maxExposureRatio: 0.70, maxDrawdown: 0.25 },
};

export interface PortfolioState {
  safeBalance: number;
  totalExposure: number;
  availableCapital: number;
  peakCapital: number;
  realizedPnl: number;
  dailyLoss: number;
  phase: Phase;
  positionCount: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  reason?: string;
  adjustedSize?: number;
}
