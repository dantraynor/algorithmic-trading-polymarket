'use client';

import { Panel, StatCell, SectionHeader } from '@/components/bloomberg';
import { formatUsd } from '@/lib/format';
import type { MomentumDashboardStats } from '@/lib/types';

interface Props {
  stats: MomentumDashboardStats;
}

export function MomentumPanel({ stats }: Props) {
  const pnlColor = stats.dailyProfit >= 0 ? 'green' : 'red';

  const paperBadge = stats.dryRun ? (
    <span className="text-[9px] font-bold px-1 py-0.5 bg-bb-yellow/15 text-bb-yellow border border-bb-yellow/30">
      PAPER
    </span>
  ) : undefined;

  return (
    <Panel title="BTC 5M MOMENTUM" live right={paperBadge}>

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
            label="Volume"
            value={`$${stats.dailyVolume.toFixed(0)}`}
            color="default"
          />
          <StatCell
            label="Consec Losses"
            value={stats.consecutiveLosses}
            color={stats.consecutiveLosses >= 3 ? 'red' : 'default'}
          />
        </div>

        {/* Current window */}
        <SectionHeader label="Current Window" />
        <div className="p-2 grid grid-cols-2 gap-x-4 gap-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-bb-dim">Direction</span>
            <span className={
              stats.windowDirection === 'UP' ? 'text-bb-green'
              : stats.windowDirection === 'DOWN' ? 'text-bb-red'
              : 'text-bb-dim'
            }>
              {stats.windowDirection || 'FLAT'}
            </span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-bb-dim">Delta</span>
            <span className={stats.windowDeltaBps >= 0 ? 'text-bb-green' : 'text-bb-red'}>
              {stats.windowDeltaBps >= 0 ? '+' : ''}{stats.windowDeltaBps.toFixed(0)}bps
            </span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-bb-dim">Traded</span>
            <span className={stats.windowTraded ? 'text-bb-green' : 'text-bb-dim'}>
              {stats.windowTraded ? 'YES' : 'NO'}
            </span>
          </div>
        </div>

        {/* Paper fill quality */}
        <SectionHeader label="Paper Fill Stats" />
        <div className="p-2 grid grid-cols-2 gap-x-4 gap-y-1">
          <div className="flex justify-between text-[11px]">
            <span className="text-bb-dim">Avg Fill</span>
            <span className="text-bb-text">{(stats.avgFillRatio * 100).toFixed(0)}%</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-bb-dim">Avg Slip</span>
            <span className="text-bb-text">{stats.avgSlippageBps.toFixed(1)}bps</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-bb-dim">Partial</span>
            <span className="text-bb-text">{stats.partialFills}</span>
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="text-bb-dim">Missed</span>
            <span className={stats.missedFills > 0 ? 'text-bb-red' : 'text-bb-text'}>
              {stats.missedFills}
            </span>
          </div>
        </div>
      </div>
    </Panel>
  );
}
