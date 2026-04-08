import dotenv from 'dotenv';
import { Config } from './types';
import { logger } from './logger';

dotenv.config();

export function loadConfig(): Config {
  const config: Config = {
    // Polymarket CLOB
    clobApiUrl: process.env.CLOB_API_URL || 'https://clob.polymarket.com',
    clobApiKey: process.env.CLOB_API_KEY || '',
    clobApiSecret: process.env.CLOB_API_SECRET || '',
    clobPassphrase: process.env.CLOB_PASSPHRASE || '',
    gammaApiUrl: process.env.GAMMA_API_URL || 'https://gamma-api.polymarket.com',

    // Wallet & Signing
    privateKey: process.env.PRIVATE_KEY || '',
    gnosisSafeAddress: process.env.GNOSIS_SAFE_ADDRESS || '',
    signatureType: parseInt(process.env.SIGNATURE_TYPE || '0', 10),
    negRiskCtfExchangeAddress: process.env.NEGRIK_CTF_EXCHANGE_ADDRESS || '0xC5d563A36AE78145C45a50134d48A1215220f80a',
    chainId: parseInt(process.env.CHAIN_ID || '137', 10),

    // Redis
    redisSocketPath: process.env.REDIS_SOCKET_PATH || '/var/run/redis/redis.sock',

    // Binance
    binanceWsUrl: process.env.BINANCE_WS_URL || 'wss://stream.binance.com:9443/ws/btcusdt@ticker',

    // Strategy
    entrySecondsBefore: parseInt(process.env.BTC_5M_MOM_ENTRY_SECONDS_BEFORE || '10', 10),
    minDirectionBps: parseInt(process.env.BTC_5M_MOM_MIN_DIRECTION_BPS || '5', 10),
    minEntryPrice: parseFloat(process.env.BTC_5M_MOM_MIN_ENTRY_PRICE || '0.85'),
    maxEntryPrice: parseFloat(process.env.BTC_5M_MOM_MAX_ENTRY_PRICE || '0.95'),
    maxBetUsdc: parseFloat(process.env.BTC_5M_MOM_MAX_BET_USDC || '100'),
    maxOrderShares: parseInt(process.env.BTC_5M_MOM_MAX_ORDER_SHARES || '80', 10),

    // Risk
    maxDailyLossUsdc: parseFloat(process.env.BTC_5M_MOM_MAX_DAILY_LOSS_USDC || '300'),
    maxConsecutiveLosses: parseInt(process.env.BTC_5M_MOM_MAX_CONSECUTIVE_LOSSES || '5', 10),
    streakPauseMinutes: parseInt(process.env.BTC_5M_MOM_STREAK_PAUSE_MINUTES || '30', 10),

    // Safety
    dryRun: process.env.BTC_5M_MOM_DRY_RUN !== 'false', // Default true
  };

  // Validate
  if (!config.dryRun) {
    if (!config.privateKey) {
      throw new Error('PRIVATE_KEY is required for live trading');
    }
    if (!config.clobApiKey || !config.clobApiSecret || !config.clobPassphrase) {
      throw new Error('CLOB API credentials are required for live trading');
    }
  }

  if (config.minEntryPrice >= config.maxEntryPrice) {
    throw new Error('BTC_5M_MOM_MIN_ENTRY_PRICE must be < BTC_5M_MOM_MAX_ENTRY_PRICE');
  }

  if (config.maxEntryPrice >= 1.0) {
    throw new Error('BTC_5M_MOM_MAX_ENTRY_PRICE must be < 1.0');
  }

  if (config.minDirectionBps <= 0) {
    throw new Error('BTC_5M_MOM_MIN_DIRECTION_BPS must be > 0');
  }

  logger.info('Config loaded', {
    dryRun: config.dryRun,
    entrySecondsBefore: config.entrySecondsBefore,
    minDirectionBps: config.minDirectionBps,
    minEntryPrice: config.minEntryPrice,
    maxEntryPrice: config.maxEntryPrice,
    maxBetUsdc: config.maxBetUsdc,
    maxDailyLossUsdc: config.maxDailyLossUsdc,
    maxConsecutiveLosses: config.maxConsecutiveLosses,
    streakPauseMinutes: config.streakPauseMinutes,
  });

  return config;
}
