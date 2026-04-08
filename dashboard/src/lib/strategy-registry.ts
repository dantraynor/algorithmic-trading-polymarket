export type StrategyId = 'arb' | 'btc-5m' | 'btc-5m-latency' | 'btc-5m-momentum' | 'alpha-crypto' | 'alpha-sports';

export interface StrategyDefinition {
  id: StrategyId;
  label: string;
  fullName: string;
  color: string;
  killSwitchKey: string;
  statsKey: string;
  resultsChannel: string;
  page: 'overview' | 'crypto' | 'sports';
}

export const STRATEGIES: Record<StrategyId, StrategyDefinition> = {
  arb: {
    id: 'arb',
    label: 'ARB',
    fullName: 'Box Spread Arbitrage',
    color: 'text-bb-cyan',
    killSwitchKey: 'TRADING_ENABLED',
    statsKey: 'execution:stats',
    resultsChannel: 'results:execution',
    page: 'overview',
  },
  'btc-5m': {
    id: 'btc-5m',
    label: 'BTC5M',
    fullName: 'BTC 5-Minute Box Spread',
    color: 'text-bb-orange',
    killSwitchKey: 'BTC_5M_TRADING_ENABLED',
    statsKey: 'btc5m:stats',
    resultsChannel: 'results:btc5m',
    page: 'crypto',
  },
  'btc-5m-latency': {
    id: 'btc-5m-latency',
    label: 'LATCY',
    fullName: 'BTC 5-Min Latency Arb',
    color: 'text-bb-yellow',
    killSwitchKey: 'BTC_5M_LATENCY_TRADING_ENABLED',
    statsKey: 'btc5m_latency:stats',
    resultsChannel: 'results:btc5m_latency',
    page: 'crypto',
  },
  'btc-5m-momentum': {
    id: 'btc-5m-momentum',
    label: 'MOMTM',
    fullName: 'BTC 5-Min Momentum',
    color: 'text-bb-orange',
    killSwitchKey: 'BTC_5M_MOMENTUM_TRADING_ENABLED',
    statsKey: 'btc5m_momentum:stats',
    resultsChannel: 'results:btc5m_momentum',
    page: 'crypto',
  },
  'alpha-crypto': {
    id: 'alpha-crypto',
    label: 'ACRYP',
    fullName: 'Alpha Crypto Signals',
    color: 'text-bb-green',
    killSwitchKey: 'ALPHA_TRADING_ENABLED',
    statsKey: 'alpha:stats',
    resultsChannel: 'results:alpha',
    page: 'crypto',
  },
  'alpha-sports': {
    id: 'alpha-sports',
    label: 'ASPRT',
    fullName: 'Alpha Sports Signals',
    color: 'text-bb-purple',
    killSwitchKey: 'ALPHA_TRADING_ENABLED',
    statsKey: 'alpha:stats',
    resultsChannel: 'results:alpha',
    page: 'sports',
  },
};

export const ALL_STRATEGY_IDS = Object.keys(STRATEGIES) as StrategyId[];

export function getStrategy(id: StrategyId): StrategyDefinition {
  return STRATEGIES[id];
}
