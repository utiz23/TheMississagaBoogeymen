import { RELATIONSHIPS, type NewsFacts, type ReporterId } from '@eanhl/db/news'
import { classifyNight, type GameSituation, type NightSituation } from './situation.ts'

/** Items the desk already wrote (live or test), for the frequency limits. */
export type Activity = { reporter: ReporterId; night: string | null; createdAt: Date }[]

const DAY_MS = 24 * 60 * 60 * 1000

const GAME_PREFERENCE: Record<GameSituation, readonly ReporterId[]> = {
  ot_win: ['vale', 'barlow', 'rink'],
  ot_loss: ['mercer', 'barlow', 'quill'],
  blowout_loss: ['mercer', 'quill', 'voss'],
  goalie_steal: ['voss', 'quill', 'rink'],
  quiet_win: ['quill', 'barlow', 'halberd'],
  routine_win: ['barlow', 'halberd', 'quill'],
  loss: ['barlow', 'mercer', 'quill'],
}

const NIGHT_PREFERENCE: Record<NightSituation, readonly ReporterId[]> = {
  sweep: ['vale', 'barlow'],
  winning: ['barlow', 'halberd'],
  even: ['halberd', 'quill'],
  losing: ['quill', 'barlow'],
  winless: ['mercer', 'barlow'],
  single: ['barlow', 'quill'],
}

/** Week piece by ISO week number mod 4. */
const WEEK_ROTATION: readonly ReporterId[] = ['quill', 'halberd', 'quill', 'voss']

/** Always allowed, so every pick ends with someone. */
const FALLBACK: readonly ReporterId[] = ['barlow', 'quill', 'halberd']

/** ISO 8601 week number of a `YYYY-MM-DD` date. */
export function isoWeekNumber(day: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day)
  if (!m) throw new Error(`news assign: "${day}" is not a YYYY-MM-DD date`)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  const dayNum = (d.getUTCDay() + 6) % 7 // Monday = 0
  d.setUTCDate(d.getUTCDate() - dayNum + 3) // the Thursday of this week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3)
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY_MS))
}

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

function pick(
  list: readonly ReporterId[],
  now: Date,
  night: string | null,
  activity: Activity,
  exclude: ReporterId | null,
): ReporterId {
  for (const r of [...list, ...FALLBACK]) {
    if (r !== exclude && isAllowed(r, now, night, activity)) return r
  }
  throw new Error('news assign: no reporter available') // unreachable: the fallback has three always-allowed names
}

export function assignGamePosts(
  s: GameSituation,
  now: Date,
  night: string,
  activity: Activity,
): { first: ReporterId; second: ReporterId | null; secondIsReply: boolean } {
  const list = GAME_PREFERENCE[s]
  const first = pick(list, now, night, activity, null)
  if (s === 'routine_win' || s === 'quiet_win') {
    return { first, second: null, secondIsReply: false }
  }
  const second = pick(list, now, night, activity, first)
  const secondIsReply = RELATIONSHIPS.some((r) => r.from === second && r.to === first)
  return { first, second, secondIsReply }
}

export function assignArticle(
  kind: 'night' | 'week',
  facts: NewsFacts,
  now: Date,
  activity: Activity,
): ReporterId {
  if (kind === 'week') {
    const preferred = WEEK_ROTATION[isoWeekNumber(facts.key) % 4]!
    return pick([preferred], now, null, activity, null)
  }
  const situation = classifyNight(facts)
  const list = [...NIGHT_PREFERENCE[situation]]
  if ((situation === 'sweep' || situation === 'winless') && facts.games.length >= 4) {
    list.unshift('rink')
  }
  return pick(list, now, facts.key, activity, null)
}
