'use client';

import { Panel, StatusDot } from '@/components/bloomberg';
import type { ServiceHealth } from '@/lib/types';

interface Props {
  services: ServiceHealth | null;
}

const SERVICE_ORDER = [
  'redis',
  'ingestion',
  'signal-core',
  'execution',
  'settlement',
  'btc-5m',
  'btc-5m-momentum',
] as const;

export function ServiceHealthGrid({ services }: Props) {
  return (
    <Panel title="SERVICE HEALTH" live>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-bb-border">
              <th className="py-[2px] px-2 text-[10px] uppercase tracking-wider text-bb-cyan font-medium text-left">
                Service
              </th>
              <th className="py-[2px] px-2 text-[10px] uppercase tracking-wider text-bb-cyan font-medium text-center">
                Status
              </th>
              <th className="py-[2px] px-2 text-[10px] uppercase tracking-wider text-bb-cyan font-medium text-right">
                Metric
              </th>
            </tr>
          </thead>
          <tbody>
            {SERVICE_ORDER.map((name) => {
              const svc = services?.[name as keyof ServiceHealth];
              const status = svc?.status ?? 'down';
              const metric = svc?.metric ?? 'unknown';

              return (
                <tr
                  key={name}
                  className="border-b border-bb-border/30 hover:bg-bb-border/20"
                >
                  <td className="py-[3px] px-2 text-[11px] text-bb-text font-mono">
                    {name}
                  </td>
                  <td className="py-[3px] px-2 text-center">
                    <div className="flex items-center justify-center">
                      <StatusDot status={status === 'up' ? 'up' : 'down'} />
                      <span className={`ml-1.5 text-[10px] font-medium ${
                        status === 'up' ? 'text-bb-green' : 'text-bb-red'
                      }`}>
                        {status === 'up' ? 'UP' : 'DOWN'}
                      </span>
                    </div>
                  </td>
                  <td className="py-[3px] px-2 text-[11px] text-bb-dim text-right font-mono tabular-nums">
                    {metric}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
