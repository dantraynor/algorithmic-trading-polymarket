/**
 * CryptoSignalGenerator - Converts price momentum into AlphaSignals.
 */

import { v4 as uuidv4 } from 'uuid';
import { AlphaSignal, TradeDirection, SignalUrgency } from '../../shared/src/alpha-types';
import { CryptoMarketInfo } from './market-scanner';

export interface SignalGeneratorConfig {
  /** Minimum ask price to consider (inclusive) */
  minEntryPrice: number;
  /** Maximum ask price to consider (inclusive) */
  maxEntryPrice: number;
  /** Minimum edge between confidence and ask, expressed in basis points */
  minEdgeBps: number;
}

export class CryptoSignalGenerator {
  private config: SignalGeneratorConfig;

  private static readonly K = 0.12;

  constructor(config: SignalGeneratorConfig) {
    this.config = config;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Sigmoid confidence model.
   *
   * confidence = sigmoid(k * deltaBps / sqrt(timeRemainingSeconds + 1))
   *
   * Returns a value in [0.5, 1.0].
   * Larger moves with less time remaining → higher confidence.
   */
  calculateConfidence(deltaBps: number, timeRemainingSeconds: number): number {
    const x = CryptoSignalGenerator.K * deltaBps / Math.sqrt(timeRemainingSeconds + 1);
    const raw = 1 / (1 + Math.exp(-x));
    // sigmoid output is already in (0, 1); clamp to [0.5, 1.0]
    return Math.max(0.5, Math.min(1.0, raw));
  }

  /**
   * Decide whether a signal should be emitted.
   *
   * Conditions:
   *  1. `currentAsk` is within [minEntryPrice, maxEntryPrice]
   *  2. edge = confidence - currentAsk >= minEdgeBps / 10000
   */
  shouldEmitSignal(confidence: number, currentAsk: number): boolean {
    const { minEntryPrice, maxEntryPrice, minEdgeBps } = this.config;

    if (currentAsk < minEntryPrice || currentAsk > maxEntryPrice) {
      return false;
    }

    const edge = confidence - currentAsk;
    return edge >= minEdgeBps / 10000;
  }

  /**
   * Construct an AlphaSignal ready for publishing.
   *
   * @param market               - The CryptoMarketInfo for this window
   * @param direction            - 'YES' (UP) or 'NO' (DOWN)
   * @param confidence           - Confidence score from calculateConfidence()
   * @param currentAsk           - Current best ask for the token
   * @param availableLiquidity   - Dollar liquidity available at the ask
   * @param timeRemainingSeconds - Seconds until window closes
   */
  createSignal(
    market: CryptoMarketInfo,
    direction: TradeDirection,
    confidence: number,
    currentAsk: number,
    availableLiquidity: number,
    timeRemainingSeconds: number,
  ): AlphaSignal {
    const tokenId = direction === 'YES' ? market.upTokenId : market.downTokenId;
    const edge = confidence - currentAsk;

    const urgency: SignalUrgency =
      timeRemainingSeconds < 30
        ? 'immediate'
        : timeRemainingSeconds < 120
          ? 'seconds'
          : 'minutes';

    const ttlMs =
      urgency === 'immediate' ? 500
        : urgency === 'seconds' ? 3_000
          : 60_000;

    return {
      id: uuidv4(),
      source: 'crypto',
      marketId: market.conditionId,
      tokenId,
      direction,
      confidence,
      currentAsk,
      edge,
      availableLiquidity,
      urgency,
      ttlMs,
      resolutionTime: market.windowCloseTimestamp,
      timestampMs: Date.now(),
      metadata: {
        asset: market.asset,
        slug: market.slug,
        windowTimestamp: market.windowTimestamp,
        timeRemainingSeconds,
        negRisk: true,
      },
    };
  }
}
