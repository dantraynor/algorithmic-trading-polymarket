import { polygonClient } from './rpc-client';
import type { TokenHolding, TrackedWallet } from '@/lib/types';
import type { Address } from 'viem';

// Polygon Mainnet contract addresses
const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045' as Address;
const USDCE_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174' as Address;

// ERC-1155 balanceOf ABI fragment
const ERC1155_BALANCE_OF_ABI = [
  {
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// ERC-20 balanceOf ABI fragment
const ERC20_BALANCE_OF_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

// In-memory cache with 60s TTL, keyed by token IDs
interface CacheEntry {
  holdings: TokenHolding[];
  timestamp: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

function buildCacheKey(wallets: TrackedWallet[], tokenIds: string[]): string {
  return [
    wallets.map((wallet) => wallet.address.toLowerCase()).join('|'),
    Array.from(new Set(tokenIds.filter(Boolean))).sort().join(','),
  ].join('::');
}

async function fetchWalletHoldings(
  wallet: TrackedWallet,
  tokenIds: string[],
): Promise<TokenHolding[]> {
  const address = wallet.address as Address;
  const holdings: TokenHolding[] = [];

  const usdceBalance = await polygonClient
    .readContract({
      address: USDCE_ADDRESS,
      abi: ERC20_BALANCE_OF_ABI,
      functionName: 'balanceOf',
      args: [address],
    })
    .catch(() => BigInt(0));

  holdings.push({
    tokenId: 'USDCe',
    balance: Number(usdceBalance) / 1e6,
    label: 'USDCe',
    ownerAddress: wallet.address,
    ownerLabel: wallet.label,
    ownerSource: wallet.source,
    assetType: 'erc20',
  });

  if (tokenIds.length === 0) {
    return holdings;
  }

  const balancePromises = tokenIds.map((tokenId) =>
    polygonClient
      .readContract({
        address: CTF_ADDRESS,
        abi: ERC1155_BALANCE_OF_ABI,
        functionName: 'balanceOf',
        args: [address, BigInt(tokenId)],
      })
      .then((balance) => ({
        tokenId,
        balance: Number(balance) / 1e6,
      }))
      .catch(() => ({
        tokenId,
        balance: 0,
      })),
  );

  const ctfBalances = await Promise.all(balancePromises);
  for (const entry of ctfBalances) {
    if (entry.balance > 0) {
      holdings.push({
        tokenId: entry.tokenId,
        balance: entry.balance,
        ownerAddress: wallet.address,
        ownerLabel: wallet.label,
        ownerSource: wallet.source,
        assetType: 'erc1155',
      });
    }
  }

  return holdings;
}

/**
 * Fetch on-chain token holdings with 60s in-memory cache.
 * Reads ERC-1155 balanceOf for CTF token IDs and ERC-20 balanceOf for USDCe.
 * Cache is invalidated when the set of tokenIds changes.
 */
export async function getCachedHoldings(
  wallets: TrackedWallet[],
  tokenIds: string[],
): Promise<TokenHolding[]> {
  if (wallets.length === 0) {
    return [];
  }

  const cacheKey = buildCacheKey(wallets, tokenIds);
  const cachedEntry = cache.get(cacheKey);
  if (cachedEntry && Date.now() - cachedEntry.timestamp < CACHE_TTL_MS) {
    return cachedEntry.holdings;
  }

  const uniqueTokenIds = Array.from(new Set(tokenIds.filter(Boolean)));
  const holdings = (await Promise.all(wallets.map((wallet) => fetchWalletHoldings(wallet, uniqueTokenIds)))).flat();

  cache.set(cacheKey, { holdings, timestamp: Date.now() });

  if (cache.size > 32) {
    const now = Date.now();
    for (const [key, entry] of cache.entries()) {
      if (now - entry.timestamp >= CACHE_TTL_MS) {
        cache.delete(key);
      }
    }
  }

  return holdings;
}
