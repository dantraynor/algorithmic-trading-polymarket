'use client';

import { Panel, DataTable, SectionHeader } from '@/components/bloomberg';
import { timeAgo } from '@/lib/format';
import type { TokenHolding, TrackedWallet } from '@/lib/types';

interface Props {
  holdings: TokenHolding[];
  trackedWallets: TrackedWallet[];
  lastUpdated: number | null;
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function OnChainHoldings({ holdings, trackedWallets, lastUpdated }: Props) {
  const walletGroups = trackedWallets.length > 0
    ? trackedWallets.map((wallet) => ({
        wallet,
        holdings: holdings.filter(
          (holding) => holding.ownerAddress?.toLowerCase() === wallet.address.toLowerCase(),
        ),
      }))
    : Array.from(
        holdings.reduce((groups, holding) => {
          const address = holding.ownerAddress || 'unknown';
          if (!groups.has(address)) {
            groups.set(address, {
              wallet: {
                address,
                label: holding.ownerLabel || shortenAddress(address),
                source: holding.ownerSource || 'custom',
              } satisfies TrackedWallet,
              holdings: [],
            });
          }
          groups.get(address)?.holdings.push(holding);
          return groups;
        }, new Map<string, { wallet: TrackedWallet; holdings: TokenHolding[] }>()),
      ).map(([_, group]) => group);

  const totalUsdceBalance = holdings
    .filter((holding) => holding.tokenId === 'USDCe')
    .reduce((sum, holding) => sum + holding.balance, 0);

  const updatedLabel = (
    <span className="text-[10px] text-bb-dim">
      Updated {timeAgo(lastUpdated, ' ago')}
    </span>
  );

  return (
    <Panel title={`ON-CHAIN HOLDINGS (${walletGroups.length})`} right={updatedLabel}>
      <div className="p-2">
        {walletGroups.length === 0 ? (
          <div className="text-[11px] text-bb-dim py-2">
            No tracked wallets configured
          </div>
        ) : (
          <>
            <div className="mb-3 pb-2 border-b border-bb-border">
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-bb-dim">Total USDCe Across Tracked Wallets</span>
                <span className="text-[14px] text-bb-green font-medium tabular-nums">
                  ${totalUsdceBalance.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="space-y-3">
              {walletGroups.map(({ wallet, holdings: walletHoldings }) => {
                const usdceHolding = walletHoldings.find((holding) => holding.tokenId === 'USDCe');
                const ctfTokens = walletHoldings.filter((holding) => holding.tokenId !== 'USDCe');

                return (
                  <div key={wallet.address}>
                    <SectionHeader label={`${wallet.label.toUpperCase()} · ${shortenAddress(wallet.address)}`} />
                    <div className="mb-2 flex items-center justify-between text-[11px]">
                      <span className="text-bb-dim">USDCe</span>
                      <span className="text-bb-green font-medium tabular-nums">
                        ${(usdceHolding?.balance ?? 0).toFixed(2)}
                      </span>
                    </div>

                    {ctfTokens.length > 0 ? (
                      <DataTable
                        columns={[
                          { key: 'label', label: 'Token' },
                          { key: 'balance', label: 'Balance', align: 'right' as const },
                          { key: 'tokenId', label: 'Token ID' },
                        ]}
                        rows={ctfTokens.map((holding) => ({
                          id: `${wallet.address}:${holding.tokenId}`,
                          label: holding.label || `CTF ${holding.tokenId.slice(0, 6)}...`,
                          balance: holding.balance.toFixed(4),
                          tokenId: holding.tokenId.slice(0, 16) + '...',
                        }))}
                      />
                    ) : (
                      <div className="text-[11px] text-bb-dim py-2">
                        No tracked CTF token holdings
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
