import { sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import { THREAD_KINDS, type ThreadKind } from '../news/contract.js'
import { nightKey } from '../news/keys.js'
import { REPORTER_IDS, REPORTERS } from '../news/reporters.js'
import {
  TAKE_SPREADS,
  type NewsReporterId,
  type PressLevel,
  type TakeSpread,
} from '../schema/index.js'
import { listPressRosterSql } from './news-press.js'
import {
  interviewAnswerIsAboutTeammateSql,
  scrumAnswerIsAboutTeammateSql,
} from './press-background-sql.js'
import { namesAny } from './press-box-dossiers.js'
import { writeAudit, type PressBoxActor, type Tx } from './press-box.js'
import { checkPressText, type PressTextProblem } from './press-text-check.js'

// Press Box storylines, trends, takes and stances (the admin page /admin/press-box/storylines,
// migration 0085, task press-box-l3). Pure rules first (they carry the tests); the async functions
// run a rule and its audit line in ONE transaction, so a change and its log line are written
// together or not at all. Every typed text goes through `checkPressText` (the desk's own crude and
// slur lists) and is refused when it names a "Leave me out" player.

const num = (v: string | number): number => Number(v)
const toDate = (v: string | Date): Date => (v instanceof Date ? v : new Date(v))

export const STORYLINE_TITLE_MAX = 80
export const STORYLINE_ANGLE_MAX = 300
export const STANCE_MAX = 400
export const TAKE_TEXT_MAX = 1000
export const TAKE_DATA_ANGLE_MAX = 500
/** A reporter-system thread with a stance in this many days is an open storyline on the page. */
export const OPEN_THREAD_DAYS = 30
/** The most reporter-system threads the page lists. */
export const OPEN_THREAD_LIMIT = 12
/** At most this many stances of the pinned storyline go to a writer. */
export const PINNED_STANCES_MAX = 6

// ── Thread keys (pure) ───────────────────────────────────────────────────────

export interface ParsedThreadKey {
  kind: ThreadKind
  /** The player id (player-* threads), the opponent in lower case (rival), else null. */
  arg: string | null
  since: string
}

const THREAD_KEY_RE = /^([a-z-]+)(?::(.{1,80}))?@(\d{4}-\d{2}-\d{2})$/

/** `player-hot:5@2026-11-09` -> kind, arg, since. Null when it is not a derived thread key. */
export function parseThreadKey(key: string): ParsedThreadKey | null {
  const m = THREAD_KEY_RE.exec(key)
  if (m === null) return null
  const head = m[1] ?? ''
  const kind = (THREAD_KINDS as readonly string[]).includes(head) ? (head as ThreadKind) : null
  if (kind === null) return null
  const arg = m[2] ?? null
  const needsArg = kind === 'rival' || kind === 'player-hot' || kind === 'player-slump'
  if (needsArg !== (arg !== null)) return null
  if ((kind === 'player-hot' || kind === 'player-slump') && !/^[1-9]\d{0,9}$/.test(arg ?? '')) {
    return null
  }
  return { kind, arg, since: m[3] ?? '' }
}

const titleCase = (s: string): string =>
  s.replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase())

/**
 * The name the page and the writers use for a derived thread. Fixed words (no digit), so it can
 * go to a writer as it is. `playerName` is read by the caller for the player threads.
 */
export function threadLabel(key: ParsedThreadKey, playerName: string | null): string {
  switch (key.kind) {
    case 'winning-streak':
      return 'The win streak'
    case 'losing-streak':
      return 'The losing streak'
    case 'pp-drought':
      return 'The power-play drought'
    case 'rival':
      return `Rival: ${titleCase(key.arg ?? 'an opponent')}`
    case 'player-hot':
      return `${playerName ?? 'A player'}'s point streak`
    case 'player-slump':
      return `${playerName ?? 'A player'}'s goal drought`
  }
}

/** The player id of a player-* thread, else null. */
export function threadPlayerId(key: ParsedThreadKey): number | null {
  return (key.kind === 'player-hot' || key.kind === 'player-slump') && key.arg !== null
    ? Number(key.arg)
    : null
}

/** The stance key of a typed storyline. */
export const storylineThreadKey = (id: number): string => `storyline:${String(id)}`

// ── Text rules (pure) ────────────────────────────────────────────────────────

export type TextField = 'title' | 'angle' | 'stance' | 'take' | 'data_angle'

export type StorylineErrorCode =
  | 'bad_title'
  | 'bad_angle'
  | 'bad_stance'
  | 'bad_take'
  | 'bad_data_angle'
  | 'crude'
  | 'digits'
  | 'names_out'
  | 'no_storyline'
  | 'closed'
  | 'already_pinned'
  | 'not_pinned'
  | 'bad_thread'
  | 'out'
  | 'no_player'
  | 'bad_reporter'
  | 'bad_spread'
  | 'bad_intensity'
  | 'bad_defender'
  | 'no_take'
  | 'take_exists'
  | 'no_stance'

export type StorylineActionResult =
  | { ok: true; summary: string }
  | { ok: false; code: StorylineErrorCode }

