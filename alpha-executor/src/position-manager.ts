import Redis from 'ioredis';
import { createLogger, format, transports } from 'winston';
import { PositionRecord, SignalSource } from '../../shared/src/alpha-types';
import {
  POSITIONS_PREFIX,
  POSITIONS_EXPOSURE_KEY,
  POSITIONS_BY_VERTICAL_PREFIX,
} from '../../shared/src/constants';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

export class PositionManager {
  constructor(private redis: Redis) {}

  async openPosition(pos: PositionRecord): Promise<void> {
    const key = POSITIONS_PREFIX + pos.marketId;
    await this.redis.set(key, JSON.stringify(pos));
    await this.redis.incrbyfloat(POSITIONS_EXPOSURE_KEY, pos.entryCost);
    await this.redis.sadd(POSITIONS_BY_VERTICAL_PREFIX + pos.source, pos.marketId);
    logger.info('Position opened', {
      marketId: pos.marketId, direction: pos.direction,
      shares: pos.shares, entryPrice: pos.entryPrice,
      cost: pos.entryCost, source: pos.source,
    });
  }

  async closePosition(marketId: string): Promise<PositionRecord | null> {
    const key = POSITIONS_PREFIX + marketId;
    const raw = await this.redis.get(key);
    if (!raw) return null;

    const pos: PositionRecord = JSON.parse(raw);
    await this.redis.del(key);
    await this.redis.incrbyfloat(POSITIONS_EXPOSURE_KEY, -pos.entryCost);
    await this.redis.srem(POSITIONS_BY_VERTICAL_PREFIX + pos.source, marketId);
    logger.info('Position closed', { marketId, source: pos.source });
    return pos;
  }

  async getPosition(marketId: string): Promise<PositionRecord | null> {
    const raw = await this.redis.get(POSITIONS_PREFIX + marketId);
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async hasPosition(marketId: string): Promise<boolean> {
    const raw = await this.redis.get(POSITIONS_PREFIX + marketId);
    return raw !== null;
  }

  async getTotalExposure(): Promise<number> {
    const raw = await this.redis.get(POSITIONS_EXPOSURE_KEY);
    return raw ? parseFloat(raw) : 0;
  }

  async getPositionsByVertical(source: SignalSource): Promise<string[]> {
    return this.redis.smembers(POSITIONS_BY_VERTICAL_PREFIX + source);
  }

  async getVerticalExposure(source: SignalSource): Promise<number> {
    const marketIds = await this.getPositionsByVertical(source);
    let total = 0;
    for (const marketId of marketIds) {
      const pos = await this.getPosition(marketId);
      if (pos) total += pos.entryCost;
    }
    return total;
  }

  async getAllOpenPositions(): Promise<PositionRecord[]> {
    const positions: PositionRecord[] = [];
    for (const source of ['crypto', 'sports', 'econ', 'news', 'arbitrage'] as SignalSource[]) {
      const marketIds = await this.getPositionsByVertical(source);
      for (const marketId of marketIds) {
        const pos = await this.getPosition(marketId);
        if (pos) positions.push(pos);
      }
    }
    return positions;
  }
}
