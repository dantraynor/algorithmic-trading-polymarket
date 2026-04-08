//! Polymarket WebSocket Ingestion Layer
//! 
//! Connects to wss://ws-subscriptions-clob.polymarket.com
//! Maintains order book snapshots in Redis via Unix Domain Sockets

mod websocket;
mod redis_store;
mod config;
mod types;
mod error;
mod market_fetcher;

use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::{info, error, Level};
use tracing_subscriber::{fmt, EnvFilter};

use crate::config::Config;
use crate::websocket::WebSocketClient;
use crate::redis_store::RedisStore;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive(Level::INFO.into()))
        .json()
        .init();

    info!("Starting Polymarket Ingestion Layer v0.1.0");

    // Load configuration
    let config = Config::from_env()?;
    
    // Initialize Redis connection
    let redis_store = Arc::new(RedisStore::new(&config.redis_socket_path).await?);
    
    // Check global kill switch
    if !redis_store.is_trading_enabled().await? {
        error!("Trading is disabled via kill switch. Exiting.");
        return Ok(());
    }

    // Create shutdown channel
    let (shutdown_tx, _) = broadcast::channel::<()>(1);
    
    // Start WebSocket client
    let ws_client = WebSocketClient::new(
        config.clone(),
        redis_store.clone(),
        shutdown_tx.subscribe(),
    );

    // Handle shutdown signals
    let shutdown_tx_clone = shutdown_tx.clone();
    tokio::spawn(async move {
        tokio::signal::ctrl_c().await.expect("Failed to listen for ctrl+c");
        info!("Shutdown signal received");
        let _ = shutdown_tx_clone.send(());
    });

    // Run the WebSocket client
    ws_client.run().await?;

    info!("Ingestion layer shutdown complete");
    Ok(())
}