const FIELD_CODE: Readonly<Record<TextField, StorylineErrorCode>> = {
  title: 'bad_title',
  angle: 'bad_angle',
  stance: 'bad_stance',
  take: 'bad_take',
  data_angle: 'bad_data_angle',
}

/**
 * One typed text: collapsed, within its limit, no crude word or slur and (title, angle, stance)
 * no digit, and not naming a "Leave me out" player. Returns the text to store or the error code.
 */
export function checkTypedText(
  raw: string,
  field: TextField,
  max: number,
  outKeys: readonly string[],
  opts: { allowEmpty?: boolean } = {},
): { ok: true; text: string } | { ok: false; code: StorylineErrorCode } {
  const r = checkPressText(raw, {
    max,
    allowEmpty: opts.allowEmpty === true,
    noDigits: field === 'title' || field === 'angle' || field === 'stance',
  })
  if (!r.ok) {
    const p: PressTextProblem = r.problem
    return {
      ok: false,
      code: p === 'crude' ? 'crude' : p === 'digits' ? 'digits' : FIELD_CODE[field],
    }
  }
  if (r.text !== '' && namesAny(r.text, outKeys)) return { ok: false, code: 'names_out' }
  return r
}

const isReporter = (v: unknown): v is NewsReporterId =>
  typeof v === 'string' && (REPORTER_IDS as readonly string[]).includes(v)

/** What the takes editor may set on a take (the same fields the old editor had). */
export interface TakeInput {
  take: string
  spread: TakeSpread
  critics: NewsReporterId[]
  defender: NewsReporterId | null
  dataAngle: string | null
  /** -2..+2: negative softens the take, positive hardens it. */
  intensity: number
  active: boolean
}

/** The take's fields after the shape rules; the texts are checked separately (needs the roster). */
export function checkTakeShape(
  input: TakeInput,
  holder: NewsReporterId,
): { ok: true } | { ok: false; code: StorylineErrorCode } {
  if (!(TAKE_SPREADS as readonly string[]).includes(input.spread)) {
    return { ok: false, code: 'bad_spread' }
  }
  if (!Number.isInteger(input.intensity) || input.intensity < -2 || input.intensity > 2) {
    return { ok: false, code: 'bad_intensity' }
  }
  if (!input.critics.every(isReporter)) return { ok: false, code: 'bad_reporter' }
  if (input.defender !== null) {
    if (!isReporter(input.defender)) return { ok: false, code: 'bad_reporter' }
    if (input.defender === holder || input.critics.includes(input.defender)) {
      return { ok: false, code: 'bad_defender' }
    }
  }
  return { ok: true }
}

/** The names of the fields that differ between two takes (never the text itself). */
export function changedTakeFields(before: TakeInput, after: TakeInput): string[] {
  const out: string[] = []
  if (before.take !== after.take) out.push('text')
  if (before.spread !== after.spread) out.push(`spread ${before.spread} -> ${after.spread}`)
  if (before.intensity !== after.intensity) {
    out.push(`intensity ${String(before.intensity)} -> ${String(after.intensity)}`)
  }
  if (before.defender !== after.defender) out.push('defender')
  if ([...before.critics].sort().join() !== [...after.critics].sort().join()) out.push('critics')
  if ((before.dataAngle ?? '') !== (after.dataAngle ?? '')) out.push('data angle')
  if (before.active !== after.active) out.push(after.active ? 'switched on' : 'switched off')
  return out
}

// ── What the page reads ──────────────────────────────────────────────────────

export interface StoryStance {
  id: number
  reporter: NewsReporterId
  stance: string
  night: string | null
  at: Date
  /** The news item the stance came with; null when the admin typed it. */
  itemId: number | null
}

export interface StorylineView {
  /** `s<id>` for a stored row, `t:<thread key>` for a reporter-system thread without a row. */
  ref: string
  id: number | null
  threadKey: string | null
  title: string
  angle: string
  pinned: boolean
  openedAt: Date
  /** The newest stance, or null when there is none. */
  lastMovedAt: Date | null
  stances: StoryStance[]
  /** `typed` = made on the page; `thread` = a reporter-system thread. */
  source: 'typed' | 'thread'
  /** The player a player thread is about. */
  playerName: string | null
}

export interface StorylineBoard {
  open: StorylineView[]
  closedCount: number
  /**
   * False while migration 0085 is not applied: reporter threads still show, but nothing can be
   * pinned or closed yet.
   */
  tableReady: boolean
}

type StoredRow = {
  id: string | number
  thread_key: string | null
  title: string
  angle: string
  pinned: boolean
  opened_at: Date | string
  closed_at: Date | string | null
}

type StanceRow = {
  id: string | number
  thread_key: string
  reporter: NewsReporterId
  stance: string
  night: string | null
  created_at: Date | string
  item_id: string | number | null
}

/** A stance of a deleted or test item is left out (the sheet is the public record); one the admin typed stays. */
const VISIBLE_STANCE = sql`(s.item_id is null or (i.deleted_at is null and i.is_test = false))`

