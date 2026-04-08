//! Error types for the ingestion layer

use thiserror::Error;

#[derive(Error, Debug)]
pub enum IngestionError {
    #[error("WebSocket connection error: {0}")]
    WebSocketConnection(String),
    
    #[error("WebSocket message error: {0}")]
    WebSocketMessage(String),
    
    #[error("Redis connection error: {0}")]
    RedisConnection(String),
    
    #[error("Redis operation error: {0}")]
    RedisOperation(String),
    
    #[error("Message parsing error: {0}")]
    MessageParsing(String),
    
    #[error("Configuration error: {0}")]
    Configuration(String),
    
    #[error("Heartbeat timeout after {0} seconds")]
    HeartbeatTimeout(u64),
    
    #[error("Trading disabled via kill switch")]
    TradingDisabled,
    
    #[error("Maximum reconnection attempts exceeded")]
    MaxReconnectAttempts,
    
    #[error("Sequence gap detected: expected {expected}, got {actual}")]
    SequenceGap { expected: u64, actual: u64 },

    #[error("Invalid price value: {0}")]
    InvalidPrice(String),

    #[error("Invalid size value: {0}")]
    InvalidSize(String),

    #[error("HTTP request error: {0}")]
    HttpRequest(String),
}

impl From<redis::RedisError> for IngestionError {
    fn from(err: redis::RedisError) -> Self {
        IngestionError::RedisOperation(err.to_string())
    }
}

impl From<tokio_tungstenite::tungstenite::Error> for IngestionError {
    fn from(err: tokio_tungstenite::tungstenite::Error) -> Self {
        IngestionError::WebSocketConnection(err.to_string())
    }
}

impl From<serde_json::Error> for IngestionError {
    fn from(err: serde_json::Error) -> Self {
        IngestionError::MessageParsing(err.to_string())
    }
}
