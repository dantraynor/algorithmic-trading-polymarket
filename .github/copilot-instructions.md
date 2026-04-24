# Polymarket Research Terminal - Development Notes

## Architecture

This is a multi-service prediction-market research and execution stack.

- `ingestion` - Rust WebSocket consumer for Polymarket order books
- `signal-core` - Rust arbitrage scanner
- `execution` - TypeScript CLOB order execution
- `settlement` - TypeScript position merge and settlement helper
- `btc-5m*` - BTC 5-minute strategy variants
- `crypto-signals` - multi-asset crypto signal publisher
- `sports-signals` - sports signal publisher
- `alpha-executor` - portfolio-aware signal execution and risk
- `dashboard` - Next.js monitoring and controls
- `shared` - common types, Redis keys, and SQLite helpers

## Safety Defaults

- Demo mode must not start execution services.
- Dry-run mode should remain the default for strategy services.
- Live execution must require `TRADING_ENABLED=TRUE` and the relevant strategy switch.
- Do not add code paths that place orders from dashboard-only or demo flows.

## Critical Constants

- WebSocket: `wss://ws-subscriptions-clob.polymarket.com`
- Order type: FOK (Fill or Kill)
- Signature type: 2 (Gnosis Safe)
- Redis socket: `/var/run/redis/redis.sock`

## Common Commands

```bash
make doctor
make demo
make up
make test
make down
```

## Code Style

- Keep strategy signal generation separate from execution.
- Use Decimal.js or integer math for financial calculations.
- Prefer typed payloads and explicit config parsing.
- Add focused tests for signal, sizing, and risk behavior.
- Never commit `.env`, private keys, CLOB credentials, or dashboard secrets.
