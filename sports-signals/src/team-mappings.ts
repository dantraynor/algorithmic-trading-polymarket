export interface TeamInfo {
  espnId: number;
  fullName: string;
  abbreviation: string;
  aliases: string[];
}

// Record keyed by lowercase full team name
export const NBA_TEAMS: Record<string, TeamInfo> = {
  'atlanta hawks': {
    espnId: 1,
    fullName: 'Atlanta Hawks',
    abbreviation: 'ATL',
    aliases: ['hawks', 'atlanta'],
  },
  'boston celtics': {
    espnId: 2,
    fullName: 'Boston Celtics',
    abbreviation: 'BOS',
    aliases: ['celtics', 'boston'],
  },
  'new orleans pelicans': {
    espnId: 3,
    fullName: 'New Orleans Pelicans',
    abbreviation: 'NOP',
    aliases: ['pelicans', 'new orleans'],
  },
  'chicago bulls': {
    espnId: 4,
    fullName: 'Chicago Bulls',
    abbreviation: 'CHI',
    aliases: ['bulls', 'chicago'],
  },
  'cleveland cavaliers': {
    espnId: 5,
    fullName: 'Cleveland Cavaliers',
    abbreviation: 'CLE',
    aliases: ['cavaliers', 'cavs', 'cleveland'],
  },
  'dallas mavericks': {
    espnId: 6,
    fullName: 'Dallas Mavericks',
    abbreviation: 'DAL',
    aliases: ['mavericks', 'mavs', 'dallas'],
  },
  'denver nuggets': {
    espnId: 7,
    fullName: 'Denver Nuggets',
    abbreviation: 'DEN',
    aliases: ['nuggets', 'denver'],
  },
  'detroit pistons': {
    espnId: 8,
    fullName: 'Detroit Pistons',
    abbreviation: 'DET',
    aliases: ['pistons', 'detroit'],
  },
  'golden state warriors': {
    espnId: 9,
    fullName: 'Golden State Warriors',
    abbreviation: 'GSW',
    aliases: ['warriors', 'golden state', 'gsw'],
  },
  'houston rockets': {
    espnId: 10,
    fullName: 'Houston Rockets',
    abbreviation: 'HOU',
    aliases: ['rockets', 'houston'],
  },
  'indiana pacers': {
    espnId: 11,
    fullName: 'Indiana Pacers',
    abbreviation: 'IND',
    aliases: ['pacers', 'indiana'],
  },
  'la clippers': {
    espnId: 12,
    fullName: 'LA Clippers',
    abbreviation: 'LAC',
    aliases: ['clippers', 'la clippers', 'los angeles clippers'],
  },
  'los angeles lakers': {
    espnId: 13,
    fullName: 'Los Angeles Lakers',
    abbreviation: 'LAL',
    aliases: ['lakers', 'la lakers', 'los angeles'],
  },
  'miami heat': {
    espnId: 14,
    fullName: 'Miami Heat',
    abbreviation: 'MIA',
    aliases: ['heat', 'miami'],
  },
  'milwaukee bucks': {
    espnId: 15,
    fullName: 'Milwaukee Bucks',
    abbreviation: 'MIL',
    aliases: ['bucks', 'milwaukee'],
  },
  'minnesota timberwolves': {
    espnId: 16,
    fullName: 'Minnesota Timberwolves',
    abbreviation: 'MIN',
    aliases: ['timberwolves', 'wolves', 'minnesota'],
  },
  'brooklyn nets': {
    espnId: 17,
    fullName: 'Brooklyn Nets',
    abbreviation: 'BKN',
    aliases: ['nets', 'brooklyn'],
  },
  'new york knicks': {
    espnId: 18,
    fullName: 'New York Knicks',
    abbreviation: 'NYK',
    aliases: ['knicks', 'new york'],
  },
  'orlando magic': {
    espnId: 19,
    fullName: 'Orlando Magic',
    abbreviation: 'ORL',
    aliases: ['magic', 'orlando'],
  },
  'philadelphia 76ers': {
    espnId: 20,
    fullName: 'Philadelphia 76ers',
    abbreviation: 'PHI',
    aliases: ['76ers', 'sixers', 'philadelphia', 'philly'],
  },
  'phoenix suns': {
    espnId: 21,
    fullName: 'Phoenix Suns',
    abbreviation: 'PHX',
    aliases: ['suns', 'phoenix'],
  },
  'portland trail blazers': {
    espnId: 22,
    fullName: 'Portland Trail Blazers',
    abbreviation: 'POR',
    aliases: ['trail blazers', 'blazers', 'portland'],
  },
  'sacramento kings': {
    espnId: 23,
    fullName: 'Sacramento Kings',
    abbreviation: 'SAC',
    aliases: ['kings', 'sacramento'],
  },
  'san antonio spurs': {
    espnId: 24,
    fullName: 'San Antonio Spurs',
    abbreviation: 'SAS',
    aliases: ['spurs', 'san antonio'],
  },
  'oklahoma city thunder': {
    espnId: 25,
    fullName: 'Oklahoma City Thunder',
    abbreviation: 'OKC',
    aliases: ['thunder', 'okc', 'oklahoma city', 'oklahoma'],
  },
  'utah jazz': {
    espnId: 26,
    fullName: 'Utah Jazz',
    abbreviation: 'UTA',
    aliases: ['jazz', 'utah'],
  },
  'washington wizards': {
    espnId: 27,
    fullName: 'Washington Wizards',
    abbreviation: 'WAS',
    aliases: ['wizards', 'washington'],
  },
  'toronto raptors': {
    espnId: 28,
    fullName: 'Toronto Raptors',
    abbreviation: 'TOR',
    aliases: ['raptors', 'toronto'],
  },
  'memphis grizzlies': {
    espnId: 29,
    fullName: 'Memphis Grizzlies',
    abbreviation: 'MEM',
    aliases: ['grizzlies', 'memphis'],
  },
  'charlotte hornets': {
    espnId: 30,
    fullName: 'Charlotte Hornets',
    abbreviation: 'CHA',
    aliases: ['hornets', 'charlotte'],
  },
};

/**
 * Find an NBA team by full name, abbreviation, or alias (case-insensitive).
 * Returns null if no matching team is found.
 */
export function findTeam(query: string): TeamInfo | null {
  if (!query || query.trim() === '') {
    return null;
  }

  const normalized = query.trim().toLowerCase();

  // 1. Match by lowercase full name key
  if (NBA_TEAMS[normalized]) {
    return NBA_TEAMS[normalized];
  }

  for (const team of Object.values(NBA_TEAMS)) {
    // 2. Match by abbreviation (case-insensitive)
    if (team.abbreviation.toLowerCase() === normalized) {
      return team;
    }

    // 3. Match by alias
    if (team.aliases.some((alias) => alias.toLowerCase() === normalized)) {
      return team;
    }
  }

  return null;
}
