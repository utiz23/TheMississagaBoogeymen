import {
  mulberry32,
  weightedPick,
  REPORTER_IDS,
  type BuzzLevel,
  type NewsFacts,
  type NewsGameFacts,
  type NewsTopFact,
  type ReporterId,
} from '@eanhl/db/news'

/**
 * Scrum rules (pure, no I/O): which player a scrum picks, whether it pings,
 * how hot it runs, which reporters ask (the panel), how many questions and
 * follow-ups, and when the extras budget is spent. The press timer pass and the button handlers call
 * these.
 */

/** A volunteer or picked player has this long to accept the scrum. */
export const PRESS_ACCEPT_MS = 900_000
/** After a question, the player has this long to answer. */
export const PRESS_ANSWER_MS = 900_000
/** A scrum stays open for this long in all. */
export const PRESS_OPEN_MS = 3_600_000
/** The night recap waits at most this long for the night's open scrums. */
export const PRESS_NIGHT_WAIT_MS = 1_800_000
/** A GM-requested person waits this long before the ping: the GM may still correct or cancel the note. */
export const PRESS_GM_PING_DELAY_MS = 60_000
/** Automatic and command pings one player may get per night (GM pings are not limited). */
export const PRESS_PING_LIMIT = 2
/** `/scrum random` and `/scrum @player` uses per member per night. */
export const PRESS_COMMAND_LIMIT = 2
/** Extras (scrums, reactions) stop at this share of the monthly limit. */
export const EXTRAS_BUDGET_SHARE = 0.8

export type Heat = 'cool' | 'normal' | 'hot'

export interface Candidate {
  playerId: number
  name: string
  pressLevel: 'full' | 'easy'
  discordUserId: string | null
  star: 1 | 2 | 3 | null
  /** Goals plus assists in this game. */
  points: number
}

/**
 * Players of the game who may be asked: in `facts.people` (so never `out`,
 * never a guest), linked to a Discord ID, never an AI goalie.
 */
export function scrumCandidates(
  game: NewsGameFacts,
  facts: NewsFacts,
  discordIds: ReadonlyMap<number, string>,
): Candidate[] {
  const people = new Map(facts.people.map((p) => [p.playerId, p]))
  const out: Candidate[] = []
  for (const line of game.players) {
    const person = people.get(line.playerId)
    const discordUserId = discordIds.get(line.playerId)
    if (person === undefined || discordUserId === undefined) continue
    out.push({
      playerId: line.playerId,
      name: line.name,
      pressLevel: person.pressLevel,
      discordUserId,
      star: line.star,
      points: line.goals + line.assists,
    })
  }
  return out
}

/**
 * The player a scrum asks: the one the GM asked for (if a candidate); else
 * the subject of the heaviest top fact; else the lowest star; else the most
 * points; ties go to the lower player id.
 */
export function pickScrumPlayer(
  candidates: Candidate[],
  topFacts: NewsTopFact[],
  gmAsked: number | null,
): Candidate | null {
  if (candidates.length === 0) return null
  if (gmAsked !== null) {
    const asked = candidates.find((c) => c.playerId === gmAsked)
    if (asked !== undefined) return asked
  }
  for (const fact of topFacts) {
    if (fact.subject === null) continue
    const hit = candidates.find((c) => c.name === fact.subject)
    if (hit !== undefined) return hit
  }
  return [...candidates].sort(
    (a, b) => (a.star ?? 4) - (b.star ?? 4) || b.points - a.points || a.playerId - b.playerId,
  )[0]!
}

/** Ping the player when the GM asked, or the game is big, huge or historic. */
export function shouldPing(level: BuzzLevel, gmAsked: boolean): boolean {
  return gmAsked || level === 'big' || level === 'huge' || level === 'historic'
}

/** An `easy` player never gets a hot scrum: it drops to normal. */
export function effectiveHeat(
  heat: Heat,
  pressLevel: 'full' | 'easy',
): { heat: Heat; lowered: boolean } {
  if (pressLevel === 'easy' && heat === 'hot') return { heat: 'normal', lowered: true }
  return { heat, lowered: false }
}

const COOL_REPORTERS: readonly ReporterId[] = ['voss', 'barlow', 'bergstrom']
const HOT_REPORTERS: readonly ReporterId[] = ['mercer', 'pettibone', 'vale']

/**
 * The reporter who asks. Never `rink`, never a disabled reporter, never the
 * last scrum's reporter unless that is the only one left. Weights: 1 each;
 * x3 for the heat's reporters; x2 for a reporter with a take on the player.
 * Seeded: the same seed gives the same reporter.
 */
export function chooseScrumReporter(args: {
  heat: Heat
  seed: number
  disabled: readonly ReporterId[]
  lastScrumReporter: ReporterId | null
  takeReporters: readonly ReporterId[]
}): ReporterId {
  const allowed = REPORTER_IDS.filter((id) => id !== 'rink' && !args.disabled.includes(id))
  const fresh = allowed.filter((id) => id !== args.lastScrumReporter)
  const pool = fresh.length > 0 ? fresh : allowed
  if (pool.length === 0) return 'barlow'
  const heatSet = args.heat === 'cool' ? COOL_REPORTERS : args.heat === 'hot' ? HOT_REPORTERS : []
  const choices = pool.map((id): [ReporterId, number] => {
    let weight = 1
    if (heatSet.includes(id)) weight *= 3
    if (args.takeReporters.includes(id)) weight *= 2
    return [id, weight]
  })
  return weightedPick(choices, mulberry32(args.seed >>> 0))
}

