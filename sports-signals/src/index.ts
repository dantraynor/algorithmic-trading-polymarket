import Redis from 'ioredis';
import axios from 'axios';
import { createLogger, format, transports } from 'winston';
import { loadConfig } from './config';
import { EspnClient } from './espn-client';
import { SportsMarketScanner } from './market-scanner';
import { SportsSignalGenerator, NcaaSportsSignalGenerator } from './signal-generator';
import { NbaWinProbability } from './win-probability';
import { NcaaWinProbability } from './ncaa-win-probability';
import { SportsMarketInfo, GameScore } from './types';
import {
  ALPHA_SIGNALS_CHANNEL,
  SPORTS_SIGNALS_ENABLED,
  NCAAM_SIGNALS_ENABLED,
  REDIS_KEYS,
} from '../../shared/src/constants';
import { recordSignal } from '../../shared/src/db';

const logger = createLogger({
  level: 'info',
  format: format.combine(format.timestamp(), format.json()),
  transports: [new transports.Console()],
});

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const config = loadConfig();
  const redis = new Redis(config.redisSocketPath);
  const espn = new EspnClient(config.espnBaseUrl);
  const scanner = new SportsMarketScanner();

  // NBA components (existing)
  const nbaGenerator = new SportsSignalGenerator({
    minEntryPrice: config.minEntryPrice,
    maxEntryPrice: config.maxEntryPrice,
    minEdgeBps: config.minEdgeBps,
  });
  const nbaWinModel = new NbaWinProbability();

  // NCAA components (new)
  const ncaaGenerator = new NcaaSportsSignalGenerator({
    minEntryPrice: config.ncaaMinEntryPrice,
    maxEntryPrice: config.ncaaMaxEntryPrice,
    minEdgeBps: config.ncaaMinEdgeBps,
    minTimeRemainingSec: config.ncaaMinTimeRemainingSec,
    scoreStaleMs: config.ncaaScoreStaleMs,
  });
  const ncaaWinModel = new NcaaWinProbability();

  redis.on('error', (err) => {
    logger.error('Redis connection error', { error: err.message });
  });

  logger.info('Starting sports-signals service', {
    minEntryPrice: config.minEntryPrice,
    maxEntryPrice: config.maxEntryPrice,
    minEdgeBps: config.minEdgeBps,
    ncaaMinEntryPrice: config.ncaaMinEntryPrice,
    ncaaMaxEntryPrice: config.ncaaMaxEntryPrice,
    ncaaMinEdgeBps: config.ncaaMinEdgeBps,
    ncaaMinTimeRemainingSec: config.ncaaMinTimeRemainingSec,
    scanIntervalMs: config.scanIntervalMs,
    scorePollingIntervalMs: config.scorePollingIntervalMs,
    espnBaseUrl: config.espnBaseUrl,
  });

  // Fail-closed kill switch check — warn, don't auto-set
  const [sportsKillVal, ncaaKillVal] = await Promise.all([
    redis.get(SPORTS_SIGNALS_ENABLED),
    redis.get(NCAAM_SIGNALS_ENABLED),
  ]);
  if (sportsKillVal !== 'TRUE') {
    logger.warn('SPORTS_SIGNALS_ENABLED is not TRUE — NBA signals disabled. Set manually to enable.', {
      currentValue: sportsKillVal,
      key: SPORTS_SIGNALS_ENABLED,
    });
  }
  if (ncaaKillVal !== 'TRUE') {
    logger.warn('NCAAM_SIGNALS_ENABLED is not TRUE — NCAA signals disabled. Set manually to enable.', {
      currentValue: ncaaKillVal,
      key: NCAAM_SIGNALS_ENABLED,
    });
  }

  let nbaActiveMarkets: SportsMarketInfo[] = [];
  let ncaaActiveMarkets: SportsMarketInfo[] = [];
  let lastNbaDiscovery = 0;
  let lastNcaaDiscovery = 0;

  while (true) {
    try {
      // Check kill switches (master + per-league)
      const [masterEnabled, sportsEnabled, ncaaEnabled] = await Promise.all([
        redis.get(REDIS_KEYS.KILL_SWITCH),
        redis.get(SPORTS_SIGNALS_ENABLED),
        redis.get(NCAAM_SIGNALS_ENABLED),
      ]);

      if (masterEnabled !== 'TRUE') {
        logger.debug('Master kill switch not enabled, skipping scan', { key: REDIS_KEYS.KILL_SWITCH });
        await sleep(config.scorePollingIntervalMs);
        continue;
      }

      const now = Date.now();

      // ── NBA Scanning (existing, unchanged logic) ──────────────────
      if (sportsEnabled === 'TRUE') {
        const nbaGames = await espn.fetchNbaScoreboard();
        const liveNbaGames = nbaGames.filter(g => g.isLive);

        if (liveNbaGames.length > 0) {
          // Discover NBA markets periodically
          if (now - lastNbaDiscovery > config.scanIntervalMs) {
            nbaActiveMarkets = await scanner.discoverMarkets(nbaGames);
            lastNbaDiscovery = now;
            logger.info('NBA market discovery', {
              found: nbaActiveMarkets.length,
              liveGames: liveNbaGames.length,
            });
          }

          // Evaluate each NBA market
          for (const market of nbaActiveMarkets) {
            const game = liveNbaGames.find(g => g.gameId === market.gameId);
            if (!game) continue;

            const timeRemainingSec = game.timeRemainingMs / 1000;
            const scoreDiff = game.homeScore - game.awayScore;
            const prob = nbaWinModel.calculate(scoreDiff, timeRemainingSec);

            const homeWinConfidence = prob.homeWinProb;
            const awayWinConfidence = 1 - prob.homeWinProb;

            await evaluateAndEmitNba(
              redis, nbaGenerator, config, market, 'YES',
              homeWinConfidence, market.yesTokenId, timeRemainingSec, game,
            );
            await evaluateAndEmitNba(
              redis, nbaGenerator, config, market, 'NO',
              awayWinConfidence, market.noTokenId, timeRemainingSec, game,
            );
          }
        } else {
          logger.debug('No live NBA games');
        }
      }

      // ── NCAA Scanning (new) ───────────────────────────────────────
      if (ncaaEnabled === 'TRUE') {
        const ncaaGames = await espn.fetchNcaaScoreboard();
        const liveNcaaGames = ncaaGames.filter(g => g.isLive);

        if (liveNcaaGames.length > 0) {
          // Discover NCAA markets periodically
          if (now - lastNcaaDiscovery > config.scanIntervalMs) {
            ncaaActiveMarkets = await scanner.discoverNcaaMarkets(ncaaGames);
            lastNcaaDiscovery = now;
            logger.info('NCAA market discovery', {
              found: ncaaActiveMarkets.length,
              liveGames: liveNcaaGames.length,
            });
          }

          // Evaluate each NCAA market
          for (const market of ncaaActiveMarkets) {
            const game = liveNcaaGames.find(g => g.gameId === market.gameId);
            if (!game) continue;

            const timeRemainingSec = game.timeRemainingMs / 1000;
            const scoreDiff = game.homeScore - game.awayScore;
            const pregameSpread = game.pregameSpread || 0;
            const prob = ncaaWinModel.calculate(scoreDiff, timeRemainingSec, pregameSpread);

            const homeWinConfidence = prob.homeWinProb;
            const awayWinConfidence = 1 - prob.homeWinProb;

            await evaluateAndEmitNcaa(
              redis, ncaaGenerator, config, market, 'YES',
              homeWinConfidence, market.yesTokenId, timeRemainingSec, game, pregameSpread,
            );
            await evaluateAndEmitNcaa(
              redis, ncaaGenerator, config, market, 'NO',
              awayWinConfidence, market.noTokenId, timeRemainingSec, game, pregameSpread,
            );
          }
        } else {
          logger.debug('No live NCAA games');
        }
      }
    } catch (err: any) {
      logger.error('Scan loop error', { error: err.message });
    }

    await sleep(config.scorePollingIntervalMs);
  }
}

