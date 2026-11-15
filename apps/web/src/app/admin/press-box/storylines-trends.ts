import { REPORTERS, isNegative, type ReporterId } from '@eanhl/db/news'
import type { PressRosterEntry, RelationshipRow, TalkCount } from '@eanhl/db/queries'
import type { FormNote, MilestoneNote } from './form.ts'

/**
 * The "Trends" panel of the storylines page (design section 3.4). Pure: the page passes what the
 * queries return. Streaks, slumps and milestones come from `form.ts` (the news desk's own rules);
 * the rest is counted here from the press tables. Nothing is stored.
 */

export interface Trends {
  /** Hot players (a points streak first), strongest first. */
  streaks: FormNote[]
  /** Cold players (a goal drought first), strongest first. */
  slumps: FormNote[]
  milestones: MilestoneNote[]
  /** The player quoted most in the last 30 days (usable and joke answers), or null. */
  mostQuoted: { name: string; quotes: number } | null
  /** The reporter with the most feud-side pairs against him, or null. */
  mostInsulted: { reporter: ReporterId; name: string; pairs: number; points: number } | null
  /** Members (not "Leave me out") with no answer in the last 30 days. */
  quiet: string[]
}

/** The reporter the players are at feud with the most: most pairs on the feud side, then most points. */
export function mostInsulted(
  rels: readonly Pick<RelationshipRow, 'reporter' | 'level' | 'points'>[],
): Trends['mostInsulted'] {
  const by = new Map<ReporterId, { pairs: number; points: number }>()
  for (const r of rels) {
    if (!isNegative(r.level)) continue
    const cur = by.get(r.reporter) ?? { pairs: 0, points: 0 }
    cur.pairs += 1
    cur.points += Math.abs(r.points)
    by.set(r.reporter, cur)
  }
  let best: Trends['mostInsulted'] = null
  for (const [reporter, v] of by) {
    if (
      best === null ||
      v.pairs > best.pairs ||
      (v.pairs === best.pairs && v.points > best.points)
    ) {
      best = { reporter, name: REPORTERS[reporter].name, pairs: v.pairs, points: v.points }
    }
  }
  return best
}

/** Members who gave no answer in the window: everyone on the roster except "Leave me out" and anyone who answered. */
export function quietPlayers(
  roster: readonly Pick<PressRosterEntry, 'playerId' | 'name' | 'pressLevel'>[],
  talk: readonly Pick<TalkCount, 'playerId' | 'answers'>[],
): string[] {
  const talked = new Set(talk.filter((t) => t.answers > 0).map((t) => t.playerId))
  return roster
    .filter((r) => r.pressLevel !== 'out' && !talked.has(r.playerId))
    .map((r) => r.name)
    .sort((a, b) => a.localeCompare(b))
}

export function buildTrends(args: {
  hot: readonly FormNote[]
  cold: readonly FormNote[]
  milestones: readonly MilestoneNote[]
  talk: readonly TalkCount[]
  relationships: readonly Pick<RelationshipRow, 'reporter' | 'level' | 'points'>[]
  roster: readonly Pick<PressRosterEntry, 'playerId' | 'name' | 'pressLevel'>[]
  limit?: number
}): Trends {
  const limit = args.limit ?? 3
  // A "Leave me out" player is never named in a trend.
  const out = new Set(args.roster.filter((r) => r.pressLevel === 'out').map((r) => r.playerId))
  const quoted = args.talk.find((t) => t.quotes > 0 && !out.has(t.playerId)) ?? null
  return {
    streaks: args.hot.slice(0, limit),
    slumps: args.cold.slice(0, limit),
    milestones: args.milestones.slice(0, limit),
    mostQuoted: quoted === null ? null : { name: quoted.name, quotes: quoted.quotes },
    mostInsulted: mostInsulted(args.relationships),
    quiet: quietPlayers(args.roster, args.talk),
  }
}
