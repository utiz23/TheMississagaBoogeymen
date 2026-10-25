import {
  FEATURE_REPORTER,
  RELATIONSHIPS,
  type FeatureKind,
  type NewsFacts,
  type ReporterId,
} from '@eanhl/db/news'
import { classifyNight, type GameSituation, type NightSituation } from './situation.ts'

/**
 * What an item was, for the rotation queues (spec §12.4): the first post of a
 * game is its `recap`; a second post is a `reaction`; a night article is a
 * `night` recap; a weekly piece is a `feature`. Each kind has its own queue.
 */
export type ActivityKind = 'recap' | 'reaction' | 'night' | 'feature'

/** Items the desk already wrote (live or test), for the frequency limits and the queues. */
export type Activity = {
  reporter: ReporterId
  night: string | null
  createdAt: Date
  kind: ActivityKind
}[]

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The reporters who fit each game. The list order breaks ties in the queue
 * (rev 2: Gord Pettibone fits the losses, Lyle Bergstrom the big games).
 */
const GAME_PREFERENCE: Record<GameSituation, readonly ReporterId[]> = {
  ot_win: ['vale', 'barlow', 'bergstrom', 'rink'],
  ot_loss: ['mercer', 'barlow', 'quill', 'pettibone'],
  blowout_loss: ['mercer', 'quill', 'voss', 'pettibone'],
  goalie_steal: ['voss', 'quill', 'bergstrom', 'rink'],
  quiet_win: ['quill', 'barlow', 'halberd'],
  routine_win: ['barlow', 'halberd', 'quill'],
  loss: ['barlow', 'mercer', 'quill', 'pettibone'],
}

/** Only these games get a second post (a reaction or a reply) after the recap (spec §12.1). */
export const REACTION_SITUATIONS: readonly GameSituation[] = [
  'ot_win',
  'ot_loss',
  'blowout_loss',
  'goalie_steal',
]

const NIGHT_PREFERENCE: Record<NightSituation, readonly ReporterId[]> = {
  sweep: ['vale', 'barlow', 'bergstrom'],
  winning: ['barlow', 'halberd', 'bergstrom'],
  even: ['halberd', 'quill'],
  losing: ['quill', 'barlow', 'pettibone'],
  winless: ['mercer', 'barlow', 'pettibone'],
  single: ['barlow', 'quill', 'halberd'],
}

/** Always allowed, so every pick ends with someone. */
const FALLBACK: readonly ReporterId[] = ['barlow', 'quill', 'halberd']

/** The weekly feature rotation without Father Rink (spec §12.3). */
const FEATURE_ROTATION: readonly FeatureKind[] = ['trend', 'spotlight', 'notes', 'bigpicture']

/** Dex Mercer: at most 1 item per night and 3 per 7 days. Father Rink: 1 per 14 days. Others: always. */
export function isAllowed(
  r: ReporterId,
  now: Date,
  night: string | null,
  activity: Activity,
): boolean {
  if (r === 'mercer') {
    const mine = activity.filter((a) => a.reporter === 'mercer')
    if (night !== null && mine.some((a) => a.night === night)) return false
    const weekAgo = now.getTime() - 7 * DAY_MS
    return mine.filter((a) => a.createdAt.getTime() > weekAgo).length < 3
  }
  if (r === 'rink') {
    const cutoff = now.getTime() - 14 * DAY_MS
    return !activity.some((a) => a.reporter === 'rink' && a.createdAt.getTime() > cutoff)
  }
  return true
}

/** When `r` last wrote an item of `kind`; -Infinity when never (never = oldest). */
function lastOf(r: ReporterId, kind: ActivityKind, activity: Activity): number {
  let last = -Infinity
  for (const a of activity) {
    if (a.reporter === r && a.kind === kind) last = Math.max(last, a.createdAt.getTime())
  }
  return last
}

/**
 * The queue (spec §12.4): among the allowed fitting reporters, the one whose
 * last item of `kind` is oldest; a tie goes to the earlier one in the list.
 * When no fitting reporter is allowed, the same rule runs over the fallback.
 */
