# Safety Guide

This project can be wired to real funds. Treat every deployment like production software, even when you are experimenting.

## Recommended Progression

1. Run `make demo` and inspect the dashboard with synthetic data.
2. Run the full stack with all `*_DRY_RUN=true` values.
3. Review logs, order sizing, strategy assumptions, and risk limits.
4. Fund only a small test amount.
5. Enable one strategy at a time.
6. Monitor the dashboard and logs during the first sessions.

## Fail-Closed Trading

Trading is disabled unless Redis contains the required enable flags.

Global switch:

```text
TRADING_ENABLED=TRUE
```

Examples of strategy switches:

```text
BTC_5M_TRADING_ENABLED=TRUE
BTC_5M_LATENCY_TRADING_ENABLED=TRUE
BTC_5M_MOMENTUM_TRADING_ENABLED=TRUE
ALPHA_TRADING_ENABLED=TRUE
```

If the global key is missing or false, execution should not place orders.

## Emergency Stop

```bash
docker exec tradingbot-redis redis-cli -s /var/run/redis/redis.sock DEL TRADING_ENABLED
```

For a harder stop:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml stop execution alpha-executor settlement
```

## Risk Controls To Review

- Maximum order size
- Maximum slippage
- Maximum daily loss
- Maximum session drawdown
- Consecutive loss streak breaker
- Signal freshness windows
- Exposure caps by vertical and correlated assets
- Oracle/exchange divergence limits

The defaults are templates, not guarantees. Tune them for your bankroll, latency, market depth, and jurisdiction.

## Secrets

Never commit:

- `.env`
- private keys
- CLOB credentials
- RPC URLs with embedded credentials
- dashboard passwords
- cloud service account JSON

The repository includes `.gitleaks.toml` and a CI secret scan, but local discipline matters more.

## Operational Notes

- Prefer a new wallet/Safe dedicated to this system.
- Keep paper mode on while changing strategy logic.
- Use small max order sizes after each deploy.
- Rotate keys after sharing logs or screenshots that may include sensitive metadata.
- Review local laws and platform terms before operating any live strategy.
