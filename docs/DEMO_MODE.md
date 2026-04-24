# Demo Mode

Demo mode is the fastest way to understand the project without connecting a wallet or sending orders.

## Start

```bash
make doctor
make demo
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001).

Password:

```text
demo_dashboard_secret
```

## What Runs

Demo mode starts only:

- `redis`
- `dashboard`
- `demo-seed`

The `demo-seed` container writes synthetic balances, service health, market books, and paper trade events into Redis. It does not connect to Polymarket, Binance, ESPN, a wallet, or a Polygon RPC.

## What Does Not Run

Demo mode does not start:

- `execution`
- `alpha-executor`
- `settlement`
- any strategy that can place an order

All trading switches are continuously set to `FALSE`.

## Useful Commands

```bash
make demo-logs
make demo-down
```

If you want to reset demo data completely:

```bash
docker volume rm algorithmic-trading-polymarket-main_redis-data
```

The exact volume name can vary if your checkout directory has a different name. Run `docker volume ls | grep redis-data` if needed.
