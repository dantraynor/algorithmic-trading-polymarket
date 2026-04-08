'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { StatsStrip } from '@/components/overview/StatsStrip';
import { ArbMarketsTable } from '@/components/overview/ArbMarketsTable';
import { EquityCurve } from '@/components/shared/EquityCurve';
import { TradeFeed } from '@/components/shared/TradeFeed';
import { StatusDot } from '@/components/bloomberg';
import type {
  CoreStreamState,
  DashboardStats,
  ServiceHealth,
  TradeEvent,
  MarketSummary,
} from '@/lib/types';

/* ─── Default states ──────────────────────────────────────────────────────── */

const DEFAULT_CORE: CoreStreamState = {
  balance: 0,
  killSwitches: {},
  configOverrides: { btc5mMaxPosition: null, btc5mMomentumMaxBet: null, maxSlippageBps: null },
};

const DEFAULT_STATS: DashboardStats = {
  balance: 0,
  todayPnl: 0,
  totalPnl: 0,
  winRate: 0,
  totalTrades: 0,
  maxDrawdown: 0,
  messagesIngested: 0,
};

const DEFAULT_SERVICES: ServiceHealth = {
  redis: { status: 'down', metric: '' },
  ingestion: { status: 'down', metric: '' },
  'signal-core': { status: 'down', metric: '' },
  execution: { status: 'down', metric: '' },
  settlement: { status: 'down', metric: '' },
  'btc-5m': { status: 'down', metric: '' },
  'btc-5m-momentum': { status: 'down', metric: '' },
};

/* ─── Overview Page ───────────────────────────────────────────────────────── */

export default function OverviewPage() {
  const [core, setCore] = useState<CoreStreamState>(DEFAULT_CORE);
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [services, setServices] = useState<ServiceHealth>(DEFAULT_SERVICES);
  const [trades, setTrades] = useState<TradeEvent[]>([]);
  const [markets, setMarkets] = useState<MarketSummary[]>([]);
  const [connected, setConnected] = useState(false);
  const [stale, setStale] = useState(false);
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const backfilled = useRef(false);

  useEffect(() => {
    const es = new EventSource('/api/stream');

    es.onopen = () => {
      setConnected(true);
      setStale(false);
    };

    es.onerror = () => {
      setConnected(false);
      setStale(true);
    };

    // Named event listeners using the new SSE format
    es.addEventListener('stats_tick', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.stale) {
          setStale(true);
          return;
        }
        setStale(false);

        // Update core state
        if (data.balance !== undefined) {
          setCore({
            balance: data.balance ?? 0,
            killSwitches: data.killSwitches ?? {},
            configOverrides: data.configOverrides ?? { btc5mMaxPosition: null, btc5mMomentumMaxBet: null, maxSlippageBps: null },
          });
        }

        // Update dashboard stats
        if (data.stats) {
          setStats(data.stats);
        }
      } catch {
        // Ignore parse errors
      }
    });

    es.addEventListener('trade_event', (e: MessageEvent) => {
      try {
        const trade: TradeEvent = JSON.parse(e.data);
        setTrades((prev) => [trade, ...prev].slice(0, 100));
      } catch {
        // Ignore parse errors
      }
    });

    es.addEventListener('trade_backfill', (e: MessageEvent) => {
      if (backfilled.current) return;
      try {
        const data = JSON.parse(e.data);
        if (Array.isArray(data)) {
          setTrades(data);
          backfilled.current = true;
        }
      } catch {
        // Ignore parse errors
      }
    });

    es.addEventListener('market_snapshot', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.markets) {
          setMarkets(data.markets);
          // Auto-select first market (functional setter avoids stale closure)
          setSelectedMarket((prev) => prev ?? data.markets[0].id);
        }
      } catch {
        // Ignore parse errors
      }
    });

    es.addEventListener('service_health', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.services) {
          setServices(data.services);
        }
      } catch {
        // Ignore parse errors
      }
    });

    // Also listen for legacy unnamed messages for backwards compatibility
    es.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'stats' && msg.data) {
          if (msg.data.stale) {
            setStale(true);
          } else {
            setStale(false);
            if (msg.data.stats) setStats(msg.data.stats);
            if (msg.data.services) setServices(msg.data.services);
            if (msg.data.markets) setMarkets(msg.data.markets);
            // Backfill trades from legacy format
            if (msg.data.trades && !backfilled.current) {
              setTrades(msg.data.trades);
              backfilled.current = true;
            }
            // Extract core from legacy DashboardState
            if (msg.data.stats?.balance !== undefined) {
              setCore((prev) => ({
                ...prev,
                balance: msg.data.stats.balance,
              }));
            }
          }
        } else if (msg.type === 'trade' && msg.data) {
          setTrades((prev) => [msg.data, ...prev].slice(0, 100));
        }
      } catch {
        // Ignore
      }
    };

    return () => es.close();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelectMarket = useCallback((id: string) => {
    setSelectedMarket(id);
  }, []);

  return (
    <div className="flex flex-col gap-1 p-1 h-full">
      {/* Connection status bar */}
      <div className="flex items-center justify-between px-2 py-0.5 border-b border-bb-border">
        <div className="flex items-center gap-3">
          <StatusDot status={connected ? 'up' : 'down'} label={connected ? 'CONNECTED' : 'DISCONNECTED'} />
          {stale && (
            <span className="text-[10px] text-bb-yellow uppercase">DATA STALE</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {Object.entries(services).slice(0, 5).map(([name, { status }]) => (
            <StatusDot
              key={name}
              status={status === 'up' ? 'up' : 'down'}
              label={name}
            />
          ))}
        </div>
      </div>

      {/* Top row: Stats strip */}
      <StatsStrip core={core} stats={stats} />

      {/* Middle row: Equity curve (60%) + Trade feed (40%) */}
      <div className="flex gap-1 flex-1 min-h-0">
        <div className="w-[60%]">
          <EquityCurve trades={trades} />
        </div>
        <div className="w-[40%] flex flex-col min-h-0">
          <TradeFeed trades={trades} />
        </div>
      </div>

      {/* Bottom row: Arb markets table */}
      <ArbMarketsTable
        markets={markets}
        selectedMarket={selectedMarket ?? undefined}
        onSelectMarket={handleSelectMarket}
      />
    </div>
  );
}
