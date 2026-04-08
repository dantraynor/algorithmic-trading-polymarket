//! Type definitions for the signal core

use serde::{Deserialize, Serialize};

/// Arbitrage opportunity signal
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArbitrageSignal {
    /// Market identifier
    pub market_id: String,
    
    /// YES token ID
    pub yes_token_id: String,
    
    /// NO token ID
    pub no_token_id: String,
    
    /// Best ask price for YES
    pub yes_ask_price: f64,
    
    /// Best ask size for YES
    pub yes_ask_size: f64,
    
    /// Best ask price for NO
    pub no_ask_price: f64,
    
    /// Best ask size for NO
    pub no_ask_size: f64,
    
    /// Combined probability (yes + no)
    pub combined_prob: f64,
    
    /// Edge (profit per unit)
    pub edge: f64,
    
    /// Maximum executable size (min of both sides)
    pub max_size: f64,
    
    /// Expected profit in USD
    pub expected_profit: f64,
    
    /// Timestamp in milliseconds
    pub timestamp_ms: i64,
    
    /// Signal sequence number
    pub sequence: u64,
}

/// Market pair configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketPair {
    pub market_id: String,
    pub yes_token_id: String,
    pub no_token_id: String,
    pub min_order_size: f64,
    pub is_neg_risk: bool,
    pub active: bool,
}

/// Order book state for a single token
#[derive(Debug, Clone, Default)]
pub struct TokenOrderBook {
    pub token_id: String,
    pub best_bid_price: Option<f64>,
    pub best_bid_size: Option<f64>,
    pub best_ask_price: Option<f64>,
    pub best_ask_size: Option<f64>,
    pub last_update_ms: i64,
}

/// Scanner statistics
#[derive(Debug, Clone, Default)]
pub struct ScannerStats {
    pub total_scans: u64,
    pub opportunities_found: u64,
    pub signals_sent: u64,
    pub avg_scan_time_us: f64,
    pub max_scan_time_us: u64,
    pub last_opportunity_ms: Option<i64>,
}

impl ScannerStats {
    pub fn record_scan(&mut self, duration_us: u64) {
        self.total_scans += 1;
        
        // Rolling average
        let n = self.total_scans as f64;
        self.avg_scan_time_us = self.avg_scan_time_us * (n - 1.0) / n + duration_us as f64 / n;
        
        if duration_us > self.max_scan_time_us {
            self.max_scan_time_us = duration_us;
        }
    }
    
    pub fn record_opportunity(&mut self) {
        self.opportunities_found += 1;
        self.last_opportunity_ms = Some(chrono::Utc::now().timestamp_millis());
    }
    
    pub fn record_signal_sent(&mut self) {
        self.signals_sent += 1;
    }
}
