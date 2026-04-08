//! Box Spread Scanner - O(1) Arbitrage Detection
//! 
//! Continuously scans market pairs for arbitrage opportunities
//! Condition: yes_ask + no_ask < (1.0 - buffer)

use std::sync::Arc;
use std::time::Instant;
use tokio::sync::broadcast;
use tokio::time::{interval, Duration};
use tracing::{debug, info, warn, error};
use dashmap::DashMap;

use crate::config::Config;
use crate::redis_client::RedisClient;
use crate::types::{ArbitrageSignal, MarketPair, ScannerStats};

pub struct BoxSpreadScanner {
    config: Config,
    redis: Arc<RedisClient>,
    shutdown_rx: broadcast::Receiver<()>,
    
    /// Local cache of market pairs for O(1) access
    market_pairs: DashMap<String, MarketPair>,
    
    /// Scanner statistics
    stats: parking_lot::Mutex<ScannerStats>,
    
    /// Signal sequence counter
    sequence: std::sync::atomic::AtomicU64,
}

impl BoxSpreadScanner {
    pub fn new(
        config: Config,
        redis: Arc<RedisClient>,
        shutdown_rx: broadcast::Receiver<()>,
    ) -> Self {
        BoxSpreadScanner {
            config,
            redis,
            shutdown_rx,
            market_pairs: DashMap::new(),
            stats: parking_lot::Mutex::new(ScannerStats::default()),
            sequence: std::sync::atomic::AtomicU64::new(0),
        }
    }

    pub async fn run(mut self) -> anyhow::Result<()> {
        info!("Starting Box Spread Scanner");
        info!("Buffer: {:.2}%, Min Edge: ${:.2}", 
            self.config.arbitrage_buffer * 100.0, 
            self.config.min_edge_usd);

        // Load initial market pairs
        self.refresh_market_pairs().await?;
        
        let scan_interval = Duration::from_micros(self.config.scan_interval_us);
        let mut scan_ticker = interval(scan_interval);
        
        let kill_check_interval = Duration::from_millis(self.config.kill_switch_check_interval_ms);
        let mut kill_switch_ticker = interval(kill_check_interval);
        
        // Refresh market pairs every 60 seconds
        let mut market_refresh_ticker = interval(Duration::from_secs(60));
        
        // Stats reporting every 10 seconds
        let mut stats_ticker = interval(Duration::from_secs(10));
        
        loop {
            tokio::select! {
                // Check for shutdown
                _ = self.shutdown_rx.recv() => {
                    info!("Shutdown signal received");
                    break;
                }
                
                // Main scan loop - runs every scan_interval_us
                _ = scan_ticker.tick() => {
                    if let Err(e) = self.scan_all_markets().await {
                        error!("Scan error: {}", e);
                    }
                }
                
                // Kill switch check
                _ = kill_switch_ticker.tick() => {
                    match self.redis.is_trading_enabled().await {
                        Ok(false) => {
                            warn!("Trading disabled via kill switch");
                            tokio::time::sleep(Duration::from_secs(1)).await;
                            continue;
                        }
                        Err(e) => {
                            error!("Kill switch check failed: {}", e);
                        }
                        _ => {}
                    }
                }
                
                // Refresh market pairs periodically
                _ = market_refresh_ticker.tick() => {
                    if let Err(e) = self.refresh_market_pairs().await {
                        error!("Failed to refresh market pairs: {}", e);
                    }
                }
                
                // Report stats
                _ = stats_ticker.tick() => {
                    self.report_stats().await;
                }
            }
        }

        info!("Scanner shutdown complete");
        Ok(())
    }

    async fn refresh_market_pairs(&self) -> anyhow::Result<()> {
        let pairs = self.redis.get_market_pairs().await?;
        
        // Clear and reload
        self.market_pairs.clear();
        for pair in pairs {
            self.market_pairs.insert(pair.market_id.clone(), pair);
        }
        
        info!("Loaded {} active market pairs", self.market_pairs.len());
        Ok(())
    }

