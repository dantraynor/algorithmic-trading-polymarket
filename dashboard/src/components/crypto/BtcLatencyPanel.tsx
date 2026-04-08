'use client';

import { Panel, StatCell, SectionHeader } from '@/components/bloomberg';
import { formatUsd, formatTime } from '@/lib/format';
import type { StrategyStats, BtcWindow } from '@/lib/types';

interface Props {
  stats: StrategyStats;
  window: BtcWindow | null;
  config?: {
    dryRun?: boolean;
    minEdge?: number;
    bankroll?: number;
    maxPositionPerWindow?: number;
  };
}

export function BtcLatencyPanel({ stats, window: win, config }: Props) {
  const pnlColor = stats.dailyProfit >= 0 ? 'green' : 'red';

  return (
    <Panel title="BTC 5M LATENCY ARB" live>
      <div className="p-2">
        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-x-4 gap-y-2 mb-3">
          <StatCell label="Wins" value={stats.wins} color="green" />
          <StatCell label="Losses" value={stats.losses} color="red" />
          <StatCell
            label="Win Rate"
            value={`${(stats.winRate * 100).toFixed(1)}%`}
            color={stats.winRate >= 0.5 ? 'green' : 'red'}
          />
          <StatCell
            label="Daily P&L"
            value={formatUsd(stats.dailyProfit)}
            color={pnlColor}
            size="lg"
          />
          <StatCell
            label="Session P&L"
            value={formatUsd(stats.totalPnl)}
            color={stats.totalPnl >= 0 ? 'green' : 'red'}
          />
          <StatCell
            label="Consec Losses"
            value={stats.consecutiveLosses}
            color={stats.consecutiveLosses >= 3 ? 'red' : 'default'}
          />
        </div>

        {/* Current window */}
        <SectionHeader label="Current Window" />
        <div className="p-2">
          {win ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-bb-dim">Time</span>
                <span className="text-bb-text">{formatTime(win.timestamp)}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-bb-dim">Direction</span>
                <span className={win.direction === 'UP' ? 'text-bb-green' : win.direction === 'DOWN' ? 'text-bb-red' : 'text-bb-dim'}>
                  {win.direction}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-bb-dim">Open Price</span>
                <span className="text-bb-text">${win.openPrice.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-bb-dim">Confidence</span>
                <span className="text-bb-yellow">{(win.confidence * 100).toFixed(1)}%</span>
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-bb-dim py-1">No active window</div>
          )}
        </div>

        {/* Config */}
        {config && (
          <>
            <SectionHeader label="Config" />
            <div className="p-2 grid grid-cols-2 gap-x-4 gap-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-bb-dim">Mode</span>
                <span className={config.dryRun ? 'text-bb-yellow' : 'text-bb-green'}>
                  {config.dryRun ? 'PAPER' : 'LIVE'}
                </span>
              </div>
              {config.minEdge != null && (
                <div className="flex justify-between text-[11px]">
                  <span className="text-bb-dim">Min Edge</span>
                  <span className="text-bb-text">{config.minEdge}bps</span>
                </div>
              )}
              {config.bankroll != null && (
                <div className="flex justify-between text-[11px]">
                  <span className="text-bb-dim">Bankroll</span>
                  <span className="text-bb-text">${config.bankroll.toFixed(0)}</span>
                </div>
              )}
              {config.maxPositionPerWindow != null && (
                <div className="flex justify-between text-[11px]">
                  <span className="text-bb-dim">Max Pos/Win</span>
                  <span className="text-bb-text">${config.maxPositionPerWindow.toFixed(0)}</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer: total trades / last trade */}
        <div className="border-t border-bb-border mt-2 pt-1 px-1 flex justify-between text-[10px] text-bb-dim">
          <span>{stats.totalTrades} total trades</span>
          <span>Last: {stats.lastTradeTime ? formatTime(stats.lastTradeTime) : 'never'}</span>
        </div>
      </div>
    </Panel>
  );
}
