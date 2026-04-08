/**
 * Merge Service - Position Settlement via Polymarket Relayer
 * 
 * Detects "Box" positions (1.0 YES + 1.0 NO) and merges them back to USDCe
 * Uses Gnosis Safe (Signature Type 2) with gas-less relayer
 */

import { ethers, Contract, Interface } from 'ethers';
import axios from 'axios';
import Redis from 'ioredis';
import { Config } from './config';
import { BoxPosition, MergeRequest, RelayerResponse, SettlementResult } from './types';
import { logger } from './logger';

// Conditional Tokens ABI (minimal for mergePositions)
const CONDITIONAL_TOKENS_ABI = [
  'function mergePositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)',
  'function balanceOf(address owner, uint256 id) view returns (uint256)',
  'function getPositionId(address collateralToken, bytes32 collectionId) view returns (uint256)',
];

// ERC20 ABI for USDCe balance checks
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
];

// Gnosis Safe ABI for nonce queries
const GNOSIS_SAFE_ABI = [
  'function nonce() view returns (uint256)',
];

export class MergeService {
  private config: Config;
  private redis: Redis;
  private provider: ethers.JsonRpcProvider;
  private wallet: ethers.Wallet;
  private conditionalTokens: Contract;
  private usdce: Contract;
  private gnosisSafe: Contract;
  private isRunning: boolean = false;

  constructor(config: Config) {
    this.config = config;
    this.redis = new Redis(config.redisSocketPath);
    this.provider = new ethers.JsonRpcProvider(config.polygonRpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, this.provider);

    this.conditionalTokens = new Contract(
      config.conditionalTokensAddress,
      CONDITIONAL_TOKENS_ABI,
      this.provider
    );

    this.usdce = new Contract(
      config.usdceAddress,
      ERC20_ABI,
      this.provider
    );

    this.gnosisSafe = new Contract(
      config.gnosisSafeAddress,
      GNOSIS_SAFE_ABI,
      this.provider
    );

    logger.info('MergeService initialized', {
      safeAddress: config.gnosisSafeAddress,
      ctfAddress: config.conditionalTokensAddress,
    });
  }

  /**
   * Start the merge service
   */
  async start(): Promise<void> {
    logger.info('Starting Merge Service');
    this.isRunning = true;

    while (this.isRunning) {
      try {
        // Scan for mergeable positions
        const boxPositions = await this.scanForBoxPositions();
        
        for (const box of boxPositions) {
          if (box.mergeableAmount >= BigInt(this.config.minMergeAmount * 1e6)) {
            await this.mergePosition(box);
          }
        }
      } catch (error) {
        logger.error('Merge scan error:', error);
      }

      await this.sleep(this.config.scanIntervalMs);
    }
  }

  /**
   * Stop the merge service
   */
  async stop(): Promise<void> {
    logger.info('Stopping Merge Service');
    this.isRunning = false;
    await this.redis.quit();
  }

  /**
   * Scan for positions that can be merged (YES + NO = 1.0)
   */
  async scanForBoxPositions(): Promise<BoxPosition[]> {
    const boxPositions: BoxPosition[] = [];
    
    // Get all active markets from Redis
    const marketIds = await this.redis.smembers('markets:active');

    for (const marketId of marketIds) {
      const marketKey = `market:${marketId}`;
      const [yesTokenId, noTokenId, conditionId] = await Promise.all([
        this.redis.hget(marketKey, 'yes_token'),
        this.redis.hget(marketKey, 'no_token'),
        this.redis.hget(marketKey, 'condition_id'),
      ]);

      if (!yesTokenId || !noTokenId || !conditionId) continue;

      // Get balances from on-chain
      const [yesBalance, noBalance] = await Promise.all([
        this.getTokenBalance(yesTokenId),
        this.getTokenBalance(noTokenId),
      ]);

      // Calculate mergeable amount (min of both)
      const mergeableAmount = yesBalance < noBalance ? yesBalance : noBalance;

      if (mergeableAmount > 0n) {
        boxPositions.push({
          marketId,
          conditionId,
          yesTokenId,
          noTokenId,
          mergeableAmount,
          remainingYes: yesBalance - mergeableAmount,
          remainingNo: noBalance - mergeableAmount,
        });

        logger.debug(`Found box position in ${marketId}`, {
          mergeableAmount: mergeableAmount.toString(),
        });
      }
    }

    return boxPositions;
  }

  /**
   * Get token balance for the Safe
   */
  private async getTokenBalance(tokenId: string): Promise<bigint> {
    try {
      const balance = await this.conditionalTokens.balanceOf(
        this.config.gnosisSafeAddress,
        tokenId
      );
      return BigInt(balance);
    } catch (error) {
      logger.error(`Failed to get balance for token ${tokenId}:`, error);
      return 0n;
    }
  }

