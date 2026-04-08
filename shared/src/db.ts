/**
 * SQLite persistence layer for historical trading data.
 *
 * Redis stays for real-time pub/sub and live state.
 * SQLite stores all historical trades, signals, positions, and daily stats permanently.
 *
 * Uses better-sqlite3 (synchronous, fast, no async overhead).
 */

import Database from 'better-sqlite3';

const DB_PATH = process.env.SQLITE_DB_PATH || '/data/tradingbot.db';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    initSchema(db);
  }
  return db;
}

// ── Schema ────────────────────────────────────────────────────────────────────

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      strategy TEXT NOT NULL,
      market TEXT NOT NULL,
      direction TEXT,
      outcome TEXT,
      shares REAL,
      entry_price REAL,
      cost REAL,
      pnl REAL,
      edge REAL,
      z_score REAL,
      dry_run INTEGER DEFAULT 0,
      metadata TEXT,
      timestamp INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_trades_strategy ON trades(strategy);
    CREATE INDEX IF NOT EXISTS idx_trades_timestamp ON trades(timestamp);
    CREATE INDEX IF NOT EXISTS idx_trades_dry_run ON trades(dry_run);

    CREATE TABLE IF NOT EXISTS signals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      market_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      confidence REAL NOT NULL,
      current_ask REAL,
      edge REAL,
      urgency TEXT,
      game_info TEXT,
      metadata TEXT,
      timestamp INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_signals_source ON signals(source);
    CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(timestamp);

    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id TEXT NOT NULL,
      token_id TEXT,
      direction TEXT NOT NULL,
      shares REAL,
      entry_price REAL,
      entry_cost REAL,
      exit_price REAL,
      exit_pnl REAL,
      source TEXT,
      status TEXT DEFAULT 'open',
      condition_id TEXT,
      dry_run INTEGER DEFAULT 0,
      opened_at INTEGER NOT NULL,
      closed_at INTEGER,
      metadata TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
    CREATE INDEX IF NOT EXISTS idx_positions_source ON positions(source);

    CREATE TABLE IF NOT EXISTS daily_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      strategy TEXT NOT NULL,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      pnl REAL DEFAULT 0,
      volume REAL DEFAULT 0,
      trades_count INTEGER DEFAULT 0,
      dry_run INTEGER DEFAULT 0,
      UNIQUE(date, strategy, dry_run)
    );
  `);
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DbTrade {
  id: number;
  strategy: string;
  market: string;
  direction: string | null;
  outcome: string | null;
  shares: number | null;
  entry_price: number | null;
  cost: number | null;
  pnl: number | null;
  edge: number | null;
  z_score: number | null;
  dry_run: number;
  metadata: string | null;
  timestamp: number;
  created_at: string;
}

export interface DbSignal {
  id: number;
  source: string;
  market_id: string;
  direction: string;
  confidence: number;
  current_ask: number | null;
  edge: number | null;
  urgency: string | null;
  game_info: string | null;
  metadata: string | null;
  timestamp: number;
  created_at: string;
}

export interface DbPosition {
  id: number;
  market_id: string;
  token_id: string | null;
  direction: string;
  shares: number | null;
  entry_price: number | null;
  entry_cost: number | null;
  exit_price: number | null;
  exit_pnl: number | null;
  source: string | null;
  status: string;
  condition_id: string | null;
  dry_run: number;
  opened_at: number;
  closed_at: number | null;
  metadata: string | null;
}

export interface DbDailyStat {
  id: number;
  date: string;
  strategy: string;
  wins: number;
  losses: number;
  pnl: number;
  volume: number;
  trades_count: number;
  dry_run: number;
}

// ── Write helpers ─────────────────────────────────────────────────────────────

export function recordTrade(trade: {
  strategy: string;
  market: string;
  direction?: string;
  outcome?: string;
  shares?: number;
  entryPrice?: number;
  cost?: number;
  pnl?: number;
  edge?: number;
  zScore?: number;
  dryRun?: boolean;
  metadata?: Record<string, unknown>;
  timestamp: number;
}): void {
  try {
    const d = getDb();
    d.prepare(`
      INSERT INTO trades (strategy, market, direction, outcome, shares, entry_price, cost, pnl, edge, z_score, dry_run, metadata, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trade.strategy,
      trade.market,
      trade.direction ?? null,
      trade.outcome ?? null,
      trade.shares ?? null,
      trade.entryPrice ?? null,
      trade.cost ?? null,
      trade.pnl ?? null,
      trade.edge ?? null,
      trade.zScore ?? null,
      trade.dryRun ? 1 : 0,
      trade.metadata ? JSON.stringify(trade.metadata) : null,
      trade.timestamp,
    );
  } catch (err) {
    console.error('[db] recordTrade error:', err);
  }
}

