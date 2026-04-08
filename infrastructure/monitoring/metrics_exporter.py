#!/usr/bin/env python3
"""
Custom Prometheus exporter for Polymarket Trading Bot metrics.
Reads stats from Redis and exposes them as Prometheus metrics.
"""

import os
import time
from prometheus_client import start_http_server, Gauge, Counter, Info
import redis

# Configuration
REDIS_SOCKET = os.environ.get('REDIS_SOCKET_PATH', '/var/run/redis/redis.sock')
METRICS_PORT = int(os.environ.get('METRICS_PORT', '9122'))

# Scanner Metrics
scanner_total_scans = Gauge('tradingbot_scanner_total_scans', 'Total number of market scans')
scanner_opportunities = Gauge('tradingbot_scanner_opportunities_found', 'Number of arbitrage opportunities found')
scanner_signals_sent = Gauge('tradingbot_scanner_signals_sent', 'Number of signals sent to execution')
scanner_avg_scan_time = Gauge('tradingbot_scanner_avg_scan_time_us', 'Average scan time in microseconds')
scanner_last_update = Gauge('tradingbot_scanner_last_update_timestamp', 'Last scanner update timestamp')

# Execution Metrics
execution_orders_submitted = Gauge('tradingbot_execution_orders_submitted', 'Total orders submitted')
execution_orders_filled = Gauge('tradingbot_execution_orders_filled', 'Total orders filled')
execution_orders_failed = Gauge('tradingbot_execution_orders_failed', 'Total orders failed')
execution_total_volume = Gauge('tradingbot_execution_total_volume_usd', 'Total trading volume in USD')
execution_total_profit = Gauge('tradingbot_execution_total_profit_usd', 'Total profit in USD')
execution_avg_latency = Gauge('tradingbot_execution_avg_latency_ms', 'Average execution latency in ms')

# Settlement Metrics
settlement_merges_completed = Gauge('tradingbot_settlement_merges_completed', 'Total position merges completed')
settlement_merges_failed = Gauge('tradingbot_settlement_merges_failed', 'Total position merges failed')
settlement_total_redeemed = Gauge('tradingbot_settlement_total_redeemed_usd', 'Total USDC redeemed from merges')

# System Metrics
trading_enabled = Gauge('tradingbot_trading_enabled', 'Trading kill switch status (1=enabled, 0=disabled)')
active_markets = Gauge('tradingbot_active_markets', 'Number of active markets being monitored')
safe_balance = Gauge('tradingbot_safe_balance_usdce', 'Gnosis Safe USDCe balance')

# Order Book Metrics
orderbook_depth = Gauge('tradingbot_orderbook_depth', 'Order book depth', ['token_id', 'side'])
orderbook_spread = Gauge('tradingbot_orderbook_spread_bps', 'Order book spread in basis points', ['market_id'])


def get_redis_connection():
    """Create Redis connection via Unix socket."""
    return redis.Redis(unix_socket_path=REDIS_SOCKET, decode_responses=True)


def collect_scanner_metrics(r):
    """Collect scanner statistics from Redis."""
    stats = r.hgetall('scanner:stats')
    if stats:
        scanner_total_scans.set(float(stats.get('total_scans', 0)))
        scanner_opportunities.set(float(stats.get('opportunities_found', 0)))
        scanner_signals_sent.set(float(stats.get('signals_sent', 0)))
        scanner_avg_scan_time.set(float(stats.get('avg_scan_time_us', 0)))
        scanner_last_update.set(float(stats.get('last_update', 0)))


def collect_execution_metrics(r):
    """Collect execution statistics from Redis."""
    stats = r.hgetall('execution:stats')
    if stats:
        execution_orders_submitted.set(float(stats.get('orders_submitted', 0)))
        execution_orders_filled.set(float(stats.get('orders_filled', 0)))
        execution_orders_failed.set(float(stats.get('orders_failed', 0)))
        execution_total_volume.set(float(stats.get('total_volume_usd', 0)))
        execution_total_profit.set(float(stats.get('total_profit_usd', 0)))
        execution_avg_latency.set(float(stats.get('avg_latency_ms', 0)))


def collect_settlement_metrics(r):
    """Collect settlement statistics from Redis."""
    stats = r.hgetall('settlement:stats')
    if stats:
        settlement_merges_completed.set(float(stats.get('merges_completed', 0)))
        settlement_merges_failed.set(float(stats.get('merges_failed', 0)))
        settlement_total_redeemed.set(float(stats.get('total_redeemed_usd', 0)))


def collect_system_metrics(r):
    """Collect system-level metrics."""
    # Trading enabled status
    enabled = r.get('TRADING_ENABLED')
    trading_enabled.set(1 if enabled and enabled.upper() == 'TRUE' else 0)

    # Active markets count
    markets = r.smembers('markets:active')
    active_markets.set(len(markets) if markets else 0)

    # Safe balance
    balance = r.get('safe:balance:usdce')
    if balance:
        safe_balance.set(float(balance))


def collect_all_metrics():
    """Collect all metrics from Redis."""
    try:
        r = get_redis_connection()

        collect_scanner_metrics(r)
        collect_execution_metrics(r)
        collect_settlement_metrics(r)
        collect_system_metrics(r)

        r.close()
    except Exception as e:
        print(f"Error collecting metrics: {e}")


def main():
    """Main entry point."""
    print(f"Starting Tradingbot Metrics Exporter on port {METRICS_PORT}")
    print(f"Redis socket: {REDIS_SOCKET}")

    # Start HTTP server
    start_http_server(METRICS_PORT)

    # Collection loop
    while True:
        collect_all_metrics()
        time.sleep(1)  # Collect every second


if __name__ == '__main__':
    main()
