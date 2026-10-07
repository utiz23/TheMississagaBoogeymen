/**
 * Player-card view model and its pure builders (spec Part 2; PlayerCard.dc.html
 * renderVals). No React and no runtime import of the db client, so the card
 * stays client-safe and these run under `node --test`.
 */
import { BADGE_FAMILIES, topBadges } from '@eanhl/db/cards'
import type { BadgeLevelRef, CardThemeKey, CardTier } from '@eanhl/db/cards'

export type CardRole = 'skater' | 'goalie'

export interface CardStat {
  label: string
  value: string
}

export interface CardFront {
  playerId: number
  name: string
  jersey: string
  role: CardRole
  /** Short position tag (LW, D, G…), or null when unknown. */
  position: string | null
  record: string
  winPct: string
  /** Four stats; the fourth is the "lead" stat. */
  stats: CardStat[]
  platform: string | null
  nationality: string | null
  tier: CardTier
  level: number
  theme: CardThemeKey
  /** Featured badge (footer slot), or null when none is earned. */
  badge: BadgeLevelRef | null
}

export interface CardLedger {
  head: string[]
  /** Column index (into head) of the accent column. */
  leadCol: number
  rows: { label: string; cells: string[] }[]
}

export interface CardBack {
  ledger: CardLedger
  badges: { earned: number; pool: number; top: BadgeLevelRef[] }
  source: string
}

export interface CardViewModel {
  front: CardFront
  /** Only the player page (hero) flips, so list cards carry no back. */
  back: CardBack | null
}

const DASH = '—'

export function formatRecord(w: number | null, l: number | null, otl: number | null): string {
  if (w === null || l === null) return DASH
  return `${String(w)}–${String(l)}–${String(otl ?? 0)}`
}

export function formatWinPct(w: number | null, l: number | null, otl: number | null): string {
  if (w === null || l === null) return DASH
  const games = w + l + (otl ?? 0)
  return games > 0 ? `${String(Math.round((w / games) * 100))}% Win` : DASH
}

/** Stored save % is a percentage (66.00); cards show it hockey style (.660). */
export function formatSavePct(value: string | number | null): string {
  if (value === null) return DASH
  const n = Number(value)
  if (!Number.isFinite(n)) return DASH
  const fraction = n > 1 ? n / 100 : n
  return fraction.toFixed(3).replace(/^0(?=\.)/, '')
}

export function formatGaa(value: string | number | null): string {
  if (value === null) return DASH
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(2) : DASH
}

const POSITION_TAGS: Readonly<Record<string, string>> = {
  goalie: 'G',
  center: 'C',
  defenseMen: 'D',
  leftDefenseMen: 'LD',
  rightDefenseMen: 'RD',
  leftWing: 'LW',
  rightWing: 'RW',
}

/** Same labels as lib/format `formatPosition`. */
export function positionTag(position: string | null): string | null {
  if (position === null) return null
  return POSITION_TAGS[position] ?? position
}

export interface CardSeasonTotals {
  skaterGp: number
  goalieGp: number
  goals: number
  assists: number
  points: number
  goalieWins: number | null
  savePct: string | null
  gaa: string | null
}

export function cardStats(role: CardRole, t: CardSeasonTotals): CardStat[] {
  return role === 'goalie'
    ? [
        { label: 'GP', value: String(t.goalieGp) },
        { label: 'SV%', value: formatSavePct(t.savePct) },
        { label: 'GAA', value: formatGaa(t.gaa) },
        { label: 'W', value: t.goalieWins === null ? DASH : String(t.goalieWins) },
      ]
    : [
        { label: 'GP', value: String(t.skaterGp) },
        { label: 'G', value: String(t.goals) },
        { label: 'A', value: String(t.assists) },
        { label: 'PTS', value: String(t.points) },
      ]
}

export interface CardGame {
  result: string
  isGoalie: boolean
  goals: number | null
  assists: number | null
  saves: number | null
  goalsAgainst: number | null
}

export interface CardLast10 {
  gp: number
  /** Ledger cells: skater GP G A PTS, goalie GP REC SV% GAA SO. */
  cells: string[]
}

