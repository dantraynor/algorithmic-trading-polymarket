/**
 * Settlement Service Configuration
 */

import dotenv from 'dotenv';
import { logger } from './logger';

dotenv.config();

export interface Config {
  // Redis
  redisSocketPath: string;

  // Wallet & Gnosis Safe
  privateKey: string;
  gnosisSafeAddress: string;
  
  // Polygon Network
  polygonRpcUrl: string;
  chainId: number;

  // Contract Addresses
  ctfExchangeAddress: string;
  usdceAddress: string;
  conditionalTokensAddress: string;

  // Polymarket Relayer
  relayerUrl: string;

  // Service Settings
  scanIntervalMs: number;
  minMergeAmount: number;
  maxGasPrice: bigint;
}

export function loadConfig(): Config {
  return {
    redisSocketPath: process.env.REDIS_SOCKET_PATH || '/var/run/redis/redis.sock',

    privateKey: process.env.PRIVATE_KEY || '',
    gnosisSafeAddress: process.env.GNOSIS_SAFE_ADDRESS || '',

    polygonRpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    chainId: parseInt(process.env.CHAIN_ID || '137', 10),

    // Polymarket Contract Addresses
    ctfExchangeAddress: process.env.CTF_EXCHANGE_ADDRESS || '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E',
    usdceAddress: process.env.USDCE_ADDRESS || '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    conditionalTokensAddress: process.env.CONDITIONAL_TOKENS_ADDRESS || '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045',

    relayerUrl: process.env.RELAYER_URL || 'https://relayer.polymarket.com',

    scanIntervalMs: parseInt(process.env.SCAN_INTERVAL_MS || '5000', 10),
    minMergeAmount: parseFloat(process.env.MIN_MERGE_AMOUNT || '1.0'),
    maxGasPrice: BigInt(process.env.MAX_GAS_PRICE || '100000000000'), // 100 gwei
  };
}
