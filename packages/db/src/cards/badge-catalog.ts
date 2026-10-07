/**
 * Badge catalog for the player-card progression system.
 *
 * Families, groups and the re-tuned 30-step ladders approved in
 * docs/superpowers/specs/2026-10-07-player-cards-badges-design.md (Part 1).
 * Pure data: imported by the worker (recompute) and the web app (badge UI),
 * so this module must never import the database client.
 */

export const BADGE_FAMILY_IDS = [
  'p3v3',
  'p6v6',
  'p6g',
  'pwins',
  'pgoals',
  'pasts',
  'pshots',
  'pdekes',
  'pht',
  'pbrk',
  'phits',
  'pfo',
  'ptka',
  'pblk',
  'pfight',
  'gg',
  'gw',
  'gsv',
  'gdsv',
  'gpoke',
  'gso',
] as const
export type BadgeFamilyId = (typeof BADGE_FAMILY_IDS)[number]

export type BadgeGroupId = 'games' | 'scoring' | 'physical' | 'defense' | 'goalie'
export type BadgeShapeId = 'hex' | 'round' | 'invtri' | 'square' | 'octagon'
export type TierPool = 'skater' | 'goalie'

export interface BadgeFamily {
  id: BadgeFamilyId
  name: string
  short: string
  /** lucide icon name (kebab-case). */
  glyph: string
  group: BadgeGroupId
  unit: string
}

export interface BadgeGroup {
  id: BadgeGroupId
  name: string
  shape: BadgeShapeId
}

export const BADGE_MAX_LEVEL = 30

export const BADGE_FAMILIES: readonly BadgeFamily[] = [
  {
    id: 'p3v3',
    name: '3v3 Games Completed',
    short: '3V3 GP',
    glyph: 'users',
    group: 'games',
    unit: '3v3 games',
  },
  {
    id: 'p6v6',
    name: '6v6 Games Completed',
    short: '6V6 GP',
    glyph: 'hexagon',
    group: 'games',
    unit: '6v6 games',
  },
  {
    id: 'p6g',
    name: "6's with Goalie",
    short: '6S + G',
    glyph: 'shield-check',
    group: 'games',
    unit: 'games with goalie',
  },
  { id: 'pwins', name: 'Wins', short: 'WINS', glyph: 'trophy', group: 'games', unit: 'wins' },
  { id: 'pgoals', name: 'Goals', short: 'GOALS', glyph: 'siren', group: 'scoring', unit: 'goals' },
  {
    id: 'pasts',
    name: 'Assists',
    short: 'ASSISTS',
    glyph: 'apple',
    group: 'scoring',
    unit: 'assists',
  },
  {
    id: 'pshots',
    name: 'Shots',
    short: 'SHOTS',
    glyph: 'crosshair',
    group: 'scoring',
    unit: 'shots',
  },
  {
    id: 'pdekes',
    name: 'Dekes',
    short: 'DEKES',
    glyph: 'traffic-cone',
    group: 'scoring',
    unit: 'dekes',
  },
  {
    id: 'pht',
    name: 'Hat-Tricks',
    short: 'HAT TRICKS',
    glyph: 'sparkles',
    group: 'scoring',
    unit: 'hat tricks',
  },
  {
    id: 'pbrk',
    name: 'Breakaways',
    short: 'BREAKAWAYS',
    glyph: 'unlink',
    group: 'scoring',
    unit: 'breakaways',
  },
  { id: 'phits', name: 'Hits', short: 'HITS', glyph: 'hammer', group: 'physical', unit: 'hits' },
  {
    id: 'pfo',
    name: 'Faceoffs Won',
    short: 'FACEOFFS',
    glyph: 'circle-dot',
    group: 'defense',
    unit: 'faceoffs won',
  },
  {
    id: 'ptka',
    name: 'Takeaways',
    short: 'TAKEAWAYS',
    glyph: 'magnet',
    group: 'defense',
    unit: 'takeaways',
  },
  {
    id: 'pblk',
    name: 'Blocked Shots',
    short: 'BLOCKS',
    glyph: 'shield',
    group: 'defense',
    unit: 'blocked shots',
  },
  {
    id: 'pfight',
    name: 'Fights Won',
    short: 'FIGHTS',
    glyph: 'swords',
    group: 'physical',
    unit: 'fights won',
  },
  {
    id: 'gg',
    name: 'Goalie Games Completed',
    short: 'STARTS',
    glyph: 'scan-face',
    group: 'goalie',
    unit: 'goalie games',
  },
  {
    id: 'gw',
    name: 'Goalie Wins',
    short: 'G WINS',
    glyph: 'award',
    group: 'goalie',
    unit: 'goalie wins',
  },
  { id: 'gsv', name: 'Saves', short: 'SAVES', glyph: 'hand', group: 'goalie', unit: 'saves' },
  {
    id: 'gdsv',
    name: 'Desperation Saves',
    short: 'DESPERATION',
    glyph: 'heart-pulse',
    group: 'goalie',
    unit: 'desperation saves',
  },
  {
    id: 'gpoke',
    name: 'Goalie Poke-Checks',
    short: 'POKE CHECKS',
    glyph: 'sword',
    group: 'goalie',
    unit: 'poke-checks',
  },
  {
    id: 'gso',
    name: 'Shutouts',
    short: 'SHUTOUTS',
    glyph: 'brick-wall',
    group: 'goalie',
    unit: 'shutouts',
  },
]