// ── NBA Signal Evaluation (existing, preserved) ───────────────────────

async function evaluateAndEmitNba(
  redis: Redis,
  generator: SportsSignalGenerator,
  config: { clobApiUrl: string },
  market: SportsMarketInfo,
  direction: 'YES' | 'NO',
  confidence: number,
  tokenId: string,
  timeRemainingSec: number,
  game: GameScore,
): Promise<void> {
  // Fetch current ask from CLOB orderbook
  let currentAsk = 0;
  let availableLiquidity = 0;
  try {
    const obRes = await axios.get(`${config.clobApiUrl}/book`, {
      params: { token_id: tokenId },
      timeout: 3000,
    });
    const asks = (obRes.data?.asks || []).sort(
      (a: any, b: any) => parseFloat(a.price) - parseFloat(b.price),
    );
    if (asks.length === 0) return;
    currentAsk = parseFloat(asks[0].price);
    for (const ask of asks) {
      const p = parseFloat(ask.price);
      if (p > currentAsk * 1.05) break;
      availableLiquidity += parseFloat(ask.size) * p;
    }
  } catch {
    return;
  }

  if (!generator.shouldEmitSignal(confidence, currentAsk)) return;

  const signal = generator.createSignal(
    market, direction, confidence, currentAsk,
    availableLiquidity, timeRemainingSec,
  );

  await redis.publish(ALPHA_SIGNALS_CHANNEL, JSON.stringify(signal));

  // Persist signal to SQLite
  recordSignal({
    source: 'sports',
    marketId: market.conditionId,
    direction,
    confidence,
    currentAsk,
    edge: confidence - currentAsk,
    urgency: signal.urgency,
    gameInfo: {
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      timeRemainingSec,
      league: 'NBA',
    },
    timestamp: Date.now(),
  });

  logger.info('NBA signal emitted', {
    game: `${game.homeTeam} vs ${game.awayTeam}`,
    score: `${game.homeScore}-${game.awayScore}`,
    direction,
    confidence: confidence.toFixed(3),
    ask: currentAsk,
    edge: (confidence - currentAsk).toFixed(3),
    timeRemaining: `${Math.floor(timeRemainingSec / 60)}m`,
  });
}