/** Threads with a visible stance in the last `days` days (newest move first). */
export function recentThreadKeysSql(now: Date, days: number, limit: number): SQL {
  return sql`
    select s.thread_key, max(s.created_at) as last_moved
    from news_stances s
    left join news_items i on i.id = s.item_id
    where ${VISIBLE_STANCE} and s.thread_key !~ '^storyline:'
    group by s.thread_key
    having max(s.created_at) > ${now.toISOString()}::timestamptz - make_interval(days => ${days})
    order by max(s.created_at) desc
    limit ${limit}`
}

export function stancesForKeysSql(keys: readonly string[]): SQL {
  return sql`
    select s.id, s.thread_key, s.reporter, s.stance, to_char(s.night, 'YYYY-MM-DD') as night,
      s.created_at, s.item_id
    from news_stances s
    left join news_items i on i.id = s.item_id
    where s.thread_key in (${sql.join(
      keys.map((k) => sql`${k}`),
      sql`, `,
    )})
      and ${VISIBLE_STANCE}
    order by s.created_at asc, s.id asc`
}

const stanceOf = (r: StanceRow): StoryStance => ({
  id: num(r.id),
  reporter: r.reporter,
  stance: r.stance,
  night: r.night,
  at: toDate(r.created_at),
  itemId: r.item_id === null ? null : num(r.item_id),
})

const newestMove = (s: readonly StoryStance[]): Date | null =>
  s.length === 0 ? null : new Date(Math.max(...s.map((x) => x.at.getTime())))

/**
 * Open storylines: every stored row that is not closed, and the reporter-system threads with a
 * stance in the last 30 days that have no stored row (a closed one has a row, so it is not here).
 * Pinned first, then the newest move. Without migration 0085 the threads still list (`tableReady`
 * false) and nothing can be pinned or closed.
 */
export async function listStorylineBoard(now: Date): Promise<StorylineBoard> {
  let stored: StoredRow[] = []
  let tableReady = true
  try {
    stored = [
      ...(await db.execute<StoredRow>(sql`
        select id, thread_key, title, angle, pinned, opened_at, closed_at
        from news_storylines order by id`)),
    ]
  } catch (err: unknown) {
    // 42P01 = the table does not exist yet (migration 0085 not applied). Drizzle wraps the driver
    // error, so the code may sit on `cause`. Any other error is real.
    const code = (e: unknown): unknown => (e as { code?: unknown } | null)?.code
    if (code(err) !== '42P01' && code((err as { cause?: unknown } | null)?.cause) !== '42P01') {
      throw err
    }
    tableReady = false
  }
  const open = stored.filter((r) => r.closed_at === null)
  const closedCount = stored.length - open.length
  const storedKeys = new Set(stored.flatMap((r) => (r.thread_key === null ? [] : [r.thread_key])))
  const recent = await db.execute<{ thread_key: string }>(
    recentThreadKeysSql(now, OPEN_THREAD_DAYS, OPEN_THREAD_LIMIT),
  )
  const derived = recent.map((r) => r.thread_key).filter((k) => !storedKeys.has(k))
  const keyOf = (r: StoredRow): string => r.thread_key ?? storylineThreadKey(num(r.id))
  const allKeys = [...open.map(keyOf), ...derived]
  const byKey = new Map<string, StoryStance[]>()
  if (allKeys.length > 0) {
    const rows = await db.execute<StanceRow>(stancesForKeysSql(allKeys))
    for (const r of rows) {
      const list = byKey.get(r.thread_key) ?? []
      list.push(stanceOf(r))
      byKey.set(r.thread_key, list)
    }
  }
  const parsed = new Map<string, ParsedThreadKey>()
  for (const k of [
    ...open.flatMap((r) => (r.thread_key === null ? [] : [r.thread_key])),
    ...derived,
  ]) {
    const p = parseThreadKey(k)
    if (p !== null) parsed.set(k, p)
  }
  const idSet = new Set<number>()
  for (const p of parsed.values()) {
    const id = threadPlayerId(p)
    if (id !== null) idSet.add(id)
  }
  const playerIds = [...idSet]
  const names = new Map<number, string>()
  if (playerIds.length > 0) {
    const rows = await db.execute<{ id: string | number; name: string }>(sql`
      select p.id, coalesce(nullif(btrim(pp.player_name), ''), p.gamertag) as name
      from players p left join player_profiles pp on pp.player_id = p.id
      where p.id in (${sql.join(
        playerIds.map((id) => sql`${id}`),
        sql`, `,
      )})`)
    for (const r of rows) names.set(num(r.id), r.name)
  }
  const playerOf = (k: string): string | null => {
    const p = parsed.get(k)
    const id = p === undefined ? null : threadPlayerId(p)
    return id === null ? null : (names.get(id) ?? null)
  }
  const views: StorylineView[] = [
    ...open.map((r): StorylineView => {
      const key = keyOf(r)
      const stances = byKey.get(key) ?? []
      return {
        ref: `s${String(num(r.id))}`,
        id: num(r.id),
        threadKey: r.thread_key,
        title: r.title,
        angle: r.angle,
        pinned: r.pinned,
        openedAt: toDate(r.opened_at),
        lastMovedAt: newestMove(stances),
        stances,
        source: r.thread_key === null ? 'typed' : 'thread',
        playerName: r.thread_key === null ? null : playerOf(r.thread_key),
      }
    }),
    ...derived.map((k): StorylineView => {
      const stances = byKey.get(k) ?? []
      const p = parsed.get(k)
      return {
        ref: `t:${k}`,
        id: null,
        threadKey: k,
        title: p === undefined ? k : threadLabel(p, playerOf(k)),
        angle: '',
        pinned: false,
        openedAt: stances[0]?.at ?? now,
        lastMovedAt: newestMove(stances),
        stances,
        source: 'thread',
        playerName: playerOf(k),
      }
    }),
  ]
  views.sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned) ||
      (b.lastMovedAt ?? b.openedAt).getTime() - (a.lastMovedAt ?? a.openedAt).getTime(),
  )
  return { open: views, closedCount, tableReady }
}

