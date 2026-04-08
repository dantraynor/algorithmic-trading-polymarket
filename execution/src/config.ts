import dotenv from 'dotenv';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { logger } from './logger';

dotenv.config();

export interface Config {
  // Polymarket CLOB API
  clobApiUrl: string;
  clobApiKey: string;
  clobApiSecret: string;
  clobPassphrase: string;

  // Wallet & Signing
  privateKey: string;
  gnosisSafeAddress: string;
  signatureType: number; // 2 for Gnosis Safe
  ctfExchangeAddress: string;
  negRiskCtfExchangeAddress: string;

  // Redis
  redisSocketPath: string;
  signalChannel: string;

  // Execution parameters
  maxBatchSize: number; // 15 orders max per 2026 spec
  orderType: string; // FOK
  maxPositionSize: number;
  minProfitThreshold: number;

  // Safety
  killSwitchCheckInterval: number;
  maxSlippageBps: number;

  // Network
  chainId: number;
  polygonRpcUrl: string;

  // GCP
  gcpProjectId: string;
}

const secretManagerClient = new SecretManagerServiceClient();

async function getSecret(secretName: string, projectId: string): Promise<string> {
  try {
    const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
    const [version] = await secretManagerClient.accessSecretVersion({ name });

    const payload = version.payload?.data;
    if (!payload) {
      throw new Error(`Secret ${secretName} has no payload`);
    }

    return payload.toString();
  } catch (error) {
    logger.error(`Failed to fetch secret ${secretName}:`, error);
    throw error;
  }
}

export async function loadConfig(): Promise<Config> {
  // Load secrets from GCP Secret Manager in production
  const useSecretManager = process.env.USE_SECRET_MANAGER === 'true';
  const gcpProjectId = process.env.GCP_PROJECT_ID || '';

  let privateKey: string;
  let clobApiKey: string;
  let clobApiSecret: string;
  let clobPassphrase: string;

  if (useSecretManager) {
    logger.info('Loading secrets from GCP Secret Manager');
    const secretName = process.env.SECRET_NAME || 'tradingbot-credentials';
    const secrets = JSON.parse(await getSecret(secretName, gcpProjectId));
    privateKey = secrets.privateKey;
    clobApiKey = secrets.clobApiKey;
    clobApiSecret = secrets.clobApiSecret;
    clobPassphrase = secrets.clobPassphrase;
  } else {
    logger.warn('Using environment variables for secrets (not recommended for production)');
    privateKey = process.env.PRIVATE_KEY || '';
    clobApiKey = process.env.CLOB_API_KEY || '';
    clobApiSecret = process.env.CLOB_API_SECRET || '';
    clobPassphrase = process.env.CLOB_PASSPHRASE || '';
  }

  return {
    clobApiUrl: process.env.CLOB_API_URL || 'https://clob.polymarket.com',
    clobApiKey,
    clobApiSecret,
    clobPassphrase,

    privateKey,
    gnosisSafeAddress: process.env.GNOSIS_SAFE_ADDRESS || '',
    signatureType: parseInt(process.env.SIGNATURE_TYPE || '0', 10), // 0 = EOA, 2 = Gnosis Safe
    ctfExchangeAddress: process.env.CTF_EXCHANGE_ADDRESS || '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
    negRiskCtfExchangeAddress: process.env.NEGRIK_CTF_EXCHANGE_ADDRESS || '0xC5d563A36AE78145C45a50134d48A1215220f80a',

    redisSocketPath: process.env.REDIS_SOCKET_PATH || '/var/run/redis/redis.sock',
    signalChannel: process.env.SIGNAL_CHANNEL || 'signals:arbitrage',

    maxBatchSize: parseInt(process.env.MAX_BATCH_SIZE || '15', 10),
    orderType: 'FOK', // Fill or Kill
    maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || '1000'),
    minProfitThreshold: parseFloat(process.env.MIN_PROFIT_THRESHOLD || '0.50'),

    killSwitchCheckInterval: parseInt(process.env.KILL_SWITCH_CHECK_INTERVAL || '100', 10),
    maxSlippageBps: parseInt(process.env.MAX_SLIPPAGE_BPS || '50', 10), // 0.5%

    chainId: parseInt(process.env.CHAIN_ID || '137', 10), // Polygon mainnet
    polygonRpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',

    gcpProjectId,
  };
}
