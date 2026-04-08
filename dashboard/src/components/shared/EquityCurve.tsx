'use client';

import React, { useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Panel } from '@/components/bloomberg';
import { num } from '@/lib/format';
import type { TradeEvent } from '@/lib/types';

const RANGES = [
  { label: '1H', ms: 60 * 60 * 1000 },
  { label: '1D', ms: 24 * 60 * 60 * 1000 },
  { label: '7D', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: '30D', ms: 30 * 24 * 60 * 60 * 1000 },
] as const;

interface Props {
  trades: TradeEvent[];
}

function EquityCurveInner({ trades }: Props) {
  const [rangeIdx, setRangeIdx] = useState(1);

  const { data, cumulative } = useMemo(() => {
    const cutoff = Date.now() - RANGES[rangeIdx].ms;
    let cum = 0;
    const points = trades
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .filter((t) => t.timestamp >= cutoff)
      .map((t) => {
        const pnl = num((t as any).pnl ?? (t as any).grossPnl);
        cum += pnl;
        return {
          time: new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          pnl: parseFloat(cum.toFixed(2)),
        };
      });
    return { data: points, cumulative: cum };
  }, [trades, rangeIdx]);

  const isPositive = cumulative >= 0;
  const strokeColor = isPositive ? '#00ff41' : '#ff3131';

  return (
    <Panel title="Equity Curve" live className="flex-1">
      <div className="px-2 pt-1 pb-0">
        {/* Range buttons */}
        <div className="flex gap-0 mb-1">
          {RANGES.map((r, i) => (
            <button
              key={r.label}
              onClick={() => setRangeIdx(i)}
              className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                i === rangeIdx
                  ? 'text-bb-cyan border-b-2 border-bb-cyan'
                  : 'text-bb-dim hover:text-bb-text border-b-2 border-transparent'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-1 pb-2">
        {data.length === 0 ? (
          <div className="flex items-center justify-center h-[180px] text-bb-dim text-[10px] uppercase">
            No trades in range
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
              <XAxis
                dataKey="time"
                tick={{ fontSize: 10, fill: '#555555', fontFamily: 'IBM Plex Mono' }}
                axisLine={{ stroke: '#2a2a2a' }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#555555', fontFamily: 'IBM Plex Mono' }}
                width={48}
                axisLine={{ stroke: '#2a2a2a' }}
                tickLine={false}
                tickFormatter={(v: number) => `$${v.toFixed(0)}`}
              />
              <ReferenceLine y={0} stroke="#2a2a2a" strokeDasharray="3 3" />
              <Tooltip
                contentStyle={{
                  background: '#111111',
                  border: '1px solid #2a2a2a',
                  borderRadius: 0,
                  fontSize: 11,
                  fontFamily: 'IBM Plex Mono',
                  color: '#e0e0e0',
                }}
                labelStyle={{ color: '#555555', fontSize: 10 }}
                formatter={(value: number) => [`$${value.toFixed(2)}`, 'P&L']}
              />
              <Line
                type="monotone"
                dataKey="pnl"
                stroke={strokeColor}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 3, fill: strokeColor, stroke: '#111111', strokeWidth: 1 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </Panel>
  );
}

export const EquityCurve = React.memo(EquityCurveInner);