// ── What the writers read ────────────────────────────────────────────────────

/** The pinned storyline as a writer gets it: a suggested angle and the reporters' earlier stances. */
export interface PinnedStoryline {
  id: number
  title: string
  /** May be empty: the writers then get the title only. */
  angle: string
  /** Oldest first, at most `PINNED_STANCES_MAX`. */
  stances: { reporter: NewsReporterId; stance: string }[]
}

/** The one row the writers may read: pinned AND not closed. */
export function pinnedStorylineSql(): SQL {
  return sql`
    select id, thread_key, title, angle from news_storylines
    where pinned and closed_at is null limit 1`
}

/**
 * The pinned, not closed storyline, or null. Closed and unpinned storylines are never returned.
 * Throws when migration 0085 is not applied (the writers catch that and use none).
 */
export async function getPinnedStoryline(): Promise<PinnedStoryline | null> {
  const rows = await db.execute<{
    id: string | number
    thread_key: string | null
    title: string
    angle: string
  }>(pinnedStorylineSql())
  const r = rows[0]
  if (r === undefined) return null
  const key = r.thread_key ?? storylineThreadKey(num(r.id))
  const st = await db.execute<StanceRow>(stancesForKeysSql([key]))
  return {
    id: num(r.id),
    title: r.title,
    angle: r.angle,
    stances: st.slice(-PINNED_STANCES_MAX).map((s) => ({ reporter: s.reporter, stance: s.stance })),
  }
}

// ── Trends (reads) ───────────────────────────────────────────────────────────

export interface TalkCount {
  playerId: number
  name: string
  /** Usable and joke answers (the ones a writer may quote). */
  quotes: number
  /** All answers, any usability. */
  answers: number
}

/** Answers per player in the last `days` days (test answers and answers about a teammate left out). */
export function talkCountsSql(now: Date, days: number, withAsks = true): SQL {
  const since = sql`${now.toISOString()}::timestamptz - make_interval(days => ${days})`
  return sql`
    select x.player_id, count(*) filter (where x.usability in ('usable', 'joke')) as quotes,
      count(*) as answers
    from (
      select a.player_id, a.usability from news_scrum_answers a
      where not a.is_test and a.created_at > ${since}
        ${withAsks ? sql`and not ${scrumAnswerIsAboutTeammateSql('a')}` : sql``}
      union all
      select ia.player_id, ia.usability from news_interview_answers ia
      where not ia.is_test and ia.created_at > ${since}
        ${withAsks ? sql`and not ${interviewAnswerIsAboutTeammateSql('ia')}` : sql``}
    ) x
    group by x.player_id`
}

export async function listTalkCounts(now: Date, days = 30): Promise<TalkCount[]> {
  type Row = { player_id: string | number; quotes: string | number; answers: string | number }
  const rows = await db
    .execute<Row>(talkCountsSql(now, days))
    // Before migration 0084 there is no ask table, so no answer about a teammate to leave out.
    .catch(() => db.execute<Row>(talkCountsSql(now, days, false)))
  const ids = rows.map((r) => num(r.player_id))
  if (ids.length === 0) return []
  const names = await db.execute<{ id: string | number; name: string }>(sql`
    select p.id, coalesce(nullif(btrim(pp.player_name), ''), p.gamertag) as name
    from players p left join player_profiles pp on pp.player_id = p.id
    where p.id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )})`)
  const nameOf = new Map(names.map((n) => [num(n.id), n.name]))
  return rows
    .map((r) => ({
      playerId: num(r.player_id),
      name: nameOf.get(num(r.player_id)) ?? 'Unknown',
      quotes: num(r.quotes),
      answers: num(r.answers),
    }))
    .sort((a, b) => b.quotes - a.quotes || b.answers - a.answers || a.name.localeCompare(b.name))
}

// ── Actions (database) ───────────────────────────────────────────────────────

type RosterRow = { name: string; gamertag: string; aliases: string[] | null }

/** Names, gamertags and nicknames of the "Leave me out" players: a typed text may not name them. */
async function outKeysOf(tx: Tx): Promise<string[]> {
  const rows = await tx.execute<RosterRow>(
    sql`select * from (${listPressRosterSql()}) r where r.press_level = 'out'`,
  )
  return rows.flatMap((r) => [r.name, r.gamertag, ...(r.aliases ?? [])])
}

