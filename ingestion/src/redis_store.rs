//! Redis storage layer for order book data using Unix Domain Sockets

use redis::aio::MultiplexedConnection;
use redis::{AsyncCommands, Client};
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

use crate::error::IngestionError;
use crate::types::Side;

/// Redis keys
const KILL_SWITCH_KEY: &str = "TRADING_ENABLED";
const OB_PREFIX: &str = "ob";

/// Retry configuration
const MAX_RETRIES: u32 = 3;
const INITIAL_RETRY_DELAY_MS: u64 = 10;
const MAX_RETRY_DELAY_MS: u64 = 100;

pub struct RedisStore {
    client: Client,
    /// Cached multiplexed connection for better performance
    conn: RwLock<Option<MultiplexedConnection>>,
}

impl RedisStore {
    pub async fn new(socket_path: &str) -> Result<Self, IngestionError> {
        // Connect via Unix Domain Socket for minimal latency
        let redis_url = format!("unix://{}", socket_path);

        info!("Connecting to Redis via Unix socket: {}", socket_path);

        let client = Client::open(redis_url)
            .map_err(|e| IngestionError::RedisConnection(e.to_string()))?;

        // Create and cache the multiplexed connection
        let conn = client.get_multiplexed_async_connection().await
            .map_err(|e| IngestionError::RedisConnection(e.to_string()))?;

        // Test connection
        let mut test_conn = conn.clone();
        let _: String = redis::cmd("PING")
            .query_async(&mut test_conn)
            .await
            .map_err(|e| IngestionError::RedisConnection(e.to_string()))?;

        info!("Redis connection established and cached successfully");

        Ok(RedisStore {
            client,
            conn: RwLock::new(Some(conn)),
        })
    }

    /// Get a connection, reconnecting if necessary
    async fn get_conn(&self) -> Result<MultiplexedConnection, IngestionError> {
        // Try to get cached connection
        {
            let guard = self.conn.read().await;
            if let Some(ref conn) = *guard {
                return Ok(conn.clone());
            }
        }

        // Need to reconnect
        warn!("Redis connection not available, reconnecting...");
        let new_conn = self.client.get_multiplexed_async_connection().await
            .map_err(|e| IngestionError::RedisConnection(e.to_string()))?;

        // Cache the new connection
        {
            let mut guard = self.conn.write().await;
            *guard = Some(new_conn.clone());
        }

        info!("Redis connection re-established");
        Ok(new_conn)
    }

    /// Execute a Redis operation with retry and exponential backoff
    /// Used for critical operations that should not fail silently
    async fn with_retry<T, F, Fut>(&self, operation_name: &str, mut operation: F) -> Result<T, IngestionError>
    where
        F: FnMut(MultiplexedConnection) -> Fut,
        Fut: std::future::Future<Output = Result<T, IngestionError>>,
    {
        let mut last_error = None;
        let mut delay_ms = INITIAL_RETRY_DELAY_MS;

        for attempt in 1..=MAX_RETRIES {
            // Get connection (may reconnect if needed)
            let conn = match self.get_conn().await {
                Ok(c) => c,
                Err(e) => {
                    error!("Failed to get Redis connection on attempt {}: {}", attempt, e);
                    last_error = Some(e);
                    if attempt < MAX_RETRIES {
                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                        delay_ms = (delay_ms * 2).min(MAX_RETRY_DELAY_MS);
                    }
                    continue;
                }
            };

            // Execute the operation
            match operation(conn).await {
                Ok(result) => {
                    if attempt > 1 {
                        info!("{} succeeded on attempt {}", operation_name, attempt);
                    }
                    return Ok(result);
                }
                Err(e) => {
                    warn!("{} failed on attempt {}/{}: {}", operation_name, attempt, MAX_RETRIES, e);
                    last_error = Some(e);

                    // Clear cached connection on error to force reconnect
                    {
                        let mut guard = self.conn.write().await;
                        *guard = None;
                    }

                    if attempt < MAX_RETRIES {
                        tokio::time::sleep(Duration::from_millis(delay_ms)).await;
                        delay_ms = (delay_ms * 2).min(MAX_RETRY_DELAY_MS);
                    }
                }
            }
        }

        Err(last_error.unwrap_or_else(|| {
            IngestionError::RedisOperation(format!("{} failed after {} retries", operation_name, MAX_RETRIES))
        }))
    }

