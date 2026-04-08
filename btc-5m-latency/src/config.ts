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
    ctfExchangeAddress: process.env.CTF_EXCHANGE_ADDRESS || '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
    chainId: parseInt(process.env.CHAIN_ID || '137', 10),

    // Redis
    redisSocketPath: process.env.REDIS_SOCKET_PATH || '/var/run/redis/redis.sock',

    // Exchange feeds
    binanceWsUrl: process.env.BTC_5M_LAT_BINANCE_WS_URL || 'wss://stream.binance.com:9443/ws/btcusdt@trade',
    coinbaseWsUrl: process.env.BTC_5M_LAT_COINBASE_WS_URL || 'wss://ws-feed.exchange.coinbase.com',

    // Chainlink
    chainlinkPollIntervalMs: parseInt(process.env.BTC_5M_LAT_CHAINLINK_POLL_MS || '1000', 10),
    chainlinkRpcUrl: process.env.BTC_5M_LAT_CHAINLINK_RPC_URL || 'https://polygon-bor-rpc.publicnode.com',
    chainlinkAggregator: process.env.BTC_5M_LAT_CHAINLINK_AGGREGATOR || '0xc907E116054Ad103354f2D350FD2514433D57F6f',

    // Strategy
    minEdge: parseFloat(process.env.BTC_5M_LAT_MIN_EDGE || '0.08'),
    minZScore: parseFloat(process.env.BTC_5M_LAT_MIN_ZSCORE || '0.3'),
    edgeBuffer: parseFloat(process.env.BTC_5M_LAT_EDGE_BUFFER || '0.02'),
    kellyMultiplier: parseFloat(process.env.BTC_5M_LAT_KELLY_MULTIPLIER || '0.25'),
    maxPositionPerWindow: parseFloat(process.env.BTC_5M_LAT_MAX_POSITION_PER_WINDOW || '200'),
    volLookbackSec: parseInt(process.env.BTC_5M_LAT_VOL_LOOKBACK_SEC || '300', 10),
    tickAggregationMs: parseInt(process.env.BTC_5M_LAT_TICK_AGGREGATION_MS || '100', 10),
    minTimeRemaining: parseInt(process.env.BTC_5M_LAT_MIN_TIME_REMAINING || '10', 10),
    maxTimeRemaining: parseInt(process.env.BTC_5M_LAT_MAX_TIME_REMAINING || '180', 10),
    maxOrderShares: parseInt(process.env.BTC_5M_LAT_MAX_ORDER_SHARES || '80', 10),

    // Risk
    maxSessionDrawdown: parseFloat(process.env.BTC_5M_LAT_MAX_SESSION_DRAWDOWN || '2000'),
    maxDailyLossUsdc: parseFloat(process.env.BTC_5M_LAT_MAX_DAILY_LOSS_USDC || '1000'),
    trendThreshold: parseFloat(process.env.BTC_5M_LAT_TREND_THRESHOLD || '500'),
    oracleDivergenceLimit: parseFloat(process.env.BTC_5M_LAT_ORACLE_DIVERGENCE_LIMIT || '100'),
    oracleDivergenceDurationMs: parseInt(process.env.BTC_5M_LAT_ORACLE_DIVERGENCE_DURATION_MS || '30000', 10),
    minBookDepthUsdc: parseFloat(process.env.BTC_5M_LAT_MIN_BOOK_DEPTH_USDC || '50'),
    minVolatility: parseFloat(process.env.BTC_5M_LAT_MIN_VOLATILITY || '15'),
    minDelta: parseFloat(process.env.BTC_5M_LAT_MIN_DELTA || '10'),
    maxConsecutiveLosses: parseInt(process.env.BTC_5M_LAT_MAX_CONSECUTIVE_LOSSES || '3', 10),
    streakPauseMinutes: parseInt(process.env.BTC_5M_LAT_STREAK_PAUSE_MINUTES || '30', 10),
    bankroll: parseFloat(process.env.BTC_5M_LAT_BANKROLL || '2500'),

    // Safety
    dryRun: process.env.BTC_5M_LAT_DRY_RUN !== 'false', // Default true
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

  if (config.minEdge <= config.edgeBuffer) {
    throw new Error('BTC_5M_LAT_MIN_EDGE must be > BTC_5M_LAT_EDGE_BUFFER');
  }

  if (config.edgeBuffer <= 0) {
    throw new Error('BTC_5M_LAT_EDGE_BUFFER must be > 0');
  }

  if (config.kellyMultiplier <= 0 || config.kellyMultiplier > 1.0) {
    throw new Error('BTC_5M_LAT_KELLY_MULTIPLIER must be in (0, 1.0]');
  }

  if (config.minTimeRemaining <= 0) {
    throw new Error('BTC_5M_LAT_MIN_TIME_REMAINING must be > 0');
  }

  logger.info('Config loaded', {
    dryRun: config.dryRun,
    minEdge: config.minEdge,
    minZScore: config.minZScore,
    edgeBuffer: config.edgeBuffer,
    kellyMultiplier: config.kellyMultiplier,
    maxPositionPerWindow: config.maxPositionPerWindow,
    bankroll: config.bankroll,
    tickAggregationMs: config.tickAggregationMs,
    chainlinkPollIntervalMs: config.chainlinkPollIntervalMs,
  });

  return config;
}
