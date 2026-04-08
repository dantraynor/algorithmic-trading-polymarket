'use client';

import { useState, useEffect } from 'react';
import { ServiceHealthGrid } from '@/components/system/ServiceHealthGrid';
import { ControlsPanel } from '@/components/system/ControlsPanel';
import { LogPanel } from '@/components/system/LogPanel';
import { StatCell } from '@/components/bloomberg';
import type { CoreStreamState, ServiceHealth } from '@/lib/types';

export default function SystemPage() {
  const [coreState, setCoreState] = useState<CoreStreamState | null>(null);
  const [serviceHealth, setServiceHealth] = useState<ServiceHealth | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource('/api/stream/system');

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.addEventListener('stats_tick', (event) => {
      try {
        setCoreState(JSON.parse(event.data));
      } catch {
        // Ignore parse errors
      }
    });

    es.addEventListener('service_health', (event) => {
      try {
        setServiceHealth(JSON.parse(event.data));
      } catch {
        // Ignore parse errors
      }
    });

    return () => es.close();
  }, []);

  // Count up/down services
  const serviceEntries = serviceHealth ? Object.values(serviceHealth) : [];
  const upCount = serviceEntries.filter((s) => s.status === 'up').length;
  const downCount = serviceEntries.filter((s) => s.status === 'down').length;

  // Count enabled kill switches
  const ks = coreState?.killSwitches ?? {};
  const enabledCount = Object.values(ks).filter(Boolean).length;
  const totalKs = Object.keys(ks).length;

  return (
    <div className="p-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-bold text-bb-yellow tracking-wider">SYSTEM</span>
          <span className="text-[10px] text-bb-dim">Monitoring + Controls</span>
        </div>
        <div className="flex items-center gap-3">
          {!connected && (
            <span className="text-[10px] text-bb-yellow">RECONNECTING...</span>
          )}
          <span className="text-[10px] text-bb-dim">
            Services: <span className="text-bb-green">{upCount} UP</span>
            {downCount > 0 && <span className="text-bb-red ml-1">{downCount} DOWN</span>}
          </span>
        </div>
      </div>

      {/* Summary bar */}
      <div className="border border-bb-border bg-bb-panel p-2 mb-3">
        <div className="grid grid-cols-5 gap-x-4">
          <StatCell
            label="Balance"
            value={`$${(coreState?.balance ?? 0).toFixed(2)}`}
            color="cyan"
            size="lg"
          />
          <StatCell
            label="Services Up"
            value={`${upCount}/${upCount + downCount}`}
            color={downCount === 0 ? 'green' : 'yellow'}
          />
          <StatCell
            label="Kill Switches"
            value={`${enabledCount}/${totalKs} ON`}
            color={enabledCount === totalKs ? 'green' : 'yellow'}
          />
          <StatCell
            label="Bet Size"
            value={`$${coreState?.configOverrides.btc5mMaxPosition ?? 'N/A'}`}
            color="default"
          />
          <StatCell
            label="Max Slippage"
            value={`${coreState?.configOverrides.maxSlippageBps ?? 'N/A'}bps`}
            color="default"
          />
        </div>
      </div>

      {/* Main grid: 2 columns */}
      <div className="grid grid-cols-2 gap-3">
        {/* Left: Service health + Logs */}
        <div className="flex flex-col gap-3">
          <ServiceHealthGrid services={serviceHealth} />
          <LogPanel />
        </div>

        {/* Right: Controls */}
        <div className="flex flex-col gap-3">
          <ControlsPanel coreState={coreState} />
        </div>
      </div>
    </div>
  );
}
