# Wallet & Gnosis Safe Setup

## 1. Create a Gnosis Safe on Polygon

1. Go to [app.safe.global](https://app.safe.global)
2. Connect your wallet (the owner wallet whose private key you'll use)
3. Select **Polygon** network
4. Deploy a new Safe with:
   - 1 owner (your trading wallet)
   - Threshold: 1/1
5. Record the Safe address → this is your `GNOSIS_SAFE_ADDRESS`

## 2. Fund the Safe

### USDCe (trading capital)
- Bridge USDC to Polygon as USDCe (`0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`)
- Send USDCe to your Safe address
- Recommended minimum: $100 for testing, scale up after verification

### MATIC (gas for settlement)
- Send a small amount of MATIC to the Safe address for settlement transaction gas
- ~5 MATIC is sufficient for extensive testing

## 3. Approve CTF Exchange

The Safe must approve the CTF Exchange contract to spend USDCe on its behalf.

**Option A: Via Safe Transaction Builder**
1. Open your Safe at app.safe.global
2. Go to Apps → Transaction Builder
3. Add a transaction:
   - **To**: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` (USDCe)
   - **ABI**: ERC20 `approve(address,uint256)`
   - **spender**: `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E` (CTF Exchange)
   - **amount**: `115792089237316195423570985008687907853269984665640564039457584007913129639935` (max uint256)
4. Submit and confirm the transaction

**Option B: Via Polymarket UI**
1. Connect your Safe wallet to polymarket.com
2. The UI will prompt you to approve spending

## 4. Derive CLOB API Keys

CLOB API keys are **IP-bound** — they must be derived from the production server's IP address (Zurich).

### From the production server:
```bash
ssh ubuntu@<INSTANCE_IP>
cd /opt/tradingbot
PRIVATE_KEY=0x... node scripts/derive-keys.js
```

### Output:
```
CLOB_API_KEY=<your-api-key>
CLOB_API_SECRET=<your-secret>
CLOB_PASSPHRASE=<your-passphrase>
```

Add these to `/opt/tradingbot/.env`.

### Using the first-run setup script:
The `first-run-setup.sh` script automates this — it reads `PRIVATE_KEY` from `.env`, derives the keys, and updates the `.env` file automatically.

## 5. Environment Variables Checklist

After completing all steps, your `.env` should have:

```
PRIVATE_KEY=0x...                    # Your wallet private key
GNOSIS_SAFE_ADDRESS=0x...            # Safe address from step 1
CLOB_API_KEY=...                     # Derived in step 4
CLOB_API_SECRET=...                  # Derived in step 4
CLOB_PASSPHRASE=...                  # Derived in step 4
WALLET_ADDRESS=0x...                 # Optional: EOA to track in dashboard
POLYMARKET_PROXY_WALLET_ADDRESSES=0x...,0x...
CHAIN_HOLDINGS_EXTRA_TOKEN_IDS=123...,456...
```

For the dashboard, you can also set `CHAIN_HOLDINGS_ADDRESSES` as a comma-separated
`label=address` list when you want explicit EOA / Safe / Proxy labeling in the
on-chain holdings panel.
