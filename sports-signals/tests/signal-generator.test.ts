import { describe, it, expect, beforeEach } from 'vitest';
import { SportsSignalGenerator } from '../src/signal-generator';
import { SportsMarketInfo } from '../src/types';

describe('SportsSignalGenerator', () => {
  let generator: SportsSignalGenerator;

  beforeEach(() => {
    generator = new SportsSignalGenerator({
      minEntryPrice: 0.10,
      maxEntryPrice: 0.95,
      minEdgeBps: 500,
    });
  });

  describe('shouldEmitSignal', () => {
    it('emits when confidence exceeds ask price plus min edge', () => {
      expect(generator.shouldEmitSignal(0.90, 0.80)).toBe(true);
    });

    it('does not emit when edge below minimum', () => {
      // confidence=0.82, ask=0.80, edge=200bps < 500bps
      expect(generator.shouldEmitSignal(0.82, 0.80)).toBe(false);
    });

    it('does not emit when ask outside price range', () => {
      expect(generator.shouldEmitSignal(0.99, 0.98)).toBe(false);
      expect(generator.shouldEmitSignal(0.15, 0.05)).toBe(false);
    });
  });

  describe('createSignal', () => {
    const market: SportsMarketInfo = {
      conditionId: 'cond-123',
      yesTokenId: 'token-home',
      noTokenId: 'token-away',
      homeTeam: 'Lakers',
      awayTeam: 'Celtics',
      league: 'NBA',
      gameId: '401584701',
      slug: 'nba-lakers-celtics',
      negRisk: false,
    };

    it('creates signal with source=sports', () => {
      const signal = generator.createSignal(market, 'YES', 0.90, 0.75, 5000, 300);
      expect(signal.source).toBe('sports');
      expect(signal.marketId).toBe('cond-123');
      expect(signal.tokenId).toBe('token-home');
    });

    it('uses noTokenId for NO direction', () => {
      const signal = generator.createSignal(market, 'NO', 0.85, 0.70, 3000, 300);
      expect(signal.tokenId).toBe('token-away');
    });

    it('sets urgency=seconds for time > 30s', () => {
      const signal = generator.createSignal(market, 'YES', 0.90, 0.75, 5000, 120);
      expect(signal.urgency).toBe('seconds');
      expect(signal.ttlMs).toBe(15000);
    });

    it('sets urgency=minutes for time > 120s', () => {
      const signal = generator.createSignal(market, 'YES', 0.90, 0.75, 5000, 600);
      expect(signal.urgency).toBe('minutes');
      expect(signal.ttlMs).toBe(60000);
    });

    it('includes game metadata', () => {
      const signal = generator.createSignal(market, 'YES', 0.90, 0.75, 5000, 300);
      expect(signal.metadata.gameId).toBe('401584701');
      expect(signal.metadata.league).toBe('NBA');
      expect(signal.metadata.homeTeam).toBe('Lakers');
      expect(signal.metadata.negRisk).toBe(false);
    });
  });
});
