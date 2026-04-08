'use client';

import { Panel, StatCell, SectionHeader, DataTable } from '@/components/bloomberg';
import { formatUsd } from '@/lib/format';
import { POSITION_COLUMNS, positionToRow } from '@/components/positions/shared';
import type { AlphaStreamState } from '@/lib/types';

interface Props {
  alpha: AlphaStreamState | null;
}

export function AlphaCryptoPanel({ alpha }: Props) {
  if (!alpha) {
    return (
      <Panel title="ALPHA CRYPTO" live>
        <div className="p-2 text-[11px] text-bb-dim">Waiting for data...</div>
      </Panel>
    );
  }

  const { portfolio, positions, stats } = alpha;
  const cryptoPositions = positions.filter((p) => p.source === 'crypto');

  // Determine phase based on exposure/capital
  const exposureRatio = portfolio.peakCapital > 0
    ? portfolio.totalExposure / portfolio.peakCapital
    : 0;
  const phase = exposureRatio > 0.8 ? 'FULL' : exposureRatio > 0.4 ? 'ACTIVE' : exposureRatio > 0 ? 'SCALING' : 'IDLE';

  const positionRows = cryptoPositions.map((p) => positionToRow(p));

  return (
    <Panel title="ALPHA CRYPTO SIGNALS" live>
      <div className="p-2">
        {/* Portfolio state */}
        <div className="grid grid-cols-3 gap-x-4 gap-y-2 mb-3">
          <StatCell
            label="Phase"
            value={phase}
            color={phase === 'IDLE' ? 'default' : phase === 'FULL' ? 'yellow' : 'green'}
          />
          <StatCell
            label="Exposure"
            value={`$${portfolio.totalExposure.toFixed(2)}`}
            color="cyan"
          />
          <StatCell
            label="Peak Capital"
            value={`$${portfolio.peakCapital.toFixed(2)}`}
            color="default"
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
            value={cryptoPositions.length}
            color="cyan"
          />
        </div>

        {/* Alpha stats summary */}
        {Object.keys(stats).length > 0 && (
          <>
            <SectionHeader label="Stats" />
            <div className="p-2 grid grid-cols-2 gap-x-4 gap-y-1">
              {Object.entries(stats).slice(0, 6).map(([key, val]) => (
                <div key={key} className="flex justify-between text-[11px]">
                  <span className="text-bb-dim">{key}</span>
                  <span className="text-bb-text">{val}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Open crypto positions table */}
        {cryptoPositions.length > 0 && (
          <>
            <SectionHeader label={`Crypto Positions (${cryptoPositions.length})`} />
            <DataTable columns={POSITION_COLUMNS} rows={positionRows} />
          </>
        )}

        {cryptoPositions.length === 0 && (
          <div className="text-[10px] text-bb-dim px-1 mt-2">No open crypto positions</div>
        )}
      </div>
    </Panel>
  );
}
