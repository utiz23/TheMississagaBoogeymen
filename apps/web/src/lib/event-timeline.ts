// apps/web/src/lib/event-timeline.ts

/**
 * Pure data-shaping for the game-sheet event timeline.
 *
 * The render layer (`components/matches/event-timeline.tsx`) is a client
 * component for the condensed/full toggle, so every derivation that can be
 * reasoned about — chronological order, the running score, the game-winner,
 * period grouping — lives here instead, where it is testable without a DOM.
 *
 * Two facts drive most of the awkward bits:
 *
 *  1. `clock` is the in-game broadcast countdown (MM:SS **remaining**), so
 *     "earlier in the period" means a LARGER value. Every sort here is period
 *     ASC then remaining DESC.
 *  2. Events are OCR-only and gated on review, so a timeline can hold fewer
 *     goals than the match actually had. The real score is passed in and
 *     compared: an incomplete timeline never claims a game-winner and never
 *     presents its derived tally as the final.
 */

// Explicit extension so `node --test` can resolve this import when it strips
// types directly from source (tsconfig already sets allowImportingTsExtensions).
import { formatPeriodLabel } from './period-label.ts'

/** The minimal shape the timeline needs from a `MatchEventRow`. */
export interface TimelineEvent {
  id: number
  periodNumber: number
  clock: string | null
  eventType: string
  teamSide: string | null
}

export type TimelineSide = 'bgm' | 'opp'
export type TimelineLeader = TimelineSide | 'tied'

/** Periods 4+ are OT in EASHL — there is no shootout (period 6 is OT3). */
const FIRST_OT_PERIOD = 4

/** Periods are 20 minutes, regulation and OT alike. */
const PERIOD_LENGTH_SEC = 20 * 60

export function isStoryEvent(event: { eventType: string }): boolean {
  return event.eventType === 'goal' || event.eventType === 'penalty'
}

/** `team_side` is BGM-relative: 'for' is us, anything else is them. */
export function sideOf(teamSide: string | null): TimelineSide {
  return teamSide === 'for' ? 'bgm' : 'opp'
}

export interface GoalContext {
  goalId: number
  bgmBefore: number
  oppBefore: number
  bgmAfter: number
  oppAfter: number
  leader: TimelineLeader
  prevLeader: TimelineLeader
  scoredBy: TimelineSide
  tied: boolean
  isOt: boolean
  /** Nth goal for the scoring side — the "#2" in "GOAL · BGM #2". */
  goalNumberForSide: number
  isGameWinner: boolean
  /**
   * This goal put a side back in front that had already led earlier in the
   * game. A lead can only change hands through a tie (one goal at a time), so
   * this — not a leader-to-leader flip — is what "regains the lead" means.
   */
  reclaimsLead: boolean
}

export interface TimelinePeriod<T> {
  periodNumber: number
  /** Divider headline — "2ND PERIOD", "OT". */
  label: string
  /** Clock-pill tag — "2ND", "OT". */
  shortLabel: string
  goals: number
  penalties: number
  /** Chronological; empty for a period the timeline spans but never scored in. */
  rows: T[]
}

export interface TimelineFinal {
  /** The real match score (EA truth), never derived from events. */
  bgm: number
  opp: number
  winner: TimelineSide | null
  /** Goals the timeline actually holds, per side. */
  countedBgm: number
  countedOpp: number
  /** Both counted totals match the real score — the timeline tells the whole story. */
  complete: boolean
}

export interface TimelineModel<T> {
  periods: TimelinePeriod<T>[]
  goalContext: Map<number, GoalContext>
  goalCount: number
  penaltyCount: number
  final: TimelineFinal
  isEmpty: boolean
}

/** MM:SS remaining → seconds. Unparseable/absent reads as 0 (period end). */
export function clockToSeconds(clock: string | null): number {
  if (!clock) return 0
  const [m, s] = clock.split(':')
  const mins = Number(m)
  const secs = Number(s)
  if (!Number.isFinite(mins) || !Number.isFinite(secs)) return 0
  return mins * 60 + secs
}

/**
 * The DB clock counts down; the post-game Events screen — and the NHL
 * record-book "time of goal" convention — reports the elapsed mark. Convert
 * for display so cards match the screen the rest of the recap is read from.
 * Out-of-range input is passed through rather than turned into nonsense.
 */
export function toElapsedClock(clock: string | null): string | null {
  if (!clock) return null
  const remaining = clockToSeconds(clock)
  const elapsed = PERIOD_LENGTH_SEC - remaining
  if (elapsed < 0 || elapsed > PERIOD_LENGTH_SEC) return clock
  const mm = Math.floor(elapsed / 60)
  const ss = elapsed % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

/**
 * Divider headline for a period number. Derived from the number, not from the
 * DB's `period_label` — OCR writes region prefixes into that column ("RT 2ND
 * PERIOD"), and periods the timeline spans but never scored in have no row to
 * read a label from at all.
 */
export function periodHeadline(periodNumber: number): string {
  const short = formatPeriodLabel(periodNumber)
  return periodNumber <= 3 ? `${short} PERIOD` : short
}

/** "NO GOALS" · "2 GOALS" · "2 GOALS · 1 PEN" — the divider's count chip. */
export function periodCountLabel(goals: number, penalties: number): string {
  const goalPart = goals === 0 ? 'NO GOALS' : `${String(goals)} ${goals === 1 ? 'GOAL' : 'GOALS'}`
  if (penalties === 0) return goalPart
  return `${goalPart} · ${String(penalties)} PEN`
}

/** Period ASC, then remaining-clock DESC — true chronological order. */
export function sortChronologically<T extends TimelineEvent>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => {
    if (a.periodNumber !== b.periodNumber) return a.periodNumber - b.periodNumber
    return clockToSeconds(b.clock) - clockToSeconds(a.clock)
  })
}

