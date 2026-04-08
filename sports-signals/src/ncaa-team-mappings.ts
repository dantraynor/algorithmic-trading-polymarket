/**
 * NCAA team matching utilities for ESPN <-> Polymarket matching.
 *
 * Unlike NBA where there are only 30 teams, NCAA has 350+ D1 programs.
 * Instead of maintaining a static mapping, we use fuzzy matching on team
 * display names. ESPN uses "Duke Blue Devils", Polymarket typically uses
 * the same or similar naming in market titles.
 */

/**
 * Normalize a team name for comparison: lowercase, strip common suffixes,
 * collapse whitespace.
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Match an ESPN team name against a Polymarket market title.
 *
 * Checks both the full display name and the school-only portion.
 * ESPN: "Duke Blue Devils" -> matches "Duke Blue Devils vs. Kansas Jayhawks"
 * Also matches just "Duke" against the title for shorter market names.
 *
 * @param espnName - Full ESPN displayName (e.g. "Duke Blue Devils")
 * @param polymarketTitle - Full Polymarket market question/title
 * @returns true if the team appears in the market title
 */
export function matchNcaaTeam(espnName: string, polymarketTitle: string): boolean {
  const normalizedEspn = normalize(espnName);
  const normalizedTitle = normalize(polymarketTitle);

  // Direct full-name match: "duke blue devils" in title
  if (normalizedTitle.includes(normalizedEspn)) {
    return true;
  }

  // School-only match: try first word(s) before mascot
  // e.g. "Duke Blue Devils" -> try "Duke"
  // e.g. "North Carolina Tar Heels" -> try "North Carolina"
  // We split on known mascot patterns
  const schoolName = extractSchoolName(normalizedEspn);
  if (schoolName && schoolName.length >= 3 && normalizedTitle.includes(schoolName)) {
    return true;
  }

  return false;
}

/**
 * Extract teams from a Polymarket NCAA market title.
 * Supports patterns like:
 * - "Will Duke Blue Devils beat Kansas Jayhawks?"
 * - "Duke Blue Devils vs. Kansas Jayhawks"
 * - "Duke vs Kansas"
 */
const NCAA_BEAT_PATTERN = /will\s+(?:the\s+)?([\w\s]+?)\s+beat\s+(?:the\s+)?([\w\s]+?)[\s?]*$/i;
const NCAA_VS_PATTERN = /([\w\s]+?)\s+vs\.?\s+([\w\s]+?)[\s?]*$/i;
const NCAA_WIN_PATTERN = /will\s+(?:the\s+)?([\w\s]+?)\s+win\s+(?:against|over)\s+(?:the\s+)?([\w\s]+?)[\s?]*$/i;

export function extractNcaaTeamsFromTitle(title: string): { team1: string; team2: string } | null {
  for (const pattern of [NCAA_BEAT_PATTERN, NCAA_WIN_PATTERN, NCAA_VS_PATTERN]) {
    const match = title.match(pattern);
    if (match) {
      return { team1: match[1].trim(), team2: match[2].trim() };
    }
  }
  return null;
}

/**
 * Known multi-word school names that should not be split.
 * The mascot portion follows these. This list covers major tournament programs.
 */
const KNOWN_SCHOOLS: string[] = [
  'north carolina', 'saint marys', "saint mary's", 'st. marys', "st. mary's",
  'michigan state', 'ohio state', 'florida state', 'iowa state', 'kansas state',
  'oklahoma state', 'penn state', 'texas tech', 'virginia tech', 'georgia tech',
  'nc state', 'san diego state', 'boise state', 'colorado state', 'utah state',
  'new mexico', 'south carolina', 'west virginia', 'northwestern', 'wake forest',
  'boston college', 'notre dame', 'grand canyon', 'saint peters', "saint peter's",
  'st. peters', "st. peter's", 'mount st. marys', "mount st. mary's",
  'oral roberts', 'abilene christian', 'texas a&m', 'uab', 'ucf', 'usc', 'ucla',
  'unlv', 'utep', 'vcu', 'smu', 'tcu', 'lsu', 'ole miss', 'byu',
  'unc', 'unc asheville', 'unc wilmington',
  'long beach state', 'cal state fullerton', 'southeast missouri',
  'northern iowa', 'middle tennessee', 'south dakota state',
  'north dakota state', 'murray state', 'morehead state',
  'jacksonville state', 'kennesaw state', 'sam houston state',
  'stephen f. austin', 'texas southern', 'prairie view a&m',
  'new orleans', 'loyola chicago', 'saint louis',
];

/**
 * Extract the school-name portion from a full ESPN displayName.
 * Returns lowercase school name.
 */
function extractSchoolName(normalizedFullName: string): string | null {
  // Check known multi-word schools first
  for (const school of KNOWN_SCHOOLS) {
    if (normalizedFullName.startsWith(school)) {
      return school;
    }
  }

  // Single-word school: take the first word
  // e.g. "duke blue devils" -> "duke"
  // e.g. "gonzaga bulldogs" -> "gonzaga"
  const parts = normalizedFullName.split(' ');
  if (parts.length >= 2) {
    return parts[0];
  }

  return normalizedFullName;
}
