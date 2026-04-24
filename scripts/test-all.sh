#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_npm() {
  local service="$1"

  if [ ! -f "$ROOT/$service/package.json" ]; then
    return
  fi

  printf "\n==> %s: npm checks\n" "$service"
  if [ ! -d "$ROOT/$service/node_modules" ]; then
    npm --prefix "$ROOT/$service" ci
  fi

  local scripts
  scripts="$(npm --prefix "$ROOT/$service" run 2>/dev/null || true)"
  if grep -q " build" <<<"$scripts"; then
    npm --prefix "$ROOT/$service" run build
  fi
  if grep -q " test" <<<"$scripts"; then
    case "$service" in
      btc-5m-latency|btc-5m-momentum)
        npm --prefix "$ROOT/$service" test -- --runInBand
        ;;
      *)
        npm --prefix "$ROOT/$service" test
        ;;
    esac
  fi
}

run_cargo() {
  local service="$1"

  if [ ! -f "$ROOT/$service/Cargo.toml" ]; then
    return
  fi

  printf "\n==> %s: cargo test\n" "$service"
  cargo test --manifest-path "$ROOT/$service/Cargo.toml"
}

run_cargo ingestion
run_cargo signal-core

for service in \
  shared \
  execution \
  settlement \
  btc-5m \
  btc-5m-momentum \
  btc-5m-latency \
  crypto-signals \
  sports-signals \
  alpha-executor \
  dashboard
do
  run_npm "$service"
done

printf "\nAll configured checks completed.\n"
