'use client';

import { Panel } from '@/components/bloomberg';
import { num, formatPnl, timeAgo } from '@/lib/format';
import { STRATEGIES, type StrategyId } from '@/lib/strategy-registry';
import type { TradeEvent } from '@/lib/types';

/** Resolve strategy display label and color from the registry */
function resolveStrategy(raw: string): { label: string; color: string } {
  // Try direct registry lookup
  if (raw in STRATEGIES) {
    const def = STRATEGIES[raw as StrategyId];
    return { label: def.label, color: def.color };
  }
  // Legacy name mapping
  if (raw === 'arbitrage' || raw === 'arb') return { label: 'ARB', color: 'text-bb-cyan' };
  if (raw === 'btc5m' || raw === 'btc-5m') return { label: 'BTC5M', color: 'text-bb-orange' };
  if (raw === 'momentum' || raw === 'btc5m_momentum') return { label: 'MOMTM', color: 'text-bb-orange' };
  if (raw === 'latency' || raw === 'btc5m_latency') return { label: 'LATCY', color: 'text-bb-yellow' };
  if (raw === 'alpha') return { label: 'ALPHA', color: 'text-bb-green' };
  return { label: raw.toUpperCase().slice(0, 5), color: 'text-bb-dim' };
}

interface Props {
  trades: TradeEvent[];
  maxRows?: number;
}

export function TradeFeed({ trades, maxRows = 30 }: Props) {
  return (
    <Panel title="Trade Feed" live className="flex-1 flex flex-col">
      <div className="flex-1 overflow-y-auto log-scroll">
        {trades.length === 0 ? (
          <div className="flex items-center justify-center h-24 text-bb-dim text-[10px] uppercase">
            Waiting for trades
          </div>
        ) : (
          <div className="flex flex-col">
            {trades.slice(0, maxRows).map((trade, i) => {
              const pnl = num((trade as any).pnl ?? (trade as any).grossPnl);
              const strat = resolveStrategy(trade.strategy);
              return (
                <div
                  key={`${trade.timestamp}-${i}`}
                  className="flex items-center gap-2 px-2 py-[2px] hover:bg-bb-border/30 transition-colors"
                >
                  {/* Strategy badge */}
                  <span className={`text-[10px] font-medium w-[38px] shrink-0 ${strat.color}`}>
                    {strat.label}
                  </span>

                  {/* Dry run marker */}
                  {trade.dryRun && (
                    <span className="text-[9px] text-bb-yellow font-medium">DRY</span>
                  )}

                  {/* Market name */}
                  <span className="text-[11px] text-bb-text truncate flex-1 font-mono">
                    {trade.market}
                  </span>

                  {/* PnL */}
                  <span
                    className={`text-[11px] font-mono tabular-nums shrink-0 ${
                      pnl >= 0 ? 'text-bb-green' : 'text-bb-red'
                    }`}
                  >
                    {formatPnl(pnl)}
                  </span>

                  {/* Timestamp */}
                  <span className="text-[10px] text-bb-dim w-[28px] text-right shrink-0 tabular-nums">
                    {timeAgo(trade.timestamp)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Panel>
  );
}
