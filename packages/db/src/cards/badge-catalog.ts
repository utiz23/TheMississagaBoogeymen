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

/**
 * Prestige of a badge when picking a card's featured badge (1 = marquee).
 * Families left out are participation badges (games played, wins): featured
 * only when a player has nothing else unlocked. Insertion order breaks ties,
 * so the most prestigious come first.
 */
export const BADGE_PRESTIGE: Readonly<Partial<Record<BadgeFamilyId, number>>> = {
  pgoals: 1,
  pasts: 1,
  pht: 1,
  gso: 1,
  gsv: 1,
  gw: 1,
  pbrk: 0.8,
  pdekes: 0.8,
  pshots: 0.8,
  pfo: 0.8,
  ptka: 0.8,
  pblk: 0.8,
  gdsv: 0.8,
  gpoke: 0.8,
  phits: 0.6,
  pfight: 0.6,
}

/** Goalie-group families form the goalie tier pool; every other family is skater. */
export function poolOf(family: BadgeFamily): TierPool {
  return family.group === 'goalie' ? 'goalie' : 'skater'
}

/**
 * Thresholds for levels 1..30, sized for ONE title's season (spec
 * docs/superpowers/specs/2026-10-08-season-cards-design.md). Level = number of
 * thresholds the season total meets. Level 30 = the operator's ceiling; levels
 * are multiples of 5/10/50, except plain counts for rare stats' first levels.
 */
// prettier-ignore
export const BADGE_LADDERS: Readonly<Record<BadgeFamilyId, readonly number[]>> = {
  p3v3: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
  p6v6: [5, 10, 15, 20, 25, 30, 35, 40, 45, 55, 65, 80, 95, 110, 130, 140, 160, 180, 200, 220, 250, 270, 290, 320, 350, 380, 410, 440, 470, 500],
  p6g: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
  pwins: [1, 2, 3, 6, 9, 12, 20, 25, 30, 35, 45, 50, 60, 70, 80, 90, 100, 120, 130, 140, 160, 170, 190, 200, 220, 240, 260, 280, 300, 320],
  pgoals: [5, 10, 15, 20, 25, 30, 45, 55, 70, 90, 110, 130, 150, 170, 200, 230, 260, 290, 320, 360, 390, 430, 470, 510, 560, 600, 650, 700, 750, 800],
  pasts: [5, 10, 15, 20, 25, 30, 45, 55, 70, 90, 110, 130, 150, 170, 200, 230, 260, 290, 320, 360, 390, 430, 470, 510, 560, 600, 650, 700, 750, 800],
  pshots: [5, 10, 25, 45, 70, 100, 140, 180, 230, 280, 340, 400, 470, 540, 630, 710, 800, 900, 1000, 1100, 1250, 1350, 1450, 1600, 1750, 1900, 2050, 2200, 2350, 2500],
  pdekes: [5, 10, 15, 20, 25, 30, 45, 55, 70, 90, 110, 130, 150, 170, 200, 230, 260, 290, 320, 360, 390, 430, 470, 510, 560, 600, 650, 700, 750, 800],
  pht: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
  pbrk: [1, 2, 3, 4, 6, 8, 11, 15, 20, 25, 30, 35, 40, 45, 50, 55, 65, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 190, 200],
  phits: [5, 10, 20, 35, 55, 80, 110, 140, 180, 220, 270, 320, 380, 440, 500, 570, 640, 720, 800, 890, 980, 1100, 1200, 1300, 1400, 1500, 1600, 1750, 1850, 2000],
  pfo: [5, 20, 40, 70, 110, 160, 220, 280, 360, 440, 540, 640, 750, 870, 1000, 1150, 1300, 1450, 1600, 1800, 1950, 2150, 2350, 2550, 2800, 3000, 3250, 3500, 3750, 4000],
  ptka: [5, 10, 15, 25, 40, 60, 80, 110, 140, 170, 200, 240, 280, 330, 380, 430, 480, 540, 600, 670, 740, 810, 880, 960, 1050, 1150, 1200, 1300, 1400, 1500],
  pblk: [1, 2, 4, 7, 11, 15, 20, 30, 35, 45, 55, 65, 75, 85, 100, 110, 130, 140, 160, 180, 200, 220, 240, 260, 280, 300, 320, 350, 370, 400],
  pfight: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
  gg: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
  gw: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 30, 35, 40, 45, 50],
  gsv: [5, 10, 15, 20, 25, 30, 35, 45, 60, 70, 85, 100, 120, 140, 160, 180, 210, 230, 260, 290, 320, 350, 380, 420, 450, 490, 530, 570, 610, 650],
  gdsv: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100],
  gpoke: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 30, 35, 40, 45, 50],
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
