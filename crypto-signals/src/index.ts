/**
 * Crypto Signals Service
 *
 * Discovers 5-minute Up/Down markets for BTC, ETH, SOL on Polymarket,
 * reads price momentum from Binance, and publishes AlphaSignals to Redis.
 */

import Redis from 'ioredis';
import axios from 'axios';
import { createLogger, format, transports } from 'winston';
import { loadConfig } from './config';
import { MultiBinanceFeed } from './binance-feed';
import { CryptoMarketScanner } from './market-scanner';
import { CryptoSignalGenerator } from './signal-generator';
import {
  ALPHA_SIGNALS_CHANNEL,
  CRYPTO_SIGNALS_ENABLED,
  REDIS_KEYS,
} from '../../shared/src/constants';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

async function main(): Promise<void> {
  const config = loadConfig();

  logger.info('Starting crypto-signals service', {
    binanceSymbols: config.binanceSymbols,
    minDirectionBps: config.minDirectionBps,
    minEntryPrice: config.minEntryPrice,
    maxEntryPrice: config.maxEntryPrice,
    minEdgeBps: config.minEdgeBps,
    scanIntervalMs: config.scanIntervalMs,
    entryStartSec: config.entryStartSec,
    entryEndSec: config.entryEndSec,
  });

  // Initialize Redis
  const redis = new Redis(config.redisSocketPath, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });

  redis.on('error', (err) => {
    logger.error('Redis connection error', { error: err.message });
  });

  // Initialize components
  const binanceFeed = new MultiBinanceFeed(config.binanceSymbols, config.minDirectionBps);
  const marketScanner = new CryptoMarketScanner();
  const signalGenerator = new CryptoSignalGenerator({
    minEntryPrice: config.minEntryPrice,
    maxEntryPrice: config.maxEntryPrice,
    minEdgeBps: config.minEdgeBps,
  });

  // Connect to Binance combined streams
  try {
    await binanceFeed.connect();
    logger.info('Binance feed connected, first price received');
  } catch (error: any) {
    logger.error('Failed to connect Binance feed', { error: error.message });
    throw error;
  }

  // Fail-closed kill switch check
  const killSwitchValue = await redis.get(CRYPTO_SIGNALS_ENABLED);
  if (killSwitchValue !== 'TRUE') {
    logger.warn('CRYPTO_SIGNALS_ENABLED is not TRUE — signals will not be emitted until enabled', {
      currentValue: killSwitchValue,
      key: CRYPTO_SIGNALS_ENABLED,
    });
  }

  let isRunning = true;

  // Track which windows have had open prices recorded per symbol
  const recordedWindowOpens = new Set<string>();

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down crypto-signals service...');
    isRunning = false;
    binanceFeed.disconnect();
    try {
      await redis.quit();
    } catch {
      // Already closed
    }
    logger.info('Crypto-signals service stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Main scan loop
  while (isRunning) {
    const loopStart = Date.now();

    try {
      // Check kill switches (master + crypto-signals-specific)
      const [masterEnabled, cryptoEnabled] = await Promise.all([
        redis.get(REDIS_KEYS.KILL_SWITCH),
        redis.get(CRYPTO_SIGNALS_ENABLED),
      ]);
      if (masterEnabled !== 'TRUE') {
        logger.debug('Master kill switch not enabled, skipping scan', { key: REDIS_KEYS.KILL_SWITCH });
      } else if (cryptoEnabled !== 'TRUE') {
        logger.debug('Crypto signals kill switch not enabled, skipping scan', { key: CRYPTO_SIGNALS_ENABLED });
      } else {
        const nowSec = Math.floor(Date.now() / 1000);
        const windowTimestamp = marketScanner.getCurrentWindowTimestamp(nowSec);

        // Record open prices on new window for each symbol
        for (const symbol of config.binanceSymbols) {
          const windowKey = `${symbol}:${windowTimestamp}`;
          if (!recordedWindowOpens.has(windowKey)) {
            binanceFeed.recordWindowOpen(symbol, windowTimestamp);
            recordedWindowOpens.add(windowKey);
            // Prune old window keys (keep only last 2 windows worth)
            for (const key of recordedWindowOpens) {
              const [, tsStr] = key.split(':');
              if (tsStr && parseInt(tsStr) < windowTimestamp - 600) {
                recordedWindowOpens.delete(key);
              }
            }
          }
        }

        // Check if in entry window
        const inEntryWindow = marketScanner.isInEntryWindow(
          windowTimestamp,
          nowSec,
          config.entryStartSec,
          config.entryEndSec,
        );

        if (!inEntryWindow) {
          logger.debug('Not in entry window', {
            windowTimestamp,
            elapsed: nowSec - windowTimestamp,
            entryStartSec: config.entryStartSec,
            entryEndSec: config.entryEndSec,
          });
        } else {
          // Discover markets for current window
          const markets = await marketScanner.discoverMarkets(
            windowTimestamp,
            config.binanceSymbols,
          );

          const timeRemainingSeconds = (windowTimestamp + 300) - nowSec;

          for (const [asset, market] of markets) {
            // Get direction from BinanceFeed
            const directionResult = binanceFeed.getDirection(asset, windowTimestamp);
            if (!directionResult || directionResult.direction === 'FLAT') {
              logger.debug('No directional signal for asset', { asset, direction: directionResult?.direction });
              continue;
            }

            // Calculate confidence
            const confidence = signalGenerator.calculateConfidence(
              directionResult.deltaBps,
              timeRemainingSeconds,
            );

            // Determine which token to buy: UP → YES token, DOWN → NO token
            const direction = directionResult.direction === 'UP' ? 'YES' as const : 'NO' as const;
            const tokenId = direction === 'YES' ? market.upTokenId : market.downTokenId;

            // Fetch orderbook from CLOB
            let currentAsk = 0;
            let availableLiquidity = 0;
            try {
              const obResponse = await axios.get(`${config.clobApiUrl}/book`, {
                params: { token_id: tokenId },
                timeout: 5000,
              });
              const orderbook = obResponse.data as { asks?: Array<{ price: string; size: string }> };
              if (orderbook.asks && orderbook.asks.length > 0) {
                currentAsk = parseFloat(orderbook.asks[0].price);
                availableLiquidity = parseFloat(orderbook.asks[0].size) * currentAsk;
              }
            } catch (err: any) {
              logger.debug('Failed to fetch orderbook', { asset, tokenId, error: err.message });
              continue;
            }

            if (currentAsk <= 0) {
              logger.debug('No ask price available', { asset, tokenId });
              continue;
            }

            // Check shouldEmitSignal
            if (!signalGenerator.shouldEmitSignal(confidence, currentAsk)) {
              logger.debug('Signal not emitted — insufficient edge', {
                asset,
                direction,
                confidence,
                currentAsk,
                minEdgeBps: config.minEdgeBps,
              });
              continue;
            }

            // Create and publish AlphaSignal
            const signal = signalGenerator.createSignal(
              market,
              direction,
              confidence,
              currentAsk,
              availableLiquidity,
              timeRemainingSeconds,
            );

            await redis.publish(ALPHA_SIGNALS_CHANNEL, JSON.stringify(signal));

            logger.info('AlphaSignal published', {
              id: signal.id,
              asset,
              direction,
              confidence: confidence.toFixed(4),
              currentAsk,
              edge: signal.edge.toFixed(4),
              urgency: signal.urgency,
              deltaBps: directionResult.deltaBps.toFixed(2),
            });
          }
        }
      }
    } catch (error: any) {
      logger.error('Error in scan loop', { error: error.message, stack: error.stack });
    }

    // Wait for next interval
    const elapsed = Date.now() - loopStart;
    const waitMs = Math.max(0, config.scanIntervalMs - elapsed);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

main().catch((error) => {
  logger.error('Fatal error', { error: error.message, stack: error.stack });
  process.exit(1);
});
