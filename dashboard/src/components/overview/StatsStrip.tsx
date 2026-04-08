'use client';

import { StatCell } from '@/components/bloomberg';
import { formatUsd, formatCount } from '@/lib/format';
import type { CoreStreamState, DashboardStats, ServiceHealth } from '@/lib/types';

interface Props {
  core: CoreStreamState;
  stats: DashboardStats;
  totalExposure?: number;
}

export function StatsStrip({ core, stats, totalExposure = 0 }: Props) {
  // Determine operational phase based on kill switches
  const activeCount = Object.values(core.killSwitches).filter(Boolean).length;
  const phase = activeCount === 0 ? 'IDLE' : activeCount <= 2 ? 'PARTIAL' : 'FULL';
  const phaseColor = phase === 'FULL' ? 'green' : phase === 'PARTIAL' ? 'yellow' : 'red';

  const cells: Array<{
    label: string;
    value: string;
    color: 'green' | 'red' | 'yellow' | 'cyan' | 'default';
  }> = [
    {
      label: 'Balance',
      value: `$${core.balance.toFixed(2)}`,
      color: 'default',
    },
    {
      label: 'Daily P&L',
      value: formatUsd(stats.todayPnl),
      color: stats.todayPnl >= 0 ? 'green' : 'red',
    },
    {
      label: 'Total P&L',
      value: formatUsd(stats.totalPnl),
      color: stats.totalPnl >= 0 ? 'green' : 'red',
    },
    {
      label: 'Win Rate',
      value: `${(stats.winRate * 100).toFixed(0)}%`,
      color: stats.winRate >= 0.5 ? 'green' : 'yellow',
    },
    {
      label: 'Trades',
      value: String(stats.totalTrades),
      color: 'default',
    },
    {
      label: 'Msgs',
      value: formatCount(stats.messagesIngested),
      color: 'cyan',
    },
    {
      label: 'Exposure',
      value: `$${totalExposure.toFixed(0)}`,
      color: totalExposure > core.balance * 0.5 ? 'yellow' : 'default',
    },
    {
      label: 'Phase',
      value: phase,
      color: phaseColor,
    },
  ];

  return (
    <div className="flex items-stretch border border-bb-border bg-bb-panel">
      {cells.map((cell, i) => (
        <div
          key={cell.label}
          className={`flex-1 px-3 py-2 ${
            i < cells.length - 1 ? 'border-r border-bb-border' : ''
          }`}
        >
          <StatCell
            label={cell.label}
            value={cell.value}
            color={cell.color}
          />
        </div>
      ))}
    </div>
  );
}