// ── NCAA Signal Evaluation (new) ──────────────────────────────────────

async function evaluateAndEmitNcaa(
  redis: Redis,
  generator: NcaaSportsSignalGenerator,
  config: { clobApiUrl: string },
  market: SportsMarketInfo,
  direction: 'YES' | 'NO',
  confidence: number,
  tokenId: string,
  timeRemainingSec: number,
  game: GameScore,
  pregameSpread: number,
): Promise<void> {
  // Fetch current ask from CLOB orderbook
  let currentAsk = 0;
  let availableLiquidity = 0;
  try {
    const obRes = await axios.get(`${config.clobApiUrl}/book`, {
      params: { token_id: tokenId },
      timeout: 3000,
    });
    const asks = (obRes.data?.asks || []).sort(
      (a: any, b: any) => parseFloat(a.price) - parseFloat(b.price),
    );
    if (asks.length === 0) return;
    currentAsk = parseFloat(asks[0].price);
    for (const ask of asks) {
      const p = parseFloat(ask.price);
      if (p > currentAsk * 1.05) break;
      availableLiquidity += parseFloat(ask.size) * p;
    }
  } catch {
    return;
  }

  // NCAA-specific checks (time cutoff, freshness, dynamic edge)
  const check = generator.shouldEmitSignal(confidence, currentAsk, timeRemainingSec, game);
  if (!check.emit) {
    if (check.reason === 'stale_score') {
      logger.warn('NCAA stale score, skipping signal', {
        game: `${game.homeTeam} vs ${game.awayTeam}`,
        staleness: Date.now() - game.lastUpdated,
      });
    }
    return;
  }

  const signal = generator.createSignal(
    market, direction, confidence, currentAsk,
    availableLiquidity, timeRemainingSec, pregameSpread,
  );

  await redis.publish(ALPHA_SIGNALS_CHANNEL, JSON.stringify(signal));

  // Persist signal to SQLite
  recordSignal({
    source: 'sports',
    marketId: market.conditionId,
    direction,
    confidence,
    currentAsk,
    edge: confidence - currentAsk,
    urgency: signal.urgency,
    gameInfo: {
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
      timeRemainingSec,
      pregameSpread,
      league: 'NCAAM',
    },
    timestamp: Date.now(),
  });

  logger.info('NCAA signal emitted', {
    game: `${game.homeTeam} vs ${game.awayTeam}`,
    score: `${game.homeScore}-${game.awayScore}`,
    direction,
    confidence: confidence.toFixed(3),
    ask: currentAsk,
    edge: (confidence - currentAsk).toFixed(3),
    requiredEdge: generator.calculateRequiredEdge(timeRemainingSec).toFixed(3),
    timeRemaining: `${Math.floor(timeRemainingSec / 60)}m`,
    pregameSpread,
  });
}

// Graceful shutdown
const shutdown = () => {
  logger.info('Shutting down sports-signals');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(err => {
  logger.error('Fatal error', { error: err.message });
  process.exit(1);
});
