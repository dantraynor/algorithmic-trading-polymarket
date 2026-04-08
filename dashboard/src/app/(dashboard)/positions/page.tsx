'use client';

import { useState, useEffect } from 'react';
import { OpenPositionsTable } from '@/components/positions/OpenPositionsTable';
import { OnChainHoldings } from '@/components/positions/OnChainHoldings';
import { StatCell } from '@/components/bloomberg';
import type { OpenPosition, TokenHolding, TrackedWallet } from '@/lib/types';

interface PortfolioData {
  totalExposure: number;
  realizedPnl: number;
}

export default function PositionsPage() {
  const [positions, setPositions] = useState<OpenPosition[]>([]);
  const [portfolio, setPortfolio] = useState<PortfolioData | null>(null);
  const [holdings, setHoldings] = useState<TokenHolding[]>([]);
  const [trackedWallets, setTrackedWallets] = useState<TrackedWallet[]>([]);
  const [holdingsUpdated, setHoldingsUpdated] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/stream/positions');

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.addEventListener('positions_data', (event) => {
      try {
        const data = JSON.parse(event.data);
        setPositions(data.positions || []);
        setPortfolio(data.portfolio || null);
      } catch {
        // Ignore parse errors
      }
    });

    es.addEventListener('chain_holdings', (event) => {
      try {
        const data = JSON.parse(event.data);
        setHoldings(data.holdings || []);
        setTrackedWallets(data.trackedWallets || []);
        setHoldingsUpdated(Date.now());
      } catch {
        // Ignore parse errors
      }
    });

    return () => es.close();
  }, []);

  const totalCost = positions.reduce((sum, p) => sum + p.entryCost, 0);
  const usdceBalance = holdings
    .filter((holding) => holding.tokenId === 'USDCe')
    .reduce((sum, holding) => sum + holding.balance, 0);
  const trackedWalletCount = trackedWallets.length || new Set(
    holdings.map((holding) => holding.ownerAddress).filter(Boolean),
  ).size;

  return (
    <div className="p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-bold text-bb-cyan tracking-wider">POSITIONS</span>
          <span className="text-[10px] text-bb-dim">Open Positions + Tracked EOA/Safe/Proxy Holdings</span>
        </div>
        <div className="flex items-center gap-3">
          {!connected && (
            <span className="text-[10px] text-bb-yellow">RECONNECTING...</span>
          )}
        </div>
      </div>

      {/* Summary bar */}
      <div className="border border-bb-border bg-bb-panel p-2 mb-3">
        <div className="grid grid-cols-6 gap-x-4">
          <StatCell
            label="Open Positions"
            value={positions.length}
            color="cyan"
            size="lg"
          />
          <StatCell
            label="Total Cost"
            value={`$${totalCost.toFixed(2)}`}
            color="default"
          />
          <StatCell
            label="Exposure"
            value={`$${(portfolio?.totalExposure ?? 0).toFixed(2)}`}
            color="cyan"
          />
          <StatCell
            label="Realized P&L"
            value={`${(portfolio?.realizedPnl ?? 0) >= 0 ? '+' : ''}$${(portfolio?.realizedPnl ?? 0).toFixed(2)}`}
            color={(portfolio?.realizedPnl ?? 0) >= 0 ? 'green' : 'red'}
          />
          <StatCell
            label="USDCe On-Chain"
            value={`$${usdceBalance.toFixed(2)}`}
            color="green"
          />
          <StatCell
            label="Tracked Wallets"
            value={trackedWalletCount}
            color="default"
          />
        </div>
      </div>

      {/* Main content: positions table on top, holdings below */}
      <div className="flex flex-col gap-3">
        <OpenPositionsTable positions={positions} portfolio={portfolio} />
        <OnChainHoldings
          holdings={holdings}
          trackedWallets={trackedWallets}
          lastUpdated={holdingsUpdated}
        />
      </div>
    </div>
  );
}