export function recordSignal(signal: {
  source: string;
  marketId: string;
  direction: string;
  confidence: number;
  currentAsk?: number;
  edge?: number;
  urgency?: string;
  gameInfo?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  timestamp: number;
}): void {
  try {
    const d = getDb();
    d.prepare(`
      INSERT INTO signals (source, market_id, direction, confidence, current_ask, edge, urgency, game_info, metadata, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      signal.source,
      signal.marketId,
      signal.direction,
      signal.confidence,
      signal.currentAsk ?? null,
      signal.edge ?? null,
      signal.urgency ?? null,
      signal.gameInfo ? JSON.stringify(signal.gameInfo) : null,
      signal.metadata ? JSON.stringify(signal.metadata) : null,
      signal.timestamp,
    );
  } catch (err) {
    console.error('[db] recordSignal error:', err);
  }
}

export function recordPosition(position: {
  marketId: string;
  tokenId?: string;
  direction: string;
  shares?: number;
  entryPrice?: number;
  entryCost?: number;
  source?: string;
  conditionId?: string;
  dryRun?: boolean;
  openedAt: number;
  metadata?: Record<string, unknown>;
}): void {
  try {
    const d = getDb();
    d.prepare(`
      INSERT INTO positions (market_id, token_id, direction, shares, entry_price, entry_cost, source, condition_id, dry_run, opened_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      position.marketId,
      position.tokenId ?? null,
      position.direction,
      position.shares ?? null,
      position.entryPrice ?? null,
      position.entryCost ?? null,
      position.source ?? null,
      position.conditionId ?? null,
      position.dryRun ? 1 : 0,
      position.openedAt,
      position.metadata ? JSON.stringify(position.metadata) : null,
    );
  } catch (err) {
    console.error('[db] recordPosition error:', err);
  }
}

export function closePosition(marketId: string, exitPrice: number, exitPnl: number): void {
  try {
    const d = getDb();
    d.prepare(`
      UPDATE positions SET status = 'closed', exit_price = ?, exit_pnl = ?, closed_at = ?
      WHERE market_id = ? AND status = 'open'
    `).run(exitPrice, exitPnl, Date.now(), marketId);
  } catch (err) {
    console.error('[db] closePosition error:', err);
  }
}

export function updateDailyStats(
  date: string,
  strategy: string,
  pnl: number,
  won: boolean,
  volume: number,
  dryRun: boolean,
): void {
  try {
    const d = getDb();
    d.prepare(`
      INSERT INTO daily_stats (date, strategy, wins, losses, pnl, volume, trades_count, dry_run)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(date, strategy, dry_run) DO UPDATE SET
        wins = wins + excluded.wins,
        losses = losses + excluded.losses,
        pnl = pnl + excluded.pnl,
        volume = volume + excluded.volume,
        trades_count = trades_count + 1
    `).run(date, strategy, won ? 1 : 0, won ? 0 : 1, pnl, volume, dryRun ? 1 : 0);
  } catch (err) {
    console.error('[db] updateDailyStats error:', err);
  }
}

// ── Read helpers ──────────────────────────────────────────────────────────────

export function getRecentTrades(limit = 50, strategy?: string, dryRun?: boolean): DbTrade[] {
  try {
    const d = getDb();
    let sql = 'SELECT * FROM trades WHERE 1=1';
    const params: unknown[] = [];

    if (strategy) {
      sql += ' AND strategy = ?';
      params.push(strategy);
    }
    if (dryRun !== undefined) {
      sql += ' AND dry_run = ?';
      params.push(dryRun ? 1 : 0);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    return d.prepare(sql).all(...params) as DbTrade[];
  } catch (err) {
    console.error('[db] getRecentTrades error:', err);
    return [];
  }
}

export function getRecentSignals(limit = 50, source?: string): DbSignal[] {
  try {
    const d = getDb();
    let sql = 'SELECT * FROM signals WHERE 1=1';
    const params: unknown[] = [];

    if (source) {
      sql += ' AND source = ?';
      params.push(source);
    }

    sql += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    return d.prepare(sql).all(...params) as DbSignal[];
  } catch (err) {
    console.error('[db] getRecentSignals error:', err);
    return [];
  }
}

export function getOpenPositions(source?: string): DbPosition[] {
  try {
    const d = getDb();
    let sql = "SELECT * FROM positions WHERE status = 'open'";
    const params: unknown[] = [];

    if (source) {
      sql += ' AND source = ?';
      params.push(source);
    }

    sql += ' ORDER BY opened_at DESC';

    return d.prepare(sql).all(...params) as DbPosition[];
  } catch (err) {
    console.error('[db] getOpenPositions error:', err);
    return [];
  }
}

export function getPositions(status?: string, source?: string): DbPosition[] {
  try {
    const d = getDb();
    let sql = 'SELECT * FROM positions WHERE 1=1';
    const params: unknown[] = [];

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }
    if (source) {
      sql += ' AND source = ?';
      params.push(source);
    }

    sql += ' ORDER BY opened_at DESC';

    return d.prepare(sql).all(...params) as DbPosition[];
  } catch (err) {
    console.error('[db] getPositions error:', err);
    return [];
  }
}

export function getDailyStats(date?: string): DbDailyStat[] {
  try {
    const d = getDb();
    let sql = 'SELECT * FROM daily_stats WHERE 1=1';
    const params: unknown[] = [];

    if (date) {
      sql += ' AND date = ?';
      params.push(date);
    }

    sql += ' ORDER BY date DESC';

    return d.prepare(sql).all(...params) as DbDailyStat[];
  } catch (err) {
    console.error('[db] getDailyStats error:', err);
    return [];
  }
}
