/**
 * Badge catalog for the player-card progression system.
 *
 * Families and groups from docs/superpowers/specs/2026-10-07-player-cards-badges-design.md
 * (Part 1); per-season ladders from docs/superpowers/specs/2026-10-08-season-cards-design.md.
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

/** Titles with this `game_titles.release_order` or later get a card per title (NHL 27 on). */
export const FIRST_CARD_RELEASE_ORDER = 27

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

/**
 * Thresholds for levels 1..30, sized for ONE title's season (spec
 * docs/superpowers/specs/2026-10-08-season-cards-design.md). Level = number of
 * thresholds the season total meets.
 */
// prettier-ignore
export const BADGE_LADDERS: Readonly<Record<BadgeFamilyId, readonly number[]>> = {
  p3v3: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 16, 19, 22, 25, 28, 32, 36, 40, 44, 49, 54, 59, 64, 69, 75, 81, 87, 93, 100],
  p6v6: [1, 2, 5, 9, 13, 19, 26, 34, 43, 53, 65, 77, 90, 105, 120, 135, 155, 175, 195, 215, 235, 260, 280, 305, 335, 360, 390, 420, 450, 480],
  p6g: [1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 13, 16, 19, 22, 25, 28, 32, 36, 40, 44, 49, 54, 59, 64, 69, 75, 81, 87, 93, 100],
  pwins: [1, 2, 3, 6, 9, 13, 17, 23, 29, 36, 43, 51, 60, 70, 80, 91, 105, 115, 130, 140, 155, 170, 190, 205, 220, 240, 260, 280, 300, 320],
  pgoals: [1, 2, 6, 10, 15, 22, 30, 39, 50, 61, 74, 88, 105, 120, 140, 155, 175, 200, 220, 245, 270, 295, 325, 350, 380, 415, 445, 480, 515, 550],
  pasts: [1, 3, 7, 12, 19, 27, 37, 48, 61, 76, 91, 110, 130, 150, 170, 195, 220, 245, 275, 300, 335, 365, 400, 435, 470, 510, 550, 590, 635, 680],
  pshots: [3, 12, 26, 46, 72, 105, 140, 185, 235, 290, 350, 415, 490, 565, 650, 740, 835, 935, 1040, 1160, 1270, 1400, 1530, 1660, 1810, 1950, 2110, 2260, 2430, 2600],
  pdekes: [1, 4, 8, 14, 22, 32, 44, 57, 72, 89, 110, 130, 150, 175, 200, 230, 255, 290, 320, 355, 390, 430, 470, 510, 555, 600, 650, 695, 750, 800],
  pht: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 21, 23, 26, 29, 32, 35, 38, 42, 45, 49, 53, 57, 61, 65],
  pbrk: [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 18, 21, 24, 28, 31, 35, 40, 44, 49, 54, 59, 65, 70, 76, 83, 89, 96, 105, 110],
  phits: [2, 9, 20, 36, 56, 80, 110, 140, 180, 220, 270, 320, 375, 435, 500, 570, 640, 720, 800, 890, 980, 1080, 1180, 1280, 1390, 1500, 1620, 1740, 1870, 2000],
  pfo: [4, 16, 35, 62, 97, 140, 190, 250, 315, 390, 470, 560, 655, 760, 875, 995, 1120, 1260, 1400, 1560, 1710, 1880, 2060, 2240, 2430, 2630, 2840, 3050, 3270, 3500],
  ptka: [2, 7, 17, 29, 46, 66, 90, 115, 150, 185, 220, 265, 310, 360, 415, 470, 530, 595, 660, 735, 810, 885, 970, 1060, 1150, 1240, 1340, 1440, 1540, 1650],
  pblk: [1, 2, 4, 7, 12, 17, 23, 30, 38, 47, 56, 67, 79, 91, 105, 120, 135, 150, 170, 185, 205, 225, 245, 270, 290, 315, 340, 365, 390, 420],
  pfight: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30, 32, 35, 37, 40],
  gg: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 19, 22, 24, 27, 29, 32, 35, 38, 42, 45, 49, 52, 56, 60],
  gw: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
  gsv: [1, 3, 7, 12, 18, 26, 35, 46, 59, 72, 87, 105, 120, 140, 165, 185, 210, 235, 260, 290, 320, 350, 380, 415, 450, 490, 525, 565, 605, 650],
  gdsv: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 26, 28, 30, 32, 35, 37, 40],
  gpoke: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
  gso: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30],
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
