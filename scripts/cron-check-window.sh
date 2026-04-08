#!/bin/bash
# Cron wrapper: copies script into settlement container and runs it.
# Logs to /opt/tradingbot/logs/check-window.log
# Sends push notifications via ntfy.sh when trades or redeemable tokens found.
# Install: crontab -e → */5 * * * * /opt/tradingbot/scripts/cron-check-window.sh

LOG_DIR=/opt/tradingbot/logs
SCRIPT=/opt/tradingbot/scripts/check-window.js
NTFY_TOPIC="${NTFY_TOPIC:-your-ntfy-topic}"
mkdir -p "$LOG_DIR"

# Copy script into container (handles container restarts)
docker cp "$SCRIPT" tradingbot-settlement:/app/check-window.js 2>/dev/null

# Run check and capture output
OUTPUT=$(docker exec tradingbot-settlement node /app/check-window.js 2>&1)

# Append to log (keep last 500 lines)
echo "$OUTPUT" >> "$LOG_DIR/check-window.log"
tail -500 "$LOG_DIR/check-window.log" > "$LOG_DIR/check-window.log.tmp" && \
  mv "$LOG_DIR/check-window.log.tmp" "$LOG_DIR/check-window.log"

# Send notification if there are trades or redeemable tokens
if echo "$OUTPUT" | grep -q "RECENT TRADES\|REDEEMABLE"; then
  # Build a compact notification message
  MSG=""

  # Extract trade lines
  TRADES=$(echo "$OUTPUT" | grep -E '^[✅❌]')
  if [ -n "$TRADES" ]; then
    MSG="$TRADES"
  fi

  # Extract balance
  BALANCE=$(echo "$OUTPUT" | grep "EOA USDCe")
  if [ -n "$BALANCE" ]; then
    MSG="$MSG
$BALANCE"
  fi

  # Extract redeemable info
  REDEEM=$(echo "$OUTPUT" | grep "TOTAL REDEEMABLE")
  if [ -n "$REDEEM" ]; then
    MSG="$MSG
$REDEEM"
    # Include conditionIds
    CONDS=$(echo "$OUTPUT" | grep "REDEEM \$")
    if [ -n "$CONDS" ]; then
      MSG="$MSG
$CONDS"
    fi
  fi

  # Send to ntfy
  if [ -n "$MSG" ]; then
    curl -s -d "$MSG" "https://ntfy.sh/$NTFY_TOPIC" > /dev/null 2>&1
  fi
fi
