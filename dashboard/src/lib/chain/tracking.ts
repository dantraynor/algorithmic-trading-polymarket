import type Redis from 'ioredis';
import { getCachedHoldings } from './holdings';
import type { TokenHolding, TrackedWallet } from '@/lib/types';

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const TOKEN_ID_PATTERN = /^\d+$/;

export interface ChainHoldingsSnapshot {
  holdings: TokenHolding[];
  usdceBalance: string;
  trackedWallets: TrackedWallet[];
  trackedTokenIds: string[];
}

function splitCsv(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function createWallet(
  address: string | undefined,
  label: string,
  source: TrackedWallet['source'],
): TrackedWallet | null {
  if (!address) return null;
  const trimmed = address.trim();
  if (!ADDRESS_PATTERN.test(trimmed)) return null;
  return { address: trimmed, label, source };
}

function appendUniqueWallet(
  wallets: TrackedWallet[],
  seen: Set<string>,
  wallet: TrackedWallet | null,
): void {
  if (!wallet) return;
  const key = wallet.address.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  wallets.push(wallet);
}

function parseCustomWallet(entry: string, index: number): TrackedWallet | null {
  const separatorIndex = entry.indexOf('=');
  if (separatorIndex === -1) {
    return createWallet(entry, `Wallet ${index + 1}`, 'custom');
  }

  const label = entry.slice(0, separatorIndex).trim() || `Wallet ${index + 1}`;
  const address = entry.slice(separatorIndex + 1).trim();
  return createWallet(address, label, 'custom');
}

function addTokenId(target: Set<string>, tokenId: unknown): void {
  if (typeof tokenId === 'string' && TOKEN_ID_PATTERN.test(tokenId)) {
    target.add(tokenId);
  }
}

function collectTokenIdsFromTradeRecord(record: unknown, tokenIds: Set<string>): void {
  if (!record || typeof record !== 'object') return;

  const trade = record as Record<string, unknown>;
  addTokenId(tokenIds, trade.tokenId);

  const fills = Array.isArray(trade.fills)
    ? trade.fills
    : Array.isArray((trade.metadata as Record<string, unknown> | undefined)?.fills)
      ? ((trade.metadata as Record<string, unknown>).fills as unknown[])
      : [];

  for (const fill of fills) {
    if (fill && typeof fill === 'object') {
      addTokenId(tokenIds, (fill as Record<string, unknown>).tokenId);
    }
  }
}

async function collectOpenPositionTokenIds(redis: Redis): Promise<string[]> {
  const tokenIds = new Set<string>();
  const verticals = ['crypto', 'sports', 'econ', 'news', 'arbitrage'];

  const verticalPipeline = redis.pipeline();
  for (const vertical of verticals) {
    verticalPipeline.smembers(`positions:by_vertical:${vertical}`);
  }

  const verticalResults = await verticalPipeline.exec();
  const marketIds: string[] = [];
  if (verticalResults) {
    for (const [err, ids] of verticalResults as Array<[Error | null, string[]]>) {
      if (!err && ids) {
        marketIds.push(...ids);
      }
    }
  }

  if (marketIds.length === 0) {
    return [];
  }

  const positionPipeline = redis.pipeline();
  for (const marketId of marketIds) {
    positionPipeline.get(`positions:open:${marketId}`);
  }

  const positionResults = await positionPipeline.exec();
  if (positionResults) {
    for (const [err, raw] of positionResults as Array<[Error | null, string | null]>) {
      if (err || !raw) continue;
      try {
        const position = JSON.parse(raw) as { tokenId?: string };
        addTokenId(tokenIds, position.tokenId);
      } catch {
        // Ignore malformed position payloads
      }
    }
  }

  return Array.from(tokenIds);
}

export function getTrackedWalletsFromEnv(): TrackedWallet[] {
  const wallets: TrackedWallet[] = [];
  const seen = new Set<string>();

  splitCsv(process.env.CHAIN_HOLDINGS_ADDRESSES).forEach((entry, index) => {
    appendUniqueWallet(wallets, seen, parseCustomWallet(entry, index));
  });

  appendUniqueWallet(wallets, seen, createWallet(process.env.WALLET_ADDRESS, 'EOA', 'wallet'));
  appendUniqueWallet(
    wallets,
    seen,
    createWallet(process.env.SAFE_ADDRESS || process.env.GNOSIS_SAFE_ADDRESS, 'Safe', 'safe'),
  );
  appendUniqueWallet(
    wallets,
    seen,
    createWallet(process.env.POLYMARKET_PROXY_WALLET_ADDRESS, 'Proxy Wallet', 'proxy'),
  );

  splitCsv(process.env.POLYMARKET_PROXY_WALLET_ADDRESSES).forEach((address, index) => {
    appendUniqueWallet(
      wallets,
      seen,
      createWallet(address, `Proxy Wallet ${index + 1}`, 'proxy'),
    );
  });

  return wallets;
}

export function getExtraTrackedTokenIdsFromEnv(): string[] {
  const tokenIds = new Set<string>();
  for (const tokenId of splitCsv(process.env.CHAIN_HOLDINGS_EXTRA_TOKEN_IDS)) {
    addTokenId(tokenIds, tokenId);
  }
  return Array.from(tokenIds);
}

export async function collectTrackedTokenIds(
  redis: Redis,
  seedTokenIds: string[] = [],
): Promise<string[]> {
  const tokenIds = new Set<string>();

  seedTokenIds.forEach((tokenId) => addTokenId(tokenIds, tokenId));
  getExtraTrackedTokenIdsFromEnv().forEach((tokenId) => tokenIds.add(tokenId));

  if (seedTokenIds.length === 0) {
    try {
      const openPositionTokenIds = await collectOpenPositionTokenIds(redis);
      openPositionTokenIds.forEach((tokenId) => tokenIds.add(tokenId));
    } catch {
      // Open position discovery is best-effort
    }
  }

  try {
    const recentTrades = await redis.lrange('trades:history', 0, 199);
    for (const raw of recentTrades) {
      try {
        collectTokenIdsFromTradeRecord(JSON.parse(raw), tokenIds);
      } catch {
        // Ignore malformed trade payloads
      }
    }
  } catch {
    // Trade-history token discovery is best-effort
  }

  return Array.from(tokenIds);
}

export async function loadChainHoldingsSnapshot(
  redis: Redis,
  seedTokenIds: string[] = [],
): Promise<ChainHoldingsSnapshot> {
  const trackedWallets = getTrackedWalletsFromEnv();
  if (trackedWallets.length === 0) {
    return {
      holdings: [],
      usdceBalance: '0',
      trackedWallets: [],
      trackedTokenIds: [],
    };
  }

  const trackedTokenIds = await collectTrackedTokenIds(redis, seedTokenIds);
  const holdings = await getCachedHoldings(trackedWallets, trackedTokenIds);
  const usdceBalance = String(
    holdings
      .filter((holding) => holding.tokenId === 'USDCe')
      .reduce((sum, holding) => sum + holding.balance, 0),
  );

  return {
    holdings,
    usdceBalance,
    trackedWallets,
    trackedTokenIds,
  };
}