type PlayerRow = { name: string; press_level: PressLevel }

async function readPlayer(tx: Tx, playerId: number): Promise<PlayerRow | null> {
  const rows = await tx.execute<PlayerRow>(sql`
    select coalesce(nullif(btrim(pp.player_name), ''), p.gamertag) as name,
      coalesce(pp.press_level, 'full') as press_level
    from players p left join player_profiles pp on pp.player_id = p.id
    where p.id = ${playerId} and p.ai_goalie_side is null`)
  return rows[0] ?? null
}

type RowRef = { id: number } | { threadKey: string }

type StorylineRow = {
  id: number
  title: string
  angle: string
  pinned: boolean
  closed: boolean
  threadKey: string | null
}

type RawStoryline = {
  id: string | number
  title: string
  angle: string
  pinned: boolean
  closed_at: Date | string | null
  thread_key: string | null
}

const rowOf = (r: RawStoryline): StorylineRow => ({
  id: num(r.id),
  title: r.title,
  angle: r.angle,
  pinned: r.pinned,
  closed: r.closed_at !== null,
  threadKey: r.thread_key,
})

/**
 * Finds the stored row of a reference, locking it. A reporter-system thread key with no row yet is
 * made on the spot (`create`: 'open' for a pin, 'closed' for a close) from the thread's own label.
 */
async function resolveStoryline(
  tx: Tx,
  ref: RowRef,
  create: 'open' | 'closed' | null,
  actor: PressBoxActor,
  now: Date,
): Promise<{ ok: true; row: StorylineRow } | { ok: false; code: StorylineErrorCode }> {
  if ('id' in ref) {
    const rows = await tx.execute<RawStoryline>(sql`
      select id, title, angle, pinned, closed_at, thread_key from news_storylines
      where id = ${ref.id} for update`)
    return rows[0] === undefined
      ? { ok: false, code: 'no_storyline' }
      : { ok: true, row: rowOf(rows[0]) }
  }
  const parsed = parseThreadKey(ref.threadKey)
  if (parsed === null) return { ok: false, code: 'bad_thread' }
  const rows = await tx.execute<RawStoryline>(sql`
    select id, title, angle, pinned, closed_at, thread_key from news_storylines
    where thread_key = ${ref.threadKey} for update`)
  if (rows[0] !== undefined) return { ok: true, row: rowOf(rows[0]) }
  if (create === null) return { ok: false, code: 'no_storyline' }
  const known = await tx.execute<{ n: string | number }>(
    sql`select 1 as n from news_stances where thread_key = ${ref.threadKey} limit 1`,
  )
  if (known[0] === undefined) return { ok: false, code: 'bad_thread' }
  const playerId = threadPlayerId(parsed)
  let playerName: string | null = null
  if (playerId !== null) {
    const p = await readPlayer(tx, playerId)
    if (p === null) return { ok: false, code: 'no_player' }
    // A "Leave me out" player is never a storyline, pinned or not.
    if (p.press_level === 'out') return { ok: false, code: 'out' }
    playerName = p.name
  }
  const title = threadLabel(parsed, playerName)
  const at = now.toISOString()
  const made = await tx.execute<{ id: string | number }>(sql`
    insert into news_storylines (thread_key, title, angle, pinned, opened_at, pinned_at, closed_at, created_by, updated_at)
    values (${ref.threadKey}, ${title}, '', false, ${at}::timestamptz, null,
      ${create === 'closed' ? sql`${at}::timestamptz` : sql`null`}, ${actor.name}, ${at}::timestamptz)
    returning id`)
  const id = made[0]?.id
  if (id === undefined) throw new Error('resolveStoryline: no row returned')
  return {
    ok: true,
    row: {
      id: num(id),
      title,
      angle: '',
      pinned: false,
      closed: create === 'closed',
      threadKey: ref.threadKey,
    },
  }
}

/** Opens a storyline the admin typed (a title and, optionally, a suggested angle). */
export async function createStorylineWithAudit(args: {
  title: string
  angle: string
  actor: PressBoxActor
  now: Date
}): Promise<StorylineActionResult & { id?: number }> {
  return db.transaction(async (tx) => {
    const out = await outKeysOf(tx)
    const title = checkTypedText(args.title, 'title', STORYLINE_TITLE_MAX, out)
    if (!title.ok) return { ok: false, code: title.code } as const
    const angle = checkTypedText(args.angle, 'angle', STORYLINE_ANGLE_MAX, out, {
      allowEmpty: true,
    })
    if (!angle.ok) return { ok: false, code: angle.code } as const
    const at = args.now.toISOString()
    const rows = await tx.execute<{ id: string | number }>(sql`
      insert into news_storylines (thread_key, title, angle, created_by, opened_at, updated_at)
      values (null, ${title.text}, ${angle.text}, ${args.actor.name}, ${at}::timestamptz, ${at}::timestamptz)
      returning id`)
    const id = num(rows[0]?.id ?? 0)
    if (id === 0) throw new Error('createStorylineWithAudit: no row returned')
    const summary = `opened storyline ${String(id)}${angle.text === '' ? '' : ' with a suggested angle'}`
    await writeAudit(
      tx,
      args.actor,
      { kind: 'storyline_new', target: title.text, summary },
      args.now,
    )
    return { ok: true, summary, id } as const
  })
}

