/**
 * What one card-progression recompute should write, per player. Pure: the
 * worker loads totals and stored state, calls this, and turns the plan into
 * upserts. Spec: docs/superpowers/specs/2026-10-07-player-cards-badges-design.md.
 */
import { BADGE_LADDERS, type BadgeFamilyId, type LadderSet } from './badge-catalog.js'
import {
  applyStanding,
  badgeLevels,
  computeStanding,
  diffCardEvents,
  type BadgeValues,
  type CardEvent,
  type CardStanding,
} from './progression.js'

export interface PlannedPlayer {
  playerId: number
  standing: CardStanding
  levels: Record<BadgeFamilyId, number>
  values: BadgeValues
  events: CardEvent[]
  firstRun: boolean
  /**
   * False for a hand-awarded (manual) standing: only `card-mythic` changes that
   * row. Re-writing the copy this run read could undo a `--clear` that committed
   * after the read.
   */
  writeStanding: boolean
}

/**
 * `laddersOf`: the ladder set per player (the AI goalies have their own).
 * `rebase`: the one-time switch to new badge sources or ladders
 * (docs/superpowers/specs/2026-10-26-club-only-badges-design.md): the computed
 * standing replaces the stored one even when lower, and no events are emitted.
 * A manual standing still stays as it is.
 */
export function planCardRecompute(
  totals: ReadonlyMap<number, BadgeValues>,
  storedStanding: ReadonlyMap<number, CardStanding>,
  storedLevels: ReadonlyMap<number, Partial<Record<BadgeFamilyId, number>>>,
  laddersOf: (playerId: number) => LadderSet = () => BADGE_LADDERS,
  opts: { rebase?: boolean } = {},
): PlannedPlayer[] {
  const rebase = opts.rebase === true
  const plan: PlannedPlayer[] = []
  for (const [playerId, values] of totals) {
    const ladders = laddersOf(playerId)
    const levels = badgeLevels(values, ladders)
    const prev = storedStanding.get(playerId) ?? null
    const computed = computeStanding(values, ladders)
    const standing = rebase
      ? prev?.pool === 'manual'
        ? prev
        : computed
      : applyStanding(prev, computed)
    const events = rebase
      ? []
      : diffCardEvents(
          prev === null ? null : { standing: prev, levels: storedLevels.get(playerId) ?? {} },
          { standing, levels },
        )
    plan.push({
      playerId,
      standing,
      levels,
      values,
      events,
      firstRun: prev === null,
      writeStanding: standing.pool !== 'manual',
    })
  }
  return plan
}
