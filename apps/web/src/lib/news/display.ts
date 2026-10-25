import type { FeatureKind } from '@eanhl/db/news'
import { formatMatchDate, formatMatchTime } from '../format.ts'

/** The small label above a weekly feature's headline, by feature kind (revision 2). */
export const FEATURE_KICKERS: Readonly<Record<FeatureKind, string>> = {
  trend: 'Numbers Desk',
  spotlight: 'Spotlight',
  notes: 'Notes',
  bigpicture: 'Big Country',
  rink: 'Midnight Column',
}

/**
 * The small label above an article's headline: it names the kind of piece,
 * not the reporter. Posts (game recaps and reactions) have none. A weekly
 * piece from before revision 2 has no feature kind and reads "Week in review".
 */
export function articleKicker(item: {
  kind: 'post' | 'article'
  night: string | null
  weekStart: string | null
  featureKind: FeatureKind | null
}): string | null {
  if (item.kind !== 'article') return null
  if (item.featureKind !== null) return FEATURE_KICKERS[item.featureKind]
  if (item.night !== null) return 'Night recap'
  if (item.weekStart !== null) return 'Week in review'
  return null
}

/** Article body paragraphs: the service stores them joined by blank lines. */
export function splitParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== '')
}

/** Whole minutes to read `body` at 200 words a minute; at least 1. */
export function readMinutes(body: string): number {
  const words = body.split(/\s+/).filter((w) => w !== '').length
  return Math.max(1, Math.round(words / 200))
}

function dayKeyToDate(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null
  // Noon UTC is the same calendar day in the club zone (America/Edmonton).
  return new Date(`${key}T12:00:00Z`)
}

/** 'YYYY-MM-DD' → "Oct 12" (the year is added when it is not this year). */
export function dayKeyLabel(key: string): string {
  const d = dayKeyToDate(key)
  return d === null ? key : formatMatchDate(d)
}

/** 'YYYY-MM-DD' → "Sun Oct 12". */
export function dayKeyLabelWithWeekday(key: string): string {
  const d = dayKeyToDate(key)
  if (d === null) return key
  const weekday = d.toLocaleDateString('en-US', { timeZone: 'America/Edmonton', weekday: 'short' })
  return `${weekday} ${formatMatchDate(d)}`
}

/** One score chip on an article: result, score, opponent and the game link. */
export interface ScoreChip {
  matchId: number
  result: 'WIN' | 'LOSS' | 'OTL'
  scoreFor: number
  scoreAgainst: number
  opponentName: string
  /** Shots for and against, when the sheet has them. */
  shots: { for: number; against: number } | null
}

/**
 * The games listed in an article's fact sheet, for the score chips. `facts` is
 * stored JSON and may be null or odd: anything that is not a well-formed game
 * is skipped, so a bad row shows fewer chips, never an error.
 */
export function scoreChips(facts: unknown): ScoreChip[] {
  if (typeof facts !== 'object' || facts === null) return []
  const games = (facts as { games?: unknown }).games
  if (!Array.isArray(games)) return []
  const chips: ScoreChip[] = []
  for (const g of games as unknown[]) {
    if (typeof g !== 'object' || g === null) continue
    const o = g as Record<string, unknown>
    const { matchId, result, scoreFor, scoreAgainst, opponentName } = o
    if (
      typeof matchId !== 'number' ||
      (result !== 'WIN' && result !== 'LOSS' && result !== 'OTL') ||
      typeof scoreFor !== 'number' ||
      typeof scoreAgainst !== 'number' ||
      typeof opponentName !== 'string'
    ) {
      continue
    }
    const team = (o as { team?: { shotsFor?: unknown; shotsAgainst?: unknown } | null }).team
    const shotsFor = team?.shotsFor
    const shotsAgainst = team?.shotsAgainst
    const shots =
      typeof shotsFor === 'number' && typeof shotsAgainst === 'number'
        ? { for: shotsFor, against: shotsAgainst }
        : null
    chips.push({ matchId, result, scoreFor, scoreAgainst, opponentName, shots })
  }
  return chips
}

/** "Oct 12, 9:40 PM" in the club zone, for a post's time stamp. */
export function postTimeLabel(createdAt: Date): string {
  return `${formatMatchDate(createdAt)}, ${formatMatchTime(createdAt)}`
}
