# Contributing

Thanks for your interest in contributing to the Polymarket trading platform.

## Getting Started

1. Fork the repo and clone it locally
2. Copy `.env.example` to `.env` and fill in your credentials
3. Run `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`
4. Make your changes on a feature branch

## Development

### Building individual services

```bash
# Rust services
cd ingestion && cargo build --release
cd signal-core && cargo build --release

# TypeScript services
cd <service> && npm install && npm run build

# Run tests
cd <service> && npm test       # TypeScript
cd <service> && cargo test     # Rust
```

### Code conventions

- **Rust**: `tracing` crate for structured logging, `thiserror` for custom errors
- **TypeScript**: Winston logger, strict null checks, Decimal.js for financial math (never floating point)
- **Dashboard**: Bloomberg `bb-*` color tokens, zero border-radius, IBM Plex Mono 11px
- All services implement graceful shutdown (SIGINT/SIGTERM handlers)
- Exponential backoff for all reconnection logic

### Adding a new strategy

1. Create a new service directory (e.g. `my-strategy/`)
2. Connect to Redis via Unix socket, read order books or external data
3. Publish signals to a Redis pub/sub channel
4. Add a Dockerfile and entry in `docker-compose.yml`
5. Add a kill switch key in Redis (follow the `*_TRADING_ENABLED` pattern)
6. If using the dashboard, add one entry to `dashboard/src/lib/strategy-registry.ts`

## Pull Requests

- Keep PRs focused — one feature or fix per PR
- Include a clear description of what changed and why
- Add tests for new strategy logic or risk management changes
- Make sure `cargo build --release` and `npm run build` pass for affected services
- Don't commit `.env` files or anything with secrets

## Reporting Issues

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Relevant logs (sanitize any wallet addresses or API keys)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