/** T5: a reporter in a feud with the player is this many times likelier on the panel (like a take). */
export const FEUD_PANEL_WEIGHT = 3
/** T9: a reporter who is a fan of the player ("fan" or "glazing") is this many times likelier (like a take). */
export const FAVOUR_PANEL_WEIGHT = 2

/** Reporters who ask one person: 3 for a picked player (or a GM request), 2 for a volunteer. */
export const PANEL_SIZE = { picked: 3, volunteer: 2 } as const

export function panelSize(role: 'picked' | 'volunteer'): number {
  return PANEL_SIZE[role]
}

/**
 * The target total of questions plus follow-ups for one picked player, with
 * its share in percent: a low chance of both extremes, the middle value 5.
 */
export const TARGET_TOTALS: readonly (readonly [number, number])[] = [
  [3, 10],
  [4, 25],
  [5, 50],
  [6, 15],
]

/** The total drawn for one picked player (seeded: the same seed gives the same total). */
export function drawTargetTotal(seed: number): number {
  return weightedPick(TARGET_TOTALS, mulberry32(seed >>> 0))
}

/**
 * The target total for a role: a volunteer asks 2 reporters and gets no
 * follow-up (total 2); a picked player gets the drawn total (3-6).
 */
export function targetTotalFor(role: 'picked' | 'volunteer', seed: number): number {
  return role === 'volunteer' ? PANEL_SIZE.volunteer : drawTargetTotal(seed)
}

/**
 * The reporters who ask one person, in order. `first` asks first when it can
 * (the GM's chosen reporter, or the scrum's own reporter chosen by rotation,
 * heat and takes); the others are drawn without replacement with the heat and
 * take weights of `chooseScrumReporter`. Never `rink`, never a disabled
 * reporter, no reporter twice. Shorter than `size` only when too few reporters
 * are left. Seeded.
 */
export function choosePanel(args: {
  size: number
  heat: Heat
  seed: number
  disabled: readonly ReporterId[]
  first: ReporterId | null
  takeReporters: readonly ReporterId[]
  /** T5: reporters in a feud (level "feud" or above) with the player: likelier on the panel. */
  feudReporters?: readonly ReporterId[]
  /** T9: reporters who are a fan of the player ("fan" or above): likelier on the panel. */
  favourReporters?: readonly ReporterId[]
}): ReporterId[] {
  const allowed = REPORTER_IDS.filter((id) => id !== 'rink' && !args.disabled.includes(id))
  const panel: ReporterId[] = []
  if (args.first !== null && allowed.includes(args.first)) panel.push(args.first)
  const heatSet = args.heat === 'cool' ? COOL_REPORTERS : args.heat === 'hot' ? HOT_REPORTERS : []
  const rand = mulberry32(args.seed >>> 0)
  while (panel.length < args.size) {
    const pool = allowed.filter((id) => !panel.includes(id))
    if (pool.length === 0) break
    const choices = pool.map((id): [ReporterId, number] => {
      let weight = 1
      if (heatSet.includes(id)) weight *= 3
      if (args.takeReporters.includes(id)) weight *= 2
      if (args.feudReporters?.includes(id) === true) weight *= FEUD_PANEL_WEIGHT
      if (args.favourReporters?.includes(id) === true) weight *= FAVOUR_PANEL_WEIGHT
      return [id, weight]
    })
    panel.push(weightedPick(choices, rand))
  }
  return panel
}

/** What a reporter may do after an answer: nothing, a follow-up if there is a lot to chase, or a follow-up now. */
export type FollowUpPlan = 'none' | 'chased' | 'must'

/**
 * The follow-up plan after an answer in a panel round. At most one follow-up
 * per reporter (never after a follow-up); the round aims for `targetTotal`
 * questions plus follow-ups. With follow-ups still to give (`targetTotal` -
 * panel size - follow-ups so far):
 * - as many left as answers still to come (this one and the later questions):
 *   `must` (every chance is needed);
 * - fewer: `chased` (only when the answer has a lot to chase), so the
 *   follow-ups go to the answers with the most to chase.
 * A reporter who cannot (an unusable answer) leaves the round shorter.
 * `questionsAsked` counts the base questions asked, the current one included.
 */
export function followUpPlan(p: {
  panelSize: number
  questionsAsked: number
  followupsAsked: number
  askingFollowup: boolean
  targetTotal: number
}): FollowUpPlan {
  if (p.askingFollowup) return 'none'
  const left = p.targetTotal - p.panelSize - p.followupsAsked
  if (left <= 0) return 'none'
  const chances = p.panelSize - p.questionsAsked + 1
  return left >= chances ? 'must' : 'chased'
}

/**
 * Old one-reporter rounds (a person with no panel, made before migration
 * 0073): 2 questions for a picked player, 1 for a volunteer.
 */
export function questionLimit(role: 'picked' | 'volunteer'): number {
  return role === 'picked' ? 2 : 1
}

/**
 * Old rounds: at most one follow-up per question, and no more than the role's
 * limit. A follow-up comes after the answer to the current question, so the
 * follow-ups so far must be fewer than the questions asked.
 */
export function followUpAllowed(p: {
  questionsAsked: number
  followupsAsked: number
  role: 'picked' | 'volunteer'
}): boolean {
  return p.followupsAsked < p.questionsAsked && p.followupsAsked < questionLimit(p.role)
}

/** Extras may run while the month's spend is under 80% of the limit. */
export function extrasBudgetLeft(spent: number, limitUsd: number): boolean {
  return spent < limitUsd * EXTRAS_BUDGET_SHARE
}
