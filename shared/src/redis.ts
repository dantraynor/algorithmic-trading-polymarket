/**
 * Redis utility functions
 */

import Redis from 'ioredis';
import { REDIS_KEYS } from './constants';

export class RedisUtils {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Check if trading is enabled via global kill switch
   */
  async isTradingEnabled(): Promise<boolean> {
    const value = await this.redis.get(REDIS_KEYS.KILL_SWITCH);
    return value?.toUpperCase() !== 'FALSE';
  }

  /**
   * Set the global kill switch
   */
  async setTradingEnabled(enabled: boolean): Promise<void> {
    await this.redis.set(REDIS_KEYS.KILL_SWITCH, enabled ? 'TRUE' : 'FALSE');
  }

  /**
   * Get Safe USDCe balance
   */
  async getSafeBalance(): Promise<number> {
    const balance = await this.redis.get(REDIS_KEYS.SAFE_BALANCE);
    return parseFloat(balance || '0');
  }

  /**
   * Update Safe USDCe balance
   */
  async updateSafeBalance(balance: number): Promise<void> {
    await this.redis.set(REDIS_KEYS.SAFE_BALANCE, balance.toString());
  }

  /**
   * Get all active market IDs
   */
  async getActiveMarkets(): Promise<string[]> {
    return this.redis.smembers(REDIS_KEYS.ACTIVE_MARKETS);
  }

  /**
   * Add a market to active set
   */
  async addActiveMarket(marketId: string): Promise<void> {
    await this.redis.sadd(REDIS_KEYS.ACTIVE_MARKETS, marketId);
  }

  /**
   * Remove a market from active set
   */
  async removeActiveMarket(marketId: string): Promise<void> {
    await this.redis.srem(REDIS_KEYS.ACTIVE_MARKETS, marketId);
  }

  /**
   * Get market info by ID
   */
  async getMarket(marketId: string): Promise<Record<string, string> | null> {
    const data = await this.redis.hgetall(`market:${marketId}`);
    return Object.keys(data).length > 0 ? data : null;
  }

  /**
   * Store market info
   */
  async setMarket(
    marketId: string,
    yesToken: string,
    noToken: string,
    conditionId: string,
    minOrderSize: number
  ): Promise<void> {
    await this.redis.hset(`market:${marketId}`, {
      yes_token: yesToken,
      no_token: noToken,
      condition_id: conditionId,
      min_order_size: minOrderSize.toString(),
    });
    await this.addActiveMarket(marketId);
  }
}

/**
 * Create Redis client for Unix Domain Socket
 */
export function createRedisClient(socketPath: string): Redis {
  return new Redis(socketPath);
}

/**
 * Create Redis client for TCP connection
 */
export function createRedisTcpClient(host: string, port: number): Redis {
  return new Redis({ host, port });
}