/**
 * Pins a storyline: the writers get it as a suggested angle. One at a time: the pinned one, if
 * any, is unpinned in the same transaction (the audit line says which). A closed storyline cannot
 * be pinned. A thread with no row yet gets its row here.
 */
export async function pinStorylineWithAudit(args: {
  ref: RowRef
  actor: PressBoxActor
  now: Date
}): Promise<StorylineActionResult> {
  return db.transaction(async (tx) => {
    const found = await resolveStoryline(tx, args.ref, 'open', args.actor, args.now)
    if (!found.ok) return found
    const row = found.row
    if (row.closed) return { ok: false, code: 'closed' } as const
    if (row.pinned) return { ok: false, code: 'already_pinned' } as const
    // The text may have been fine when it was typed and name a "Leave me out" player now.
    const out = await outKeysOf(tx)
    if (namesAny(row.title, out) || namesAny(row.angle, out)) {
      return { ok: false, code: 'names_out' } as const
    }
    const at = args.now.toISOString()
    // The old pin goes first: the unique index allows one pinned row at a time.
    const replaced = await tx.execute<{ title: string }>(sql`
      update news_storylines set pinned = false, pinned_at = null, updated_at = ${at}::timestamptz
      where pinned and id <> ${row.id} returning title`)
    await tx.execute(sql`
      update news_storylines set pinned = true, pinned_at = ${at}::timestamptz, updated_at = ${at}::timestamptz
      where id = ${row.id}`)
    const summary = `pinned storyline ${String(row.id)}${
      replaced[0] === undefined ? '' : ` (replaced "${replaced[0].title}")`
    }`
    await writeAudit(
      tx,
      args.actor,
      { kind: 'storyline_pin', target: row.title, summary },
      args.now,
    )
    return { ok: true, summary } as const
  })
}

export async function unpinStorylineWithAudit(args: {
  ref: RowRef
  actor: PressBoxActor
  now: Date
}): Promise<StorylineActionResult> {
  return db.transaction(async (tx) => {
    const found = await resolveStoryline(tx, args.ref, null, args.actor, args.now)
    if (!found.ok) return found
    if (!found.row.pinned) return { ok: false, code: 'not_pinned' } as const
    await tx.execute(sql`
      update news_storylines set pinned = false, pinned_at = null, updated_at = ${args.now.toISOString()}::timestamptz
      where id = ${found.row.id}`)
    const summary = `unpinned storyline ${String(found.row.id)}`
    await writeAudit(
      tx,
      args.actor,
      { kind: 'storyline_unpin', target: found.row.title, summary },
      args.now,
    )
    return { ok: true, summary } as const
  })
}

/** Closes a storyline (also unpins it). A closed storyline reaches no writer. A thread with no row gets a closed row. */
export async function closeStorylineWithAudit(args: {
  ref: RowRef
  actor: PressBoxActor
  now: Date
}): Promise<StorylineActionResult> {
  return db.transaction(async (tx) => {
    const found = await resolveStoryline(tx, args.ref, 'closed', args.actor, args.now)
    if (!found.ok) return found
    const row = found.row
    const at = args.now.toISOString()
    if (!row.closed || row.pinned) {
      await tx.execute(sql`
        update news_storylines set pinned = false, pinned_at = null,
          closed_at = coalesce(closed_at, ${at}::timestamptz), updated_at = ${at}::timestamptz
        where id = ${row.id}`)
    }
    const summary = `closed storyline ${String(row.id)}${row.pinned ? ' (it was pinned)' : ''}`
    await writeAudit(
      tx,
      args.actor,
      { kind: 'storyline_close', target: row.title, summary },
      args.now,
    )
    return { ok: true, summary } as const
  })
}

// ── Stances ──────────────────────────────────────────────────────────────────

/** A stance belongs to a reporter-system thread (by key) or to a typed storyline (by id). */
export type StanceTarget = { threadKey: string } | { storylineId: number }

async function stanceKeyOf(
  tx: Tx,
  target: StanceTarget,
): Promise<{ ok: true; key: string; label: string } | { ok: false; code: StorylineErrorCode }> {
  if ('storylineId' in target) {
    const rows = await tx.execute<RawStoryline>(sql`
      select id, title, angle, pinned, closed_at, thread_key from news_storylines
      where id = ${target.storylineId} and thread_key is null`)
    const r = rows[0]
    if (r === undefined) return { ok: false, code: 'no_storyline' }
    if (r.closed_at !== null) return { ok: false, code: 'closed' }
    return { ok: true, key: storylineThreadKey(num(r.id)), label: r.title }
  }
  const parsed = parseThreadKey(target.threadKey)
  if (parsed === null) return { ok: false, code: 'bad_thread' }
  const closed = await tx.execute<{ title: string; closed_at: Date | string | null }>(
    sql`select title, closed_at from news_storylines where thread_key = ${target.threadKey}`,
  )
  if (closed[0]?.closed_at != null) return { ok: false, code: 'closed' }
  return { ok: true, key: target.threadKey, label: closed[0]?.title ?? target.threadKey }
}

