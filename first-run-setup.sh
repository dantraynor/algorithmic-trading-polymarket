#!/bin/bash
set -e

echo "==================================="
echo "Polymarket Research Terminal - First Run Setup"
echo "==================================="
echo "==================================="

# Check if .env exists with credentials
if [ ! -f /opt/tradingbot/.env ]; then
    echo "ERROR: /opt/tradingbot/.env not found!"
    echo "Please copy your .env file to /opt/tradingbot/.env first"
    exit 1
fi

# Source the .env to get PRIVATE_KEY
source /opt/tradingbot/.env

if [ -z "$PRIVATE_KEY" ]; then
    echo "ERROR: PRIVATE_KEY not set in .env"
    exit 1
fi

echo ""
echo "Step 1: Deriving CLOB API credentials from server IP..."
echo ""

# Install Polymarket CLOB client for key derivation
cd /opt/tradingbot
npm init -y 2>/dev/null || true
npm install @polymarket/clob-client @ethersproject/wallet

# Run key derivation (restricted temp file)
DERIVE_OUT="$(mktemp)"
chmod 600 "$DERIVE_OUT"
trap 'rm -f "$DERIVE_OUT"' EXIT
node scripts/derive-keys.js 2>&1 | tee "$DERIVE_OUT"

# Extract credentials and update .env
API_KEY=$(grep "^CLOB_API_KEY=" "$DERIVE_OUT" | cut -d= -f2-)
API_SECRET=$(grep "^CLOB_API_SECRET=" "$DERIVE_OUT" | cut -d= -f2-)
PASSPHRASE=$(grep "^CLOB_PASSPHRASE=" "$DERIVE_OUT" | cut -d= -f2-)

if [ -n "$API_KEY" ] && [ -n "$API_SECRET" ] && [ -n "$PASSPHRASE" ]; then
    sed -i "s|^CLOB_API_KEY=.*|CLOB_API_KEY=$API_KEY|" /opt/tradingbot/.env
    sed -i "s|^CLOB_API_SECRET=.*|CLOB_API_SECRET=$API_SECRET|" /opt/tradingbot/.env
    sed -i "s|^CLOB_PASSPHRASE=.*|CLOB_PASSPHRASE=$PASSPHRASE|" /opt/tradingbot/.env

    echo ""
    echo "Credentials derived and saved to .env"
else
    echo "ERROR: Failed to derive credentials"
    exit 1
fi

echo ""
echo "Step 2: Building and starting services..."
echo ""

cd /opt/tradingbot
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

echo ""
echo "Step 3: Verifying deployment..."
echo ""

sleep 10
docker compose ps

echo ""
echo "==================================="
echo "First-run setup complete!"
echo ""
echo "Trading is DISABLED by default (fail-closed)."
echo "To enable trading, run:"
echo "  docker exec tradingbot-redis redis-cli -s /var/run/redis/redis.sock SET TRADING_ENABLED TRUE"
echo ""
echo "To check logs:"
echo "  docker compose logs -f"
echo "==================================="
