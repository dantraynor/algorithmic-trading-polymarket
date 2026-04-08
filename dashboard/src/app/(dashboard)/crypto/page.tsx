'use client';

import { useState, useEffect } from 'react';
import { BtcLatencyPanel } from '@/components/crypto/BtcLatencyPanel';
import { MomentumPanel } from '@/components/crypto/MomentumPanel';
import { AlphaCryptoPanel } from '@/components/crypto/AlphaCryptoPanel';
import { Panel, StatCell } from '@/components/bloomberg';
import { formatUsd, formatPnl } from '@/lib/format';
import type { BtcStreamState, AlphaStreamState, TradeEvent } from '@/lib/types';

export default function CryptoPage() {
  const [btcData, setBtcData] = useState<BtcStreamState | null>(null);
  const [alphaData, setAlphaData] = useState<AlphaStreamState | null>(null);
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/stream/crypto');

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.addEventListener('btc_data', (event) => {
      try {
        setBtcData(JSON.parse(event.data));
      } catch {
        // Ignore parse errors
      }
    });

    es.addEventListener('alpha_data', (event) => {
      try {
        setAlphaData(JSON.parse(event.data));
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

  // Compute aggregate stats
  const btc5mPnl = btcData?.btc5m.stats.dailyProfit ?? 0;
  const latencyPnl = btcData?.btc5mLatency.stats.dailyProfit ?? 0;
  const momentumPnl = btcData?.btc5mMomentum.stats?.dailyProfit ?? 0;
  const alphaPnl = alphaData?.portfolio.realizedPnl ?? 0;
  const totalDailyPnl = btc5mPnl + latencyPnl + momentumPnl;

  return (
    <div className="p-3">
      {/* Header bar */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-bold text-bb-orange tracking-wider">CRYPTO</span>
          <span className="text-[10px] text-bb-dim">BTC Strategies + Alpha Signals</span>
        </div>
        <div className="flex items-center gap-3">
          {!connected && (
            <span className="text-[10px] text-bb-yellow">RECONNECTING...</span>
          )}
          <span className="text-[10px] text-bb-dim">
            Daily: <span className={totalDailyPnl >= 0 ? 'text-bb-green' : 'text-bb-red'}>
              {formatUsd(totalDailyPnl)}
            </span>
          </span>
        </div>
      </div>

      {/* Top summary bar */}
      <div className="border border-bb-border bg-bb-panel p-2 mb-3">
        <div className="grid grid-cols-6 gap-x-4">
          <StatCell
            label="BTC 5M P&L"
            value={formatUsd(btc5mPnl)}
            color={btc5mPnl >= 0 ? 'green' : 'red'}
          />
          <StatCell
            label="Latency P&L"
            value={formatUsd(latencyPnl)}
            color={latencyPnl >= 0 ? 'green' : 'red'}
          />
          <StatCell
            label="Momentum P&L"
            value={formatUsd(momentumPnl)}
            color={momentumPnl >= 0 ? 'green' : 'red'}
          />
          <StatCell
            label="Alpha P&L"
            value={formatUsd(alphaPnl)}
            color={alphaPnl >= 0 ? 'green' : 'red'}
          />
          <StatCell
            label="BTC Trades"
            value={(btcData?.btc5m.stats.totalTrades ?? 0) + (btcData?.btc5mLatency.stats.totalTrades ?? 0)}
            color="cyan"
          />
          <StatCell
            label="Open Signals"
            value={alphaData?.positions.filter((p) => p.source === 'crypto').length ?? 0}
            color="cyan"
          />
        </div>
      </div>

      {/* Main grid: 2 columns */}
      <div className="grid grid-cols-2 gap-3">
        {/* Left: BTC strategies */}
        <div className="flex flex-col gap-3">
          {/* BTC Latency panel — the main one */}
          <BtcLatencyPanel
            stats={btcData?.btc5mLatency.stats ?? {
              wins: 0, losses: 0, winRate: 0, totalTrades: 0,
              dailyProfit: 0, dailyVolume: 0, totalPnl: 0,
              consecutiveLosses: 0, lastTradeTime: 0,
            }}
            window={btcData?.btc5mLatency.window ?? null}
          />

          {/* BTC 5M base strategy */}
          <Panel title="BTC 5M BASE" live>
            <div className="p-2">
              <div className="grid grid-cols-3 gap-x-4 gap-y-2">
                <StatCell
                  label="Wins"
                  value={btcData?.btc5m.stats.wins ?? 0}
                  color="green"
                />
                <StatCell
                  label="Losses"
                  value={btcData?.btc5m.stats.losses ?? 0}
                  color="red"
                />
                <StatCell
                  label="Win Rate"
                  value={`${((btcData?.btc5m.stats.winRate ?? 0) * 100).toFixed(1)}%`}
                  color={(btcData?.btc5m.stats.winRate ?? 0) >= 0.5 ? 'green' : 'red'}
                />
                <StatCell
                  label="Daily P&L"
                  value={formatUsd(btcData?.btc5m.stats.dailyProfit ?? 0)}
                  color={(btcData?.btc5m.stats.dailyProfit ?? 0) >= 0 ? 'green' : 'red'}
                  size="lg"
                />
                <StatCell
                  label="Total P&L"
                  value={formatUsd(btcData?.btc5m.stats.totalPnl ?? 0)}
                  color={(btcData?.btc5m.stats.totalPnl ?? 0) >= 0 ? 'green' : 'red'}
                />
                <StatCell
                  label="Total Trades"
                  value={btcData?.btc5m.stats.totalTrades ?? 0}
                  color="default"
                />
              </div>
              {btcData?.btc5m.window && (
                <div className="mt-2 pt-1 border-t border-bb-border flex gap-4 text-[10px] text-bb-dim">
                  <span>Dir: <span className={btcData.btc5m.window.direction === 'UP' ? 'text-bb-green' : btcData.btc5m.window.direction === 'DOWN' ? 'text-bb-red' : 'text-bb-dim'}>{btcData.btc5m.window.direction}</span></span>
                  <span>Conf: <span className="text-bb-yellow">{(btcData.btc5m.window.confidence * 100).toFixed(0)}%</span></span>
                  <span>Open: <span className="text-bb-text">${btcData.btc5m.window.openPrice.toFixed(2)}</span></span>
                </div>
              )}
            </div>
          </Panel>
        </div>

        {/* Right: Momentum + Alpha */}
        <div className="flex flex-col gap-3">
          {btcData?.btc5mMomentum.stats && (
            <MomentumPanel stats={btcData.btc5mMomentum.stats} />
          )}

          {!btcData?.btc5mMomentum.stats && (
            <Panel title="BTC 5M MOMENTUM">
              <div className="p-2 text-[11px] text-bb-dim">Waiting for momentum data...</div>
            </Panel>
          )}

          <AlphaCryptoPanel alpha={alphaData} />
        </div>
      </div>

      {/* Recent trade events */}
      {trades.length > 0 && (
        <div className="mt-3">
          <Panel title="RECENT CRYPTO TRADES" live>
            <div className="max-h-[180px] overflow-y-auto log-scroll">
              {trades.map((t, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 px-2 py-0.5 text-[10px] border-b border-bb-border/20 hover:bg-bb-border/20"
                >
                  <span className="text-bb-muted w-16 shrink-0">
                    {new Date(t.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                  </span>
                  <span className="text-bb-cyan w-14 shrink-0">{t.strategy}</span>
                  <span className={t.direction === 'UP' ? 'text-bb-green' : t.direction === 'DOWN' ? 'text-bb-red' : 'text-bb-dim'}>
                    {t.direction || '--'}
                  </span>
                  <span className={`ml-auto tabular-nums ${(t.pnl ?? 0) >= 0 ? 'text-bb-green' : 'text-bb-red'}`}>
                    {formatPnl(t.pnl ?? 0)}
                  </span>
                  {t.dryRun && (
                    <span className="text-[9px] text-bb-yellow border border-bb-yellow/30 px-1">PAPER</span>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
