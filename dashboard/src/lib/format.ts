/**
 * Shared formatting utilities for the dashboard.
 * Extracted from component-level duplicates to ensure consistency.
 */

/** Safe coercion — data from Redis may have string values for numeric fields */
export function num(v: unknown): number {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  if (v == null) return 0;
  return parseFloat(String(v)) || 0;
}

/** Format a number as USD with sign prefix, e.g. "+$12.34" or "-$5.00" */
export function formatUsd(value: number): string {
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}$${value.toFixed(2)}`;
}

/** Format a timestamp as a time string (HH:MM:SS or HH:MM) */
export function formatTime(ts: number, includeSeconds = true): string {
  if (!ts) return includeSeconds ? '--:--:--' : '--:--';
  const d = new Date(ts);
  return includeSeconds
    ? d.toLocaleTimeString('en-US', { hour12: false })
    : d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });
}

/** Format a large count with K/M suffixes */
export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`;
  return String(value);
}

/** Format a P&L value with sign prefix, no dollar sign, e.g. "+12.34" or "-5.00" */
export function formatPnl(value: number): string {
  const prefix = value >= 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}`;
}

/** Human-friendly time-ago string from an epoch timestamp */
export function timeAgo(ts: number | null, suffix = ''): string {
  if (!ts) return 'never';
  const seconds = Math.round((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s${suffix}`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${suffix}`;
  return `${Math.floor(seconds / 3600)}h${suffix}`;
}
