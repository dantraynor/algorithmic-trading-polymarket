import { describe, it, expect } from 'vitest';
import { num, formatUsd, formatTime, formatCount } from '../format';

describe('num()', () => {
  it('returns a number as-is', () => {
    expect(num(42)).toBe(42);
    expect(num(0)).toBe(0);
    expect(num(-3.5)).toBe(-3.5);
  });

  it('parses a numeric string', () => {
    expect(num('123')).toBe(123);
    expect(num('3.14')).toBe(3.14);
    expect(num('-7')).toBe(-7);
  });

  it('returns 0 for null', () => {
    expect(num(null)).toBe(0);
  });

  it('returns 0 for undefined', () => {
    expect(num(undefined)).toBe(0);
  });

  it('returns 0 for NaN', () => {
    expect(num(NaN)).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(num('')).toBe(0);
  });

  it('returns 0 for non-numeric string', () => {
    expect(num('abc')).toBe(0);
  });
});

describe('formatUsd()', () => {
  it('formats positive values with + prefix', () => {
    expect(formatUsd(12.34)).toBe('+$12.34');
  });

  it('formats negative values (sign from number)', () => {
    expect(formatUsd(-5)).toBe('$-5.00');
  });

  it('formats zero with + prefix', () => {
    expect(formatUsd(0)).toBe('+$0.00');
  });

  it('formats large values', () => {
    expect(formatUsd(1234.567)).toBe('+$1234.57');
  });
});

describe('formatTime()', () => {
  it('formats a valid timestamp with seconds', () => {
    const ts = new Date('2026-01-15T14:30:45Z').getTime();
    const result = formatTime(ts, true);
    // Should contain HH:MM:SS pattern
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  it('formats a valid timestamp without seconds', () => {
    const ts = new Date('2026-01-15T14:30:45Z').getTime();
    const result = formatTime(ts, false);
    // Should contain HH:MM but not extra :SS
    expect(result).toMatch(/\d{2}:\d{2}/);
  });

  it('returns placeholder for 0 timestamp with seconds', () => {
    expect(formatTime(0, true)).toBe('--:--:--');
  });

  it('returns placeholder for 0 timestamp without seconds', () => {
    expect(formatTime(0, false)).toBe('--:--');
  });

  it('defaults to including seconds', () => {
    const ts = new Date('2026-01-15T14:30:45Z').getTime();
    const result = formatTime(ts);
    expect(result).toMatch(/\d{2}:\d{2}:\d{2}/);
  });
});

describe('formatCount()', () => {
  it('formats small numbers as-is', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(42)).toBe('42');
    expect(formatCount(999)).toBe('999');
  });

  it('formats thousands with K suffix', () => {
    expect(formatCount(1000)).toBe('1K');
    expect(formatCount(1500)).toBe('2K');
    expect(formatCount(45000)).toBe('45K');
  });

  it('formats millions with M suffix', () => {
    expect(formatCount(1000000)).toBe('1.0M');
    expect(formatCount(2500000)).toBe('2.5M');
    expect(formatCount(12345678)).toBe('12.3M');
  });
});