    /// Check if trading is enabled via global kill switch
    /// FAIL-CLOSED: If key is missing or Redis fails, trading is DISABLED
    /// Uses retry logic for reliability
    pub async fn is_trading_enabled(&self) -> Result<bool, IngestionError> {
        self.with_retry("is_trading_enabled", |mut conn| async move {
            let value: Option<String> = conn.get(KILL_SWITCH_KEY).await?;
            // Fail-closed: only enable if explicitly set to TRUE
            Ok(value.map(|v| v.to_uppercase() == "TRUE").unwrap_or(false))
        }).await
    }

    /// Set the global kill switch
    /// Uses retry logic for reliability
    pub async fn set_trading_enabled(&self, enabled: bool) -> Result<(), IngestionError> {
        let value = if enabled { "TRUE" } else { "FALSE" };
        self.with_retry("set_trading_enabled", |mut conn| {
            let v = value.to_string();
            async move {
                conn.set::<_, _, ()>(KILL_SWITCH_KEY, v).await?;
                Ok(())
            }
        }).await?;

        info!("Trading enabled set to: {}", enabled);
        Ok(())
    }

    /// Update a price level in the order book ZSET
    /// Key format: ob:{TOKEN_ID}:{asks|bids}
    /// Score: price, Member: price (for deduplication)
    /// Separate key for sizes: ob:{TOKEN_ID}:{asks|bids}:sizes
    pub async fn update_price_level(
        &self,
        token_id: &str,
        side: Side,
        price: &str,
        size: &str,
    ) -> Result<(), IngestionError> {
        let mut conn = self.get_conn().await?;
        
        let side_str = match side {
            Side::Bid => "bids",
            Side::Ask => "asks",
        };
        
        let zset_key = format!("{}:{}:{}", OB_PREFIX, token_id, side_str);
        let sizes_key = format!("{}:{}:{}:sizes", OB_PREFIX, token_id, side_str);

        // Validate price - reject invalid values instead of silently using 0.0
        let price_f64: f64 = price.parse()
            .map_err(|_| IngestionError::InvalidPrice(format!(
                "Cannot parse '{}' as price for token {}", price, token_id
            )))?;

        // Validate size - reject invalid values instead of silently using 0.0
        let size_f64: f64 = size.parse()
            .map_err(|_| IngestionError::InvalidSize(format!(
                "Cannot parse '{}' as size for token {}", size, token_id
            )))?;

        // Additional validation: prices must be positive (or zero for removal)
        if price_f64 < 0.0 {
            return Err(IngestionError::InvalidPrice(format!(
                "Negative price {} for token {}", price, token_id
            )));
        }

        if size_f64 < 0.0 {
            return Err(IngestionError::InvalidSize(format!(
                "Negative size {} for token {}", size, token_id
            )));
        }

        if size_f64 == 0.0 {
            // Remove price level if size is zero
            let _: () = redis::pipe()
                .zrem(&zset_key, price)
                .hdel(&sizes_key, price)
                .query_async(&mut conn)
                .await?;

            debug!("Removed price level {} from {}", price, zset_key);
        } else {
            // Add/update price level
            let _: () = redis::pipe()
                .zadd(&zset_key, price, price_f64)
                .hset(&sizes_key, price, size)
                .query_async(&mut conn)
                .await?;

            debug!("Updated {} @ {} = {}", zset_key, price, size);
        }
        
        Ok(())
    }