export async function addStanceWithAudit(args: {
  target: StanceTarget
  reporter: string
  text: string
  actor: PressBoxActor
  now: Date
}): Promise<StorylineActionResult> {
  if (!isReporter(args.reporter)) return { ok: false, code: 'bad_reporter' }
  const reporter = args.reporter
  return db.transaction(async (tx) => {
    const out = await outKeysOf(tx)
    const text = checkTypedText(args.text, 'stance', STANCE_MAX, out)
    if (!text.ok) return { ok: false, code: text.code } as const
    const k = await stanceKeyOf(tx, args.target)
    if (!k.ok) return k
    if ('threadKey' in args.target) {
      const known = await tx.execute<{ n: string | number }>(
        sql`select 1 as n from news_stances where thread_key = ${k.key} limit 1`,
      )
      const stored = await tx.execute<{ n: string | number }>(
        sql`select 1 as n from news_storylines where thread_key = ${k.key} limit 1`,
      )
      if (known[0] === undefined && stored[0] === undefined)
        return { ok: false, code: 'bad_thread' } as const
    }
    const rows = await tx.execute<{ id: string | number }>(sql`
      insert into news_stances (thread_key, reporter, stance, night, item_id, created_at)
      values (${k.key}, ${reporter}, ${text.text}, ${nightKey(args.now)}::date, null, ${args.now.toISOString()}::timestamptz)
      returning id`)
    const id = num(rows[0]?.id ?? 0)
    if (id === 0) throw new Error('addStanceWithAudit: no row returned')
    const summary = `added stance ${String(id)} for ${REPORTERS[reporter].name}`
    await writeAudit(tx, args.actor, { kind: 'stance_add', target: k.label, summary }, args.now)
    return { ok: true, summary } as const
  })
}

export async function editStanceWithAudit(args: {
  id: number
  text: string
  actor: PressBoxActor
  now: Date
}): Promise<StorylineActionResult> {
  return db.transaction(async (tx) => {
    const out = await outKeysOf(tx)
    const text = checkTypedText(args.text, 'stance', STANCE_MAX, out)
    if (!text.ok) return { ok: false, code: text.code } as const
    const rows = await tx.execute<{ thread_key: string; reporter: NewsReporterId; stance: string }>(
      sql`select thread_key, reporter, stance from news_stances where id = ${args.id} for update`,
    )
    const r = rows[0]
    if (r === undefined) return { ok: false, code: 'no_stance' } as const
    await tx.execute(sql`update news_stances set stance = ${text.text} where id = ${args.id}`)
    const summary = `changed stance ${String(args.id)} of ${REPORTERS[r.reporter].name}${
      r.stance === text.text ? ' (same text)' : ''
    }`
    await writeAudit(
      tx,
      args.actor,
      { kind: 'stance_edit', target: r.thread_key, summary },
      args.now,
    )
    return { ok: true, summary } as const
  })
}

export async function removeStanceWithAudit(args: {
  id: number
  actor: PressBoxActor
  now: Date
}): Promise<StorylineActionResult> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{ thread_key: string; reporter: NewsReporterId }>(
      sql`delete from news_stances where id = ${args.id} returning thread_key, reporter`,
    )
    const r = rows[0]
    if (r === undefined) return { ok: false, code: 'no_stance' } as const
    const summary = `removed stance ${String(args.id)} of ${REPORTERS[r.reporter].name}`
    await writeAudit(
      tx,
      args.actor,
      { kind: 'stance_remove', target: r.thread_key, summary },
      args.now,
    )
    return { ok: true, summary } as const
  })
}

// ── Takes ────────────────────────────────────────────────────────────────────

type RawTake = {
  id: string | number
  reporter: NewsReporterId
  player_id: string | number
  take: string
  spread: TakeSpread
  critics: unknown
  defender: NewsReporterId | null
  data_angle: string | null
  intensity: number
  active: boolean
}

const takeOf = (r: RawTake): TakeInput => ({
  take: r.take,
  spread: r.spread,
  critics: (Array.isArray(r.critics) ? r.critics : []).filter(isReporter),
  defender: r.defender,
  dataAngle: r.data_angle,
  intensity: r.intensity,
  active: r.active,
})

async function checkTakeTexts(
  tx: Tx,
  input: TakeInput,
): Promise<{ ok: true; input: TakeInput } | { ok: false; code: StorylineErrorCode }> {
  const out = await outKeysOf(tx)
  const take = checkTypedText(input.take, 'take', TAKE_TEXT_MAX, out)
  if (!take.ok) return take
  const angle = checkTypedText(input.dataAngle ?? '', 'data_angle', TAKE_DATA_ANGLE_MAX, out, {
    allowEmpty: true,
  })
  if (!angle.ok) return angle
  return {
    ok: true,
    input: { ...input, take: take.text, dataAngle: angle.text === '' ? null : angle.text },
  }
}