function pickFromQueue(
  list: readonly ReporterId[],
  kind: ActivityKind,
  now: Date,
  night: string | null,
  activity: Activity,
  exclude: readonly ReporterId[],
): ReporterId {
  for (const pool of [list, FALLBACK]) {
    let best: ReporterId | null = null
    let bestAt = Infinity
    for (const r of pool) {
      if (exclude.includes(r) || !isAllowed(r, now, night, activity)) continue
      const at = lastOf(r, kind, activity)
      if (best === null || at < bestAt) {
        best = r
        bestAt = at
      }
    }
    if (best !== null) return best
  }
  throw new Error('news assign: no reporter available') // unreachable: the fallback has three always-allowed names
}

/**
 * The recap post goes to the fitting reporter whose last recap is oldest. A
 * second post (reaction or reply) only for the situations in
 * REACTION_SITUATIONS, from the reaction queue, never by the recap writer.
 */
export function assignGamePosts(
  s: GameSituation,
  now: Date,
  night: string,
  activity: Activity,
): { first: ReporterId; second: ReporterId | null; secondIsReply: boolean } {
  const list = GAME_PREFERENCE[s]
  const first = pickFromQueue(list, 'recap', now, night, activity, [])
  if (!REACTION_SITUATIONS.includes(s)) {
    return { first, second: null, secondIsReply: false }
  }
  const second = pickFromQueue(list, 'reaction', now, night, activity, [first])
  const secondIsReply = RELATIONSHIPS.some((r) => r.from === second && r.to === first)
  return { first, second, secondIsReply }
}

/**
 * The night recap: the night queue among the reporters who fit the night,
 * never the writer of the previous night recap. Father Rink keeps his own
 * trigger: a sweep or winless night of 4+ games is his when his 14-day limit
 * allows (he writes "now and then", so the queue would almost never reach him).
 */
export function assignNightRecap(facts: NewsFacts, now: Date, activity: Activity): ReporterId {
  const situation = classifyNight(facts)
  const list = NIGHT_PREFERENCE[situation]
  let previous: { reporter: ReporterId; at: number } | null = null
  for (const a of activity) {
    if (a.kind !== 'night') continue
    const at = a.createdAt.getTime()
    if (previous === null || at >= previous.at) previous = { reporter: a.reporter, at }
  }
  const rinkNight = (situation === 'sweep' || situation === 'winless') && facts.games.length >= 4
  if (rinkNight && previous?.reporter !== 'rink' && isAllowed('rink', now, facts.key, activity)) {
    return 'rink'
  }
  return pickFromQueue(
    list,
    'night',
    now,
    facts.key,
    activity,
    previous === null ? [] : [previous.reporter],
  )
}

/**
 * The next weekly feature kind: trend → spotlight → notes → bigpicture, then
 * Father Rink's column as every 5th feature when he is allowed (else trend
 * again), then trend. No previous feature ⇒ trend.
 */
export function nextFeatureKind(last: FeatureKind | null, rinkAllowed: boolean): FeatureKind {
  if (last === null || last === 'rink') return 'trend'
  if (last === 'bigpicture') return rinkAllowed ? 'rink' : 'trend'
  return FEATURE_ROTATION[FEATURE_ROTATION.indexOf(last) + 1]!
}

/** The kind and the writer of the next weekly feature. */
export function assignFeature(
  lastKind: FeatureKind | null,
  now: Date,
  activity: Activity,
): { kind: FeatureKind; reporter: ReporterId } {
  const kind = nextFeatureKind(lastKind, isAllowed('rink', now, null, activity))
  return { kind, reporter: FEATURE_REPORTER[kind] }
}

/**
 * The prediction the new feature must judge (spec §12.6: "last week's
 * prediction"): the last feature's prediction only when that feature covered
 * the week right before `weekStart`. After a week without games the old
 * prediction was about a week that was never played, so there is none.
 */
export function predictionToJudge(
  weekStart: string,
  last: { prediction: string | null; weekStart: string | null } | null,
): string | null {
  if (last === null || last.prediction === null || last.weekStart === null) return null
  const [y, m, d] = weekStart.split('-').map(Number)
  const previous = new Date(Date.UTC(y!, m! - 1, d! - 7)).toISOString().slice(0, 10)
  return last.weekStart === previous ? last.prediction : null
}
