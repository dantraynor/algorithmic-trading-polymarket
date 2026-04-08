//! Type definitions for WebSocket messages and order book data

use serde::{Deserialize, Serialize};

/// Price changes message from Polymarket WebSocket
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceChangesMessage {
    pub market: String,
    pub price_changes: Vec<PriceChangeEntry>,
}

/// A single price change entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceChangeEntry {
    pub asset_id: String,
    pub price: String,
    pub size: String,
    pub side: TradeSide,
    #[serde(default)]
    pub hash: Option<String>,
    #[serde(default)]
    pub best_bid: Option<String>,
    #[serde(default)]
    pub best_ask: Option<String>,
}

/// Trade side as sent by Polymarket (BUY/SELL)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum TradeSide {
    Buy,
    Sell,
}

impl TradeSide {
    /// Convert to order book side (BUY = Bid, SELL = Ask)
    pub fn to_book_side(self) -> Side {
        match self {
            TradeSide::Buy => Side::Bid,
            TradeSide::Sell => Side::Ask,
        }
    }
}

/// Full order book snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BookSnapshot {
    pub asset_id: String,
    pub market: String,
    pub bids: Vec<PriceLevel>,
    pub asks: Vec<PriceLevel>,
    #[serde(default)]
    pub timestamp: Option<String>,
    #[serde(default)]
    pub hash: Option<String>,
}

/// Single price level in the order book
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceLevel {
    pub price: String,
    pub size: String,
}

/// Order side (internal representation for Redis storage)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Side {
    Bid,
    Ask,
}

/// Subscription confirmation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionConfirm {
    pub channel: String,
    pub assets: Vec<String>,
}

/// Error message from WebSocket
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ErrorMessage {
    pub code: i32,
    pub message: String,
}

/// Subscription request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubscriptionRequest {
    pub auth: Option<AuthPayload>,
    pub markets: Vec<String>,
    pub assets_ids: Vec<String>,
    #[serde(rename = "type")]
    pub msg_type: String,
}

/// Authentication payload
#[derive(Clone, Serialize, Deserialize)]
pub struct AuthPayload {
    pub api_key: String,
    pub secret: String,
    pub passphrase: String,
}

impl std::fmt::Debug for AuthPayload {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AuthPayload")
            .field("api_key", &format!("{}...", &self.api_key.chars().take(8).collect::<String>()))
            .field("secret", &"[REDACTED]")
            .field("passphrase", &"[REDACTED]")
            .finish()
    }
}
