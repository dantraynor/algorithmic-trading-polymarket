//! Configuration module for the ingestion layer

use std::env;
use anyhow::Result;

#[derive(Clone, Debug)]
pub struct Config {
    /// WebSocket URL for Polymarket CLOB
    pub websocket_url: String,
    
    /// Redis Unix Domain Socket path
    pub redis_socket_path: String,
    
    /// Heartbeat timeout in seconds
    pub heartbeat_timeout_secs: u64,
    
    /// Reconnect delay in milliseconds
    pub reconnect_delay_ms: u64,
    
    /// Maximum reconnect attempts
    pub max_reconnect_attempts: u32,
    
    /// Kill switch check interval in milliseconds
    pub kill_switch_check_interval_ms: u64,

    /// CLOB REST API URL for fetching active markets
    pub clob_api_url: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Config {
            websocket_url: env::var("POLYMARKET_WS_URL")
                .unwrap_or_else(|_| "wss://ws-subscriptions-clob.polymarket.com/ws/market".to_string()),
            
            redis_socket_path: env::var("REDIS_SOCKET_PATH")
                .unwrap_or_else(|_| "/var/run/redis/redis.sock".to_string()),
            
            heartbeat_timeout_secs: env::var("HEARTBEAT_TIMEOUT_SECS")
                .unwrap_or_else(|_| "60".to_string())
                .parse()?,
            
            reconnect_delay_ms: env::var("RECONNECT_DELAY_MS")
                .unwrap_or_else(|_| "1000".to_string())
                .parse()?,
            
            max_reconnect_attempts: env::var("MAX_RECONNECT_ATTEMPTS")
                .unwrap_or_else(|_| "10".to_string())
                .parse()?,
            
            kill_switch_check_interval_ms: env::var("KILL_SWITCH_CHECK_INTERVAL_MS")
                .unwrap_or_else(|_| "100".to_string())
                .parse()?,

            clob_api_url: env::var("CLOB_API_URL")
                .unwrap_or_else(|_| "https://clob.polymarket.com".to_string()),
        })
    }
}

impl Default for Config {
    fn default() -> Self {
        Config {
            websocket_url: "wss://ws-subscriptions-clob.polymarket.com/ws/market".to_string(),
            redis_socket_path: "/var/run/redis/redis.sock".to_string(),
            heartbeat_timeout_secs: 60,
            reconnect_delay_ms: 1000,
            max_reconnect_attempts: 10,
            kill_switch_check_interval_ms: 100,
            clob_api_url: "https://clob.polymarket.com".to_string(),
        }
    }
}
