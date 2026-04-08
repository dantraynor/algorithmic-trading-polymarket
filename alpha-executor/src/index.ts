/**
 * Alpha Executor Service
 *
 * Subscribes to AlphaSignals from Redis, sizes and executes trades on
 * the Polymarket CLOB, and records positions.
 */

import Redis from 'ioredis';
import { createLogger, format, transports } from 'winston';
import { loadConfig } from './config';
import { AlphaSigner } from './signer';
import { AlphaClobClient } from './clob-client';
import { PortfolioRiskManager } from './risk-manager';
import { PositionManager } from './position-manager';
import { SignalProcessor } from './signal-processor';
import { AlphaSignal, PortfolioState, PositionRecord } from '../../shared/src/alpha-types';
import {
  ALPHA_SIGNALS_CHANNEL,
  ALPHA_RESULTS_CHANNEL,
  ALPHA_KILL_SWITCH,
  ALPHA_STATS_KEY,
  REDIS_KEYS,
  PORTFOLIO_PEAK_KEY,
  PORTFOLIO_DAILY_LOSS_KEY,
  POSITIONS_EXPOSURE_KEY,
} from '../../shared/src/constants';
import { recordTrade, recordPosition } from '../../shared/src/db';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

const PRUNE_INTERVAL_MS = 10_000;

