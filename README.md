# Polymarket Research Terminal

> Open-source infrastructure for researching, simulating, monitoring, and safely operating Polymarket strategies.

![License](https://img.shields.io/badge/license-MIT-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)
![Rust](https://img.shields.io/badge/Rust-stable-orange)
![Docker](https://img.shields.io/badge/Docker-Compose-blue)
![Mode](https://img.shields.io/badge/default-safe_demo-purple)

This repository is a full-stack prediction-market research lab: real-time market ingestion, strategy engines, risk controls, paper/live execution plumbing, settlement helpers, monitoring, and a Next.js trading terminal.

It is designed to be useful in three ways:

- **Curious users** can run a wallet-free local demo in a couple of minutes.
- **Builders** can fork the strategy template, add a signal, and see it in the dashboard.
- **Operators** can run the full Docker stack with fail-closed kill switches and paper mode before enabling live execution.

This project does not include accounts, wallets, API keys, or financial advice. Trading is disabled by default.

## Quick Demo

Run the dashboard with synthetic data. No wallet, no API keys, no live order flow.

```bash
git clone https://github.com/<your-org>/<your-repo>.git
cd <your-repo>

make doctor
make demo
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001) and sign in with:

```text
demo_dashboard_secret
```

Stop it with:

```bash
make demo-down
```

The demo starts only Redis, the dashboard, and a synthetic data feeder. Execution services are not started.

## Why People Star This

- **Real architecture, not a toy script** - Rust ingestion, TypeScript strategy services, Redis streams, SQLite analytics, Docker Compose, and CI.
- **Safe first-run experience** - local demo, paper defaults, explicit live opt-in, global and per-strategy kill switches.
- **Hackable strategy surface** - strategies publish typed Redis signals and show up in the dashboard through a registry entry.
- **Production-shaped operations** - Docker images, GCP Terraform, GitHub Actions deployment, Grafana/Prometheus monitoring, runbooks.
- **Readable codebase** - services are split by responsibility instead of hiding everything in one bot process.

## What Is Included

| Area | Services |
| --- | --- |
| Market data | `ingestion`, `signal-core` |
| Crypto strategies | `btc-5m`, `btc-5m-latency`, `btc-5m-momentum`, `crypto-signals` |
| Sports strategies | `sports-signals` |
| Execution and risk | `execution`, `alpha-executor`, `settlement` |
| UI and analytics | `dashboard`, `shared` |
| Operations | Docker Compose, Terraform, Prometheus, Grafana, GitHub Actions |

## Architecture

```text
Polymarket WebSocket
        |
        v
ingestion (Rust) ------ Redis order books / market state
        |
        +--> signal-core (Rust arbitrage scanner)
        +--> btc-5m / latency / momentum strategies
        +--> crypto-signals
        +--> sports-signals
                         |
                         v
                 Redis signal bus
                         |
          +--------------+--------------+
          v                             v
   execution engine              alpha-executor
          |                             |
          +--------------+--------------+
                         v
                    settlement

dashboard reads Redis, SQLite, and optional on-chain balances
```

## Full Stack Setup

Use this path when you want paper trading or live-ready infrastructure.

### Prerequisites

- Docker Desktop or Docker Engine with Compose v2
- Node.js 20+ for local TypeScript development
- Rust stable for local Rust development
- A Polygon RPC URL for live/paper strategy services that need chain reads
- Wallet, Safe, and Polymarket CLOB credentials only if you intend to execute orders

### Configure

```bash
make setup
```

Then edit `.env`. Keep all `*_DRY_RUN=true` values while testing.

To derive CLOB credentials from a funded/authorized key:

```bash
cd scripts
npm install
PRIVATE_KEY=0x... node derive-keys.js
```

Add the printed `CLOB_API_KEY`, `CLOB_API_SECRET`, and `CLOB_PASSPHRASE` to `.env`.

### Run

```bash
make up
make ps
make logs
```

Dashboard:

```text
http://127.0.0.1:3001
```

### Enable Trading

Trading is fail-closed. Missing switches mean no trading.

```bash
# Global enable
docker exec tradingbot-redis redis-cli -s /var/run/redis/redis.sock SET TRADING_ENABLED TRUE

# Emergency stop
docker exec tradingbot-redis redis-cli -s /var/run/redis/redis.sock DEL TRADING_ENABLED
```

Each strategy also has its own switch, for example `BTC_5M_LATENCY_TRADING_ENABLED` and `ALPHA_TRADING_ENABLED`. The global switch and the strategy switch must both be enabled.

## Safety Model

| Layer | Behavior |
| --- | --- |
| Demo mode | No execution services, synthetic data only |
| Dry run | Strategy logic runs, orders are not sent |
| Kill switches | Global and per-strategy Redis flags must be explicitly enabled |
| Risk caps | Max size, slippage, drawdown, streak, and exposure controls |
| Freshness checks | Stale signals and corrupt order books are discarded |
| Deployment hygiene | Secrets live in `.env` or Secret Manager, never in the repo |

See [docs/SAFETY.md](docs/SAFETY.md) for operator guidance.

## Developer Workflow

```bash
make doctor      # verify tools
make demo        # dashboard-only demo
make up          # full local stack
make test        # run configured service tests
make down        # stop full stack
```

Build individual services:

```bash
cd ingestion && cargo build --release
cd signal-core && cargo build --release

cd btc-5m-latency && npm ci && npm run build && npm test
cd dashboard && npm ci && npm run build && npm test
```

## Add A Strategy

1. Create a service directory with `src/index.ts` or Rust equivalent.
2. Read market data from Redis or an external feed.
3. Publish a typed signal to a Redis channel such as `signals:alpha`.
4. Add a risk gate or reuse `alpha-executor`.
5. Add the service to Docker Compose.
6. Register it in `dashboard/src/lib/strategy-registry.ts`.
7. Add tests for signal generation and risk behavior.

More detail: [CONTRIBUTING.md](CONTRIBUTING.md).

## Docs

- [Demo mode](docs/DEMO_MODE.md)
- [Configuration guide](docs/CONFIGURATION.md)
- [Safety guide](docs/SAFETY.md)
- [Deployment runbook](docs/DEPLOY_RUNBOOK.md)
- [Wallet setup](docs/WALLET_SETUP.md)
- [Roadmap](docs/ROADMAP.md)

## Project Structure

```text
.
├── dashboard/          Next.js terminal UI
├── ingestion/          Rust WebSocket order book consumer
├── signal-core/        Rust arbitrage scanner
├── execution/          TypeScript CLOB order execution
├── settlement/         Position merge and settlement helper
├── alpha-executor/     Unified alpha execution and portfolio risk
├── btc-5m*/            BTC 5-minute strategy variants
├── crypto-signals/     Multi-asset crypto signal service
├── sports-signals/     NBA/NCAA signal service
├── shared/             Shared types, Redis keys, SQLite helpers
├── infrastructure/     Terraform, Redis, monitoring
├── scripts/            Setup, demo, and utility scripts
└── docs/               Operator and contributor documentation
```

## Responsible Use

Prediction markets and automated trading involve financial, legal, and operational risk. Use this software only where permitted, start with demo or paper mode, review every strategy before running it, and never commit secrets.

## License

[MIT](LICENSE)
