//! WebSocket client for Polymarket CLOB connection

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::{broadcast, RwLock};
use tokio::time::{interval, timeout};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{debug, error, info, warn};

use crate::config::Config;
use crate::error::IngestionError;
use crate::market_fetcher;
use crate::redis_store::RedisStore;
use crate::types::{BookSnapshot, PriceChangesMessage, SubscriptionConfirm, ErrorMessage, SubscriptionRequest};

pub struct WebSocketClient {
    config: Config,
    redis_store: Arc<RedisStore>,
    shutdown_rx: broadcast::Receiver<()>,
    /// Track last sequence number per asset for gap detection
    sequence_tracker: Arc<RwLock<HashMap<String, u64>>>,
    /// Flag to request snapshot on sequence gap
    needs_snapshot: Arc<RwLock<HashMap<String, bool>>>,
    /// Stats counters for dashboard monitoring
    messages_received: AtomicU64,
    snapshots_applied: AtomicU64,
    reconnects: AtomicU64,
}

impl WebSocketClient {
    pub fn new(
        config: Config,
        redis_store: Arc<RedisStore>,
        shutdown_rx: broadcast::Receiver<()>,
    ) -> Self {
        WebSocketClient {
            config,
            redis_store,
            shutdown_rx,
            sequence_tracker: Arc::new(RwLock::new(HashMap::new())),
            needs_snapshot: Arc::new(RwLock::new(HashMap::new())),
            messages_received: AtomicU64::new(0),
            snapshots_applied: AtomicU64::new(0),
            reconnects: AtomicU64::new(0),
        }
    }

    /// Check for sequence gaps and return true if data should be processed
    /// Returns false if a gap was detected and snapshot is needed
    async fn check_sequence(&self, asset_id: &str, seq: u64) -> bool {
        let mut tracker = self.sequence_tracker.write().await;

        if let Some(&last_seq) = tracker.get(asset_id) {
            let expected = last_seq + 1;
            if seq != expected {
                // Sequence gap detected
                warn!(
                    "Sequence gap for asset {}: expected {}, got {} (gap of {})",
                    asset_id, expected, seq, seq.saturating_sub(expected)
                );

                // Mark this asset as needing a snapshot
                self.needs_snapshot.write().await.insert(asset_id.to_string(), true);

                // Update tracker to current seq to avoid repeated warnings
                tracker.insert(asset_id.to_string(), seq);
                return false;
            }
        }

        // Update sequence tracker
        tracker.insert(asset_id.to_string(), seq);
        true
    }

    /// Reset sequence tracking for an asset after receiving a snapshot
    async fn reset_sequence(&self, asset_id: &str) {
        self.sequence_tracker.write().await.remove(asset_id);
        self.needs_snapshot.write().await.remove(asset_id);
    }

