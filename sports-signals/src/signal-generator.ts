import { v4 as uuidv4 } from 'uuid';
import { createLogger, format, transports } from 'winston';
import { AlphaSignal, TradeDirection } from '../../shared/src/alpha-types';
import { SportsMarketInfo, GameScore } from './types';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

export interface SignalGeneratorConfig {
  minEntryPrice: number;
  maxEntryPrice: number;
  minEdgeBps: number;
}

export interface NcaaSignalGeneratorConfig {
  minEntryPrice: number;
  maxEntryPrice: number;
  minEdgeBps: number;
  minTimeRemainingSec: number;
  scoreStaleMs: number;
}

export class SportsSignalGenerator {
  constructor(private config: SignalGeneratorConfig) {}

  shouldEmitSignal(confidence: number, currentAsk: number): boolean {
    if (currentAsk < this.config.minEntryPrice || currentAsk > this.config.maxEntryPrice) {
      return false;
    }
    const edgeBps = (confidence - currentAsk) * 10_000;
    return edgeBps >= this.config.minEdgeBps;
  }

  createSignal(
    market: SportsMarketInfo,
    direction: TradeDirection,
    confidence: number,
    currentAsk: number,
    availableLiquidity: number,
    timeRemainingSeconds: number,
  ): AlphaSignal {
    const tokenId = direction === 'YES' ? market.yesTokenId : market.noTokenId;

    let urgency: 'immediate' | 'seconds' | 'minutes';
    let ttlMs: number;

    if (timeRemainingSeconds <= 30) {
      urgency = 'immediate';
      ttlMs = 15000; // 15s — sports scores update every 5-10s
    } else if (timeRemainingSeconds <= 120) {
      urgency = 'seconds';
      ttlMs = 15000;
    } else {
      urgency = 'minutes';
      ttlMs = 60000;
    }

    logger.debug('Creating sports signal', {
      market: market.conditionId,
      direction,
      confidence,
      currentAsk,
      urgency,
    });

    return {
      id: uuidv4(),
      source: 'sports',
      marketId: market.conditionId,
      tokenId,
      direction,
      confidence,
      currentAsk,
      edge: confidence - currentAsk,
      availableLiquidity,
      urgency,
      ttlMs,
      timestampMs: Date.now(),
      resolutionTime: Math.floor(Date.now() / 1000) + Math.ceil(timeRemainingSeconds),
      metadata: {
        gameId: market.gameId,
        league: market.league,
        homeTeam: market.homeTeam,
        awayTeam: market.awayTeam,
        negRisk: market.negRisk,
        timeRemainingSeconds,
      },
    };
  }
}

// ── NCAA Signal Generator ─────────────────────────────────────────────

/**
 * NCAA-specific signal generator with dynamic edge threshold,
 * time cutoff, and score freshness guard.
 */
export class NcaaSportsSignalGenerator {
  constructor(private config: NcaaSignalGeneratorConfig) {}

  /**
   * Dynamic edge threshold for NCAA: increases as game progresses.
   * 5% at tipoff -> 15% at 4 min remaining.
   *
   * Formula: requiredEdge = 0.05 + ((2400 - timeRemainingSec) / 2160)^2 * 0.10
   * At tipoff (2400s): 0.05 + 0 = 0.05 (5%)
   * At 4 min (240s): 0.05 + 1.0 * 0.10 = 0.15 (15%)
   */
  calculateRequiredEdge(timeRemainingSec: number): number {
    const totalGameSec = 2400; // 40 minutes
    const minTimeSec = this.config.minTimeRemainingSec; // 240s = 4 min
    const usableRange = totalGameSec - minTimeSec; // 2160s

    const elapsed = Math.max(0, Math.min(usableRange, totalGameSec - timeRemainingSec));
    const progress = elapsed / usableRange;

    return 0.05 + Math.pow(progress, 2) * 0.10;
  }

  /**
   * Check if a signal should be emitted for an NCAA game.
   * Applies: price bounds, dynamic edge threshold, time cutoff, score freshness.
   */
  shouldEmitSignal(
    confidence: number,
    currentAsk: number,
    timeRemainingSec: number,
    game: GameScore,
  ): { emit: boolean; reason?: string } {
    // Price bounds
    if (currentAsk < this.config.minEntryPrice || currentAsk > this.config.maxEntryPrice) {
      return { emit: false, reason: 'price_out_of_range' };
    }

    // No entries below 4 minutes (240 seconds)
    if (timeRemainingSec < this.config.minTimeRemainingSec) {
      return { emit: false, reason: 'below_time_cutoff' };
    }

    // Score freshness guard: reject if score data is stale (> 15s)
    const staleness = Date.now() - game.lastUpdated;
    if (staleness > this.config.scoreStaleMs) {
      return { emit: false, reason: 'stale_score' };
    }

    // Dynamic edge threshold
    const requiredEdge = this.calculateRequiredEdge(timeRemainingSec);
    const actualEdge = confidence - currentAsk;

    if (actualEdge < requiredEdge) {
      return { emit: false, reason: 'insufficient_edge' };
    }

    // Also check minimum edge in bps
    const edgeBps = actualEdge * 10_000;
    if (edgeBps < this.config.minEdgeBps) {
      return { emit: false, reason: 'below_min_edge_bps' };
    }

    return { emit: true };
  }

  /**
   * Create an NCAA signal. Delegates to the same AlphaSignal format.
   */
  createSignal(
    market: SportsMarketInfo,
    direction: TradeDirection,
    confidence: number,
    currentAsk: number,
    availableLiquidity: number,
    timeRemainingSeconds: number,
    pregameSpread?: number,
  ): AlphaSignal {
    const tokenId = direction === 'YES' ? market.yesTokenId : market.noTokenId;

    let urgency: 'immediate' | 'seconds' | 'minutes';
    let ttlMs: number;

    if (timeRemainingSeconds <= 60) {
      urgency = 'immediate';
      ttlMs = 10000; // 10s — NCAA games move fast near end
    } else if (timeRemainingSeconds <= 300) {
      urgency = 'seconds';
      ttlMs = 15000;
    } else {
      urgency = 'minutes';
      ttlMs = 45000; // Shorter TTL than NBA — NCAA halves are only 20 min
    }

    logger.debug('Creating NCAA sports signal', {
      market: market.conditionId,
      direction,
      confidence,
      currentAsk,
      urgency,
      timeRemainingSeconds,
      pregameSpread,
    });

    return {
      id: uuidv4(),
      source: 'sports',
      marketId: market.conditionId,
      tokenId,
      direction,
      confidence,
      currentAsk,
      edge: confidence - currentAsk,
      availableLiquidity,
      urgency,
      ttlMs,
      timestampMs: Date.now(),
      resolutionTime: Math.floor(Date.now() / 1000) + Math.ceil(timeRemainingSeconds),
      metadata: {
        gameId: market.gameId,
        league: market.league,
        homeTeam: market.homeTeam,
        awayTeam: market.awayTeam,
        negRisk: market.negRisk,
        timeRemainingSeconds,
        pregameSpread,
      },
    };
  }
}
