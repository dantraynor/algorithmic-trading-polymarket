# Configuration Guide

Configuration is environment-driven. Copy `.env.example` to `.env` with:

```bash
make setup
```

Keep `.env` local. It is intentionally ignored by git.

## Minimal Modes

| Mode | Required |
| --- | --- |
| Dashboard demo | Nothing beyond Docker |
| Full stack paper run | `.env`, dashboard secret, RPC URL for chain-backed views |
| Live execution | Wallet key, Safe/proxy wallet, CLOB credentials, funded account, explicit kill switches |

## High-Impact Variables

| Variable | Purpose |
| --- | --- |
| `DASHBOARD_API_SECRET` | Dashboard login password and session signing secret. Minimum 16 characters. |
| `PRIVATE_KEY` | Wallet key used to derive CLOB credentials and sign orders. Required only for execution. |
| `GNOSIS_SAFE_ADDRESS` | Safe address used by signature type 2 flows. |
| `POLYGON_RPC_URL` | Polygon RPC endpoint for chain reads and settlement flows. |
| `CLOB_API_KEY` | Polymarket CLOB API key. |
| `CLOB_API_SECRET` | Polymarket CLOB API secret. |
| `CLOB_PASSPHRASE` | Polymarket CLOB API passphrase. |
| `REDIS_SOCKET_PATH` | Unix socket used by services to communicate with Redis. |

## Dry Run Defaults

Strategy services default to paper behavior through variables such as:

```text
BTC_5M_DRY_RUN=true
BTC_5M_MOM_DRY_RUN=true
BTC_5M_LAT_DRY_RUN=true
ALPHA_DRY_RUN=true
```

Do not set these to `false` until you have reviewed the strategy, risk settings, wallet setup, and kill switch state.

## Kill Switches

Execution requires both a global switch and strategy-specific switches:

```bash
docker exec tradingbot-redis redis-cli -s /var/run/redis/redis.sock SET TRADING_ENABLED TRUE
docker exec tradingbot-redis redis-cli -s /var/run/redis/redis.sock SET BTC_5M_LATENCY_TRADING_ENABLED TRUE
```

Emergency stop:

```bash
docker exec tradingbot-redis redis-cli -s /var/run/redis/redis.sock DEL TRADING_ENABLED
```

## Dashboard Wallet Tracking

The dashboard can track multiple addresses:

```text
WALLET_ADDRESS=0x...
GNOSIS_SAFE_ADDRESS=0x...
POLYMARKET_PROXY_WALLET_ADDRESSES=0x...,0x...
CHAIN_HOLDINGS_ADDRESSES=EOA=0x...,Safe=0x...,Proxy=0x...
```

Use labels in `CHAIN_HOLDINGS_ADDRESSES` when you want the Positions page to be readable for non-technical operators.