    pub async fn run(mut self) -> Result<(), IngestionError> {
        let mut reconnect_attempts = 0;

        loop {
            // Check shutdown signal
            if self.shutdown_rx.try_recv().is_ok() {
                info!("Shutdown signal received, exiting WebSocket loop");
                break;
            }

            // Check kill switch
            match self.redis_store.is_trading_enabled().await {
                Ok(true) => {}
                Ok(false) => {
                    warn!("Trading disabled via kill switch, waiting...");
                    tokio::time::sleep(Duration::from_secs(5)).await;
                    continue;
                }
                Err(e) => {
                    error!("Failed to check kill switch: {}", e);
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
            }

            match self.connect_and_run().await {
                Ok(_) => {
                    info!("WebSocket connection closed gracefully");
                    reconnect_attempts = 0;
                }
                Err(e) => {
                    error!("WebSocket error: {}", e);
                    reconnect_attempts += 1;
                    self.reconnects.fetch_add(1, Ordering::Relaxed);

                    if reconnect_attempts >= self.config.max_reconnect_attempts {
                        error!("Max reconnect attempts reached, exiting");
                        return Err(IngestionError::MaxReconnectAttempts);
                    }

                    let delay = Duration::from_millis(
                        self.config.reconnect_delay_ms * reconnect_attempts as u64
                    );
                    warn!("Reconnecting in {:?} (attempt {})", delay, reconnect_attempts);
                    tokio::time::sleep(delay).await;
                }
            }
        }

        Ok(())
    }

    async fn connect_and_run(&mut self) -> Result<(), IngestionError> {
        // Fetch active markets from CLOB REST API
        info!("Fetching active markets from {}", self.config.clob_api_url);
        let markets = market_fetcher::fetch_active_markets(&self.config.clob_api_url).await?;

        if markets.is_empty() {
            warn!("No active markets found, waiting before retry");
            tokio::time::sleep(Duration::from_secs(30)).await;
            return Ok(());
        }

        // Register market pairs in Redis and collect asset IDs
        let mut asset_ids = Vec::with_capacity(markets.len() * 2);
        for m in &markets {
            asset_ids.push(m.yes_token_id.clone());
            asset_ids.push(m.no_token_id.clone());
            if let Err(e) = self.redis_store.register_market_pair(
                &m.condition_id,
                &m.yes_token_id,
                &m.no_token_id,
                0.0,
            ).await {
                warn!("Failed to register market {}: {}", m.condition_id, e);
            }
        }

        info!("Subscribing to {} assets across {} markets", asset_ids.len(), markets.len());

        info!("Connecting to {}", self.config.websocket_url);

        let (ws_stream, _) = connect_async(&self.config.websocket_url).await?;
        let (mut write, mut read) = ws_stream.split();

        info!("WebSocket connected successfully");

        // Subscribe to market channel with actual asset IDs
        let subscription = SubscriptionRequest {
            auth: None,
            markets: vec![],
            assets_ids: asset_ids,
            msg_type: "subscribe".to_string(),
        };

        let sub_msg = serde_json::to_string(&subscription)?;
        write.send(Message::Text(sub_msg)).await?;

        let mut last_message_time = Instant::now();
        let heartbeat_timeout = Duration::from_secs(self.config.heartbeat_timeout_secs);
        let mut kill_switch_interval = interval(
            Duration::from_millis(self.config.kill_switch_check_interval_ms)
        );
        let mut stats_interval = interval(Duration::from_secs(10));

        loop {
            tokio::select! {
                // Check for shutdown
                _ = self.shutdown_rx.recv() => {
                    info!("Shutdown signal received");
                    break;
                }

                // Check kill switch periodically
                _ = kill_switch_interval.tick() => {
                    if !self.redis_store.is_trading_enabled().await.unwrap_or(false) {
                        warn!("Trading disabled via kill switch");
                        break;
                    }
                }

                // Flush ingestion stats to Redis periodically
                _ = stats_interval.tick() => {
                    let msgs = self.messages_received.load(Ordering::Relaxed);
                    let snaps = self.snapshots_applied.load(Ordering::Relaxed);
                    let reconns = self.reconnects.load(Ordering::Relaxed);
                    if let Err(e) = self.redis_store.update_ingestion_stats(msgs, snaps, reconns).await {
                        warn!("Failed to update ingestion stats: {}", e);
                    }
                }

                // Handle incoming messages with timeout
                result = timeout(heartbeat_timeout, read.next()) => {
                    match result {
                        Ok(Some(Ok(msg))) => {
                            last_message_time = Instant::now();
                            self.messages_received.fetch_add(1, Ordering::Relaxed);
                            self.handle_message(msg).await?;
                        }
                        Ok(Some(Err(e))) => {
                            error!("WebSocket read error: {}", e);
                            return Err(IngestionError::WebSocketMessage(e.to_string()));
                        }
                        Ok(None) => {
                            info!("WebSocket stream ended");
                            break;
                        }
                        Err(_) => {
                            // Heartbeat timeout
                            let elapsed = last_message_time.elapsed();
                            error!("Heartbeat timeout after {:?}", elapsed);
                            return Err(IngestionError::HeartbeatTimeout(
                                self.config.heartbeat_timeout_secs
                            ));
                        }
                    }
                }
            }
        }

        Ok(())
    }

    async fn handle_message(&self, msg: Message) -> Result<(), IngestionError> {
        let text = match msg {
            Message::Text(t) => t,
            Message::Binary(data) => {
                match String::from_utf8(data) {
                    Ok(t) => t,
                    Err(e) => {
                        warn!("Failed to decode binary message as UTF-8: {}", e);
                        return Ok(());
                    }
                }
            }
            Message::Ping(_) => { debug!("Received ping"); return Ok(()); }
            Message::Pong(_) => { debug!("Received pong"); return Ok(()); }
            Message::Close(frame) => { info!("Received close frame: {:?}", frame); return Ok(()); }
            _ => { return Ok(()); }
        };

        // Parse as generic JSON Value first, then dispatch by structure
        let value: serde_json::Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(e) => {
                let preview: String = text.chars().take(200).collect();
                warn!("Invalid JSON: {} | raw: {}", e, preview);
                return Ok(());
            }
        };

        let obj = match value.as_object() {
            Some(o) => o,
            None => {
                warn!("WebSocket message is not a JSON object");
                return Ok(());
            }
        };

        // Book snapshots arrive wrapped as {"0": {snapshot}, "1": {snapshot}, ...}
        // Detect by checking if all keys are numeric strings
        let first_key = obj.keys().next();
        let is_wrapped_snapshots = first_key
            .map(|k| k.parse::<u64>().is_ok())
            .unwrap_or(false);

        if is_wrapped_snapshots {
            for (_key, inner) in obj {
                match serde_json::from_value::<BookSnapshot>(inner.clone()) {
                    Ok(snapshot) => self.handle_book_snapshot(snapshot).await?,
                    Err(e) => {
                        let preview = serde_json::to_string(inner)
                            .unwrap_or_default()
                            .chars().take(200).collect::<String>();
                        warn!("Failed to parse wrapped book snapshot: {} | raw: {}", e, preview);
                    }
                }
            }
            return Ok(());
        }

        // Dispatch based on field presence
        if obj.contains_key("price_changes") {
            match serde_json::from_value::<PriceChangesMessage>(value) {
                Ok(msg) => self.handle_price_changes(msg).await?,
                Err(e) => warn!("Failed to parse price_changes: {}", e),
            }
        } else if obj.contains_key("bids") && obj.contains_key("asks") {
            // Unwrapped book snapshot (unlikely but handle it)
            match serde_json::from_value::<BookSnapshot>(value) {
                Ok(snapshot) => self.handle_book_snapshot(snapshot).await?,
                Err(e) => warn!("Failed to parse book snapshot: {}", e),
            }
        } else if obj.contains_key("channel") {
            match serde_json::from_value::<SubscriptionConfirm>(value) {
                Ok(confirm) => {
                    info!("Subscribed to channel: {} with {} assets",
                        confirm.channel, confirm.assets.len());
                }
                Err(e) => warn!("Failed to parse subscription confirm: {}", e),
            }
        } else if obj.contains_key("code") {
            match serde_json::from_value::<ErrorMessage>(value) {
                Ok(err) => {
                    error!("WebSocket error message: {} (code: {})", err.message, err.code);
                }
                Err(e) => warn!("Failed to parse error message: {}", e),
            }
        } else {
            // Unknown message type - log at debug level
            let keys: Vec<&String> = obj.keys().collect();
            debug!("Unrecognized message type, keys: {:?}", keys);
        }

        Ok(())
    }

