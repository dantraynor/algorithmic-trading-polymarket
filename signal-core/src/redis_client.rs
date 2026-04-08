//! Redis client for signal core

use redis::{AsyncCommands, Client};
use tracing::{debug, info};

use crate::types::{MarketPair, ArbitrageSignal};

const KILL_SWITCH_KEY: &str = "TRADING_ENABLED";
const OB_PREFIX: &str = "ob";

pub struct RedisClient {
    client: Client,
}

impl RedisClient {
    pub async fn new(socket_path: &str) -> anyhow::Result<Self> {
        let redis_url = format!("unix://{}", socket_path);
        
        info!("Connecting to Redis via Unix socket: {}", socket_path);
        
        let client = Client::open(redis_url)?;
        
        // Test connection
        let mut conn = client.get_multiplexed_async_connection().await?;
        let _: String = redis::cmd("PING").query_async(&mut conn).await?;
        
        info!("Redis connection established");
        
        Ok(RedisClient { client })
    }

    /// Check if trading is enabled via global kill switch
    /// FAIL-CLOSED: If key is missing or Redis fails, trading is DISABLED
    pub async fn is_trading_enabled(&self) -> anyhow::Result<bool> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        let value: Option<String> = conn.get(KILL_SWITCH_KEY).await?;
        // Fail-closed: only enable if explicitly set to TRUE
        Ok(value.map(|v| v.to_uppercase() == "TRUE").unwrap_or(false))
    }

    /// Get all active market pairs
    pub async fn get_market_pairs(&self) -> anyhow::Result<Vec<MarketPair>> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        
        let market_ids: Vec<String> = conn.smembers("markets:active").await?;
        let mut pairs = Vec::with_capacity(market_ids.len());
        
        for market_id in market_ids {
            let market_key = format!("market:{}", market_id);
            
            let yes_token: Option<String> = conn.hget(&market_key, "yes_token").await?;
            let no_token: Option<String> = conn.hget(&market_key, "no_token").await?;
            let min_size: Option<f64> = conn.hget(&market_key, "min_order_size").await?;
            let is_neg_risk: Option<bool> = conn.hget(&market_key, "is_neg_risk").await?;
            
            if let (Some(yes), Some(no)) = (yes_token, no_token) {
                pairs.push(MarketPair {
                    market_id,
                    yes_token_id: yes,
                    no_token_id: no,
                    min_order_size: min_size.unwrap_or(5.0),
                    is_neg_risk: is_neg_risk.unwrap_or(false),
                    active: true,
                });
            }
        }
        
        Ok(pairs)
    }

    /// Get best ask for a token (lowest sell price)
    pub async fn get_best_ask(&self, token_id: &str) -> anyhow::Result<Option<(f64, f64)>> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        
        let zset_key = format!("{}:{}:asks", OB_PREFIX, token_id);
        let sizes_key = format!("{}:{}:asks:sizes", OB_PREFIX, token_id);
        
        // Get lowest ask (first by score)
        let result: Vec<(String, f64)> = conn.zrange_withscores(&zset_key, 0, 0).await?;
        
        if let Some((price_str, price)) = result.into_iter().next() {
            let size: Option<String> = conn.hget(&sizes_key, &price_str).await?;
            let size_f64 = size.and_then(|s| s.parse().ok()).unwrap_or(0.0);
            Ok(Some((price, size_f64)))
        } else {
            Ok(None)
        }
    }

    /// Get best bid for a token (highest buy price)  
    pub async fn get_best_bid(&self, token_id: &str) -> anyhow::Result<Option<(f64, f64)>> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;
        
        let zset_key = format!("{}:{}:bids", OB_PREFIX, token_id);
        let sizes_key = format!("{}:{}:bids:sizes", OB_PREFIX, token_id);
        
        // Get highest bid (last by score)
        let result: Vec<(String, f64)> = conn.zrevrange_withscores(&zset_key, 0, 0).await?;
        
        if let Some((price_str, price)) = result.into_iter().next() {
            let size: Option<String> = conn.hget(&sizes_key, &price_str).await?;
            let size_f64 = size.and_then(|s| s.parse().ok()).unwrap_or(0.0);
            Ok(Some((price, size_f64)))
        } else {
            Ok(None)
        }
    }

    /// Publish arbitrage signal
    pub async fn publish_signal(&self, signal: &ArbitrageSignal, channel: &str) -> anyhow::Result<()> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;

        let payload = serde_json::to_string(signal)?;
        let _: i64 = conn.publish(channel, &payload).await?;

        debug!("Published signal for market {} with edge {:.4}",
            signal.market_id, signal.edge);

        Ok(())
    }

    /// Store scanner statistics
    pub async fn update_scanner_stats(
        &self,
        total_scans: u64,
        opportunities: u64,
        signals_sent: u64,
        avg_scan_us: f64,
    ) -> anyhow::Result<()> {
        let mut conn = self.client.get_multiplexed_async_connection().await?;

        let _: () = redis::pipe()
            .hset("scanner:stats", "total_scans", total_scans)
            .hset("scanner:stats", "opportunities_found", opportunities)
            .hset("scanner:stats", "signals_sent", signals_sent)
            .hset("scanner:stats", "avg_scan_time_us", avg_scan_us)
            .hset("scanner:stats", "last_update", chrono::Utc::now().timestamp_millis())
            .query_async(&mut conn)
            .await?;

        Ok(())
    }
}
