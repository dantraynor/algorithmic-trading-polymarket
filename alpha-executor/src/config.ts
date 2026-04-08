export interface AlphaExecutorConfig {
  redisSocketPath: string;
  clobApiUrl: string;
  clobApiKey: string;
  clobApiSecret: string;
  clobPassphrase: string;
  privateKey: string;
  gnosisSafeAddress: string;
  chainId: number;
  ctfExchangeAddress: string;
  negRiskCtfExchangeAddress: string;
  signatureType: number;
  takerFeeBps: number;
  maxOrderShares: number;
  dryRun: boolean;
}

export function loadConfig(): AlphaExecutorConfig {
  return {
    redisSocketPath: process.env.REDIS_SOCKET_PATH || '/var/run/redis/redis.sock',
    clobApiUrl: process.env.CLOB_API_URL || 'https://clob.polymarket.com',
    clobApiKey: process.env.CLOB_API_KEY || '',
    clobApiSecret: process.env.CLOB_API_SECRET || '',
    clobPassphrase: process.env.CLOB_PASSPHRASE || '',
    privateKey: process.env.PRIVATE_KEY || '',
    gnosisSafeAddress: process.env.GNOSIS_SAFE_ADDRESS || '',
    chainId: parseInt(process.env.CHAIN_ID || '137'),
    ctfExchangeAddress: process.env.CTF_EXCHANGE_ADDRESS || '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
    negRiskCtfExchangeAddress: process.env.NEGRIK_CTF_EXCHANGE_ADDRESS || '0xC5d563A36AE78145C45a50134d48A1215220f80a',
    signatureType: parseInt(process.env.SIGNATURE_TYPE || '0'),
    takerFeeBps: parseInt(process.env.TAKER_FEE_BPS || '0'),
    maxOrderShares: parseInt(process.env.ALPHA_MAX_ORDER_SHARES || '80'),
    dryRun: process.env.ALPHA_DRY_RUN === 'true',
  };
}
