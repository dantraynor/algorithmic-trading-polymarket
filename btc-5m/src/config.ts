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
    signatureType: parseInt(process.env.SIGNATURE_TYPE || '0', 10), // 0 = EOA, 2 = Gnosis Safe
    ctfExchangeAddress: process.env.CTF_EXCHANGE_ADDRESS || '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
    negRiskCtfExchangeAddress: process.env.NEGRIK_CTF_EXCHANGE_ADDRESS || '0xC5d563A36AE78145C45a50134d48A1215220f80a',
    chainId: parseInt(process.env.CHAIN_ID || '137', 10), // Polygon

    // Redis
    redisSocketPath: process.env.REDIS_SOCKET_PATH || '/var/run/redis/redis.sock',

    // Strategy
    maxPositionUsdc: parseFloat(process.env.BTC_5M_MAX_POSITION_USDC || '5000'),
    maxOrderShares: parseInt(process.env.BTC_5M_MAX_ORDER_SHARES || '80', 10),
    minEdgeBps: parseInt(process.env.BTC_5M_MIN_EDGE_BPS || '150', 10),
    maxCombinedCost: parseFloat(process.env.BTC_5M_MAX_COMBINED_COST || '0.985'),
    scanIntervalMs: parseInt(process.env.BTC_5M_SCAN_INTERVAL_MS || '500', 10),
    entryStartSec: parseInt(process.env.BTC_5M_ENTRY_START_SEC || '30', 10),
    entryEndSec: parseInt(process.env.BTC_5M_ENTRY_END_SEC || '250', 10),
    maxBookLevels: parseInt(process.env.BTC_5M_MAX_BOOK_LEVELS || '50', 10),

    // Risk
    maxDailyLossUsdc: parseFloat(process.env.BTC_5M_MAX_DAILY_LOSS_USDC || '200'),

    // Safety
    dryRun: process.env.BTC_5M_DRY_RUN !== 'false', // Default true
    killSwitchCheckIntervalMs: parseInt(process.env.KILL_SWITCH_CHECK_INTERVAL || '1000', 10),
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

  if (config.maxCombinedCost >= 1.0) {
    throw new Error('BTC_5M_MAX_COMBINED_COST must be < 1.0');
  }

  if (config.minEdgeBps <= 0) {
    throw new Error('BTC_5M_MIN_EDGE_BPS must be > 0');
  }

  logger.info('Config loaded', {
    dryRun: config.dryRun,
    maxPositionUsdc: config.maxPositionUsdc,
    maxOrderShares: config.maxOrderShares,
    minEdgeBps: config.minEdgeBps,
    maxCombinedCost: config.maxCombinedCost,
    entryStartSec: config.entryStartSec,
    entryEndSec: config.entryEndSec,
    scanIntervalMs: config.scanIntervalMs,
    maxBookLevels: config.maxBookLevels,
  });

  return config;
}