async function main(): Promise<void> {
  const config = loadConfig();

  logger.info('Starting alpha-executor service', {
    dryRun: config.dryRun,
    maxOrderShares: config.maxOrderShares,
    takerFeeBps: config.takerFeeBps,
    chainId: config.chainId,
    signatureType: config.signatureType,
  });

  // Initialize Redis — two connections: one for pub/sub, one for data
  const redisSub = new Redis(config.redisSocketPath, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });
  const redisData = new Redis(config.redisSocketPath, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 100, 3000),
  });

  redisSub.on('error', (err) => {
    logger.error('Redis sub connection error', { error: err.message });
  });
  redisData.on('error', (err) => {
    logger.error('Redis data connection error', { error: err.message });
  });

  // Initialize components
  const signer = new AlphaSigner(
    config.privateKey,
    config.gnosisSafeAddress,
    config.chainId,
    config.ctfExchangeAddress,
    config.negRiskCtfExchangeAddress,
    config.signatureType,
  );

  const clobClient = new AlphaClobClient({
    clobApiUrl: config.clobApiUrl,
    clobApiKey: config.clobApiKey,
    clobApiSecret: config.clobApiSecret,
    clobPassphrase: config.clobPassphrase,
    signerAddress: signer.getAddress(),
  });

  const riskManager = new PortfolioRiskManager(redisData);
  const positionManager = new PositionManager(redisData);
  riskManager.setPositionManager(positionManager);
  const signalProcessor = new SignalProcessor(riskManager, positionManager, config.takerFeeBps);

  // Fail-closed kill switch check
  const killSwitchValue = await redisData.get(ALPHA_KILL_SWITCH);
  if (killSwitchValue !== 'TRUE') {
    logger.warn('ALPHA_TRADING_ENABLED is not TRUE — trades will not execute until enabled', {
      currentValue: killSwitchValue,
      key: ALPHA_KILL_SWITCH,
    });
  }

  let isRunning = true;

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down alpha-executor service...');
    isRunning = false;
    try {
      await redisSub.quit();
    } catch { /* Already closed */ }
    try {
      await redisData.quit();
    } catch { /* Already closed */ }
    logger.info('Alpha-executor service stopped');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Periodic stale signal pruning
  const pruneTimer = setInterval(() => {
    if (isRunning) {
      signalProcessor.pruneStaleEntries();
      logger.debug('Pruned stale signal entries');
    }
  }, PRUNE_INTERVAL_MS);
  pruneTimer.unref();

  // Subscribe to signals channel
  await redisSub.subscribe(ALPHA_SIGNALS_CHANNEL);
  logger.info('Subscribed to alpha signals channel', { channel: ALPHA_SIGNALS_CHANNEL });

  redisSub.on('message', async (channel: string, message: string) => {
    if (!isRunning) return;
    if (channel !== ALPHA_SIGNALS_CHANNEL) return;

    let signal: AlphaSignal;
    try {
      signal = JSON.parse(message) as AlphaSignal;
    } catch (err: any) {
      logger.error('Failed to parse signal message', { error: err.message, message });
      return;
    }

    try {
      // Check kill switches (master + alpha-specific)
      const [masterEnabled, alphaEnabled] = await Promise.all([
        redisData.get(REDIS_KEYS.KILL_SWITCH),
        redisData.get(ALPHA_KILL_SWITCH),
      ]);
      if (masterEnabled !== 'TRUE') {
        logger.debug('Master kill switch not enabled, discarding signal', {
          signalId: signal.id,
          key: REDIS_KEYS.KILL_SWITCH,
        });
        return;
      }
      if (alphaEnabled !== 'TRUE') {
        logger.debug('Alpha kill switch not enabled, discarding signal', {
          signalId: signal.id,
          key: ALPHA_KILL_SWITCH,
        });
        return;
      }

      // Build PortfolioState from Redis
      const [balanceStr, exposureStr, peakStr, dailyLossStr, windowsStr] = await Promise.all([
        redisData.get(REDIS_KEYS.SAFE_BALANCE),
        redisData.get(POSITIONS_EXPOSURE_KEY),
        redisData.get(PORTFOLIO_PEAK_KEY),
        redisData.get(PORTFOLIO_DAILY_LOSS_KEY),
        redisData.hget(ALPHA_STATS_KEY, 'totalWindowsTraded'),
      ]);

      const safeBalance = balanceStr ? parseFloat(balanceStr) : 0;
      const totalExposure = exposureStr ? parseFloat(exposureStr) : 0;
      const peakCapital = peakStr ? parseFloat(peakStr) : safeBalance;
      const dailyLoss = dailyLossStr ? parseFloat(dailyLossStr) : 0;
      const totalWindowsTraded = windowsStr ? parseInt(windowsStr, 10) : 0;
      const availableCapital = Math.max(0, safeBalance - totalExposure);
      const phase = riskManager.determinePhase(safeBalance, totalWindowsTraded);

      const portfolioState: PortfolioState = {
        safeBalance,
        totalExposure,
        availableCapital,
        peakCapital,
        realizedPnl: 0,
        dailyLoss,
        phase,
        positionCount: 0,
      };

      // Process signal through SignalProcessor
      const decision = await signalProcessor.processSignal(signal, portfolioState);

      if (decision.action === 'reject') {
        logger.debug('Signal rejected', { signalId: signal.id, reason: decision.reason });
        return;
      }

      const betSize = decision.size;
      const currentAsk = signal.currentAsk;

      logger.info('Executing alpha trade', {
        signalId: signal.id,
        marketId: signal.marketId,
        tokenId: signal.tokenId,
        direction: signal.direction,
        confidence: signal.confidence,
        currentAsk,
        betSize,
        dryRun: config.dryRun,
      });

      // Calculate shares from betSize and currentAsk
      const totalShares = currentAsk > 0 ? Math.floor(betSize / currentAsk) : 0;

      if (totalShares <= 0) {
        logger.warn('Calculated 0 shares, skipping', { betSize, currentAsk });
        return;
      }

      // Chunk into maxOrderShares and sign/submit BUY orders
      let filledShares = 0;
      let orderSuccess = false;

      if (config.dryRun) {
        // Dry run — simulate fill
        filledShares = totalShares;
        orderSuccess = true;
        logger.info('DRY RUN: simulated order fill', {
          tokenId: signal.tokenId,
          price: currentAsk,
          shares: totalShares,
        });
      } else {
        const negRisk = signal.metadata.negRisk as boolean ?? false;
        let remainingShares = totalShares;
        while (remainingShares > 0 && isRunning) {
          const chunkShares = Math.min(remainingShares, config.maxOrderShares);
          try {
            const signedOrder = await signer.signBuyOrder(
              signal.tokenId,
              currentAsk,
              chunkShares,
              negRisk,
            );
            const response = await clobClient.submitOrder(signedOrder);
            if (response.success) {
              filledShares += chunkShares;
              orderSuccess = true;
              logger.info('Order chunk filled', {
                signalId: signal.id,
                orderID: response.orderID,
                chunkShares,
                filledShares,
                totalShares,
              });
            } else {
              logger.warn('Order chunk failed', {
                signalId: signal.id,
                errorMsg: response.errorMsg,
                chunkShares,
              });
              break;
            }
          } catch (err: any) {
            logger.error('Order submission error', { error: err.message, signalId: signal.id });
            break;
          }
          remainingShares -= chunkShares;
        }
      }

      if (!orderSuccess || filledShares <= 0) {
        logger.warn('No shares filled, skipping position recording', { signalId: signal.id });
        return;
      }

      // Record position via PositionManager
      const entryCost = filledShares * currentAsk;
      const positionRecord: PositionRecord = {
        marketId: signal.marketId,
        tokenId: signal.tokenId,
        direction: signal.direction,
        shares: filledShares,
        entryPrice: currentAsk,
        entryCost,
        entryTime: Date.now(),
        source: signal.source,
        signalId: signal.id,
        resolutionTime: signal.resolutionTime,
      };

      await positionManager.openPosition(positionRecord);

      // Persist position to SQLite
      recordPosition({
        marketId: signal.marketId,
        tokenId: signal.tokenId,
        direction: signal.direction,
        shares: filledShares,
        entryPrice: currentAsk,
        entryCost,
        source: signal.source,
        dryRun: config.dryRun,
        openedAt: Date.now(),
        metadata: { signalId: signal.id, confidence: signal.confidence },
      });

      // Persist trade to SQLite
      recordTrade({
        strategy: `alpha-${signal.source}`,
        market: signal.marketId,
        direction: signal.direction,
        shares: filledShares,
        entryPrice: currentAsk,
        cost: entryCost,
        edge: signal.edge,
        dryRun: config.dryRun,
        metadata: { signalId: signal.id, tokenId: signal.tokenId, confidence: signal.confidence },
        timestamp: Date.now(),
      });

      // Update peak capital and increment traded windows counter
      await riskManager.updatePeakCapital(safeBalance);
      await redisData.hincrby(ALPHA_STATS_KEY, 'totalWindowsTraded', 1);

      // Publish result to results:alpha
      const result = {
        signalId: signal.id,
        marketId: signal.marketId,
        tokenId: signal.tokenId,
        direction: signal.direction,
        shares: filledShares,
        entryPrice: currentAsk,
        entryCost,
        dryRun: config.dryRun,
        timestamp: Date.now(),
      };

      await redisData.publish(ALPHA_RESULTS_CHANNEL, JSON.stringify(result));

      logger.info('Alpha trade complete', {
        signalId: signal.id,
        filledShares,
        entryCost: entryCost.toFixed(4),
        dryRun: config.dryRun,
      });
    } catch (error: any) {
      logger.error('Error processing signal', {
        signalId: signal.id,
        error: error.message,
        stack: error.stack,
      });
    }
  });

  logger.info('Alpha-executor service running, awaiting signals...');
}

main().catch((error) => {
  const logger = createLogger({
    level: 'error',
    format: format.combine(format.timestamp(), format.json()),
    transports: [new transports.Console()],
  });
  logger.error('Fatal error', { error: error.message, stack: error.stack });
  process.exit(1);
});