    /// Get best bid (highest price)
    pub async fn get_best_bid(&self, token_id: &str) -> Result<Option<(f64, f64)>, IngestionError> {
        let mut conn = self.get_conn().await?;

        let zset_key = format!("{}:{}:bids", OB_PREFIX, token_id);
        let sizes_key = format!("{}:{}:bids:sizes", OB_PREFIX, token_id);

        // Get highest bid (last element by score)
        let result: Vec<(String, f64)> = conn.zrevrange_withscores(&zset_key, 0, 0).await?;

        if let Some((price_str, price)) = result.into_iter().next() {
            let size: Option<String> = conn.hget(&sizes_key, &price_str).await?;
            let size_f64 = size.and_then(|s| s.parse().ok()).unwrap_or(0.0);
            Ok(Some((price, size_f64)))
        } else {
            Ok(None)
        }
    }

    /// Get best ask (lowest price)
    pub async fn get_best_ask(&self, token_id: &str) -> Result<Option<(f64, f64)>, IngestionError> {
        let mut conn = self.get_conn().await?;

        let zset_key = format!("{}:{}:asks", OB_PREFIX, token_id);
        let sizes_key = format!("{}:{}:asks:sizes", OB_PREFIX, token_id);

        // Get lowest ask (first element by score)
        let result: Vec<(String, f64)> = conn.zrange_withscores(&zset_key, 0, 0).await?;

        if let Some((price_str, price)) = result.into_iter().next() {
            let size: Option<String> = conn.hget(&sizes_key, &price_str).await?;
            let size_f64 = size.and_then(|s| s.parse().ok()).unwrap_or(0.0);
            Ok(Some((price, size_f64)))
        } else {
            Ok(None)
        }
    }

    /// Clear all order book data for a token
    pub async fn clear_order_book(&self, token_id: &str) -> Result<(), IngestionError> {
        let mut conn = self.get_conn().await?;

        let keys = [
            format!("{}:{}:bids", OB_PREFIX, token_id),
            format!("{}:{}:asks", OB_PREFIX, token_id),
            format!("{}:{}:bids:sizes", OB_PREFIX, token_id),
            format!("{}:{}:asks:sizes", OB_PREFIX, token_id),
            format!("{}:{}:meta", OB_PREFIX, token_id),
        ];

        let _: () = conn.del(&keys[..]).await?;

        debug!("Cleared order book for token {}", token_id);
        Ok(())
    }

    /// Atomically apply a full order book snapshot using Redis transaction
    /// This prevents race conditions where scanners read partial order books
    pub async fn apply_snapshot_atomic(
        &self,
        token_id: &str,
        bids: &[(String, String)], // (price, size) pairs
        asks: &[(String, String)],
        timestamp: u64,
        hash: &str,
    ) -> Result<(), IngestionError> {
        let mut conn = self.get_conn().await?;

        let bids_key = format!("{}:{}:bids", OB_PREFIX, token_id);
        let asks_key = format!("{}:{}:asks", OB_PREFIX, token_id);
        let bids_sizes_key = format!("{}:{}:bids:sizes", OB_PREFIX, token_id);
        let asks_sizes_key = format!("{}:{}:asks:sizes", OB_PREFIX, token_id);
        let meta_key = format!("{}:{}:meta", OB_PREFIX, token_id);

        // Build atomic pipeline: delete old data and insert new data in one transaction
        let mut pipe = redis::pipe();
        pipe.atomic();

        // Clear existing data
        pipe.del(&bids_key);
        pipe.del(&asks_key);
        pipe.del(&bids_sizes_key);
        pipe.del(&asks_sizes_key);

        // Insert bids - validate prices, log warnings for invalid entries
        for (price, size) in bids {
            match price.parse::<f64>() {
                Ok(price_f64) if price_f64 > 0.0 => {
                    pipe.zadd(&bids_key, price, price_f64);
                    pipe.hset(&bids_sizes_key, price, size);
                }
                Ok(price_f64) if price_f64 == 0.0 => {
                    // Zero price is valid for removal, skip silently
                }
                Ok(price_f64) => {
                    warn!("Skipping invalid bid price {} for token {} (negative)", price_f64, token_id);
                }
                Err(_) => {
                    warn!("Skipping unparseable bid price '{}' for token {}", price, token_id);
                }
            }
        }

        // Insert asks - validate prices, log warnings for invalid entries
        for (price, size) in asks {
            match price.parse::<f64>() {
                Ok(price_f64) if price_f64 > 0.0 => {
                    pipe.zadd(&asks_key, price, price_f64);
                    pipe.hset(&asks_sizes_key, price, size);
                }
                Ok(price_f64) if price_f64 == 0.0 => {
                    // Zero price is valid for removal, skip silently
                }
                Ok(price_f64) => {
                    warn!("Skipping invalid ask price {} for token {} (negative)", price_f64, token_id);
                }
                Err(_) => {
                    warn!("Skipping unparseable ask price '{}' for token {}", price, token_id);
                }
            }
        }

        // Update metadata
        pipe.hset(&meta_key, "timestamp", timestamp);
        pipe.hset(&meta_key, "hash", hash);

        // Execute atomically
        let _: () = pipe.query_async(&mut conn).await?;

        debug!("Applied atomic snapshot for token {} ({} bids, {} asks)",
            token_id, bids.len(), asks.len());

        Ok(())
    }

