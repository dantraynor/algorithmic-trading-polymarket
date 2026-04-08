'use client';

import { Panel, StatCell, SectionHeader, DataTable } from '@/components/bloomberg';
import { formatUsd, formatTime } from '@/lib/format';
import { POSITION_COLUMNS, positionToRow } from '@/components/positions/shared';
import type { OpenPosition, TradeEvent } from '@/lib/types';

interface SportsData {
  stats: Record<string, string>;
  portfolio: {
    totalExposure: number;
    peakCapital: number;
    realizedPnl: number;
    dailyLoss: number;
  };
  positions: OpenPosition[];
}

interface Props {
  data: SportsData | null;
  recentTrades: TradeEvent[];
}

const TRADE_COLUMNS = [
  { key: 'market', label: 'Market' },
  { key: 'direction', label: 'Dir' },
  { key: 'pnl', label: 'P&L', align: 'right' as const },
  { key: 'time', label: 'Time', align: 'right' as const },
];

export function SportsSummaryPanel({ data, recentTrades }: Props) {
  if (!data) {
    return (
      <Panel title="SPORTS SIGNALS" live>
        <div className="p-3 text-[11px] text-bb-dim">
          Waiting for sports data...
        </div>
      </Panel>
    );
  }

  const { portfolio, positions } = data;

  const positionRows = positions.map((p) => positionToRow(p, 12));

  const tradeRows = recentTrades.slice(0, 10).map((t, i) => ({
    id: i,
    market: (t.market || 'unknown').slice(0, 12),
    direction: t.direction || '--',
    pnl: formatUsd(t.pnl),
    time: formatTime(t.timestamp, false),
  }));

  return (
    <Panel title="ALPHA SPORTS SIGNALS" live>
      <div className="p-2">
        {/* Portfolio overview */}
        <div className="grid grid-cols-3 gap-x-4 gap-y-2 mb-3">
          <StatCell
            label="Exposure"
            value={`$${portfolio.totalExposure.toFixed(2)}`}
            color="cyan"
          />
          <StatCell
            label="Realized P&L"
            value={formatUsd(portfolio.realizedPnl)}
            color={portfolio.realizedPnl >= 0 ? 'green' : 'red'}
          />
          <StatCell
            label="Daily Loss"
            value={formatUsd(-Math.abs(portfolio.dailyLoss))}
            color={portfolio.dailyLoss > 0 ? 'red' : 'default'}
          />
          <StatCell
            label="Open Positions"
            value={positions.length}
            color="cyan"
          />
          <StatCell
            label="Peak Capital"
            value={`$${portfolio.peakCapital.toFixed(2)}`}
            color="default"
          />
          <StatCell
            label="Games Tracked"
            value={positions.length > 0 ? 'ACTIVE' : 'NONE'}
            color={positions.length > 0 ? 'green' : 'default'}
          />
        </div>

        {/* Open sports positions */}
        <SectionHeader label={`Open Positions (${positions.length})`} />
        {positions.length > 0 ? (
          <DataTable columns={POSITION_COLUMNS} rows={positionRows} />
        ) : (
          <div className="px-2 py-2 text-[11px] text-bb-dim">
            No open sports positions
          </div>
        )}

        {/* Recent trades */}
        {recentTrades.length > 0 && (
          <>
            <SectionHeader label="Recent Trades" />
            <DataTable columns={TRADE_COLUMNS} rows={tradeRows} />
          </>
        )}

        {/* Alpha stats */}
        {Object.keys(data.stats).length > 0 && (
          <>
            <SectionHeader label="Stats" />
            <div className="p-2 grid grid-cols-2 gap-x-4 gap-y-1">
              {Object.entries(data.stats).slice(0, 6).map(([key, val]) => (
                <div key={key} className="flex justify-between text-[11px]">
                  <span className="text-bb-dim">{key}</span>
                  <span className="text-bb-text">{val}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
