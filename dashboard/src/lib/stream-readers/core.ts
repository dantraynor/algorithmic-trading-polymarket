import type Redis from 'ioredis';
import type { CoreStreamState } from '@/lib/types';

const KILL_SWITCH_KEYS = {
  TRADING_ENABLED: 'TRADING_ENABLED',
  BTC_5M_TRADING_ENABLED: 'BTC_5M_TRADING_ENABLED',
  BTC_5M_MOMENTUM_TRADING_ENABLED: 'BTC_5M_MOMENTUM_TRADING_ENABLED',
  BTC_5M_LATENCY_TRADING_ENABLED: 'BTC_5M_LATENCY_TRADING_ENABLED',
  ALPHA_TRADING_ENABLED: 'ALPHA_TRADING_ENABLED',
  CRYPTO_SIGNALS_ENABLED: 'CRYPTO_SIGNALS_ENABLED',
  SPORTS_SIGNALS_ENABLED: 'SPORTS_SIGNALS_ENABLED',
} as const;

const CONFIG_KEYS = {
  btc5mMaxPosition: 'config:btc5m:max_position_usdc',
  btc5mMomentumMaxBet: 'config:btc5m_momentum:max_bet_usdc',
  maxSlippageBps: 'config:execution:max_slippage_bps',
} as const;

export async function readCoreStats(redis: Redis): Promise<CoreStreamState> {
  const pipe = redis.pipeline();

  // Balance
  pipe.get('safe:balance:usdce');

  // Kill switches
  const ksKeys = Object.values(KILL_SWITCH_KEYS);
  for (const key of ksKeys) {
    pipe.get(key);
  }

  // Config overrides
  pipe.get(CONFIG_KEYS.btc5mMaxPosition);
  pipe.get(CONFIG_KEYS.btc5mMomentumMaxBet);
  pipe.get(CONFIG_KEYS.maxSlippageBps);

  const results = await pipe.exec();
  if (!results) {
    return {
      balance: 0,
      killSwitches: {},
      configOverrides: { btc5mMaxPosition: null, btc5mMomentumMaxBet: null, maxSlippageBps: null },
    };
  }

  let idx = 0;
  const balanceRaw = results[idx++] as [Error | null, string | null];
  const balance = parseFloat(balanceRaw[1] || '0');

  const killSwitches: Record<string, boolean> = {};
  const ksNames = Object.keys(KILL_SWITCH_KEYS);
  for (const name of ksNames) {
    const res = results[idx++] as [Error | null, string | null];
    killSwitches[name] = res[1]?.toUpperCase() === 'TRUE';
  }

  const btc5mMaxPositionRaw = results[idx++] as [Error | null, string | null];
  const btc5mMomentumMaxBetRaw = results[idx++] as [Error | null, string | null];
  const maxSlippageRaw = results[idx++] as [Error | null, string | null];

  return {
    balance,
    killSwitches,
    configOverrides: {
      btc5mMaxPosition: btc5mMaxPositionRaw[1] ? parseFloat(btc5mMaxPositionRaw[1]) : null,
      btc5mMomentumMaxBet: btc5mMomentumMaxBetRaw[1] ? parseFloat(btc5mMomentumMaxBetRaw[1]) : null,
      maxSlippageBps: maxSlippageRaw[1] ? parseInt(maxSlippageRaw[1], 10) : null,
    },
  };
}
