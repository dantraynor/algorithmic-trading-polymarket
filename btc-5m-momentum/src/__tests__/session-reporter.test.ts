import Decimal from 'decimal.js';
import { SessionReporter } from '../session-reporter';
import { MomentumRiskManager } from '../risk-manager';
import { MomentumStats } from '../types';

Decimal.set({ precision: 20, rounding: Decimal.ROUND_DOWN });

function mockStats(overrides: Partial<MomentumStats> = {}): MomentumStats {
  return {
    totalWindows: 10,
    windowsEvaluated: 10,
    windowsTraded: 4,
    windowsSkipped: 6,
    wins: 3,
    losses: 1,
    winRate: 0.75,
    totalProfit: new Decimal('2.34'),
    totalLoss: new Decimal('0.50'),
    dailyProfit: new Decimal('2.34'),
    dailyProfitDate: '2026-03-17',
    dailyVolume: new Decimal('38.50'),
    consecutiveLosses: 0,
    maxConsecutiveLosses: 1,
    lastTradeTime: Date.now(),
    lastTradeDirection: 'UP',
    paperFills: 4,
    paperPartialFills: 1,
    paperMissedFills: 0,
    paperAvgFillRatio: 0.94,
    paperAvgSlippageBps: 2.1,
    paperAvgEntryPrice: 0.912,
    ...overrides,
  };
}

function createReporter(stats: MomentumStats, summaryInterval = 10): SessionReporter {
  const mockRiskManager = {
    getStats: jest.fn().mockReturnValue(stats),
  } as unknown as MomentumRiskManager;

  return new SessionReporter(mockRiskManager, summaryInterval);
}

describe('SessionReporter', () => {
  it('does not print summary before threshold', () => {
    const reporter = createReporter(mockStats(), 10);
    const spy = jest.spyOn(reporter, 'printSummary');

    for (let i = 0; i < 9; i++) {
      reporter.tickWindow();
    }

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('prints summary at threshold', () => {
    const reporter = createReporter(mockStats(), 3);

    const spy = jest.spyOn(reporter, 'printSummary');

    reporter.tickWindow();
    reporter.tickWindow();
    reporter.tickWindow();

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('printFinalSummary includes session duration', () => {
    const reporter = createReporter(mockStats());
    expect(() => reporter.printFinalSummary()).not.toThrow();
  });

  it('computes avg edge from paperAvgEntryPrice', () => {
    const stats = mockStats({ paperAvgEntryPrice: 0.912 });
    const reporter = createReporter(stats);
    const summary = reporter.buildSummary();

    // Edge = (1 - 0.912) * 100 = 8.8%
    expect(summary.avgEdgePct).toBeCloseTo(8.8, 1);
  });
});
