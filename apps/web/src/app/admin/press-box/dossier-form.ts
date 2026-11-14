import { nextMilestone, type MilestoneStat } from '@eanhl/db/news'
import type { PlayerGameInput } from '../../../lib/news/players.ts'
import { hotAndCold, milestoneText, milestonesInReach } from './form.ts'

/**
 * The "Form" block of one dossier: season totals, recent games, streak or slump, and the next
 * milestones, from the stats the site already has (`listNewsPlayerGames`; no new data). Pure: the
 * page passes the person's games (oldest first, every title). Reuses the overview's rules
 * (`form.ts`), so the dossier and the overview always agree.
 */
export interface DossierFormView {
  titleId: number
  games: number
  goals: number
  assists: number
  points: number
  /** The five newest games, newest first. */
  recent: { night: string; result: PlayerGameInput['result']; goals: number; assists: number }[]
  /** "points in 5 straight", "8 games without a goal", or null when nothing stands out. */
  trend: { direction: 'hot' | 'cold'; text: string } | null
  /** The next round number for each stat (a goalie: games only), nearest first. */
  next: { stat: MilestoneStat; value: number; remaining: number; inReach: boolean; text: string }[]
}

export function buildDossierForm(
  playerId: number,
  name: string,
  games: readonly PlayerGameInput[],
  now: Date,
): DossierFormView | null {
  const last = games.at(-1)
  if (last === undefined) return null
  const titleId = last.gameTitleId
  const rows = games.filter((g) => g.gameTitleId === titleId)
  const goalie = last.position === 'G'
  const goals = rows.reduce((n, g) => n + g.goals, 0)
  const assists = rows.reduce((n, g) => n + g.assists, 0)
  const totals: Record<MilestoneStat, number> = {
    goals,
    assists,
    points: goals + assists,
    games: rows.length,
  }

  const player = { playerId, name, games }
  const form = hotAndCold([player], titleId, now)
  const note = form.hot[0] ?? form.cold[0] ?? null
  const trend =
    note === null
      ? null
      : {
          direction: (form.hot[0] === undefined ? 'cold' : 'hot') as 'hot' | 'cold',
          text: note.text,
        }

  const inReach = new Set(milestonesInReach([player], titleId).map((m) => m.stat))
  const next = (['goals', 'assists', 'points', 'games'] as const)
    .filter((stat) => !goalie || stat === 'games')
    .flatMap((stat) => {
      const value = nextMilestone(stat, totals[stat])
      if (value === null) return []
      const remaining = value - totals[stat]
      return [
        {
          stat,
          value,
          remaining,
          inReach: inReach.has(stat),
          text: milestoneText({ playerId, name, stat, value, remaining }),
        },
      ]
    })
    .sort((a, b) => a.remaining - b.remaining || b.value - a.value)

  return {
    titleId,
    games: rows.length,
    goals,
    assists,
    points: goals + assists,
    recent: rows
      .slice(-5)
      .reverse()
      .map((g) => ({ night: g.night, result: g.result, goals: g.goals, assists: g.assists })),
    trend,
    next,
  }
}
