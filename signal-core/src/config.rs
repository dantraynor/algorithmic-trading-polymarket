//! Configuration for the signal core

use std::env;
use anyhow::Result;

#[derive(Clone, Debug)]
pub struct Config {
    /// Redis Unix Domain Socket path
    pub redis_socket_path: String,
    
    /// Arbitrage buffer (profit threshold)
    /// Trigger when: yes_ask + no_ask < (1.0 - buffer)
    pub arbitrage_buffer: f64,
    
    /// Minimum edge in dollars to trigger execution
    pub min_edge_usd: f64,
    
    /// Scan interval in microseconds
    pub scan_interval_us: u64,
    
    /// Kill switch check interval in milliseconds
    pub kill_switch_check_interval_ms: u64,
    
    /// Maximum position size per trade
    pub max_position_size: f64,
    
    /// Minimum order size (from Gamma metadata)
    pub default_min_order_size: f64,
    
    /// Signal channel for publishing opportunities
    pub signal_channel: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Config {
            redis_socket_path: env::var("REDIS_SOCKET_PATH")
                .unwrap_or_else(|_| "/var/run/redis/redis.sock".to_string()),
            
            arbitrage_buffer: env::var("ARBITRAGE_BUFFER")
                .unwrap_or_else(|_| "0.005".to_string())
                .parse()?,
            
            min_edge_usd: env::var("MIN_EDGE_USD")
                .unwrap_or_else(|_| "0.50".to_string())
                .parse()?,
            
            scan_interval_us: env::var("SCAN_INTERVAL_US")
                .unwrap_or_else(|_| "50".to_string()) // 50 microseconds = 0.05ms
                .parse()?,
            
            kill_switch_check_interval_ms: env::var("KILL_SWITCH_CHECK_INTERVAL_MS")
                .unwrap_or_else(|_| "100".to_string())
                .parse()?,
            
            max_position_size: env::var("MAX_POSITION_SIZE")
                .unwrap_or_else(|_| "1000.0".to_string())
                .parse()?,
            
            default_min_order_size: env::var("DEFAULT_MIN_ORDER_SIZE")
                .unwrap_or_else(|_| "5.0".to_string())
                .parse()?,
            
            signal_channel: env::var("SIGNAL_CHANNEL")
                .unwrap_or_else(|_| "signals:arbitrage".to_string()),
        })
    }
}

impl Default for Config {
    fn default() -> Self {
        Config {
            redis_socket_path: "/var/run/redis/redis.sock".to_string(),
            arbitrage_buffer: 0.005, // 0.5% buffer
            min_edge_usd: 0.50,
            scan_interval_us: 50,
            kill_switch_check_interval_ms: 100,
            max_position_size: 1000.0,
            default_min_order_size: 5.0,
            signal_channel: "signals:arbitrage".to_string(),
        }
    }
}
