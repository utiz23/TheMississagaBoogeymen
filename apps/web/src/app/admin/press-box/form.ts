import {
  SLUMP_MIN,
  STREAK_MIN,
  nextMilestone,
  runMinimum,
  type MilestoneStat,
} from '@eanhl/db/news'
import {
  FORM_DOWN_RATIO,
  FORM_GAMES,
  FORM_MIN_DIFF,
  FORM_UP_RATIO,
  hasPoint,
  noGoal,
  rateOf,
  type PlayerGameInput,
} from '../../../lib/news/players.ts'

/**
 * Hot and cold players and milestones within reach, for the Press Box overview. Pure: the page
 * passes each member's games (oldest first, every title) from the stats the site already has
 * (`listNewsPlayerGames`); nothing new is stored. The rules reuse the news desk's own numbers
 * (streak floors, form ratios, milestone tiers), so the page and the writers agree.
 */
export interface FormPlayer {
  playerId: number
  name: string
  games: readonly PlayerGameInput[]
}

export interface FormNote {
  playerId: number
  name: string
  /** Plain words, no markup: "points in 5 straight". */
  text: string
  /** Sort key: bigger = stronger. */
  weight: number
}

export interface MilestoneNote {
  playerId: number
  name: string
  stat: MilestoneStat
  value: number
  remaining: number
}

/** How far away a milestone shows on the overview (the news desk's "approaching" is 3). */
export const REACH_MAX = 3

const counted = (g: PlayerGameInput) => g.result !== 'DNF'
const points = (g: PlayerGameInput) => g.goals + g.assists
const mean = (v: readonly number[]) =>
  v.length === 0 ? 0 : v.reduce((a, b) => a + b, 0) / v.length
const round1 = (n: number) => Math.round(n * 10) / 10

function runAtEnd(games: readonly PlayerGameInput[], hit: (g: PlayerGameInput) => boolean): number {
  let n = 0
  for (let i = games.length - 1; i >= 0 && hit(games[i]!); i--) n++
  return n
}

/** The title the club played last (the title of the newest game of anyone). */
export function currentTitle(players: readonly FormPlayer[]): number | null {
  let best: { at: string; title: number } | null = null
  for (const p of players) {
    const g = p.games.at(-1)
    if (g !== undefined && (best === null || g.playedAt > best.at)) {
      best = { at: g.playedAt, title: g.gameTitleId }
    }
  }
  return best?.title ?? null
}

/**
 * Hot and cold skaters in the current title: a points streak that is unlikely at the player's own
 * rate (hot), a goal drought of 8+ for a forward (cold), or the last 5 counted games' points per
 * game against his title average (hot 1.5x and +0.6, cold half and -0.6; the news desk's rule).
 * Only players who played in the last 14 days of the club's play are listed.
 */
export function hotAndCold(
  players: readonly FormPlayer[],
  title: number | null,
  now: Date,
): { hot: FormNote[]; cold: FormNote[] } {
  const hot: FormNote[] = []
  const cold: FormNote[] = []
  if (title === null) return { hot, cold }
  const recent = now.getTime() - 14 * 86_400_000
  for (const p of players) {
    const all = p.games.filter((g) => g.gameTitleId === title && counted(g))
    const last = all.at(-1)
    if (last === undefined || last.position === 'G') continue
    if (new Date(last.playedAt).getTime() < recent) continue
    const base = { playerId: p.playerId, name: p.name }

    const streak = runAtEnd(all, hasPoint)
    const earlier = all.slice(0, all.length - streak)
    const need = runMinimum(STREAK_MIN, rateOf(earlier, hasPoint))
    if (streak >= need) {
      hot.push({ ...base, text: `points in ${String(streak)} straight`, weight: 100 + streak })
      continue
    }
    if (last.position === 'F') {
      const drought = runAtEnd(all, noGoal)
      if (drought >= SLUMP_MIN) {
        cold.push({
          ...base,
          text: `${String(drought)} games without a goal`,
          weight: 100 + drought,
        })
        continue
      }
    }
    if (all.length < FORM_GAMES + 5) continue
    const recentGames = all.slice(-FORM_GAMES)
    const before = all.slice(0, -FORM_GAMES)
    const form = mean(recentGames.map(points))
    const season = mean(before.map(points))
    if (form >= season * FORM_UP_RATIO && form - season >= FORM_MIN_DIFF) {
      hot.push({
        ...base,
        text: `${String(round1(form))} points a game in the last ${String(FORM_GAMES)} (${String(round1(season))} before)`,
        weight: form - season,
      })
    } else if (form <= season * FORM_DOWN_RATIO && season - form >= FORM_MIN_DIFF) {
      cold.push({
        ...base,
        text: `${String(round1(form))} points a game in the last ${String(FORM_GAMES)} (${String(round1(season))} before)`,
        weight: season - form,
      })
    }
  }
  const byWeight = (a: FormNote, b: FormNote) => b.weight - a.weight || a.name.localeCompare(b.name)
  return { hot: hot.sort(byWeight), cold: cold.sort(byWeight) }
}

/**
 * Milestones within reach in the current title: goals and assists every 50, points every 100,
 * games at 100/250/500/750/1000 (the news desk's tiers), at most REACH_MAX away, nearest first.
 * Goalies only get games. Every row counts, DNF too (a game logged is a game played).
 */
export function milestonesInReach(
  players: readonly FormPlayer[],
  title: number | null,
): MilestoneNote[] {
  if (title === null) return []
  const out: MilestoneNote[] = []
  for (const p of players) {
    const rows = p.games.filter((g) => g.gameTitleId === title)
    if (rows.length === 0 || p.games.at(-1)?.gameTitleId !== title) continue
    const goalie = rows.at(-1)!.position === 'G'
    const goals = rows.reduce((n, g) => n + g.goals, 0)
    const assists = rows.reduce((n, g) => n + g.assists, 0)
    const totals: Record<MilestoneStat, number> = {
      goals,
      assists,
      points: goals + assists,
      games: rows.length,
    }
    for (const stat of ['goals', 'assists', 'points', 'games'] as const) {
      if (goalie && stat !== 'games') continue
      const next = nextMilestone(stat, totals[stat])
      if (next === null) continue
      const remaining = next - totals[stat]
      if (remaining >= 1 && remaining <= REACH_MAX) {
        out.push({ playerId: p.playerId, name: p.name, stat, value: next, remaining })
      }
    }
  }
  return out.sort(
    (a, b) => a.remaining - b.remaining || b.value - a.value || a.name.localeCompare(b.name),
  )
}

const STAT_WORD: Record<MilestoneStat, string> = {
  goals: 'goals',
  assists: 'assists',
  points: 'points',
  games: 'games',
}

/** "Silky: 2 goals from 50". */
export function milestoneText(m: MilestoneNote): string {
  return `${String(m.remaining)} ${m.remaining === 1 && m.stat === 'games' ? 'game' : STAT_WORD[m.stat]} from ${String(m.value)}`
}
