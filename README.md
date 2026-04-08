# Polymarket Trading Platform

A 12-service automated trading system for [Polymarket](https://polymarket.com) prediction markets, running multiple strategies simultaneously — from sub-second arbitrage scanning to Bayesian sports modeling. Built with Rust and TypeScript, orchestrated via Docker Compose, with a real-time Bloomberg terminal-style dashboard.

This started as a box spread arbitrage bot and grew into a multi-strategy platform handling live capital on Polygon L2.

## Architecture

```
                         ┌─────────────────────────────────────────────────────┐
                         │              Polymarket WebSocket                    │
                         └──────────────────────┬──────────────────────────────┘
                                                │
                                                ▼
                         ┌──────────────────────────────────────────────────────┐
                         │            ingestion (Rust)                           │
                         │   Real-time order book mirror for all active markets │
                         │   tokio-tungstenite · DashMap · sequence gap detect  │
                         └──────────────────────┬───────────────────────────────┘
                                                │
                              Redis (Unix socket, ZSETs + pub/sub)
                    ┌───────────────┬───────────┴───────────┬───────────────────┐
                    │               │                       │                   │
                    ▼               ▼                       ▼                   ▼
          ┌─────────────┐ ┌─────────────────┐ ┌──────────────────┐  ┌──────────────────┐
          │ signal-core │ │  btc-5m-latency │ │  crypto-signals  │  │  sports-signals  │
          │   (Rust)    │ │  (TypeScript)   │ │   (TypeScript)   │  │   (TypeScript)   │
          │             │ │                 │ │                  │  │                  │
          │ Box spread  │ │ Exchange/oracle │ │ BTC/ETH/SOL via  │  │ NBA + NCAA via   │
          │ arbitrage   │ │ latency arb     │ │ Binance WebSocket│  │ ESPN live scores │
          │ O(1) scan   │ │ Kelly criterion │ │ Sigmoid model    │  │ Bayesian model   │
          └──────┬──────┘ └────────┬────────┘ └────────┬─────────┘  └────────┬─────────┘
                 │                 │                    │                     │
                 │     Redis pub/sub (signals:*)        │                     │
                 └─────────┬───────┴────────────────────┴─────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
    ┌──────────────────┐      ┌──────────────────┐
    │    execution     │      │  alpha-executor   │
    │   (TypeScript)   │      │   (TypeScript)    │
    │                  │      │                   │
    │ EIP-712 signing  │      │ Portfolio risk    │
    │ HMAC auth        │      │ Kelly sizing      │
    │ CLOB API orders  │      │ Exposure caps     │
    └────────┬─────────┘      └────────┬──────────┘
             │                         │
             └────────────┬────────────┘
                          ▼
              ┌──────────────────────┐
              │     settlement       │
              │    (TypeScript)      │
              │                     │
              │ Merge YES+NO → USDCe│
              │ via Polymarket      │
              │ gas-less relayer    │
              └─────────────────────┘

    ┌──────────────────────────────────────────────────────────┐
    │                  dashboard (Next.js)                      │
    │   Bloomberg terminal UI · SSE streams · on-chain data    │
    │   5 pages · strategy registry · SQLite analytics         │
    └──────────────────────────────────────────────────────────┘
```

## Strategies

### Box Spread Arbitrage — `signal-core` (Rust)
Scans all active markets for mispricing: when `YES_ask + NO_ask < $1.00`, both sides are bought simultaneously. The position is guaranteed to pay out $1.00 regardless of outcome. Lock-free O(1) scanning across all order books.

### Latency Arbitrage — `btc-5m-latency` (TypeScript)
Detects divergence between exchange prices (Binance + Coinbase WebSocket) and Polymarket's Chainlink oracle for BTC 5-minute UP/DOWN markets. Uses a Normal CDF probability model with z-score filtering, Kelly criterion sizing (quarter-Kelly), and regime detection (volatility floor, min delta, streak pause). This is the primary live strategy.

### Crypto Signals — `crypto-signals` (TypeScript)
Multi-asset directional signals (BTC/ETH/SOL) via Binance WebSocket. Sigmoid confidence model maps raw price movements to position sizing. Publishes to the alpha signal bus.

### Sports Signals — `sports-signals` (TypeScript)
Live in-game trading signals for NBA and NCAA basketball via ESPN's real-time scoreboard API.

- **NBA**: Logistic regression model (`K=0.50`) converting score differentials and time remaining to win probabilities
- **NCAA March Madness**: Bayesian Normal CDF model (`sigma=17.2`) with pregame spread as a fading prior. Dynamic edge thresholds scale from 5% at tipoff to 15% in final minutes. 4-minute cutoff prevents late-game noise

### Alpha Executor — `alpha-executor` (TypeScript)
Unified execution engine for all alpha signals with portfolio-level risk management:
- 3 capital phases with progressive Kelly fractions (1/4 → 1/2 → 3/4)
- Vertical exposure caps (crypto 50%, sports 40%)
- Correlated asset protection (BTC/ETH/SOL treated as correlated)
- Shared capital awareness across all strategies

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Data ingestion** | Rust, tokio, tokio-tungstenite, DashMap |
| **Strategy engines** | TypeScript, Decimal.js, Normal CDF, Kelly criterion |
| **Execution** | ethers.js (EIP-712 signing), HMAC-SHA256, CLOB API |
| **Dashboard** | Next.js 14, Tailwind CSS, Recharts, viem, SSE |
| **Persistence** | Redis 7 (real-time), SQLite (historical) |
| **Infrastructure** | Docker Compose, Terraform (GCP), GitHub Actions CI/CD |
| **Chain** | Polygon L2, USDCe, Conditional Tokens (ERC-1155) |

## Dashboard

Bloomberg terminal-inspired monitoring interface built with Next.js. IBM Plex Mono, `#00ff41` green-on-black, zero border-radius, dense data tables.

**5 pages**: Overview (portfolio summary, recent trades, P&L), Crypto (live signals, price feeds), Sports (NBA/NCAA scores, signal history), Positions (open/closed, on-chain token balances), System (kill switches, service health, Redis stats).

Key features:
- Per-page SSE routes with domain-specific Redis readers at different poll intervals
- Strategy registry — add a new strategy by adding one entry to `strategy-registry.ts`
- On-chain holdings via viem + Polygon RPC with multi-wallet tracking
- SQLite-backed REST API for historical trades, signals, positions, daily stats

## Quick Start

### Prerequisites
- Docker and Docker Compose
- A Gnosis Safe on Polygon with USDCe
- A wallet private key (owner on the Safe)
- A non-US server (Polymarket is geo-restricted)

### Setup

```bash
git clone https://github.com/dantraynor/algorithmic-trading-polymarket.git
cd algorithmic-trading-polymarket

# Configure credentials
cp .env.example .env
# Edit .env: PRIVATE_KEY, GNOSIS_SAFE_ADDRESS, POLYGON_RPC_URL

# Derive CLOB API keys (must run from the server that will trade)
cd scripts && npm install && PRIVATE_KEY=0x... node derive-keys.js
# Add CLOB_API_KEY, CLOB_API_SECRET, CLOB_PASSPHRASE to .env

# Start everything
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

# Verify
docker compose ps
docker compose logs -f
```

### Enable Trading

Trading is **disabled by default** (fail-closed design). Nothing executes until you explicitly opt in.

```bash
# Enable
docker exec tradingbot-redis redis-cli -s /var/run/redis/redis.sock SET TRADING_ENABLED TRUE

# Emergency stop
docker exec tradingbot-redis redis-cli -s /var/run/redis/redis.sock DEL TRADING_ENABLED
```

Each strategy also has its own kill switch (`BTC_5M_LATENCY_TRADING_ENABLED`, `ALPHA_TRADING_ENABLED`, etc.). Both the global and strategy-specific switches must be `TRUE` for trades to execute.

## Safety Systems

This handles real money. Multiple layers of protection:

| System | What it does |
|--------|-------------|
| **Kill switches** | Fail-closed: missing key = no trading. Global + per-strategy. |
| **Daily loss limits** | Auto-disables strategy after configurable daily loss threshold |
| **Streak breaker** | Pauses after N consecutive losses |
| **Oracle divergence halt** | Stops if Chainlink and exchange prices diverge > threshold for > 30s |
| **Signal freshness** | Discards stale signals (configurable per strategy) |
| **Slippage protection** | Re-checks prices before every order; skips if moved too far |
| **Volatility warmup** | Requires N price samples before trading to avoid bad signals on startup |
| **Sequence gap detection** | Discards corrupt order books and waits for fresh snapshot |
| **Vertical exposure caps** | Limits concentration in correlated assets |

## Redis Data Model

All services communicate through Redis Unix domain sockets:

```
# Order books (real-time mirror of Polymarket)
ob:{tokenId}:bids          — ZSET (price → entry ID)
ob:{tokenId}:asks          — ZSET (price → entry ID)
ob:{tokenId}:bids:sizes    — HASH (price → total size)
ob:{tokenId}:asks:sizes    — HASH (price → total size)

# Markets
markets:active             — SET of active condition IDs
market:{conditionId}       — HASH (yes_token, no_token, market_name)

# Signals & results (pub/sub)
signals:arbitrage           signals:alpha
results:execution           results:btc5m_latency       results:alpha

# Stats per strategy
btc5m_latency:stats         execution:stats
scanner:stats               settlement:stats            alpha:stats

# Kill switches
TRADING_ENABLED             BTC_5M_LATENCY_TRADING_ENABLED
ALPHA_TRADING_ENABLED       CRYPTO_SIGNALS_ENABLED
SPORTS_SIGNALS_ENABLED      NCAAM_SIGNALS_ENABLED
```

## Deployment

The included Terraform config provisions a GCP Compute Engine instance with Docker, and GitHub Actions handles CI/CD (build images on push to main, deploy via SSH).

```bash
cd infrastructure/terraform
cp terraform.tfvars.example terraform.tfvars   # fill in project_id, region, zone, SSH CIDR
terraform init -backend-config="bucket=YOUR_STATE_BUCKET"
terraform apply
```

See [`docs/DEPLOY_RUNBOOK.md`](docs/DEPLOY_RUNBOOK.md) for the full deployment walkthrough and [`docs/WALLET_SETUP.md`](docs/WALLET_SETUP.md) for Gnosis Safe setup.

## Project Structure

```
tradingbot/
├── ingestion/          Rust — WebSocket order book consumer
├── signal-core/        Rust — Box spread arbitrage scanner
├── execution/          TypeScript — CLOB API order execution
├── settlement/         TypeScript — Position merge / USDCe recovery
├── btc-5m/             TypeScript — BTC 5-min box spread strategy
├── btc-5m-latency/     TypeScript — BTC latency arbitrage (primary)
├── btc-5m-momentum/    TypeScript — BTC momentum sniper (paper)
├── crypto-signals/     TypeScript — Multi-asset crypto signals
├── sports-signals/     TypeScript — NBA + NCAA live betting signals
├── alpha-executor/     TypeScript — Unified alpha execution + risk
├── dashboard/          Next.js — Bloomberg terminal monitoring
├── shared/             TypeScript — Common types, Redis keys, SQLite
├── infrastructure/     Terraform + Redis config
├── scripts/            CLOB key derivation, cron monitors
└── .github/workflows/  CI/CD pipeline
```

## Contract Addresses (Polygon)

| Contract | Address |
|----------|---------|
| CTF Exchange | `0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E` |
| Conditional Tokens (ERC-1155) | `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045` |
| USDCe | `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174` |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome — especially new strategies, dashboard improvements, and additional exchange integrations.

## License

[MIT](LICENSE)

## Disclaimer

This software is provided for educational and research purposes. Trading on prediction markets involves significant financial risk. You are solely responsible for any trades executed using this software. Always start with paper trading (`DRY_RUN=true`) before risking real capital.
