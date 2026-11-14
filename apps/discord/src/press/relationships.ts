import {
  REPORTER_IDS,
  eventPoints,
  isPositive,
  relAtLeast,
  levelForPress,
  type RelEvent,
  type RelLevel,
  type ReporterId,
} from '@eanhl/db/news'
import { crudeHit, slurHit } from '../news/crude.ts'
import { relationshipStoreOf } from './relationship-store.ts'
import type { Insult, Praise } from './hard-lines.ts'
import type { PressDeps } from './pass.ts'

/**
 * Relationships in the press service (T5 feuds; T9 one signed scale from open war to glazing).
 * Points come from a message that insults a reporter (down), a compliment or thanks to a reporter (up),
 * a strong answer (up) and a big night in the reporter's taste (up, in the news cycle). The level is
 * read from the faded points with the reporter's lean and range (`@eanhl/db/news` relationships.ts).
 * Rules:
 * - the reporter's disposition scales each step, and a step outside the reporter's range is not stored
 *   (Father Rink never takes a negative step: `eventPoints` is 0);
 * - "Go easy" players: negative points may be stored, but a level on the feud side is never used for
 *   them (`levelForPress`): they may be glazed, never feuded;
 * - "Leave me out" players: nothing at all, not even points;
 * - a store without relationship methods, or a database error: no points, level "neutral" (this is
 *   only flavour, so it never fails closed into silence);
 * - off-limits messages never move anything (the callers screen first; nothing reaches here).
 */

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Press levels as the sheet and the roster say them. */
export type PressLevelNow = 'full' | 'easy' | 'out'

/** The scrum answer's step for an insult or a compliment, as an event of the scale. */
const INSULT_EVENT: Readonly<Record<Exclude<Insult, 'none'>, RelEvent>> = {
  mild: 'insultMild',
  strong: 'insultStrong',
}
const PRAISE_EVENT: Readonly<Record<Exclude<Praise, 'none'>, RelEvent>> = {
  nice: 'praiseNice',
  glowing: 'praiseGlowing',
}

/**
 * Adds one event to the scale between a player and a reporter. Never throws. Nothing for a "Leave me
 * out" player, a person with no player row (T7), or an event the reporter's range does not allow.
 */
export async function recordRelationship(
  deps: PressDeps,
  args: {
    /** Null for a bench person or a coach with no player row: no points (T7). */
    playerId: number | null
    reporter: ReporterId
    event: RelEvent
    pressLevel: PressLevelNow
    /** Where it happened, for the log line (never the message). */
    where: string
  },
): Promise<void> {
  if (args.pressLevel === 'out' || args.playerId === null) return
  const points = eventPoints(args.reporter, args.event)
  if (points === 0) return
  const st = relationshipStoreOf(deps.store)
  if (st === null) return
  try {
    await st.addRelationshipPoints({
      playerId: args.playerId,
      reporter: args.reporter,
      points,
      at: deps.now(),
    })
    deps.log(
      `[press] relationship: ${args.where}: ${args.reporter} ${points > 0 ? '+' : ''}${String(points)} (${args.event})`,
    )
  } catch (err: unknown) {
    deps.log(`[press] relationship: ${args.where}: points not saved (${reason(err)})`)
  }
}

/**
 * The steps of one player message: an insult (down) or a compliment (up) at a reporter. Both never
 * apply to one message (an insult wins in the screen). Never throws.
 */
export async function recordMessageSignals(
  deps: PressDeps,
  args: {
    playerId: number | null
    reporter: ReporterId
    insult: Insult
    praise: Praise
    pressLevel: PressLevelNow
    where: string
  },
): Promise<void> {
  if (args.insult !== 'none') {
    await recordRelationship(deps, { ...args, event: INSULT_EVENT[args.insult] })
  } else if (args.praise !== 'none') {
    await recordRelationship(deps, { ...args, event: PRAISE_EVENT[args.praise] })
  }
}

/** A relationship above neutral (what the askers and writers use). */
export interface RelationshipNow {
  reporter: ReporterId
  level: Exclude<RelLevel, 'neutral'>
}

/**
 * The reporters this player has a relationship off neutral with, strongest first. Empty for a
 * "Leave me out" player; for a "Go easy" player only the favour side is used (the feud side reads as
 * neutral). Empty when the store or the read fails.
 */
export async function relationshipsFor(
  deps: PressDeps,
  playerId: number | null,
  pressLevel: PressLevelNow,
): Promise<RelationshipNow[]> {
  // A person with no player row has no relationship (T7).
  if (pressLevel === 'out' || playerId === null) return []
  const st = relationshipStoreOf(deps.store)
  if (st === null) return []
  try {
    const rows = await st.listRelationships({ now: deps.now(), playerIds: [playerId] })
    return rows
      .map((r) => ({ reporter: r.reporter, level: levelForPress(r.level, pressLevel) }))
      .filter((r): r is RelationshipNow => r.level !== 'neutral')
  } catch (err: unknown) {
    deps.log(`[press] relationship: level not read for player ${String(playerId)} (${reason(err)})`)
    return []
  }
}