/** Last 10 games in the role, newest first. DNF counts as a loss (site rule). */
export function buildLast10(games: readonly CardGame[], role: CardRole): CardLast10 {
  const recent = games.filter((g) => g.isGoalie === (role === 'goalie')).slice(0, 10)
  const gp = recent.length
  if (gp === 0) {
    return {
      gp: 0,
      cells: role === 'goalie' ? ['0', DASH, DASH, DASH, DASH] : ['0', DASH, DASH, DASH],
    }
  }
  if (role === 'skater') {
    const g = recent.reduce((s, x) => s + (x.goals ?? 0), 0)
    const a = recent.reduce((s, x) => s + (x.assists ?? 0), 0)
    return { gp, cells: [String(gp), String(g), String(a), String(g + a)] }
  }
  const w = recent.filter((x) => x.result === 'WIN').length
  const otl = recent.filter((x) => x.result === 'OTL').length
  const l = gp - w - otl
  const saves = recent.reduce((s, x) => s + (x.saves ?? 0), 0)
  const ga = recent.reduce((s, x) => s + (x.goalsAgainst ?? 0), 0)
  const so = recent.filter((x) => x.result === 'WIN' && x.goalsAgainst === 0).length
  const shots = saves + ga
  return {
    gp,
    cells: [
      String(gp),
      formatRecord(w, l, otl),
      shots > 0 ? formatSavePct(saves / shots) : DASH,
      formatGaa(ga / gp),
      String(so),
    ],
  }
}

export interface CardCareerRow {
  gameTitleId: number
  gameTitleName: string
  skaterGp: number
  goals: number
  assists: number
  points: number
  goalieGp: number
  wins: number | null
  losses: number | null
  otl: number | null
  savePct: string | null
  gaa: string | null
  shutouts: number | null
}

/**
 * Back-of-card ledger (prototype rows): LAST 10, the current title, and — for
 * skaters with 2+ titles — a CAREER total. Career rows arrive newest first.
 */
export function buildLedger(
  role: CardRole,
  last10: CardLast10,
  career: readonly CardCareerRow[],
  currentTitleId: number | null,
): CardLedger {
  const inRole = career.filter((r) => (role === 'goalie' ? r.goalieGp > 0 : r.skaterGp > 0))
  const current = inRole.find((r) => r.gameTitleId === currentTitleId) ?? inRole[0]
  if (role === 'goalie') {
    const rows = [{ label: 'LAST 10', cells: last10.cells }]
    if (current !== undefined) {
      rows.push({
        label: current.gameTitleName.toUpperCase(),
        cells: [
          String(current.goalieGp),
          formatRecord(current.wins, current.losses, current.otl),
          formatSavePct(current.savePct),
          formatGaa(current.gaa),
          current.shutouts === null ? DASH : String(current.shutouts),
        ],
      })
    }
    return { head: ['', 'GP', 'REC', 'SV%', 'GAA', 'SO'], leadCol: 3, rows }
  }
  const rows = [{ label: 'LAST 10', cells: last10.cells }]
  if (current !== undefined) {
    rows.push({
      label: current.gameTitleName.toUpperCase(),
      cells: [current.skaterGp, current.goals, current.assists, current.points].map(String),
    })
  }
  if (inRole.length > 1) {
    const sum = (pick: (r: CardCareerRow) => number) =>
      String(inRole.reduce((s, r) => s + pick(r), 0))
    rows.push({
      label: 'CAREER',
      cells: [
        sum((r) => r.skaterGp),
        sum((r) => r.goals),
        sum((r) => r.assists),
        sum((r) => r.points),
      ],
    })
  }
  return { head: ['', 'GP', 'G', 'A', 'PTS'], leadCol: 4, rows }
}

/** Back-of-card badges: earned count and the top 4, within the role's pool. */
export function buildBadgeShowcase(
  badges: readonly BadgeLevelRef[],
  role: CardRole,
): CardBack['badges'] {
  const inPool = (id: BadgeLevelRef['familyId']) =>
    BADGE_FAMILIES.some((f) => f.id === id && (f.group === 'goalie') === (role === 'goalie'))
  const pool = BADGE_FAMILIES.filter((f) => (f.group === 'goalie') === (role === 'goalie')).length
  const own = badges.filter((b) => inPool(b.familyId))
  return { earned: own.filter((b) => b.level > 0).length, pool, top: topBadges(own) }
}
