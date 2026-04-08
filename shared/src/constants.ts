/**
 * Shared constants for Polymarket trading bot
 */

// Polymarket API Endpoints (configurable via environment)
export const POLYMARKET_WS_URL = process.env.POLYMARKET_WS_URL || 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
export const POLYMARKET_CLOB_URL = process.env.POLYMARKET_CLOB_URL || 'https://clob.polymarket.com';
export const POLYMARKET_GAMMA_URL = process.env.POLYMARKET_GAMMA_URL || 'https://gamma-api.polymarket.com';
export const POLYMARKET_RELAYER_URL = process.env.POLYMARKET_RELAYER_URL || 'https://relayer.polymarket.com';

// Contract Addresses (Polygon Mainnet - configurable via environment for testnet/staging)
export const CTF_EXCHANGE_ADDRESS = process.env.CTF_EXCHANGE_ADDRESS || '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
export const CONDITIONAL_TOKENS_ADDRESS = process.env.CONDITIONAL_TOKENS_ADDRESS || '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
export const USDCE_ADDRESS = process.env.USDCE_ADDRESS || '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
export const NEGRIK_CTF_EXCHANGE = process.env.NEGRIK_CTF_EXCHANGE_ADDRESS || '0xC5d563A36AE78145C45a50134d48A1215220f80a';

// Redis Keys
export const REDIS_KEYS = {
  KILL_SWITCH: 'TRADING_ENABLED',
  SAFE_BALANCE: 'safe:balance:usdce',
  ACTIVE_MARKETS: 'markets:active',
  SCANNER_STATS: 'scanner:stats',
  EXECUTION_STATS: 'execution:stats',
  SETTLEMENT_STATS: 'settlement:stats',
  SAFE_NONCE: 'safe:nonce',
  // Dashboard additions
  INGESTION_STATS: 'ingestion:stats',
  BTC5M_STATS: 'btc5m:stats',
  BTC5M_WINDOW: 'btc5m:window:current',
  BTC5M_TRADING_ENABLED: 'BTC_5M_TRADING_ENABLED',
  BTC5M_MOMENTUM_TRADING_ENABLED: 'BTC_5M_MOMENTUM_TRADING_ENABLED',
  BTC5M_MOMENTUM_STATS: 'btc5m_momentum:stats',
  BTC5M_MOMENTUM_WINDOW: 'btc5m_momentum:window:current',
  TRADES_HISTORY: 'trades:history',
  CONFIG_BTC5M_MAX_POSITION_USDC: 'config:btc5m:max_position_usdc',
  CONFIG_BTC5M_MOMENTUM_MAX_BET_USDC: 'config:btc5m_momentum:max_bet_usdc',
  CONFIG_EXECUTION_MAX_SLIPPAGE: 'config:execution:max_slippage_bps',
} as const;

// Redis Channels
export const REDIS_CHANNELS = {
  ARBITRAGE_SIGNALS: 'signals:arbitrage',
  EXECUTION_RESULTS: 'results:execution',
  SETTLEMENT_RESULTS: 'results:settlement',
  BTC5M_RESULTS: 'results:btc5m',
  BTC5M_MOMENTUM_RESULTS: 'results:btc5m_momentum',
} as const;

// Alpha platform Redis keys
export const ALPHA_SIGNALS_CHANNEL = 'signals:alpha';
export const ALPHA_RESULTS_CHANNEL = 'results:alpha';
export const ALPHA_KILL_SWITCH = 'ALPHA_TRADING_ENABLED';
export const CRYPTO_SIGNALS_ENABLED = 'CRYPTO_SIGNALS_ENABLED';
export const SPORTS_SIGNALS_ENABLED = 'SPORTS_SIGNALS_ENABLED';
export const NCAAM_SIGNALS_ENABLED = 'NCAAM_SIGNALS_ENABLED';
export const ALPHA_STATS_KEY = 'alpha:stats';
export const PORTFOLIO_STATE_KEY = 'portfolio:state';
export const PORTFOLIO_PEAK_KEY = 'portfolio:peak_capital';
export const PORTFOLIO_REALIZED_PNL_KEY = 'portfolio:realized_pnl';
export const PORTFOLIO_DAILY_LOSS_KEY = 'portfolio:daily_loss';
export const PORTFOLIO_DAILY_LOSS_DATE_KEY = 'portfolio:daily_loss_date';
export const POSITIONS_PREFIX = 'positions:open:';
export const POSITIONS_EXPOSURE_KEY = 'positions:total_exposure';
export const POSITIONS_BY_VERTICAL_PREFIX = 'positions:by_vertical:';
export const MARK_PRICE_PREFIX = 'positions:mark_price:';
export const CALIBRATION_PREFIX = 'calibration:';

// Phase thresholds (USD)
export const PHASE_2_THRESHOLD = 10_000;
export const PHASE_3_THRESHOLD = 100_000;

// Order Book Keys
export const ORDER_BOOK_PREFIX = 'ob';

// Trading Constants
export const TRADING_CONSTANTS = {
  MAX_BATCH_SIZE: 15, // 2026 spec update
  SIGNATURE_TYPE_GNOSIS_SAFE: 2,
  ORDER_TYPE_FOK: 'FOK',
  USDC_DECIMALS: 6,
  SHARE_DECIMALS: 6,
} as const;

// Latency Budgets (milliseconds)
export const LATENCY_BUDGET = {
  TICK_ARRIVAL: 4,
  BOOK_UPDATE: 0.1,
  DECISION: 0.05,
  SIGNING: 0.5,
  ORDER_SEND: 8,
  TOTAL_TICK_TO_TRADE: 13,
} as const;

// Safety Thresholds
export const SAFETY_THRESHOLDS = {
  HEARTBEAT_TIMEOUT_SECS: 60,
  BALANCE_DROP_HALT_PERCENT: 10,
  KILL_SWITCH_CHECK_INTERVAL_MS: 100,
  MAX_RECONNECT_ATTEMPTS: 10,
} as const;

// Chain IDs
export const CHAIN_IDS = {
  POLYGON_MAINNET: 137,
  POLYGON_MUMBAI: 80001,
} as const;
