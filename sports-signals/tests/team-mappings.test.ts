import { describe, it, expect } from 'vitest';
import { findTeam } from '../src/team-mappings';

describe('findTeam', () => {
  it('finds team by full name', () => {
    const team = findTeam('los angeles lakers');
    expect(team).toBeDefined();
    expect(team!.abbreviation).toBe('LAL');
  });

  it('finds team by abbreviation', () => {
    const team = findTeam('BOS');
    expect(team).toBeDefined();
    expect(team!.fullName).toBe('Boston Celtics');
  });

  it('finds team by alias', () => {
    expect(findTeam('lakers')!.abbreviation).toBe('LAL');
    expect(findTeam('celtics')!.abbreviation).toBe('BOS');
    expect(findTeam('sixers')!.abbreviation).toBe('PHI');
    expect(findTeam('cavs')!.abbreviation).toBe('CLE');
  });

  it('is case-insensitive', () => {
    expect(findTeam('LAKERS')).toBeDefined();
    expect(findTeam('Lakers')).toBeDefined();
  });

  it('returns null for unknown team', () => {
    expect(findTeam('nonexistent')).toBeNull();
    expect(findTeam('')).toBeNull();
  });

  it('finds multi-word team names', () => {
    expect(findTeam('golden state')!.abbreviation).toBe('GSW');
    expect(findTeam('trail blazers')!.abbreviation).toBe('POR');
    expect(findTeam('oklahoma city')!.abbreviation).toBe('OKC');
  });
});
