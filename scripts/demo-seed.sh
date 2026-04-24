#!/bin/sh
set -eu

SOCKET="${REDIS_SOCKET_PATH:-/var/run/redis/redis.sock}"
TRADE_COUNTER=0
MESSAGES=100000

redis() {
  redis-cli -s "$SOCKET" "$@"
}

wait_for_redis() {
  until redis PING >/dev/null 2>&1; do
    echo "Waiting for Redis at $SOCKET..."
    sleep 1
  done
}

seed_static_markets() {
  redis DEL markets:active >/dev/null

  redis SADD markets:active \
    demo-btc-window \
    demo-fed-cut \
    demo-nba-finals \
    demo-eth-window >/dev/null

  redis HSET market:demo-btc-window \
    yes_token demo-btc-yes \
    no_token demo-btc-no \
    market_name "Demo: BTC closes above current 5m open" >/dev/null
  redis HSET market:demo-fed-cut \
    yes_token demo-fed-yes \
    no_token demo-fed-no \
    market_name "Demo: Fed cuts rates this quarter" >/dev/null
  redis HSET market:demo-nba-finals \
    yes_token demo-nba-yes \
    no_token demo-nba-no \
    market_name "Demo: Home team wins tonight" >/dev/null
  redis HSET market:demo-eth-window \
    yes_token demo-eth-yes \
    no_token demo-eth-no \
    market_name "Demo: ETH closes green in next window" >/dev/null
}

seed_books() {
  redis DEL \
    ob:demo-btc-yes:bids ob:demo-btc-yes:asks ob:demo-btc-no:bids ob:demo-btc-no:asks \
    ob:demo-fed-yes:bids ob:demo-fed-yes:asks ob:demo-fed-no:bids ob:demo-fed-no:asks \
    ob:demo-nba-yes:bids ob:demo-nba-yes:asks ob:demo-nba-no:bids ob:demo-nba-no:asks \
    ob:demo-eth-yes:bids ob:demo-eth-yes:asks ob:demo-eth-no:bids ob:demo-eth-no:asks >/dev/null

  redis ZADD ob:demo-btc-yes:bids 0.51 btc-yes-bid >/dev/null
  redis ZADD ob:demo-btc-yes:asks 0.52 btc-yes-ask >/dev/null
  redis ZADD ob:demo-btc-no:bids 0.46 btc-no-bid >/dev/null
  redis ZADD ob:demo-btc-no:asks 0.47 btc-no-ask >/dev/null

  redis ZADD ob:demo-fed-yes:bids 0.34 fed-yes-bid >/dev/null
  redis ZADD ob:demo-fed-yes:asks 0.36 fed-yes-ask >/dev/null
  redis ZADD ob:demo-fed-no:bids 0.63 fed-no-bid >/dev/null
  redis ZADD ob:demo-fed-no:asks 0.65 fed-no-ask >/dev/null

  redis ZADD ob:demo-nba-yes:bids 0.58 nba-yes-bid >/dev/null
  redis ZADD ob:demo-nba-yes:asks 0.60 nba-yes-ask >/dev/null
  redis ZADD ob:demo-nba-no:bids 0.39 nba-no-bid >/dev/null
  redis ZADD ob:demo-nba-no:asks 0.41 nba-no-ask >/dev/null

  redis ZADD ob:demo-eth-yes:bids 0.49 eth-yes-bid >/dev/null
  redis ZADD ob:demo-eth-yes:asks 0.50 eth-yes-ask >/dev/null
  redis ZADD ob:demo-eth-no:bids 0.48 eth-no-bid >/dev/null
  redis ZADD ob:demo-eth-no:asks 0.49 eth-no-ask >/dev/null
}

publish_trade() {
  now_ms="$1"
  pnl="$2"
  strategy="$3"
  market="$4"
  direction="$5"
  price="$6"
  size="$7"

  json="{\"strategy\":\"$strategy\",\"market\":\"$market\",\"direction\":\"$direction\",\"pnl\":$pnl,\"timestamp\":$now_ms,\"price\":$price,\"size\":$size,\"dryRun\":true}"
  redis LPUSH trades:history "$json" >/dev/null
  redis LTRIM trades:history 0 49 >/dev/null

  case "$strategy" in
    btc5m_latency) channel="results:btc5m_latency" ;;
    alpha-sports) channel="results:alpha" ;;
    crypto-signals) channel="results:alpha" ;;
    *) channel="results:execution" ;;
  esac
  redis PUBLISH "$channel" "$json" >/dev/null
}