/** Adds a take of one reporter about one player (one take per reporter and player, as the seed). */
export async function addTakeWithAudit(args: {
  reporter: string
  playerId: number
  input: TakeInput
  actor: PressBoxActor
  now: Date
}): Promise<StorylineActionResult> {
  if (!isReporter(args.reporter)) return { ok: false, code: 'bad_reporter' }
  const reporter = args.reporter
  const shape = checkTakeShape(args.input, reporter)
  if (!shape.ok) return shape
  return db.transaction(async (tx) => {
    const player = await readPlayer(tx, args.playerId)
    if (player === null) return { ok: false, code: 'no_player' } as const
    // A "Leave me out" player gets no take: the writers never name them.
    if (player.press_level === 'out') return { ok: false, code: 'out' } as const
    const checked = await checkTakeTexts(tx, args.input)
    if (!checked.ok) return checked
    const dup = await tx.execute<{ id: string | number }>(sql`
      select id from news_reporter_takes where reporter = ${reporter} and player_id = ${args.playerId} limit 1`)
    if (dup[0] !== undefined) return { ok: false, code: 'take_exists' } as const
    const t = checked.input
    const at = args.now.toISOString()
    const rows = await tx.execute<{ id: string | number }>(sql`
      insert into news_reporter_takes
        (reporter, player_id, take, spread, critics, defender, data_angle, active, intensity, created_at, updated_at)
      values (${reporter}, ${args.playerId}, ${t.take}, ${t.spread}, ${JSON.stringify(t.critics)}::jsonb,
        ${t.defender}, ${t.dataAngle}, ${t.active}, ${t.intensity}, ${at}::timestamptz, ${at}::timestamptz)
      returning id`)
    const id = num(rows[0]?.id ?? 0)
    if (id === 0) throw new Error('addTakeWithAudit: no row returned')
    const summary = `added take ${String(id)} of ${REPORTERS[reporter].name}`
    await writeAudit(tx, args.actor, { kind: 'take_add', target: player.name, summary }, args.now)
    return { ok: true, summary } as const
  })
}

/** Changes a take (the same fields the old editor had). The audit line names the fields, never the text. */
export async function editTakeWithAudit(args: {
  id: number
  input: TakeInput
  actor: PressBoxActor
  now: Date
}): Promise<StorylineActionResult> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<RawTake & { player_name: string }>(sql`
      select t.id, t.reporter, t.player_id, t.take, t.spread, t.critics, t.defender, t.data_angle,
        t.intensity, t.active,
        coalesce(nullif(btrim(pp.player_name), ''), p.gamertag) as player_name
      from news_reporter_takes t
      join players p on p.id = t.player_id
      left join player_profiles pp on pp.player_id = t.player_id
      where t.id = ${args.id} for update of t`)
    const r = rows[0]
    if (r === undefined) return { ok: false, code: 'no_take' } as const
    const shape = checkTakeShape(args.input, r.reporter)
    if (!shape.ok) return shape
    const checked = await checkTakeTexts(tx, args.input)
    if (!checked.ok) return checked
    const t = checked.input
    await tx.execute(sql`
      update news_reporter_takes set take = ${t.take}, spread = ${t.spread},
        critics = ${JSON.stringify(t.critics)}::jsonb, defender = ${t.defender},
        data_angle = ${t.dataAngle}, intensity = ${t.intensity}, active = ${t.active},
        updated_at = ${args.now.toISOString()}::timestamptz
      where id = ${args.id}`)
    const changed = changedTakeFields(takeOf(r), t)
    const summary = `changed take ${String(args.id)} of ${REPORTERS[r.reporter].name}: ${
      changed.length === 0 ? 'no change' : changed.join(', ')
    }`
    await writeAudit(
      tx,
      args.actor,
      { kind: 'take_edit', target: r.player_name, summary },
      args.now,
    )
    return { ok: true, summary } as const
  })
}

/** Removes a take for good. The audit line keeps the reporter and the length, not the text. */
export async function removeTakeWithAudit(args: {
  id: number
  actor: PressBoxActor
  now: Date
}): Promise<StorylineActionResult> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute<{
      reporter: NewsReporterId
      player_name: string
      len: string | number
    }>(sql`
      delete from news_reporter_takes t using players p
      left join player_profiles pp on pp.player_id = p.id
      where t.id = ${args.id} and p.id = t.player_id
      returning t.reporter, coalesce(nullif(btrim(pp.player_name), ''), p.gamertag) as player_name,
        char_length(t.take) as len`)
    const r = rows[0]
    if (r === undefined) return { ok: false, code: 'no_take' } as const
    const summary = `removed take ${String(args.id)} of ${REPORTERS[r.reporter].name} (${String(num(r.len))} characters)`
    await writeAudit(
      tx,
      args.actor,
      { kind: 'take_remove', target: r.player_name, summary },
      args.now,
    )
    return { ok: true, summary } as const
  })
}
