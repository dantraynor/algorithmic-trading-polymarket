/**
 * SQLite database access for the dashboard.
 *
 * Re-exports read helpers from the shared db module.
 * The dashboard only reads from SQLite; writes happen in the trading services.
 */

import Database from 'better-sqlite3';

const DB_PATH = process.env.SQLITE_DB_PATH || '/data/tradingbot.db';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma('journal_mode = WAL');
  }
  return db;
}

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
