/**
 * Session Reporter - Periodic and shutdown summaries for paper trading.
 * Reads stats from MomentumRiskManager, formats and logs summaries.
 */

import { MomentumRiskManager } from './risk-manager';
import { logger } from './logger';

export interface SummaryData {
  windowsEvaluated: number;
  windowsTraded: number;
  windowsSkipped: number;
  wins: number;
  losses: number;
  winRate: number;
  dailyProfit: string;
  dailyVolume: string;
  avgEdgePct: number;
  avgFillRatio: number;
  partialFills: number;
  missedFills: number;
  avgSlippageBps: number;
  avgEntryPrice: number;
}

export class SessionReporter {
  private riskManager: MomentumRiskManager;
  private summaryInterval: number;
  private windowCounter: number = 0;
  private sessionStartTime: number;

  constructor(riskManager: MomentumRiskManager, summaryInterval: number = 10) {
    this.riskManager = riskManager;
    this.summaryInterval = summaryInterval;
    this.sessionStartTime = Date.now();
  }

  tickWindow(): void {
    this.windowCounter++;
    if (this.windowCounter >= this.summaryInterval) {
      this.printSummary();
      this.windowCounter = 0;
    }
  }

  buildSummary(): SummaryData {
    const stats = this.riskManager.getStats();
    const avgEdgePct = stats.paperAvgEntryPrice > 0
      ? (1 - stats.paperAvgEntryPrice) * 100
      : 0;

    return {
      windowsEvaluated: stats.windowsEvaluated,
      windowsTraded: stats.windowsTraded,
      windowsSkipped: stats.windowsSkipped,
      wins: stats.wins,
      losses: stats.losses,
      winRate: stats.winRate,
      dailyProfit: stats.dailyProfit.toFixed(2),
      dailyVolume: stats.dailyVolume.toFixed(2),
      avgEdgePct,
      avgFillRatio: stats.paperAvgFillRatio,
      partialFills: stats.paperPartialFills,
      missedFills: stats.paperMissedFills,
      avgSlippageBps: stats.paperAvgSlippageBps,
      avgEntryPrice: stats.paperAvgEntryPrice,
    };
  }

  printSummary(): void {
    const s = this.buildSummary();
    const elapsed = this.formatDuration(Date.now() - this.sessionStartTime);

    logger.info([
      `=== Paper Trading Summary (${elapsed}) ===`,
      `Windows: ${s.windowsEvaluated} evaluated, ${s.windowsTraded} traded, ${s.windowsSkipped} skipped`,
      `Record: ${s.wins}W / ${s.losses}L (${(s.winRate * 100).toFixed(1)}% win rate)`,
      `P&L: ${parseFloat(s.dailyProfit) >= 0 ? '+' : ''}$${s.dailyProfit} | Volume: $${s.dailyVolume}`,
      `Avg edge: ${s.avgEdgePct.toFixed(1)}% | Avg fill ratio: ${(s.avgFillRatio * 100).toFixed(0)}%`,
      `Partial fills: ${s.partialFills} | Missed fills: ${s.missedFills}`,
      `=========================================`,
    ].join('\n'));
  }

  printFinalSummary(): void {
    const s = this.buildSummary();
    const elapsed = this.formatDuration(Date.now() - this.sessionStartTime);

    logger.info([
      `=== Final Paper Trading Report ===`,
      `Session duration: ${elapsed}`,
      `Windows: ${s.windowsEvaluated} evaluated, ${s.windowsTraded} traded, ${s.windowsSkipped} skipped`,
      `Record: ${s.wins}W / ${s.losses}L (${(s.winRate * 100).toFixed(1)}% win rate)`,
      `Session P&L: ${parseFloat(s.dailyProfit) >= 0 ? '+' : ''}$${s.dailyProfit} | Volume: $${s.dailyVolume}`,
      `Avg entry price: $${s.avgEntryPrice.toFixed(3)} | Avg edge: ${s.avgEdgePct.toFixed(1)}%`,
      `Fill quality: ${(s.avgFillRatio * 100).toFixed(0)}% avg ratio, ${s.avgSlippageBps.toFixed(1)} bps avg slippage`,
      `Partial fills: ${s.partialFills} | Missed fills: ${s.missedFills}`,
      `===================================`,
    ].join('\n'));
  }

  private formatDuration(ms: number): string {
    const totalMin = Math.floor(ms / 60000);
    if (totalMin < 60) return `${totalMin}min`;
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    return `${hours}h ${mins}m`;
  }
}