/** Display order of the grouped badge list. Shapes per the Badge Leveling sheet. */
export const BADGE_GROUPS: readonly BadgeGroup[] = [
  { id: 'games', name: 'Games & Wins', shape: 'hex' },
  { id: 'scoring', name: 'Scoring', shape: 'round' },
  { id: 'physical', name: 'Physical', shape: 'invtri' },
  { id: 'defense', name: 'Defense & Possession', shape: 'square' },
  { id: 'goalie', name: 'Goalie', shape: 'octagon' },
]

/** Goalie-group families form the goalie tier pool; every other family is skater. */
export function poolOf(family: BadgeFamily): TierPool {
  return family.group === 'goalie' ? 'goalie' : 'skater'
}

/** Thresholds for levels 1..30. Level = number of thresholds the total meets. */
// prettier-ignore
export const BADGE_LADDERS: Readonly<Record<BadgeFamilyId, readonly number[]>> = {
  p3v3: [5, 8, 13, 20, 25, 35, 40, 45, 50, 75, 100, 130, 150, 180, 200, 230, 250, 350, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000],
  p6v6: [5, 15, 42, 120, 150, 220, 250, 280, 310, 460, 620, 770, 920, 1100, 1200, 1400, 1500, 2200, 2800, 3100, 3400, 3700, 4000, 4300, 4600, 4900, 5200, 5500, 5800, 6200],
  p6g: [1, 2, 6, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200],
  pwins: [5, 13, 35, 93, 120, 140, 160, 190, 210, 230, 260, 280, 300, 320, 350, 370, 390, 420, 440, 460, 510, 560, 600, 650, 700, 740, 790, 840, 880, 930],
  pgoals: [1, 4, 16, 65, 130, 260, 390, 520, 650, 780, 920, 1000, 1200, 1300, 1400, 1600, 1800, 2100, 2400, 2600, 2900, 3100, 3400, 3700, 3900, 4200, 4400, 4700, 5000, 5200],
  pasts: [1, 5, 25, 120, 250, 370, 490, 740, 990, 1200, 1500, 1700, 2000, 2200, 2500, 3000, 3500, 3900, 4400, 4900, 5400, 5900, 6400, 6900, 7400, 7900, 8400, 8900, 9400, 9900],
  pshots: [5, 23, 110, 510, 760, 1000, 1300, 1500, 2000, 2500, 3100, 3600, 4100, 4600, 5100, 6100, 7100, 8100, 9200, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000],
  pdekes: [5, 11, 23, 50, 75, 100, 130, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000],
  pht: [1, 3, 6, 16, 20, 24, 28, 33, 37, 41, 45, 49, 53, 57, 61, 81, 100, 120, 140, 160, 180, 200, 220, 240, 260, 280, 310, 330, 370, 410],
  pbrk: [1, 3, 8, 23, 30, 38, 45, 53, 61, 68, 76, 83, 91, 98, 110, 120, 130, 140, 150, 160, 170, 180, 200, 210, 230, 240, 260, 270, 290, 300],
  phits: [5, 23, 110, 500, 750, 1000, 1300, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 6000, 7000, 8000, 9000, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 20000],
  pfo: [25, 40, 63, 100, 150, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1300, 1500, 1800, 2000, 2300, 2500, 2800, 3000, 3300, 3500, 3800, 4000, 4300, 4500, 4800, 5000],
  ptka: [5, 23, 110, 510, 770, 1000, 1300, 1500, 2100, 2600, 3100, 3600, 4100, 4600, 5100, 6200, 7200, 8200, 9200, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000, 19000, 21000],
  pblk: [1, 6, 37, 220, 290, 370, 440, 520, 590, 660, 740, 810, 880, 960, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400, 2500],
  pfight: [1, 2, 6, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200],
  gg: [1, 2, 4, 8, 12, 16, 20, 23, 27, 31, 35, 39, 43, 47, 51, 55, 59, 62, 66, 78, 98, 120, 140, 160, 180, 200, 210, 230, 310, 390],
  gw: [5, 6, 7, 8, 9, 10, 11, 13, 14, 16, 17, 19, 21, 22, 24, 25, 27, 29, 30, 32, 35, 38, 41, 44, 48, 51, 54, 57, 60, 63],
  gsv: [15, 39, 100, 260, 350, 520, 700, 870, 1000, 1400, 1700, 2100, 2800, 3500, 4400, 5200, 6100, 7000, 7800, 8700, 9600, 10000, 11000, 12000, 13000, 14000, 15000, 16000, 17000, 18000],
  gdsv: [5, 6, 7, 9, 11, 14, 16, 18, 20, 23, 25, 27, 29, 32, 34, 36, 38, 41, 43, 45, 50, 54, 59, 63, 68, 72, 77, 81, 86, 90],
  gpoke: [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 32, 34, 36, 38],
  gso: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 25, 29, 33, 38, 42, 46, 50, 54, 58, 63],
}

