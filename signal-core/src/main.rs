//! Signal Core - Arbitrage Detection Engine
//! 
//! O(1) scanning for box spread arbitrage opportunities
//! Triggers execution when: Price_Yes + Price_No < (1.00 - Buffer)

mod scanner;
mod config;
mod types;
mod redis_client;

use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::{info, error, Level};
use tracing_subscriber::{fmt, EnvFilter};

use crate::config::Config;
use crate::scanner::BoxSpreadScanner;
use crate::redis_client::RedisClient;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize tracing
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive(Level::INFO.into()))
        .json()
        .init();

    info!("Starting Signal Core v0.1.0 - Arbitrage Detection Engine");

    // Load configuration
    let config = Config::from_env()?;
    
    // Initialize Redis connection
    let redis_client = Arc::new(RedisClient::new(&config.redis_socket_path).await?);
    
    // Check global kill switch
    if !redis_client.is_trading_enabled().await? {
        error!("Trading is disabled via kill switch. Exiting.");
        return Ok(());
    }

    // Create shutdown channel
    let (shutdown_tx, _) = broadcast::channel::<()>(1);
    
    // Initialize scanner
    let scanner = BoxSpreadScanner::new(
        config.clone(),
        redis_client.clone(),
        shutdown_tx.subscribe(),
    );

    // Handle shutdown signals
    let shutdown_tx_clone = shutdown_tx.clone();
    tokio::spawn(async move {
        tokio::signal::ctrl_c().await.expect("Failed to listen for ctrl+c");
        info!("Shutdown signal received");
        let _ = shutdown_tx_clone.send(());
    });

    // Run the scanner
    scanner.run().await?;

    info!("Signal core shutdown complete");
    Ok(())
}