  /**
   * Merge a box position back to USDCe
   */
  async mergePosition(box: BoxPosition): Promise<SettlementResult> {
    const startTime = performance.now();
    
    logger.info(`Merging position for market ${box.marketId}`, {
      amount: box.mergeableAmount.toString(),
    });

    try {
      // Build merge transaction
      const mergeData = this.buildMergeTransaction(box);

      // Submit via Polymarket Relayer
      const response = await this.submitToRelayer(mergeData);

      const elapsed = performance.now() - startTime;

      if (response.success) {
        const result: SettlementResult = {
          success: true,
          marketId: box.marketId,
          mergedAmount: box.mergeableAmount,
          usdceReturned: box.mergeableAmount, // 1:1 in prediction markets
          transactionHash: response.transactionHash,
          latencyMs: elapsed,
        };

        logger.info(`✅ Position merged successfully`, result);
        await this.recordMerge(result);
        return result;
      } else {
        return {
          success: false,
          marketId: box.marketId,
          mergedAmount: 0n,
          usdceReturned: 0n,
          error: response.errorMessage,
          latencyMs: elapsed,
        };
      }
    } catch (error: any) {
      logger.error('Merge failed:', error);
      return {
        success: false,
        marketId: box.marketId,
        mergedAmount: 0n,
        usdceReturned: 0n,
        error: error.message,
        latencyMs: performance.now() - startTime,
      };
    }
  }

  /**
   * Build the mergePositions transaction data
   */
  private buildMergeTransaction(box: BoxPosition): string {
    const iface = new Interface(CONDITIONAL_TOKENS_ABI);
    
    // For binary markets: partition = [1, 2] (YES=1, NO=2)
    const partition = [1, 2];
    const parentCollectionId = ethers.ZeroHash;

    const data = iface.encodeFunctionData('mergePositions', [
      this.config.usdceAddress,
      parentCollectionId,
      box.conditionId,
      partition,
      box.mergeableAmount,
    ]);

    return data;
  }

  /**
   * Submit transaction to Polymarket Relayer for gas-less execution
   */
  private async submitToRelayer(txData: string): Promise<RelayerResponse> {
    try {
      // Sign the meta-transaction for Gnosis Safe
      const signature = await this.signSafeTransaction(txData);

      const response = await axios.post(`${this.config.relayerUrl}/relayer/v2`, {
        safe: this.config.gnosisSafeAddress,
        to: this.config.conditionalTokensAddress,
        data: txData,
        value: '0',
        operation: 0, // CALL
        signature,
      }, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10 second timeout
      });

      if (response.data.success) {
        logger.info(`Relayer transaction submitted: ${response.data.transactionHash}`);
        return {
          success: true,
          transactionHash: response.data.transactionHash,
        };
      } else {
        return {
          success: false,
          errorMessage: response.data.error || 'Unknown relayer error',
        };
      }
    } catch (error: any) {
      logger.error('Relayer submission failed:', error);
      return {
        success: false,
        errorMessage: error.message,
      };
    }
  }

  /**
   * Sign transaction for Gnosis Safe
   */
  private async signSafeTransaction(txData: string): Promise<string> {
    const nonce = await this.getSafeNonce();
    
    const safeTxHash = ethers.solidityPackedKeccak256(
      ['address', 'uint256', 'bytes32', 'uint8', 'uint256'],
      [
        this.config.conditionalTokensAddress,
        0, // value
        ethers.keccak256(txData),
        0, // operation
        nonce,
      ]
    );

    const signature = await this.wallet.signMessage(ethers.getBytes(safeTxHash));
    return signature;
  }

  /**
   * Get current Safe nonce from blockchain
   * Queries the Gnosis Safe contract directly for accurate nonce
   */
  private async getSafeNonce(): Promise<number> {
    try {
      const nonce = await this.gnosisSafe.nonce();
      logger.debug(`Retrieved Safe nonce from blockchain: ${nonce}`);
      return Number(nonce);
    } catch (error) {
      logger.error('Failed to get Safe nonce from blockchain:', error);
      throw new Error('Cannot proceed without valid Safe nonce from blockchain');
    }
  }

  /**
   * Record merge in Redis for stats
   */
  private async recordMerge(result: SettlementResult): Promise<void> {
    await this.redis.hincrby('settlement:stats', 'total_merges', 1);
    await this.redis.hincrbyfloat(
      'settlement:stats',
      'total_usdce_returned',
      Number(result.usdceReturned) / 1e6
    );
    await this.redis.hset('settlement:stats', 'last_merge_ms', Date.now());

    // Publish and persist merge result for dashboard
    const tradeEvent = JSON.stringify({
      strategy: 'settlement',
      market: result.marketId,
      usdceReturned: Number(result.usdceReturned) / 1e6,
      pnl: Number(result.usdceReturned) / 1e6,
      timestamp: Date.now(),
    });
    await this.redis.publish('results:settlement', tradeEvent);
    await this.redis.lpush('trades:history', tradeEvent);
    await this.redis.ltrim('trades:history', 0, 999);
  }

  /**
   * Get current USDCe balance of the Safe
   */
  async getSafeBalance(): Promise<bigint> {
    const balance = await this.usdce.balanceOf(this.config.gnosisSafeAddress);
    return BigInt(balance);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
