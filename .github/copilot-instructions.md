# Polymarket Arbitrage Bot - Development Instructions

## Architecture Overview
Unified Node Architecture - GCP Compute Engine

## Project Structure
- `/ingestion` - Rust WebSocket consumer for order book data
- `/signal-core` - Rust arbitrage detection engine
- `/execution` - TypeScript order execution with ethers.js
- `/settlement` - TypeScript position merger via Polymarket Relayer
- `/shared` - Common types and utilities

## Key Technologies
- **Ingestion**: Rust with tokio-tungstenite, Redis Unix Domain Sockets
- **Signal Core**: Rust with O(1) scanning
- **Execution**: TypeScript, ethers.js, EIP-712 signing
- **Settlement**: TypeScript, Gnosis Safe, Polymarket Relayer
- **Infrastructure**: GCP Compute Engine, Secret Manager, Cloud Logging

## Critical Constants
- WebSocket: `wss://ws-subscriptions-clob.polymarket.com`
- Order Type: FOK (Fill or Kill)
- Batch Limit: 15 orders
- Signature Type: 2 (Gnosis Safe)
- Redis Socket: `/var/run/redis/redis.sock`

## Latency Budget
- Tick Arrival: ~4ms
- Book Update: <0.1ms
- Decision: <0.05ms
- Signing: <0.5ms
- Order Send: ~8ms
- **Total Tick-to-Trade: ~13ms**

## Safety Systems
- Global Kill-Switch: Redis key `TRADING_ENABLED`
- Balance Guard: Auto-halt on >10% drop/hour
- Heartbeat: Force reconnect after 60s silence

## Development Commands
```bash
# Rust components
cd ingestion && cargo build --release
cd signal-core && cargo build --release

# TypeScript components
cd execution && npm install && npm run build
cd settlement && npm install && npm run build

# Full stack with Docker
docker-compose up -d
```

## GCP Deployment
```bash
# Set project
gcloud config set project YOUR_PROJECT_ID

# Deploy with Terraform
cd infrastructure/terraform
terraform init
terraform apply

# SSH to instance
gcloud compute ssh YOUR_VM_NAME --zone=YOUR_ZONE
```
