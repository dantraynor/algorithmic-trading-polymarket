#!/usr/bin/env node
/**
 * Post-window check: reports recent trades and finds redeemable tokens.
 * Runs via cron every 5 minutes on the VM.
 *
 * Usage: docker exec tradingbot-settlement node /scripts/check-window.js
 */

const { ethers, Contract } = require('ethers');
const axios = require('axios');
const Redis = require('ioredis');

const EOA = process.env.WALLET_ADDRESS || 'YOUR_EOA_ADDRESS';
const CTF = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDCE = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const RPC = process.env.POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com';

const CTF_ABI = [
  'function balanceOf(address,uint256) view returns (uint256)',
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

async function main() {
  const redis = new Redis(process.env.REDIS_SOCKET_PATH || '/var/run/redis/redis.sock');
  const provider = new ethers.JsonRpcProvider(RPC);
  const ctf = new Contract(CTF, CTF_ABI, provider);
  const usdce = new Contract(USDCE, ERC20_ABI, provider);

  const now = Date.now();
  const output = [];

  // --- 1. Check recent trades (last 10 minutes) ---
  const trades = await redis.lrange('trades:history', 0, 20);
  const recentTrades = [];
  for (const raw of trades) {
    const t = JSON.parse(raw);
    if (t.strategy !== 'btc-5m-latency' || t.dryRun) continue;
    if (now - t.timestamp > 10 * 60 * 1000) break; // older than 10 min
    recentTrades.push(t);
  }

  if (recentTrades.length > 0) {
    output.push('=== RECENT TRADES ===');
    for (const t of recentTrades) {
      const time = new Date(t.timestamp).toISOString().slice(11, 19);
      const pnl = parseFloat(t.grossPnl || 0);
      const icon = pnl >= 0 ? '✅' : '❌';
      output.push(
        `${icon} ${t.market} | ${t.outcome} | ${t.numTrades} orders | ` +
        `vol=$${parseFloat(t.totalVolume).toFixed(0)} | pnl=$${pnl.toFixed(2)}`
      );
    }
  } else {
    output.push('No trades in last 10 minutes.');
  }

  // --- 2. Check EOA USDCe balance ---
  const balance = await usdce.balanceOf(EOA);
  output.push(`\nEOA USDCe: $${(Number(balance) / 1e6).toFixed(2)}`);

  // --- 3. Scan for unredeemed tokens ---
  const currentBlock = await provider.getBlockNumber();
  // Scan last ~3 hours (~5400 blocks at 2s/block), in 9999-block chunks
  const startBlock = currentBlock - 5400;
  const tokenIds = new Set();

  for (let from = startBlock; from < currentBlock; from += 9999) {
    const to = Math.min(from + 9998, currentBlock);
    try {
      const events = await ctf.queryFilter(
        ctf.filters.TransferSingle(null, null, EOA),
        from, to
      );
      for (const ev of events) tokenIds.add(ev.args[3].toString());
    } catch (e) {
      // RPC rate limit — skip this chunk
    }
  }

  // Check balances for all token IDs found
  const holdings = [];
  for (const tokenId of tokenIds) {
    try {
      const bal = await ctf.balanceOf(EOA, tokenId);
      if (bal > 0n) {
        holdings.push({ tokenId, balance: Number(bal) / 1e6 });
      }
    } catch (e) { /* skip */ }
  }

  if (holdings.length === 0) {
    output.push('\nNo unredeemed tokens on EOA.');
  } else {
    output.push(`\n=== UNREDEEMED TOKENS: ${holdings.length} positions ===`);

    let totalRedeemable = 0;
    let totalWorthless = 0;

    for (const h of holdings) {
      // Query Gamma API for resolution
      let status = 'UNRESOLVED';
      let conditionId = '';
      let marketName = '';
      try {
        const resp = await axios.get('https://gamma-api.polymarket.com/markets', {
          params: { clob_token_ids: h.tokenId, limit: 1 },
          timeout: 8000,
        });
        if (resp.data && resp.data.length > 0) {
          const m = resp.data[0];
          marketName = (m.question || '').replace('Bitcoin Up or Down - ', '');
          conditionId = m.conditionId || '';
          if (m.outcomePrices) {
            const prices = JSON.parse(m.outcomePrices);
            const tokenIds = m.clobTokenIds ? JSON.parse(m.clobTokenIds) : [];
            const idx = tokenIds.indexOf(h.tokenId);
            if (idx >= 0) {
              if (prices[idx] === '1') {
                status = 'REDEEMABLE';
                totalRedeemable += h.balance;
              } else if (prices[idx] === '0') {
                status = 'WORTHLESS';
                totalWorthless += h.balance;
              }
            }
          }
        }
      } catch (e) { /* Gamma unavailable */ }

      if (status === 'REDEEMABLE') {
        output.push(`  💰 REDEEM $${h.balance.toFixed(2)} | ${marketName} | conditionId: ${conditionId}`);
      } else if (status === 'WORTHLESS') {
        output.push(`  💀 worthless ${h.balance.toFixed(2)} | ${marketName}`);
      } else {
        output.push(`  ⏳ pending ${h.balance.toFixed(2)} | ${marketName || h.tokenId.slice(0, 20) + '...'}`);
      }
    }

    if (totalRedeemable > 0) {
      output.push(`\n🔔 TOTAL REDEEMABLE: $${totalRedeemable.toFixed(2)}`);
    }
  }

  // Print output
  const timestamp = new Date().toISOString().slice(0, 19) + 'Z';
  console.log(`\n[${timestamp}] Window Check`);
  console.log('─'.repeat(50));
  for (const line of output) console.log(line);
  console.log('─'.repeat(50));

  await redis.quit();
}

main().catch(e => {
  console.error('Check failed:', e.message);
  process.exit(1);
});
