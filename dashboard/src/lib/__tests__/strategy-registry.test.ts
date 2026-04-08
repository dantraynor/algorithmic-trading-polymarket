import { describe, it, expect } from 'vitest';
import { STRATEGIES, ALL_STRATEGY_IDS, getStrategy } from '../strategy-registry';
import type { StrategyDefinition } from '../strategy-registry';

describe('STRATEGIES registry', () => {
  it('all strategies have required fields', () => {
    for (const id of ALL_STRATEGY_IDS) {
      const s: StrategyDefinition = STRATEGIES[id];
      expect(s.id).toBe(id);
      expect(s.label).toBeTruthy();
      expect(s.fullName).toBeTruthy();
      expect(s.color).toBeTruthy();
      expect(s.killSwitchKey).toBeTruthy();
      expect(s.statsKey).toBeTruthy();
      expect(s.resultsChannel).toBeTruthy();
      expect(['overview', 'crypto', 'sports']).toContain(s.page);
    }
  });

  it('has no duplicate strategy IDs', () => {
    const ids = ALL_STRATEGY_IDS;
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it('has no duplicate labels', () => {
    const labels = ALL_STRATEGY_IDS.map((id) => STRATEGIES[id].label);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });

  it('getStrategy returns the correct definition', () => {
    const latency = getStrategy('btc-5m-latency');
    expect(latency.id).toBe('btc-5m-latency');
    expect(latency.label).toBe('LATCY');
    expect(latency.page).toBe('crypto');
  });
});

describe('STRATEGIES_BY_PAGE groupings', () => {
  function strategiesByPage(page: string) {
    return ALL_STRATEGY_IDS.filter((id) => STRATEGIES[id].page === page);
  }

  it('overview page has arb strategy', () => {
    const overview = strategiesByPage('overview');
    expect(overview).toContain('arb');
  });

  it('crypto page has BTC and alpha-crypto strategies', () => {
    const crypto = strategiesByPage('crypto');
    expect(crypto).toContain('btc-5m');
    expect(crypto).toContain('btc-5m-latency');
    expect(crypto).toContain('btc-5m-momentum');
    expect(crypto).toContain('alpha-crypto');
  });

  it('sports page has alpha-sports strategy', () => {
    const sports = strategiesByPage('sports');
    expect(sports).toContain('alpha-sports');
  });

  it('every strategy belongs to exactly one page', () => {
    for (const id of ALL_STRATEGY_IDS) {
      const s = STRATEGIES[id];
      expect(['overview', 'crypto', 'sports']).toContain(s.page);
    }
  });
});