    /// Update order book metadata (timestamp, hash)
    pub async fn update_book_metadata(
        &self,
        token_id: &str,
        timestamp: u64,
        hash: &str,
    ) -> Result<(), IngestionError> {
        let mut conn = self.get_conn().await?;

        let meta_key = format!("{}:{}:meta", OB_PREFIX, token_id);

        let _: () = redis::pipe()
            .hset(&meta_key, "timestamp", timestamp)
            .hset(&meta_key, "hash", hash)
            .query_async(&mut conn)
            .await?;

        Ok(())
    }

    /// Store market pair mapping for arbitrage scanning
    pub async fn register_market_pair(
        &self,
        market_id: &str,
        yes_token_id: &str,
        no_token_id: &str,
        min_order_size: f64,
    ) -> Result<(), IngestionError> {
        let mut conn = self.get_conn().await?;

        let market_key = format!("market:{}", market_id);

        let _: () = redis::pipe()
            .hset(&market_key, "yes_token", yes_token_id)
            .hset(&market_key, "no_token", no_token_id)
            .hset(&market_key, "min_order_size", min_order_size)
            .sadd("markets:active", market_id)
            .query_async(&mut conn)
            .await?;

        info!("Registered market pair: {} (YES: {}, NO: {})",
            market_id, yes_token_id, no_token_id);

        Ok(())
    }

    /// Update ingestion stats in Redis for dashboard monitoring
    pub async fn update_ingestion_stats(
        &self,
        messages_received: u64,
        snapshots_applied: u64,
        reconnects: u64,
    ) -> Result<(), IngestionError> {
        let mut conn = self.get_conn().await?;
        let _: () = redis::pipe()
            .atomic()
            .hset("ingestion:stats", "messages_received", messages_received)
            .hset("ingestion:stats", "snapshots_applied", snapshots_applied)
            .hset("ingestion:stats", "reconnects", reconnects)
            .hset("ingestion:stats", "last_update", chrono::Utc::now().timestamp())
            .query_async(&mut conn)
            .await?;
        Ok(())
    }

    /// Get all active market IDs
    pub async fn get_active_markets(&self) -> Result<Vec<String>, IngestionError> {
        let mut conn = self.get_conn().await?;

        let markets: Vec<String> = conn.smembers("markets:active").await?;

        Ok(markets)
    }

    /// Publish arbitrage opportunity to signal channel
    /// Uses retry logic for reliability (critical path)
    pub async fn publish_signal(
        &self,
        market_id: &str,
        yes_ask: f64,
        no_ask: f64,
        edge: f64,
    ) -> Result<(), IngestionError> {
        let signal = serde_json::json!({
            "market_id": market_id,
            "yes_ask": yes_ask,
            "no_ask": no_ask,
            "edge": edge,
            "timestamp": chrono::Utc::now().timestamp_millis()
        });
        let signal_str = signal.to_string();

        self.with_retry("publish_signal", |mut conn| {
            let s = signal_str.clone();
            async move {
                let _: i64 = conn.publish("signals:arbitrage", s).await?;
                Ok(())
            }
        }).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Tests would require a running Redis instance
    // In production, use testcontainers or mock
}
