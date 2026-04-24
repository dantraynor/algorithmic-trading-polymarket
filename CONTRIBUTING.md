# Contributing

Thanks for helping improve the Polymarket Research Terminal.

The best contributions make the project safer, easier to run, easier to inspect, or easier to extend. Avoid changes that make live trading more automatic without adding stronger guardrails.

## First Run

```bash
make doctor
make demo
```

Use the demo to understand the dashboard before wiring real services.

For full-stack development:

```bash
make setup
make up
make logs
```

Keep all dry-run variables enabled unless your change specifically requires execution testing.

## Development Commands

```bash
make test
make build
make down
```

Individual services:

```bash
cd ingestion && cargo test
cd signal-core && cargo test

cd dashboard && npm ci && npm run build && npm test
cd alpha-executor && npm ci && npm run build && npm test
```

## Code Conventions

- Rust services use `tracing`, explicit error handling, and graceful shutdown.
- TypeScript services use strict config parsing and Decimal.js for financial math.
- Strategy code should keep signal generation separate from execution.
- Dashboard UI should prioritize dense, readable operational state over decoration.
- All new strategy behavior needs focused unit tests for signal and risk decisions.

## Adding A Strategy

1. Create a service directory.
2. Add a config module with safe defaults.
3. Read market data from Redis or a documented external feed.
4. Publish typed signals to Redis.
5. Gate execution behind dry-run mode and kill switches.
6. Register dashboard metadata in `dashboard/src/lib/strategy-registry.ts`.
7. Add tests and docs.

## Pull Requests

Open focused PRs. Include:

- What changed
- Why it changed
- How to run or test it
- Any safety impact
- Screenshots for dashboard changes

Do not commit `.env`, keys, wallet addresses you do not intend to publish, API credentials, or generated secrets.

## Issue Reports

Include:

- Expected behavior
- Actual behavior
- Reproduction steps
- Relevant logs with secrets removed
- Whether you were in demo, paper, or live mode

## Security

Report sensitive issues privately. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contribution is licensed under the MIT License.