    async fn handle_price_changes(&self, msg: PriceChangesMessage) -> Result<(), IngestionError> {
        debug!("Processing {} price changes for market {}",
            msg.price_changes.len(), msg.market);

        for entry in &msg.price_changes {
            let side = entry.side.to_book_side();
            self.redis_store.update_price_level(
                &entry.asset_id,
                side,
                &entry.price,
                &entry.size,
            ).await?;
        }

        Ok(())
    }

    async fn handle_book_snapshot(&self, snapshot: BookSnapshot) -> Result<(), IngestionError> {
        debug!("Processing book snapshot for asset {}", snapshot.asset_id);

        // Convert bids and asks to (price, size) tuples
        let bids: Vec<(String, String)> = snapshot.bids
            .iter()
            .map(|level| (level.price.clone(), level.size.clone()))
            .collect();

        let asks: Vec<(String, String)> = snapshot.asks
            .iter()
            .map(|level| (level.price.clone(), level.size.clone()))
            .collect();

        // Parse string timestamp to u64 (Polymarket sends timestamps as strings)
        let timestamp = snapshot.timestamp
            .as_deref()
            .and_then(|t| t.parse::<u64>().ok())
            .unwrap_or(0);

        // Apply snapshot atomically to prevent race conditions
        self.redis_store.apply_snapshot_atomic(
            &snapshot.asset_id,
            &bids,
            &asks,
            timestamp,
            snapshot.hash.as_deref().unwrap_or(""),
        ).await?;

        // Reset sequence tracking - snapshot provides fresh baseline
        self.reset_sequence(&snapshot.asset_id).await;
        self.snapshots_applied.fetch_add(1, Ordering::Relaxed);

        info!("Book snapshot applied for {} ({} bids, {} asks)",
            snapshot.asset_id, snapshot.bids.len(), snapshot.asks.len());

        Ok(())
    }
}
