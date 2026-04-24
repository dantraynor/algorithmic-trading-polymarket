#!/usr/bin/env bash
set -euo pipefail

failures=0

check_cmd() {
  local name="$1"
  local hint="$2"
  if command -v "$name" >/dev/null 2>&1; then
    printf "ok   %-18s %s\n" "$name" "$($name --version 2>/dev/null | head -n 1 || true)"
  else
    printf "miss %-18s %s\n" "$name" "$hint"
    failures=$((failures + 1))
  fi
}

check_optional_cmd() {
  local name="$1"
  local hint="$2"
  if command -v "$name" >/dev/null 2>&1; then
    printf "ok   %-18s %s\n" "$name" "$($name --version 2>/dev/null | head -n 1 || true)"
  else
    printf "warn %-18s %s\n" "$name" "$hint"
  fi
}

printf "\nTooling\n"
check_cmd docker "Install Docker Desktop: https://docs.docker.com/desktop/"

if docker compose version >/dev/null 2>&1; then
  printf "ok   %-18s %s\n" "docker compose" "$(docker compose version --short 2>/dev/null || docker compose version)"
else
  printf "miss %-18s Docker Compose v2 is required\n" "docker compose"
  failures=$((failures + 1))
fi

check_optional_cmd node "Needed only for local TypeScript service development"
check_optional_cmd npm "Needed only for local TypeScript service development"
check_optional_cmd cargo "Needed only for local Rust service development"

printf "\nConfiguration\n"
if [ -f .env ]; then
  printf "ok   %-18s found\n" ".env"
else
  printf "warn %-18s not found; run 'make setup' before full-stack live/paper runs\n" ".env"
fi

if [ -f docker-compose.demo.yml ]; then
  printf "ok   %-18s available\n" "demo compose"
else
  printf "miss %-18s docker-compose.demo.yml missing\n" "demo compose"
  failures=$((failures + 1))
fi

if [ "$failures" -gt 0 ]; then
  printf "\nDoctor found %s blocking issue(s).\n" "$failures"
  exit 1
fi

printf "\nReady. Try 'make demo' for the wallet-free dashboard.\n"