    async fn scan_all_markets(&self) -> anyhow::Result<()> {
        let start = Instant::now();
        
        // Iterate through all market pairs
        for entry in self.market_pairs.iter() {
            let pair = entry.value();
            
            if let Err(e) = self.check_arbitrage(pair).await {
                debug!("Error checking market {}: {}", pair.market_id, e);
            }
        }
        
        // Record scan timing
        let duration_us = start.elapsed().as_micros() as u64;
        self.stats.lock().record_scan(duration_us);
        
        Ok(())
    }

    async fn check_arbitrage(&self, pair: &MarketPair) -> anyhow::Result<()> {
        // Get best ask for YES token
        let yes_ask = self.redis.get_best_ask(&pair.yes_token_id).await?;
        
        // Get best ask for NO token
        let no_ask = self.redis.get_best_ask(&pair.no_token_id).await?;
        
        // Need both sides for arbitrage
        let (yes_price, yes_size) = match yes_ask {
            Some((p, s)) if s > 0.0 => (p, s),
            _ => return Ok(()),
        };
        
        let (no_price, no_size) = match no_ask {
            Some((p, s)) if s > 0.0 => (p, s),
            _ => return Ok(()),
        };
        
        // Calculate combined probability
        let combined_prob = yes_price + no_price;
        
        // Check arbitrage condition: combined < (1.0 - buffer)
        let threshold = 1.0 - self.config.arbitrage_buffer;
        
        if combined_prob < threshold {
            // Calculate edge
            let edge = 1.0 - combined_prob;
            
            // Calculate max executable size
            let max_size = yes_size.min(no_size).min(self.config.max_position_size);
            
            // Check minimum order size
            if max_size < pair.min_order_size {
                debug!("Opportunity too small: {} < {}", max_size, pair.min_order_size);
                return Ok(());
            }
            
            // Calculate expected profit
            let expected_profit = edge * max_size;
            
            // Check minimum edge
            if expected_profit < self.config.min_edge_usd {
                debug!("Edge too small: ${:.2} < ${:.2}", 
                    expected_profit, self.config.min_edge_usd);
                return Ok(());
            }
            
            // Record opportunity
            self.stats.lock().record_opportunity();
            
            // Create and publish signal
            let signal = ArbitrageSignal {
                market_id: pair.market_id.clone(),
                yes_token_id: pair.yes_token_id.clone(),
                no_token_id: pair.no_token_id.clone(),
                yes_ask_price: yes_price,
                yes_ask_size: yes_size,
                no_ask_price: no_price,
                no_ask_size: no_size,
                combined_prob,
                edge,
                max_size,
                expected_profit,
                timestamp_ms: chrono::Utc::now().timestamp_millis(),
                sequence: self.sequence.fetch_add(1, std::sync::atomic::Ordering::SeqCst),
            };
            
            info!(
                "🎯 ARBITRAGE: {} | YES: {:.4} + NO: {:.4} = {:.4} | Edge: {:.2}% | Profit: ${:.2}",
                pair.market_id,
                yes_price,
                no_price,
                combined_prob,
                edge * 100.0,
                expected_profit
            );
            
            self.redis.publish_signal(&signal, &self.config.signal_channel).await?;
            self.stats.lock().record_signal_sent();
        }
        
        Ok(())
    }

    async fn report_stats(&self) {
        let stats = self.stats.lock().clone();
        
        info!(
            "📊 Scanner Stats | Scans: {} | Opportunities: {} | Signals: {} | Avg Scan: {:.2}μs | Max: {}μs",
            stats.total_scans,
            stats.opportunities_found,
            stats.signals_sent,
            stats.avg_scan_time_us,
            stats.max_scan_time_us
        );
        
        // Store in Redis
        if let Err(e) = self.redis.update_scanner_stats(
            stats.total_scans,
            stats.opportunities_found,
            stats.signals_sent,
            stats.avg_scan_time_us,
        ).await {
            error!("Failed to store scanner stats: {}", e);
        }
    }
}