export const CARD_THEME_ORDER = [
  'away',
  'home',
  'alternate',
  'carbon',
  'futureB',
  'frozen',
  'futureC',
  'inferno',
  'stormLive',
  'olympus',
] as const
export type CardThemeKey = (typeof CARD_THEME_ORDER)[number]

export const MYTHIC_THEMES = ['frozen', 'futureC', 'inferno', 'stormLive', 'olympus'] as const
export type MythicThemeKey = (typeof MYTHIC_THEMES)[number]

export const CARD_THEME_NAMES: Readonly<Record<CardThemeKey, string>> = {
  away: 'Away',
  home: 'Home',
  alternate: 'Alternate',
  carbon: 'Carbon-Fiber',
  futureB: 'Hardlight',
  frozen: 'Frozen',
  futureC: 'Cyber',
  inferno: 'Inferno',
  stormLive: 'Storm',
  olympus: 'Maximus',
}

export type StatsTier = 1 | 2 | 3 | 4 | 5
export type CardTier = StatsTier | 6

export const TIER_LABELS: Readonly<Record<CardTier, string>> = {
  1: 'Prospect',
  2: 'Rookie',
  3: 'Stud',
  4: 'Elite',
  5: 'Franchise',
  6: 'Legend',
}

export const TIER_THEME: Readonly<Record<StatsTier, CardThemeKey>> = {
  1: 'away',
  2: 'home',
  3: 'alternate',
  4: 'carbon',
  5: 'futureB',
}
