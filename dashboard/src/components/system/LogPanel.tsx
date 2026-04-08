'use client';

import { useState, useEffect, useRef } from 'react';
import { Panel } from '@/components/bloomberg';

interface LogEntry {
  timestamp: string;
  service: string;
  level: string;
  message: string;
}

const SERVICE_COLORS: Record<string, string> = {
  ingest: '#00e5ff',
  ingestion: '#00e5ff',
  scanner: '#00e5ff',
  'signal-core': '#00e5ff',
  exec: '#00ff41',
  execution: '#00ff41',
  settle: '#ffcc00',
  settlement: '#ffcc00',
  'btc-5m': '#c084fc',
  'btc-5m-momentum': '#ff8c00',
  'btc-5m-latency': '#ffcc00',
};

function getServiceColor(service: string): string {
  return SERVICE_COLORS[service.toLowerCase()] || '#555555';
}

const ALL_SERVICES = [
  'ALL', 'ingest', 'scanner', 'exec', 'settle', 'btc-5m',
];

export function LogPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState('ALL');
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Connect to log SSE
  useEffect(() => {
    const es = new EventSource('/api/logs');

    es.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'log' && msg.data) {
          setLogs((prev) => [...prev, msg.data].slice(-500));
        }
      } catch {
        // Ignore parse errors
      }
    };

    return () => es.close();
  }, []);

  // Auto-scroll
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 30;
  };

  const filteredLogs = filter === 'ALL'
    ? logs
    : logs.filter((l) => l.service.toLowerCase() === filter.toLowerCase());

  return (
    <Panel>
      {/* Custom header with filter buttons */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-bb-border">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-bb-green bb-blink" />
          <span className="text-[10px] uppercase tracking-wider text-bb-cyan font-medium">
            LOG STREAM
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {ALL_SERVICES.map((svc) => (
            <button
              key={svc}
              onClick={() => setFilter(svc)}
              className={`px-1.5 py-0.5 text-[9px] uppercase tracking-wider border transition-colors ${
                filter === svc
                  ? 'border-bb-cyan text-bb-cyan bg-bb-cyan/10'
                  : 'border-transparent text-bb-dim hover:text-bb-text'
              }`}
            >
              {svc}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="log-scroll max-h-[400px] overflow-y-auto font-mono text-[10px] leading-relaxed p-1"
      >
        {filteredLogs.length === 0 ? (
          <div className="text-bb-dim text-[11px] py-4 text-center">
            Waiting for logs...
          </div>
        ) : (
          filteredLogs.map((log, i) => {
            const isWarn = log.level === 'WARN';
            const isError = log.level === 'ERROR';
            const serviceColor = getServiceColor(log.service);

            return (
              <div key={i} className="flex gap-1.5 py-0.5 leading-tight">
                <span className="text-bb-muted whitespace-nowrap shrink-0">
                  {log.timestamp}
                </span>
                <span style={{ color: serviceColor }} className="shrink-0">
                  [{log.service}]
                </span>
                <span
                  className={
                    isError
                      ? 'text-bb-red'
                      : isWarn
                        ? 'text-bb-yellow'
                        : 'text-bb-text'
                  }
                >
                  {log.message}
                </span>
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}
