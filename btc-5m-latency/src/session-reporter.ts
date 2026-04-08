/**
 * Session Reporter - Periodic and shutdown summaries for latency arb paper trading.
 */

import { LatencyRiskManager } from './risk-manager';
import { logger } from './logger';

export class SessionReporter {
  private riskManager: LatencyRiskManager;
  private summaryInterval: number;
  private windowCounter: number = 0;
  private sessionStartTime: number;

  constructor(riskManager: LatencyRiskManager, summaryInterval: number = 10) {
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

  printSummary(): void {
    const stats = this.riskManager.getStats();
    const elapsed = this.formatDuration(Date.now() - this.sessionStartTime);

    logger.info([
      `=== Latency Arb Summary (${elapsed}) ===`,
      `Windows: ${stats.totalWindows} total, ${stats.windowsTraded} traded, ${stats.windowsSkipped} skipped`,
      `Record: ${stats.wins}W / ${stats.losses}L (${(stats.winRate * 100).toFixed(1)}% win rate)`,
      `P&L: session ${stats.sessionPnl.gte(0) ? '+' : ''}$${stats.sessionPnl.toFixed(2)} | daily ${stats.dailyProfit.gte(0) ? '+' : ''}$${stats.dailyProfit.toFixed(2)}`,
      `Trades: ${stats.totalTrades} total | Avg edge: ${stats.avgEdgeAtFill.mul(100).toFixed(2)}%`,
      `Volume: $${stats.dailyVolume.toFixed(2)} | Oracle divergence events: ${stats.oracleDivergenceEvents}`,
      `Paper: ${stats.paperFills} fills, ${stats.paperPartialFills} partial, ${stats.paperMissedFills} missed`,
      `=========================================`,
    ].join('\n'));
  }

  printFinalSummary(): void {
    const stats = this.riskManager.getStats();
    const elapsed = this.formatDuration(Date.now() - this.sessionStartTime);

    logger.info([
      `=== Final Latency Arb Report ===`,
      `Session duration: ${elapsed}`,
      `Windows: ${stats.totalWindows} total, ${stats.windowsTraded} traded, ${stats.windowsSkipped} skipped`,
      `Record: ${stats.wins}W / ${stats.losses}L (${(stats.winRate * 100).toFixed(1)}% win rate)`,
      `Session P&L: ${stats.sessionPnl.gte(0) ? '+' : ''}$${stats.sessionPnl.toFixed(2)}`,
      `Daily P&L: ${stats.dailyProfit.gte(0) ? '+' : ''}$${stats.dailyProfit.toFixed(2)} | Volume: $${stats.dailyVolume.toFixed(2)}`,
      `Total trades: ${stats.totalTrades} | Avg edge at fill: ${stats.avgEdgeAtFill.mul(100).toFixed(2)}%`,
      `Max consecutive losses: ${stats.maxConsecutiveLosses}`,
      `Oracle divergence events: ${stats.oracleDivergenceEvents}`,
      `Paper fill quality: ${(stats.paperAvgFillRatio * 100).toFixed(0)}% avg ratio, ${stats.paperAvgSlippageBps.toFixed(1)} bps avg slippage`,
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