/**
 * The game-winning goal: the winner's (loser's total + 1)th goal, walked in
 * chronological order. Returns null for a tie or an empty set — and callers
 * must not ask when the timeline is incomplete, because the index would be
 * counted against a tally that is missing goals.
 */
function findGameWinner(goalsInOrder: readonly TimelineEvent[]): number | null {
  let bgmTotal = 0
  let oppTotal = 0
  for (const g of goalsInOrder) {
    if (sideOf(g.teamSide) === 'bgm') bgmTotal += 1
    else oppTotal += 1
  }
  if (bgmTotal === oppTotal) return null
  const winningSide: TimelineSide = bgmTotal > oppTotal ? 'bgm' : 'opp'
  const target = Math.min(bgmTotal, oppTotal) + 1
  let seen = 0
  for (const g of goalsInOrder) {
    if (sideOf(g.teamSide) !== winningSide) continue
    seen += 1
    if (seen === target) return g.id
  }
  return null
}

/**
 * Build the whole timeline model in one pass.
 *
 * `score` is the match's real final (EA truth). It anchors the FINAL readout
 * and decides whether the derived story is complete enough to name a winner.
 */
export function buildTimeline<T extends TimelineEvent>(
  events: readonly T[],
  score: { for: number; against: number },
): TimelineModel<T> {
  const story = sortChronologically(events.filter(isStoryEvent))
  const goals = story.filter((e) => e.eventType === 'goal')
  const penaltyCount = story.length - goals.length

  let countedBgm = 0
  let countedOpp = 0
  for (const g of goals) {
    if (sideOf(g.teamSide) === 'bgm') countedBgm += 1
    else countedOpp += 1
  }
  const complete = countedBgm === score.for && countedOpp === score.against

  const final: TimelineFinal = {
    bgm: score.for,
    opp: score.against,
    winner: score.for === score.against ? null : score.for > score.against ? 'bgm' : 'opp',
    countedBgm,
    countedOpp,
    complete,
  }

  // Only a complete story can point at the game-winner; a partial one would
  // pick whichever goal happens to land on the index.
  const gwgId = complete ? findGameWinner(goals) : null

  const goalContext = new Map<number, GoalContext>()
  const hasLed: Record<TimelineSide, boolean> = { bgm: false, opp: false }
  let bgm = 0
  let opp = 0
  let prevLeader: TimelineLeader = 'tied'
  for (const g of goals) {
    const scoredBy = sideOf(g.teamSide)
    const bgmBefore = bgm
    const oppBefore = opp
    if (scoredBy === 'bgm') bgm += 1
    else opp += 1
    const leader: TimelineLeader = bgm === opp ? 'tied' : bgm > opp ? 'bgm' : 'opp'
    const reclaimsLead = leader !== 'tied' && hasLed[leader]
    if (leader !== 'tied') hasLed[leader] = true
    goalContext.set(g.id, {
      goalId: g.id,
      bgmBefore,
      oppBefore,
      bgmAfter: bgm,
      oppAfter: opp,
      leader,
      prevLeader,
      scoredBy,
      tied: bgm === opp,
      isOt: g.periodNumber >= FIRST_OT_PERIOD,
      goalNumberForSide: scoredBy === 'bgm' ? bgm : opp,
      isGameWinner: gwgId !== null && g.id === gwgId,
      reclaimsLead,
    })
    prevLeader = leader
  }

  return {
    periods: buildPeriods(story),
    goalContext,
    goalCount: goals.length,
    penaltyCount,
    final,
    isEmpty: story.length === 0,
  }
}

/**
 * Group into periods, filling any period the game demonstrably reached but
 * scored nothing in (a scoreless 1st still deserves its divider). The span
 * stops at the highest period seen — nothing here can prove a game reached
 * a period it recorded no events in, and inventing one would fabricate.
 */
function buildPeriods<T extends TimelineEvent>(storyInOrder: readonly T[]): TimelinePeriod<T>[] {
  if (storyInOrder.length === 0) return []
  const maxPeriod = storyInOrder.reduce((max, e) => Math.max(max, e.periodNumber), 1)
  const byPeriod = new Map<number, T[]>()
  for (const e of storyInOrder) {
    const bucket = byPeriod.get(e.periodNumber)
    if (bucket) bucket.push(e)
    else byPeriod.set(e.periodNumber, [e])
  }

  const out: TimelinePeriod<T>[] = []
  for (let n = 1; n <= maxPeriod; n += 1) {
    const rows = byPeriod.get(n) ?? []
    out.push({
      periodNumber: n,
      label: periodHeadline(n),
      shortLabel: formatPeriodLabel(n),
      goals: rows.filter((e) => e.eventType === 'goal').length,
      penalties: rows.filter((e) => e.eventType === 'penalty').length,
      rows,
    })
  }
  return out
}

/**
 * The swing caption under a goal's running score. OT goals are sudden death,
 * so the game-winner there ends it outright; every other case describes the
 * move in the lead.
 */
export function leadChangeLabel(ctx: GoalContext, oppAbbrev: string): string {
  const team = ctx.scoredBy === 'bgm' ? 'BGM' : oppAbbrev
  if (ctx.isOt && ctx.isGameWinner) return `↑ ${team} WINS`
  if (ctx.tied) return '— TIED'
  if (ctx.prevLeader === 'tied')
    return ctx.reclaimsLead ? `↑ ${team} REGAINS LEAD` : `↑ ${team} TAKES LEAD`
  const margin = Math.abs(ctx.bgmAfter - ctx.oppAfter)
  if (ctx.scoredBy === ctx.leader) return `↑ ${team} +${String(margin)} LEAD`
  return `${team} CLOSES`
}
