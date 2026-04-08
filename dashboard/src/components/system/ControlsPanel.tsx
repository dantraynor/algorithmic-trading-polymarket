'use client';

import { useState, useCallback } from 'react';
import { Panel, SectionHeader } from '@/components/bloomberg';
import { STRATEGIES, ALL_STRATEGY_IDS } from '@/lib/strategy-registry';
import type { CoreStreamState } from '@/lib/types';

interface Props {
  coreState: CoreStreamState | null;
}

function SquareButton({
  label,
  active,
  danger,
  onClick,
  disabled,
}: {
  label: string;
  active: boolean;
  danger?: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  const baseClass = 'px-3 py-1 text-[10px] font-bold uppercase tracking-wider border transition-colors';
  const activeClass = danger
    ? 'border-bb-red bg-bb-red/20 text-bb-red'
    : 'border-bb-green bg-bb-green/20 text-bb-green';
  const inactiveClass = 'border-bb-border bg-bb-panel text-bb-dim hover:text-bb-text hover:border-bb-dim';
  const disabledClass = 'opacity-50 cursor-not-allowed';

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseClass} ${active ? activeClass : inactiveClass} ${disabled ? disabledClass : 'cursor-pointer'}`}
    >
      {label}
    </button>
  );
}

export function ControlsPanel({ coreState }: Props) {
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const [localBetSize, setLocalBetSize] = useState('');
  const [localSlippage, setLocalSlippage] = useState('');
  const [confirmBet, setConfirmBet] = useState(false);
  const [confirmSlip, setConfirmSlip] = useState(false);

  const killSwitches = coreState?.killSwitches ?? {};
  const config = coreState?.configOverrides;

  // Initialize local values from server state
  const currentBetSize = config?.btc5mMaxPosition ?? 5000;
  const currentSlippage = config?.maxSlippageBps ?? 50;

  const toggleKillSwitch = useCallback(async (key: string, currentValue: boolean) => {
    setPendingKeys((prev) => new Set([...prev, key]));

    try {
      await fetch('/api/controls/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, enabled: !currentValue }),
      });
    } catch (err) {
      console.error('Failed to toggle kill switch:', err);
    }

    setPendingKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const setParam = useCallback(async (paramKey: string, value: string, resetConfirm: () => void) => {
    try {
      await fetch('/api/controls/params', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [paramKey]: parseFloat(value) }),
      });
    } catch (err) {
      console.error('Failed to set param:', err);
    } finally {
      resetConfirm();
    }
  }, []);

  // Determine master switch state
  const masterEnabled = killSwitches['TRADING_ENABLED'] ?? false;

  return (
    <Panel title="CONTROLS">
      <div className="p-2">
        {/* DANGER ZONE: Master trading switch */}
        <div className="border border-bb-red/50 p-2 mb-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-bb-red font-medium">
                MASTER TRADING SWITCH
              </div>
              <div className="text-[10px] text-bb-dim mt-0.5">
                Global kill switch — disables ALL trading
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[11px] font-bold ${masterEnabled ? 'text-bb-green' : 'text-bb-red'}`}>
                {masterEnabled ? 'ENABLED' : 'DISABLED'}
              </span>
              <SquareButton
                label={masterEnabled ? 'DISABLE' : 'ENABLE'}
                active={masterEnabled}
                danger={masterEnabled}
                onClick={() => toggleKillSwitch('TRADING_ENABLED', masterEnabled)}
                disabled={pendingKeys.has('TRADING_ENABLED')}
              />
            </div>
          </div>
        </div>

        {/* Per-strategy kill switches */}
        <SectionHeader label="Strategy Kill Switches" />
        <div className="p-2">
          <div className="grid grid-cols-1 gap-1">
            {(() => {
              // Group strategies by killSwitchKey to avoid duplicate toggles
              const grouped = new Map<string, { key: string; labels: string[]; fullNames: string[] }>();
              for (const stratId of ALL_STRATEGY_IDS) {
                const strat = STRATEGIES[stratId];
                const k = strat.killSwitchKey;
                const existing = grouped.get(k);
                if (existing) {
                  existing.labels.push(strat.label);
                  existing.fullNames.push(strat.fullName);
                } else {
                  grouped.set(k, { key: k, labels: [strat.label], fullNames: [strat.fullName] });
                }
              }
              return Array.from(grouped.values()).map(({ key, labels, fullNames }) => {
                const enabled = killSwitches[key] ?? false;
                const isPending = pendingKeys.has(key);
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between py-1 border-b border-bb-border/30"
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 ${enabled ? 'bg-bb-green' : 'bg-bb-red'}`} />
                      <span className="text-[11px] text-bb-text font-mono">{labels.join(' / ')}</span>
                      <span className="text-[10px] text-bb-dim">{fullNames.join(', ')}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <SquareButton
                        label={enabled ? 'ON' : 'OFF'}
                        active={enabled}
                        onClick={() => toggleKillSwitch(key, enabled)}
                        disabled={isPending}
                      />
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>

        {/* Parameter controls */}
        <SectionHeader label="Parameters" />
        <div className="p-2 flex flex-col gap-2">
          {/* Bet size */}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] text-bb-dim">Bet Size (USDC)</span>
              <span className="text-[10px] text-bb-muted ml-2">
                current: ${currentBetSize}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={localBetSize || String(currentBetSize)}
                onChange={(e) => {
                  setLocalBetSize(e.target.value);
                  setConfirmBet(false);
                }}
                className="bg-bb-bg border border-bb-border px-2 py-0.5 text-[11px] text-bb-text w-20 text-right font-mono"
              />
              <SquareButton
                label={confirmBet ? 'CONFIRM' : 'SET'}
                active={confirmBet}
                danger={confirmBet}
                onClick={() => {
                  if (confirmBet) {
                    setParam('betSize', localBetSize || String(currentBetSize), () => setConfirmBet(false));
                  } else {
                    setConfirmBet(true);
                  }
                }}
              />
            </div>
          </div>

          {/* Max slippage */}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[11px] text-bb-dim">Max Slippage (bps)</span>
              <span className="text-[10px] text-bb-muted ml-2">
                current: {currentSlippage}bps
              </span>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={localSlippage || String(currentSlippage)}
                onChange={(e) => {
                  setLocalSlippage(e.target.value);
                  setConfirmSlip(false);
                }}
                className="bg-bb-bg border border-bb-border px-2 py-0.5 text-[11px] text-bb-text w-20 text-right font-mono"
              />
              <SquareButton
                label={confirmSlip ? 'CONFIRM' : 'SET'}
                active={confirmSlip}
                danger={confirmSlip}
                onClick={() => {
                  if (confirmSlip) {
                    setParam('maxSlippage', localSlippage || String(currentSlippage), () => setConfirmSlip(false));
                  } else {
                    setConfirmSlip(true);
                  }
                }}
              />
            </div>
          </div>
        </div>

        {/* Balance */}
        {coreState && (
          <div className="border-t border-bb-border mt-2 pt-1 px-1 flex justify-between text-[10px] text-bb-dim">
            <span>Balance: <span className="text-bb-cyan">${coreState.balance.toFixed(2)}</span></span>
          </div>
        )}
      </div>
    </Panel>
  );
}