wait_for_redis
seed_static_markets
seed_books

echo "Demo data feeder started. All trading switches remain disabled."

while true; do
  now_s="$(date +%s)"
  now_ms="${now_s}000"
  MESSAGES=$((MESSAGES + 137))

  redis SET safe:balance:usdce 10000.00 >/dev/null
  redis SET TRADING_ENABLED FALSE >/dev/null
  redis SET BTC_5M_TRADING_ENABLED FALSE >/dev/null
  redis SET BTC_5M_MOMENTUM_TRADING_ENABLED FALSE >/dev/null
  redis SET BTC_5M_LATENCY_TRADING_ENABLED FALSE >/dev/null
  redis SET ALPHA_TRADING_ENABLED FALSE >/dev/null
  redis SET CRYPTO_SIGNALS_ENABLED FALSE >/dev/null
  redis SET SPORTS_SIGNALS_ENABLED FALSE >/dev/null

  redis SET config:btc5m:max_position_usdc 500 >/dev/null
  redis SET config:btc5m_momentum:max_bet_usdc 100 >/dev/null
  redis SET config:execution:max_slippage_bps 50 >/dev/null

  redis HSET ingestion:stats \
    messages_received "$MESSAGES" \
    last_update "$now_s" >/dev/null
  redis HSET scanner:stats \
    opportunities_found 4 \
    avg_scan_time_us 84 \
    last_update "$now_ms" >/dev/null
  redis HSET execution:stats \
    total_profit 128.42 \
    total_executions 17 \
    last_execution_ms "$now_ms" >/dev/null
  redis HSET settlement:stats \
    merged_positions 3 \
    recovered_usdc 244.18 \
    last_merge_ms "$now_ms" >/dev/null
  redis HSET btc5m:stats \
    totalPnl 48.25 \
    dailyPnl 12.40 \
    winRate 0.58 \
    totalTrades 36 \
    lastScanTime "$now_ms" >/dev/null
  redis HSET btc5m:window:current \
    bestDirection UP \
    confidence 0.64 \
    openPrice 65000 \
    timestamp "$now_ms" >/dev/null
  redis HSET btc5m_momentum:stats \
    wins 11 \
    losses 7 \
    winRate 0.61 \
    dailyProfit 22.80 \
    dailyVolume 1240 \
    lastTradeTime "$now_ms" >/dev/null
  redis HSET btc5m_momentum:window:current \
    direction UP \
    confidence 0.57 \
    openPrice 65000 \
    timestamp "$now_ms" >/dev/null
  redis HSET btc5m_latency:stats \
    wins 19 \
    losses 12 \
    winRate 0.61 \
    totalTrades 31 \
    dailyProfit 31.10 \
    totalPnl 94.70 \
    lastTradeTime "$now_ms" >/dev/null
  redis HSET alpha:portfolio \
    totalExposure 1420.50 \
    peakCapital 10000 \
    realizedPnl 186.25 \
    dailyLoss 0 >/dev/null
  redis HSET alpha:stats \
    signals_processed 220 \
    accepted_signals 41 \
    rejected_signals 179 \
    last_update "$now_ms" >/dev/null

  if [ $((TRADE_COUNTER % 5)) -eq 0 ]; then
    publish_trade "$now_ms" 8.42 btc5m_latency "Demo: BTC closes above current 5m open" UP 0.52 120
  elif [ $((TRADE_COUNTER % 5)) -eq 2 ]; then
    publish_trade "$now_ms" -3.15 crypto-signals "Demo: ETH closes green in next window" YES 0.50 80
  elif [ $((TRADE_COUNTER % 5)) -eq 4 ]; then
    publish_trade "$now_ms" 14.90 alpha-sports "Demo: Home team wins tonight" YES 0.60 60
  fi

  TRADE_COUNTER=$((TRADE_COUNTER + 1))
  sleep 2
done