/** The level between one player and one reporter ("neutral" when there is none to use). */
export async function relationshipLevel(
  deps: PressDeps,
  playerId: number | null,
  reporter: ReporterId,
  pressLevel: PressLevelNow,
): Promise<RelLevel> {
  const all = await relationshipsFor(deps, playerId, pressLevel)
  return all.find((f) => f.reporter === reporter)?.level ?? 'neutral'
}

/** The reporters with a feud of at least "feud" level: they are likelier on the player's panel. */
export function panelFeudReporters(
  rels: readonly { reporter: ReporterId; level: RelLevel }[],
): ReporterId[] {
  return rels.filter((f) => f.level === 'feud' || f.level === 'war').map((f) => f.reporter)
}

/** The reporters who are "fan" or above: they are likelier on the player's panel and as interviewer. */
export function panelFavourReporters(
  rels: readonly { reporter: ReporterId; level: RelLevel }[],
): ReporterId[] {
  return rels
    .filter((f) => isPositive(f.level) && relAtLeast(f.level, 'fan'))
    .map((f) => f.reporter)
}

// ── Messages that are not answers (code only, no model call) ────────────────

/**
 * Names a message may use for a reporter. Long ones also match inside a
 * hashtag ("#FuckMaraQuill"); short ones only as a whole word.
 */
const ALIASES: Readonly<Record<ReporterId, { loose: readonly string[]; word: readonly string[] }>> =
  {
    barlow: { loose: ['barlow'], word: ['wade'] },
    voss: { loose: [], word: ['voss', 'talia'] },
    mercer: { loose: ['mercer'], word: ['dex'] },
    halberd: { loose: ['halberd'], word: ['june'] },
    vale: { loose: [], word: ['vale', 'rico'] },
    quill: { loose: ['quill'], word: ['mara'] },
    rink: { loose: [], word: ['father rink'] },
    pettibone: { loose: ['pettibone'], word: ['gord'] },
    bergstrom: { loose: ['bergstrom'], word: ['lyle'] },
  }

/** Rude words that need no swearing ("idiot", "useless"); strong words come from `crudeHit`. */
const RUDE =
  /\b(idiot|stupid|useless|clown|trash|garbage|moron|dumb|loser|pathetic|terrible|worst|hate you|shut up|suck|sucks|joke of a)\b/i

/** The first reporter a message names, or null (a name as a word, a long one also inside a hashtag). */
function namedReporter(text: string): ReporterId | null {
  const lower = text.toLowerCase()
  for (const id of REPORTER_IDS) {
    const a = ALIASES[id]
    const hit =
      a.loose.some((n) => lower.includes(n)) ||
      a.word.some((n) => new RegExp(`(?<![\\p{L}\\p{N}])${n}(?![\\p{L}\\p{N}])`, 'iu').test(lower))
    if (hit) return id
  }
  return null
}

/**
 * A message in a press thread that is not an answer: does it insult a named
 * reporter? Code only (no model call, no cost): a reporter name, and a rude or
 * crude word. A slur never counts (such a message is off-limits and gets no
 * reaction). Returns the reporter and the strength, or null.
 */
export function codeInsult(
  text: string,
): { reporter: ReporterId; insult: Exclude<Insult, 'none'> } | null {
  if (slurHit(text)) return null
  const strong = crudeHit(text)
  if (!strong && !RUDE.test(text)) return null
  const reporter = namedReporter(text)
  return reporter === null ? null : { reporter, insult: strong ? 'strong' : 'mild' }
}

/** Kind words at a reporter ("thanks", "love your work", "legend"). Plain words: no swearing counts as praise. */
const KIND =
  /\b(thanks|thank you|thx|ty|love (you|your|ya)|great (question|work|job|piece|take|read)|good (question|work|job|piece|take|read)|nice (question|work|job|piece|take|read)|well said|spot on|legend|goat|the best|big fan|appreciate)\b/i

/**
 * A message in a press thread that is not an answer: does it thank or compliment a named reporter?
 * Code only (no model call, no cost): a reporter name and a kind word, and nothing rude or crude (an
 * insult wins). Always "nice" (a glowing one needs the model check, which reads answers).
 */
export function codePraise(text: string): { reporter: ReporterId; praise: 'nice' } | null {
  if (slurHit(text) || crudeHit(text) || RUDE.test(text) || !KIND.test(text)) return null
  const reporter = namedReporter(text)
  return reporter === null ? null : { reporter, praise: 'nice' }
}
