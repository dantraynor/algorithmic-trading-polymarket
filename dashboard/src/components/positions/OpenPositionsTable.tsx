'use client';

import { Panel, DataTable, SectionHeader } from '@/components/bloomberg';
import { formatTime } from '@/lib/format';
import type { OpenPosition } from '@/lib/types';

interface Props {
  positions: OpenPosition[];
  portfolio: {
    totalExposure: number;
    realizedPnl: number;
  } | null;
}

function formatDate(ts: number): string {
  if (!ts) return '--';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}`;
}

const COLUMNS = [
  { key: 'marketId', label: 'Market' },
  { key: 'direction', label: 'Dir' },
  { key: 'shares', label: 'Shares', align: 'right' as const },
  { key: 'entryPrice', label: 'Entry', align: 'right' as const },
  { key: 'entryCost', label: 'Cost', align: 'right' as const },
  { key: 'source', label: 'Source' },
  { key: 'time', label: 'Entry Time', align: 'right' as const },
];

export function OpenPositionsTable({ positions, portfolio }: Props) {
  const rows = positions.map((p) => ({
    id: p.marketId,
    marketId: p.marketId.slice(0, 10) + '...',
    direction: p.direction,
    shares: p.shares.toFixed(2),
    entryPrice: `$${p.entryPrice.toFixed(4)}`,
    entryCost: `$${p.entryCost.toFixed(2)}`,
    source: p.source.toUpperCase(),
    time: formatDate(p.entryTime),
  }));

  // Group by source
  const sourceBreakdown = positions.reduce<Record<string, number>>((acc, p) => {
    acc[p.source] = (acc[p.source] || 0) + 1;
    return acc;
  }, {});

  const totalCost = positions.reduce((sum, p) => sum + p.entryCost, 0);

  return (
    <Panel title={`OPEN POSITIONS (${positions.length})`} live>
      <div className="p-2">
        {/* Summary bar */}
        <div className="flex gap-4 mb-2 text-[11px]">
          <span className="text-bb-dim">
            Total Cost: <span className="text-bb-cyan">${totalCost.toFixed(2)}</span>
          </span>
          {portfolio && (
            <>
              <span className="text-bb-dim">
                Exposure: <span className="text-bb-cyan">${portfolio.totalExposure.toFixed(2)}</span>
              </span>
              <span className="text-bb-dim">
                Realized: <span className={portfolio.realizedPnl >= 0 ? 'text-bb-green' : 'text-bb-red'}>
                  {portfolio.realizedPnl >= 0 ? '+' : ''}${portfolio.realizedPnl.toFixed(2)}
                </span>
              </span>
            </>
          )}
          <span className="text-bb-dim">
            Sources: {Object.entries(sourceBreakdown).map(([s, c]) => `${s}(${c})`).join(' ')}
          </span>
        </div>

        {positions.length > 0 ? (
          <DataTable columns={COLUMNS} rows={rows} />
        ) : (
          <div className="text-[11px] text-bb-dim py-3 text-center">
            No open positions
          </div>
        )}
      </div>
    </Panel>
  );
}
