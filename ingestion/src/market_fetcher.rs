//! Fetches active markets from the Polymarket CLOB REST API

use serde::Deserialize;
use tracing::{info, warn};

use crate::error::IngestionError;

#[derive(Debug, Deserialize)]
struct MarketsResponse {
    data: Vec<Market>,
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Market {
    condition_id: String,
    tokens: Vec<Token>,
    #[serde(default)]
    enable_order_book: bool,
}

#[derive(Debug, Deserialize)]
struct Token {
    token_id: String,
    outcome: String,
}

/// A discovered market with its YES and NO token IDs
#[derive(Debug, Clone)]
pub struct DiscoveredMarket {
    pub condition_id: String,
    pub yes_token_id: String,
    pub no_token_id: String,
}

/// Fetch all active markets from the Polymarket CLOB API.
/// Returns a list of discovered markets with their token IDs.
pub async fn fetch_active_markets(clob_api_url: &str) -> Result<Vec<DiscoveredMarket>, IngestionError> {
    let client = reqwest::Client::new();
    let mut all_markets = Vec::new();
    let mut cursor: Option<String> = None;

    loop {
        let mut url = format!("{}/sampling-markets?limit=500", clob_api_url);
        if let Some(ref c) = cursor {
            url.push_str(&format!("&next_cursor={}", c));
        }

        let resp: MarketsResponse = client
            .get(&url)
            .send()
            .await
            .map_err(|e| IngestionError::Configuration(format!("Failed to fetch markets: {}", e)))?
            .json()
            .await
            .map_err(|e| IngestionError::Configuration(format!("Failed to parse markets response: {}", e)))?;

        for market in &resp.data {
            if !market.enable_order_book || market.tokens.len() != 2 {
                continue;
            }

            // Identify YES and NO tokens
            let (yes, no) = if market.tokens[0].outcome == "Yes" {
                (&market.tokens[0], &market.tokens[1])
            } else {
                (&market.tokens[1], &market.tokens[0])
            };

            all_markets.push(DiscoveredMarket {
                condition_id: market.condition_id.clone(),
                yes_token_id: yes.token_id.clone(),
                no_token_id: no.token_id.clone(),
            });
        }

        // Check if there are more pages
        match resp.next_cursor {
            Some(ref c) if c != "LTE=" && !resp.data.is_empty() => {
                cursor = Some(c.clone());
            }
            _ => break,
        }
    }

    info!("Fetched {} active markets with order books", all_markets.len());
    if all_markets.is_empty() {
        warn!("No active markets found — subscription will be empty");
    }

    Ok(all_markets)
}
