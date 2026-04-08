'use client';

import { useState, useEffect } from 'react';
import { SportsSummaryPanel } from '@/components/sports/SportsSummaryPanel';
import { Panel, StatCell } from '@/components/bloomberg';
import { formatUsd, formatPnl } from '@/lib/format';
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

export default function SportsPage() {
  const [data, setData] = useState<SportsData | null>(null);
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/stream/sports');

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.addEventListener('sports_data', (event) => {
      try {
        setData(JSON.parse(event.data));
      } catch {
        // Ignore parse errors
      }
    });

    es.addEventListener('trade_event', (event) => {
      try {
        const { trade } = JSON.parse(event.data);
        setTrades((prev) => [trade, ...prev].slice(0, 50));
      } catch {
        // Ignore parse errors
      }
    });

    return () => es.close();
  }, []);

  const exposure = data?.portfolio.totalExposure ?? 0;
  const positions = data?.positions ?? [];
  const realizedPnl = data?.portfolio.realizedPnl ?? 0;

  return (
    <div className="p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-bold text-bb-purple tracking-wider">SPORTS</span>
          <span className="text-[10px] text-bb-dim">Alpha Sports Signals</span>
        </div>
        <div className="flex items-center gap-3">
          {!connected && (
            <span className="text-[10px] text-bb-yellow">RECONNECTING...</span>
          )}
          <span className="text-[10px] text-bb-dim">
            {positions.length} active position{positions.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Summary bar */}
      <div className="border border-bb-border bg-bb-panel p-2 mb-3">
        <div className="grid grid-cols-4 gap-x-4">
          <StatCell
            label="Exposure"
            value={`$${exposure.toFixed(2)}`}
            color="cyan"
          />
          <StatCell
            label="Realized P&L"
            value={formatUsd(realizedPnl)}
            color={realizedPnl >= 0 ? 'green' : 'red'}
          />
          <StatCell
            label="Open Positions"
            value={positions.length}
            color="cyan"
          />
          <StatCell
            label="Status"
            value={positions.length > 0 ? 'ACTIVE' : 'IDLE'}
            color={positions.length > 0 ? 'green' : 'default'}
          />
        </div>
      </div>

      {/* Main content */}
      <div className="grid grid-cols-2 gap-3">
        <SportsSummaryPanel data={data} recentTrades={trades} />

        <div className="flex flex-col gap-3">
          {/* Sports info panel */}
          <Panel title="SPORTS VERTICAL INFO">
            <div className="p-3">
              <div className="text-[11px] text-bb-dim leading-relaxed">
                <p className="mb-2">
                  The sports vertical monitors Polymarket sports prediction markets
                  for alpha opportunities. Signals are generated from the alpha-executor
                  pipeline when favorable odds are detected.
                </p>
                <div className="border-t border-bb-border pt-2 mt-2 grid grid-cols-2 gap-2">
                  <div className="flex justify-between">
                    <span className="text-bb-dim">Signal Source</span>
                    <span className="text-bb-text">alpha-executor</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-bb-dim">Vertical</span>
                    <span className="text-bb-purple">sports</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-bb-dim">Kill Switch</span>
                    <span className="text-bb-text">ALPHA_TRADING_ENABLED</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-bb-dim">Channel</span>
                    <span className="text-bb-text">results:alpha</span>
                  </div>
                </div>
              </div>
            </div>
          </Panel>

          {/* Recent trades */}
          {trades.length > 0 && (
            <Panel title="RECENT SPORTS TRADES" live>
              <div className="max-h-[200px] overflow-y-auto log-scroll">
                {trades.map((t, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-2 py-0.5 text-[10px] border-b border-bb-border/20"
                  >
                    <span className="text-bb-muted w-16 shrink-0">
                      {new Date(t.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                    </span>
                    <span className="text-bb-text truncate flex-1">
                      {t.market || 'unknown'}
                    </span>
                    <span className={`tabular-nums ${(t.pnl ?? 0) >= 0 ? 'text-bb-green' : 'text-bb-red'}`}>
                      {formatPnl(t.pnl ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}

          {trades.length === 0 && (
            <Panel title="RECENT SPORTS TRADES">
              <div className="p-3 text-[11px] text-bb-dim text-center">
                No recent sports trades
              </div>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
