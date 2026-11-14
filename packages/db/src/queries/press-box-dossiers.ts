import { sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import { NEWS_RULES_VERSION } from '../news/rules-version.js'
import { REPORTER_IDS } from '../news/reporters.js'
import {
  PRESS_LEVELS,
  newsPressBoxRequests,
  type PressPersonRole,
  type NewsReporterId,
  type PressBoxRequestKind,
  type PressLevel,
} from '../schema/index.js'
import { listRelationshipBoard, type BoardCell } from './press-box.js'
import {
  DISCORD_USER_ID_RE,
  getPlayerDiscordUserId,
  playerDiscordUserIdSql,
} from './discord-ids.js'
import { listPressRoster, listPressRosterSql } from './news-press.js'
import { writeAudit, type PressBoxActor } from './press-box.js'
import { NO_BACKGROUND, getConfirmedBackground, type WriterBackground } from './press-background.js'

// Press Box player dossiers (admin page /admin/press-box/players, migration 0081, task
// press-box-l2). Same shape as press-box.ts: pure rules carry the tests; the async functions run
// a rule and its audit line in one transaction.
//
// The rule that matters most here: answers a player gave that were marked unusable (and anything
// off-limits) are COUNTED, never read. `answerCountsSql` has no answer column at all, and
// `quotesSql` selects the text only for usable and joke answers. `splitAnswers` is a second layer:
// whatever rows it is given, an unusable one never comes out with its text.

const num = (v: string | number): number => Number(v)
const toDate = (v: string | Date): Date => (v instanceof Date ? v : new Date(v))

// ── Who a dossier is about ───────────────────────────────────────────────────

/** A dossier belongs to a member (`playerId`) or to a bench person or the coach (`discordUserId`). */
export type DossierKey = { playerId: number } | { discordUserId: string }

export const isDiscordUserId = (v: string): boolean => DISCORD_USER_ID_RE.test(v)

/** The page key of a person in a URL: "12" for a member, "u<discord id>" for a bench person. */
export function dossierKeyOf(row: {
  playerId: number | null
  discordUserId: string | null
}): string {
  return row.playerId !== null ? String(row.playerId) : `u${row.discordUserId ?? ''}`
}

/** The inverse of `dossierKeyOf`; null for anything else. */
export function parseDossierKey(raw: string): DossierKey | null {
  if (/^[1-9]\d{0,9}$/.test(raw)) return { playerId: Number(raw) }
  const m = /^u(\d{17,20})$/.exec(raw)
  return m === null ? null : { discordUserId: m[1]! }
}

// ── Answers: usable and joke are read, the rest only counted ─────────────────

export type AnswerUsability = 'usable' | 'joke' | 'unusable'

export interface DossierQuote {
  /** `scrum:<id>` or `interview:<id>`. */
  id: string
  source: 'scrum' | 'interview'
  usability: 'usable' | 'joke'
  question: string
  text: string
  reporter: NewsReporterId | null
  at: Date
}

export interface AnswerCounts {
  usable: number
  joke: number
  /** Unusable answers (and off-limits ones are never stored): a count only. */
  unusable: number
}

/** A row as a query returns it: the text may be null for an unusable answer. */
export interface RawAnswerRow {
  id: string
  source: 'scrum' | 'interview'
  usability: AnswerUsability
  question: string | null
  answer: string | null
  reporter: NewsReporterId | null
  at: Date
}

/**
 * Splits answer rows into quotes (usable and joke, with their text) and counts. An unusable row
 * contributes a count and nothing else, even when a caller handed it its text. A usable or joke
 * row without text is not a quote (it counts).
 */
export function splitAnswers(rows: readonly RawAnswerRow[]): {
  quotes: DossierQuote[]
  counts: AnswerCounts
} {
  const counts: AnswerCounts = { usable: 0, joke: 0, unusable: 0 }
  const quotes: DossierQuote[] = []
  for (const r of rows) {
    if (r.usability === 'unusable') {
      counts.unusable++
      continue
    }
    counts[r.usability]++
    if (r.answer === null || r.question === null) continue
    quotes.push({
      id: r.id,
      source: r.source,
      usability: r.usability,
      question: r.question,
      text: r.answer,
      reporter: r.reporter,
      at: r.at,
    })
  }
  quotes.sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : -1))
  return { quotes, counts }
}

const keyCondition = (key: DossierKey, scrumAlias: string, interviewAlias: string): [SQL, SQL] =>
  'playerId' in key
    ? [
        sql`${sql.raw(scrumAlias)}.player_id = ${key.playerId}`,
        sql`${sql.raw(interviewAlias)}.player_id = ${key.playerId}`,
      ]
    : [
        sql`${sql.raw(scrumAlias)}.player_id is null and sp.discord_user_id = ${key.discordUserId}`,
        sql`${sql.raw(interviewAlias)}.player_id is null and iv.discord_user_id = ${key.discordUserId}`,
      ]

/**
 * Quote rows: the TEXT is selected only for usable and joke answers (a case expression, so an
 * unusable answer's text never leaves the database). Test rows are left out. Newest first.
 */
export function quotesSql(key: DossierKey, limit: number): SQL {
  const [scrum, interview] = keyCondition(key, 'a', 'ia')
  return sql`
    select * from (
      select 'scrum:' || a.id as id, 'scrum' as source, a.usability,
        case when a.usability in ('usable', 'joke') then a.question end as question,
        case when a.usability in ('usable', 'joke') then a.answer end as answer,
        a.reporter, a.created_at as at
      from news_scrum_answers a
      join news_scrum_people sp on sp.id = a.person_id
      where not a.is_test and ${scrum}
      union all
      select 'interview:' || ia.id, 'interview', ia.usability,
        case when ia.usability in ('usable', 'joke') then ia.question end,
        case when ia.usability in ('usable', 'joke') then ia.answer end,
        ia.reporter, ia.created_at
      from news_interview_answers ia
      join news_interviews iv on iv.id = ia.interview_id
      where not ia.is_test and ${interview}
    ) x
    where x.usability in ('usable', 'joke')
    order by x.at desc, x.id desc
    limit ${Math.max(1, Math.min(100, limit))}`
}

/** Counts per usability. No answer column is read. */
export function answerCountsSql(key: DossierKey): SQL {
  const [scrum, interview] = keyCondition(key, 'a', 'ia')
  return sql`
    select usability, count(*) as n from (
      select a.usability
      from news_scrum_answers a
      join news_scrum_people sp on sp.id = a.person_id
      where not a.is_test and ${scrum}
      union all
      select ia.usability
      from news_interview_answers ia
      join news_interviews iv on iv.id = ia.interview_id
      where not ia.is_test and ${interview}
    ) x
    group by usability`
}

async function readAnswers(
  key: DossierKey,
  quoteLimit: number,
): Promise<{ quotes: DossierQuote[]; counts: AnswerCounts }> {
  const [quoteRows, countRows] = await Promise.all([
    db.execute<{
      id: string
      source: 'scrum' | 'interview'
      usability: AnswerUsability
      question: string | null
      answer: string | null
      reporter: NewsReporterId | null
      at: Date | string
    }>(quotesSql(key, quoteLimit)),
    db.execute<{ usability: AnswerUsability; n: string | number }>(answerCountsSql(key)),
  ])
  const quotes = splitAnswers(quoteRows.map((r) => ({ ...r, at: toDate(r.at) }))).quotes
  const counts: AnswerCounts = { usable: 0, joke: 0, unusable: 0 }
  for (const r of countRows) counts[r.usability] = num(r.n)
  return { quotes, counts }
}

// ── The index ────────────────────────────────────────────────────────────────

export interface DossierIndexRow {
  /** The URL key (`dossierKeyOf`). */
  key: string
  playerId: number | null
  discordUserId: string | null
  name: string
  gamertag: string | null
  role: PressPersonRole
  /** Null for a bench person or the coach (they have no press level). */
  pressLevel: PressLevel | null
  /** Reporters whose level with this player is off neutral right now. */
  relationships: number
  /** Usable and joke answers. */
  quotes: number
  /** The last scrum or interview the person was in (test ones left out). */
  lastTalkedAt: Date | null
  profileWrittenAt: Date | null
}

interface TalkRow {
  key: string
  quotes: number
  lastAt: Date | null
}

/** Joins the parts of the index. Members first (by name), then bench people and the coach. */
export function mergeIndex(args: {
  roster: readonly { playerId: number; name: string; gamertag: string; pressLevel: PressLevel }[]
  bench: readonly { discordUserId: string; name: string; role: 'bench' | 'coach' }[]
  talk: readonly TalkRow[]
  profiles: ReadonlyMap<string, Date>
  relationships: ReadonlyMap<number, number>
}): DossierIndexRow[] {
  const talk = new Map(args.talk.map((t) => [t.key, t]))
  const members = args.roster.map((r): DossierIndexRow => {
    const key = String(r.playerId)
    // "Leave me out": identity only, so no counts or dates are carried for them.
    const t = r.pressLevel === 'out' ? undefined : talk.get(key)
    const out = r.pressLevel === 'out'
    return {
      key,
      playerId: r.playerId,
      discordUserId: null,
      name: r.name,
      gamertag: r.gamertag,
      role: 'player',
      pressLevel: r.pressLevel,
      relationships: out ? 0 : (args.relationships.get(r.playerId) ?? 0),
      quotes: t?.quotes ?? 0,
      lastTalkedAt: t?.lastAt ?? null,
      profileWrittenAt: out ? null : (args.profiles.get(key) ?? null),
    }
  })
  const bench = args.bench.map((b): DossierIndexRow => {
    const key = `u${b.discordUserId}`
    const t = talk.get(key)
    return {
      key,
      playerId: null,
      discordUserId: b.discordUserId,
      name: b.name,
      gamertag: null,
      role: b.role,
      pressLevel: null,
      relationships: 0,
      quotes: t?.quotes ?? 0,
      lastTalkedAt: t?.lastAt ?? null,
      profileWrittenAt: args.profiles.get(key) ?? null,
    }
  })
  members.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  bench.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  return [...members, ...bench]
}

/** Per person: usable and joke answers and the last scrum or interview. No answer text. */
export function talkSql(): SQL {
  return sql`
    select key, sum(quotes)::int as quotes, max(at) as last_at from (
      select coalesce(sp.player_id::text, 'u' || sp.discord_user_id) as key, 0 as quotes, sp.created_at as at
      from news_scrum_people sp join news_scrums s on s.id = sp.scrum_id
      where not s.is_test
      union all
      select coalesce(a.player_id::text, 'u' || sp.discord_user_id),
        case when a.usability in ('usable', 'joke') then 1 else 0 end, a.created_at
      from news_scrum_answers a join news_scrum_people sp on sp.id = a.person_id
      where not a.is_test
      union all
      select coalesce(iv.player_id::text, 'u' || iv.discord_user_id), 0, iv.created_at
      from news_interviews iv where not iv.is_test
      union all
      select coalesce(ia.player_id::text, 'u' || iv.discord_user_id),
        case when ia.usability in ('usable', 'joke') then 1 else 0 end, ia.created_at
      from news_interview_answers ia join news_interviews iv on iv.id = ia.interview_id
      where not ia.is_test
    ) t
    group by key`
}

/** Bench people and coaches who talked to the press (no players row). */
export function benchPeopleSql(): SQL {
  return sql`
    select distinct on (t.discord_user_id) t.discord_user_id, t.display_name, t.person_role
    from (
      select sp.discord_user_id, sp.display_name, sp.person_role, sp.created_at
      from news_scrum_people sp join news_scrums s on s.id = sp.scrum_id
      where sp.player_id is null and not s.is_test
      union all
      select iv.discord_user_id, iv.display_name, iv.person_role, iv.created_at
      from news_interviews iv where iv.player_id is null and not iv.is_test
    ) t
    order by t.discord_user_id, t.created_at desc`
}

/** Written dates of every stored profile, by URL key. */
export function profileDatesSql(): SQL {
  return sql`
    select coalesce(player_id::text, 'u' || discord_user_id) as key, written_at
    from news_player_profiles`
}

export async function listDossierIndex(now: Date): Promise<DossierIndexRow[]> {
  const [roster, talk, bench, profiles, rels] = await Promise.all([
    listPressRoster(),
    db.execute<{ key: string; quotes: string | number; last_at: Date | string | null }>(talkSql()),
    db.execute<{ discord_user_id: string; display_name: string | null; person_role: string }>(
      benchPeopleSql(),
    ),
    // Before migration 0081 is applied the profiles table does not exist: the page still renders.
    db
      .execute<{ key: string; written_at: Date | string }>(profileDatesSql())
      .catch(() => [] as { key: string; written_at: Date | string }[]),
    listRelationshipBoard(now).catch(() => null),
  ])
  const relationships = new Map<number, number>()
  for (const c of rels?.cells ?? []) {
    if (c.level !== 'neutral')
      relationships.set(c.playerId, (relationships.get(c.playerId) ?? 0) + 1)
  }
  return mergeIndex({
    roster,
    bench: bench.map((b) => ({
      discordUserId: b.discord_user_id,
      name: b.display_name ?? 'Unknown',
      role: b.person_role === 'coach' ? 'coach' : 'bench',
    })),
    talk: talk.map((t) => ({
      key: t.key,
      quotes: num(t.quotes),
      lastAt: t.last_at === null ? null : toDate(t.last_at),
    })),
    profiles: new Map(profiles.map((p) => [p.key, toDate(p.written_at)])),
    relationships,
  })
}

// ── One dossier ──────────────────────────────────────────────────────────────

export interface DossierProfile {
  text: string
  writtenAt: Date
  rulesVersion: string
  costUsd: number
}

export interface DossierTake {
  id: number
  reporter: NewsReporterId
  take: string
  active: boolean
  updatedAt: Date
}

export interface DossierStance {
  reporter: NewsReporterId
  stance: string
  threadKey: string
  at: Date
}

export interface DossierNote {
  id: number
  night: string
  note: string
  status: 'active' | 'refused' | 'cancelled'
  asks: boolean
  at: Date
}

export interface DossierAsk {
  id: number
  night: string
  question: string
  status: 'active' | 'refused' | 'cancelled'
  reporter: NewsReporterId | null
  at: Date
}

export interface DossierInterview {
  id: number
  reporter: NewsReporterId
  status: string
  articleStatus: string
  articleSlug: string | null
  answers: number
  at: Date
}

export interface DossierScrums {
  count: number
  lastNight: string | null
  lastAt: Date | null
  usableAnswers: number
}

export interface DossierIdentity {
  key: string
  playerId: number | null
  discordUserId: string | null
  name: string
  gamertag: string | null
  role: PressPersonRole
  pressLevel: PressLevel | null
  pressLevelSetBy: 'self' | 'admin' | null
  aliases: string[]
  discordLinked: boolean
}

export interface Dossier {
  identity: DossierIdentity
  profile: DossierProfile | null
  quotes: DossierQuote[]
  counts: AnswerCounts
  takes: DossierTake[]
  stances: DossierStance[]
  relationships: BoardCell[]
  notes: DossierNote[]
  asks: DossierAsk[]
  interviews: DossierInterview[]
  scrums: DossierScrums
}

/** A member's identity, or null when there is no such player (or it is an AI goalie). */
export function memberIdentitySql(playerId: number): SQL {
  return sql`
    select p.id, p.gamertag, nullif(btrim(pp.player_name), '') as player_name,
      coalesce(pp.press_level, 'full') as press_level, pp.press_level_set_by as set_by,
      coalesce((select array_agg(a.alias order by a.alias)
        from news_player_aliases a where a.player_id = p.id), '{}'::text[]) as aliases
    from players p
    left join player_profiles pp on pp.player_id = p.id
    where p.id = ${playerId} and p.ai_goalie_side is null`
}

/** The press-level change SQL is shared by the loader's identity read and the action. */
export async function getMemberIdentity(playerId: number): Promise<DossierIdentity | null> {
  const rows = await db.execute<{
    id: string | number
    gamertag: string
    player_name: string | null
    press_level: PressLevel
    set_by: 'self' | 'admin' | null
    aliases: string[] | null
  }>(memberIdentitySql(playerId))
  const r = rows[0]
  if (r === undefined) return null
  const linked = (await getPlayerDiscordUserId(playerId)) !== null
  return {
    key: String(playerId),
    playerId,
    discordUserId: null,
    name: r.player_name ?? r.gamertag,
    gamertag: r.gamertag,
    role: 'player',
    pressLevel: r.press_level,
    pressLevelSetBy: r.set_by,
    aliases: r.aliases ?? [],
    discordLinked: linked,
  }
}

/** A bench person or coach's identity (from their latest scrum or interview row), or null. */
export async function getBenchIdentity(discordUserId: string): Promise<DossierIdentity | null> {
  if (!isDiscordUserId(discordUserId)) return null
  const rows = await db.execute<{ display_name: string | null; person_role: string }>(sql`
    select t.display_name, t.person_role from (
      select sp.display_name, sp.person_role, sp.created_at from news_scrum_people sp
      where sp.player_id is null and sp.discord_user_id = ${discordUserId}
      union all
      select iv.display_name, iv.person_role, iv.created_at from news_interviews iv
      where iv.player_id is null and iv.discord_user_id = ${discordUserId}
    ) t order by t.created_at desc limit 1`)
  const r = rows[0]
  if (r === undefined) return null
  return {
    key: `u${discordUserId}`,
    playerId: null,
    discordUserId,
    name: r.display_name ?? 'Unknown',
    gamertag: null,
    role: r.person_role === 'coach' ? 'coach' : 'bench',
    pressLevel: null,
    pressLevelSetBy: null,
    aliases: [],
    discordLinked: true,
  }
}

export async function getStoredProfile(key: DossierKey): Promise<DossierProfile | null> {
  const rows = await db
    .execute<{
      profile: string
      written_at: Date | string
      rules_version: string
      cost_usd: string | number
    }>(
      'playerId' in key
        ? sql`select profile, written_at, rules_version, cost_usd from news_player_profiles where player_id = ${key.playerId}`
        : sql`select profile, written_at, rules_version, cost_usd from news_player_profiles
            where player_id is null and discord_user_id = ${key.discordUserId}`,
    )
    // Before migration 0081 is applied the table does not exist: no profile.
    .catch(() => [])
  const r = rows[0]
  return r === undefined
    ? null
    : {
        text: r.profile,
        writtenAt: toDate(r.written_at),
        rulesVersion: r.rules_version,
        costUsd: num(r.cost_usd),
      }
}

/** A thread key that names this player: `player-slump:5@2026-06-16`, or one with several ids. */
export function stanceThreadPattern(playerId: number): string {
  return `^[a-z0-9-]+(:[0-9]+)*:${String(playerId)}(:[0-9]+)*(@|$)`
}

export function stancesSql(playerId: number, limit: number): SQL {
  return sql`
    select reporter, stance, thread_key, created_at
    from news_stances
    where thread_key ~ ${stanceThreadPattern(playerId)}
    order by created_at desc, id desc
    limit ${Math.max(1, Math.min(50, limit))}`
}

export async function listDossierTakes(playerId: number): Promise<DossierTake[]> {
  const rows = await db.execute<{
    id: string | number
    reporter: NewsReporterId
    take: string
    active: boolean
    updated_at: Date | string
  }>(sql`
    select id, reporter, take, active, updated_at from news_reporter_takes
    where player_id = ${playerId} order by active desc, id`)
  return rows.map((r) => ({
    id: num(r.id),
    reporter: r.reporter,
    take: r.take,
    active: r.active,
    updatedAt: toDate(r.updated_at),
  }))
}

export async function listDossierStances(playerId: number, limit = 8): Promise<DossierStance[]> {
  const rows = await db.execute<{
    reporter: NewsReporterId
    stance: string
    thread_key: string
    created_at: Date | string
  }>(stancesSql(playerId, limit))
  return rows.map((r) => ({
    reporter: r.reporter,
    stance: r.stance,
    threadKey: r.thread_key,
    at: toDate(r.created_at),
  }))
}

export async function listDossierNotes(
  playerId: number,
  limit = 8,
): Promise<{ notes: DossierNote[]; asks: DossierAsk[] }> {
  const [notes, asks] = await Promise.all([
    db.execute<{
      id: string | number
      night: string
      note: string
      status: DossierNote['status']
      asks_player: boolean
      created_at: Date | string
    }>(sql`
      select id, night, note, status, asks_player, created_at from news_gm_notes
      where player_id = ${playerId} and not is_test order by created_at desc, id desc limit ${limit}`),
    db.execute<{
      id: string | number
      night: string
      question: string
      status: DossierAsk['status']
      reporter: NewsReporterId | null
      created_at: Date | string
    }>(sql`
      select id, night, question, status, reporter, created_at from news_gm_asks
      where player_id = ${playerId} and not is_test order by created_at desc, id desc limit ${limit}`),
  ])
  return {
    notes: notes.map((n) => ({
      id: num(n.id),
      night: String(n.night),
      note: n.note,
      status: n.status,
      asks: n.asks_player,
      at: toDate(n.created_at),
    })),
    asks: asks.map((a) => ({
      id: num(a.id),
      night: String(a.night),
      question: a.question,
      status: a.status,
      reporter: a.reporter,
      at: toDate(a.created_at),
    })),
  }
}

export function dossierInterviewsSql(key: DossierKey, limit: number): SQL {
  const who =
    'playerId' in key
      ? sql`iv.player_id = ${key.playerId}`
      : sql`iv.player_id is null and iv.discord_user_id = ${key.discordUserId}`
  return sql`
    select iv.id, iv.reporter, iv.status, iv.article_status, ni.slug,
      (select count(*) from news_interview_answers ia where ia.interview_id = iv.id) as answers,
      iv.created_at
    from news_interviews iv
    left join news_items ni on ni.id = iv.article_item_id and ni.deleted_at is null
    where not iv.is_test and ${who}
    order by iv.created_at desc, iv.id desc
    limit ${Math.max(1, Math.min(50, limit))}`
}

export async function listDossierInterviews(
  key: DossierKey,
  limit = 8,
): Promise<DossierInterview[]> {
  const rows = await db.execute<{
    id: string | number
    reporter: NewsReporterId
    status: string
    article_status: string
    slug: string | null
    answers: string | number
    created_at: Date | string
  }>(dossierInterviewsSql(key, limit))
  return rows.map((r) => ({
    id: num(r.id),
    reporter: r.reporter,
    status: r.status,
    articleStatus: r.article_status,
    articleSlug: r.slug,
    answers: num(r.answers),
    at: toDate(r.created_at),
  }))
}

export async function getDossierScrums(key: DossierKey): Promise<DossierScrums> {
  const who =
    'playerId' in key
      ? sql`sp.player_id = ${key.playerId}`
      : sql`sp.player_id is null and sp.discord_user_id = ${key.discordUserId}`
  const rows = await db.execute<{
    n: string | number
    last_night: string | null
    last_at: Date | string | null
  }>(sql`
    select count(*) as n, to_char(max(s.night), 'YYYY-MM-DD') as last_night, max(sp.created_at) as last_at
    from news_scrum_people sp join news_scrums s on s.id = sp.scrum_id
    where not s.is_test and ${who}`)
  const r = rows[0]
  return {
    count: r === undefined ? 0 : num(r.n),
    lastNight: r?.last_night ?? null,
    lastAt: r?.last_at == null ? null : toDate(r.last_at),
    usableAnswers: 0,
  }
}

/**
 * Everything one dossier shows. A "Leave me out" member gets identity only: nothing else is read
 * (no quotes, takes, notes, relationships, interviews or profile).
 */
export async function getDossier(key: DossierKey, now: Date): Promise<Dossier | null> {
  const identity =
    'playerId' in key
      ? await getMemberIdentity(key.playerId)
      : await getBenchIdentity(key.discordUserId)
  if (identity === null) return null
  if (identity.pressLevel === 'out') return outDossier(identity)
  const memberId = 'playerId' in key ? key.playerId : null
  const [profile, answers, takes, stances, board, gm, interviews, scrums] = await Promise.all([
    getStoredProfile(key),
    readAnswers(key, 30),
    memberId === null ? Promise.resolve([]) : listDossierTakes(memberId),
    memberId === null ? Promise.resolve([]) : listDossierStances(memberId),
    memberId === null ? Promise.resolve(null) : listRelationshipBoard(now).catch(() => null),
    memberId === null
      ? Promise.resolve({ notes: [] as DossierNote[], asks: [] as DossierAsk[] })
      : listDossierNotes(memberId),
    listDossierInterviews(key),
    getDossierScrums(key),
  ])
  return {
    identity,
    profile,
    quotes: answers.quotes,
    counts: answers.counts,
    takes,
    stances,
    relationships: (board?.cells ?? []).filter((c) => c.playerId === memberId),
    notes: gm.notes,
    asks: gm.asks,
    interviews,
    scrums: { ...scrums, usableAnswers: answers.counts.usable + answers.counts.joke },
  }
}

/** The dossier of a "Leave me out" member: identity only, everything else empty. */
export function outDossier(identity: DossierIdentity): Dossier {
  return {
    identity,
    profile: null,
    quotes: [],
    counts: { usable: 0, joke: 0, unusable: 0 },
    takes: [],
    stances: [],
    relationships: [],
    notes: [],
    asks: [],
    interviews: [],
    scrums: { count: 0, lastNight: null, lastAt: null, usableAnswers: 0 },
  }
}

// ── Actions: rules (pure) ────────────────────────────────────────────────────

export const NICKNAME_MIN = 2
export const NICKNAME_MAX = 24
export const GM_NOTE_MAX = 500
export const INTERVIEW_TOPIC_MAX = 300

/** Words that are never a nickname (the Discord note flow refuses the same). */
const STOP_WORDS = new Set([
  'him',
  'he',
  'his',
  'her',
  'she',
  'they',
  'them',
  'the',
  'our',
  'it',
  'guy',
])

/** A nickname as stored: trimmed, spaces collapsed, lowercase. Null when it is not allowed. */
export function normalizeNickname(raw: string): string | null {
  const v = raw.replace(/\s+/g, ' ').trim().toLowerCase()
  if (v.length < NICKNAME_MIN || v.length > NICKNAME_MAX) return null
  if (!/^[\p{L}\p{N}][\p{L}\p{N} '.-]*$/u.test(v)) return null
  if (STOP_WORDS.has(v)) return null
  return v
}

/** Does `note` name any of these keys as a whole word? Keys under 3 characters are not matched. */
export function namesAny(note: string, keys: readonly string[]): boolean {
  const hay = note.toLowerCase()
  return keys.some((k) => {
    const key = k.trim().toLowerCase()
    if (key.length < 3) return false
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, 'u').test(hay)
  })
}

export const DOSSIER_ERROR_CODES = [
  'no_player',
  'out',
  'note_easy',
  'bad_level',
  'bad_nickname',
  'nick_taken',
  'nick_exists',
  'nick_missing',
  'bad_note',
  'note_names_out',
  'request_open',
  'not_linked',
  'bad_reporter',
  'bad_topic',
] as const
export type DossierErrorCode = (typeof DOSSIER_ERROR_CODES)[number]

export type DossierActionResult =
  | { ok: true; summary: string }
  | { ok: false; code: DossierErrorCode }

// ── Actions (database) ───────────────────────────────────────────────────────

type PlayerRow = { name: string; press_level: PressLevel; set_by: string | null }

async function readPlayer(
  tx: { execute: typeof db.execute },
  playerId: number,
): Promise<PlayerRow | null> {
  const rows = await tx.execute<PlayerRow>(sql`
    select coalesce(nullif(btrim(pp.player_name), ''), p.gamertag) as name,
      coalesce(pp.press_level, 'full') as press_level, pp.press_level_set_by as set_by
    from players p left join player_profiles pp on pp.player_id = p.id
    where p.id = ${playerId} and p.ai_goalie_side is null
    for update of p`)
  return rows[0] ?? null
}

const LEVEL_WORD: Readonly<Record<PressLevel, string>> = {
  full: 'Full',
  easy: 'Go easy',
  out: 'Leave me out',
}

/** Sets a member's press level on their behalf ("admin") and writes the audit line. */
export async function setPressLevelWithAudit(args: {
  playerId: number
  level: PressLevel
  actor: PressBoxActor
  now: Date
}): Promise<DossierActionResult> {
  if (!PRESS_LEVELS.includes(args.level)) return { ok: false, code: 'bad_level' }
  return db.transaction(async (tx) => {
    const player = await readPlayer(tx, args.playerId)
    if (player === null) return { ok: false, code: 'no_player' } as const
    await tx.execute(sql`
      insert into player_profiles (player_id, press_level, press_level_set_by, updated_at)
      values (${args.playerId}, ${args.level}, 'admin', ${args.now.toISOString()}::timestamptz)
      on conflict (player_id) do update
        set press_level = excluded.press_level, press_level_set_by = 'admin',
          updated_at = excluded.updated_at`)
    const summary = `${LEVEL_WORD[player.press_level]} -> ${LEVEL_WORD[args.level]} (set for the player by the admin${
      player.set_by === 'self' ? '; the player had set it' : ''
    })`
    await writeAudit(
      tx,
      args.actor,
      { kind: 'press_level', target: player.name, summary },
      args.now,
    )
    return { ok: true, summary } as const
  })
}

export async function addNicknameWithAudit(args: {
  playerId: number
  nickname: string
  actor: PressBoxActor
  now: Date
}): Promise<DossierActionResult> {
  const alias = normalizeNickname(args.nickname)
  if (alias === null) return { ok: false, code: 'bad_nickname' }
  return db.transaction(async (tx) => {
    const player = await readPlayer(tx, args.playerId)
    if (player === null) return { ok: false, code: 'no_player' } as const
    const owner = await tx.execute<{ player_id: string | number }>(
      sql`select player_id from news_player_aliases where alias = ${alias}`,
    )
    if (owner[0] !== undefined) {
      return {
        ok: false,
        code: num(owner[0].player_id) === args.playerId ? 'nick_exists' : 'nick_taken',
      } as const
    }
    // Not another player's gamertag or profile name either (the writers would mix them up).
    const clash = await tx.execute<{ id: string | number }>(sql`
      select p.id from players p left join player_profiles pp on pp.player_id = p.id
      where p.id <> ${args.playerId}
        and (lower(p.gamertag) = ${alias} or lower(btrim(coalesce(pp.player_name, ''))) = ${alias})
      limit 1`)
    if (clash[0] !== undefined) return { ok: false, code: 'nick_taken' } as const
    await tx.execute(
      sql`insert into news_player_aliases (alias, player_id) values (${alias}, ${args.playerId})`,
    )
    const summary = `added the nickname "${alias}"`
    await writeAudit(
      tx,
      args.actor,
      { kind: 'nickname_add', target: player.name, summary },
      args.now,
    )
    return { ok: true, summary } as const
  })
}

export async function removeNicknameWithAudit(args: {
  playerId: number
  nickname: string
  actor: PressBoxActor
  now: Date
}): Promise<DossierActionResult> {
  const alias = args.nickname.trim().toLowerCase()
  if (alias === '' || alias.length > 60) return { ok: false, code: 'bad_nickname' }
  return db.transaction(async (tx) => {
    const player = await readPlayer(tx, args.playerId)
    if (player === null) return { ok: false, code: 'no_player' } as const
    const gone = await tx.execute<{ alias: string }>(sql`
      delete from news_player_aliases where alias = ${alias} and player_id = ${args.playerId}
      returning alias`)
    if (gone[0] === undefined) return { ok: false, code: 'nick_missing' } as const
    const summary = `removed the nickname "${alias}"`
    await writeAudit(
      tx,
      args.actor,
      { kind: 'nickname_remove', target: player.name, summary },
      args.now,
    )
    return { ok: true, summary } as const
  })
}

/**
 * Adds a GM note about a member for tonight's night (the same table `/gm note` writes). The note
 * is not analysed by a model here, so it is refused when it cannot be checked: for a "Leave me
 * out" player, for a "Go easy" player (Discord checks those notes for criticism), or when its text
 * names a "Leave me out" player. The text is never put in the audit line (only its id).
 */
export async function addGmNoteWithAudit(args: {
  playerId: number
  note: string
  night: string
  actor: PressBoxActor
  now: Date
}): Promise<DossierActionResult> {
  const note = args.note.replace(/\s+/g, ' ').trim()
  if (note === '' || note.length > GM_NOTE_MAX) return { ok: false, code: 'bad_note' }
  return db.transaction(async (tx) => {
    const player = await readPlayer(tx, args.playerId)
    if (player === null) return { ok: false, code: 'no_player' } as const
    if (player.press_level === 'out') return { ok: false, code: 'out' } as const
    if (player.press_level === 'easy') return { ok: false, code: 'note_easy' } as const
    const roster = await tx.execute<{
      name: string
      gamertag: string
      aliases: string[] | null
    }>(sql`
      select * from (${listPressRosterSql()}) r where r.press_level = 'out'`)
    const keys = roster.flatMap((r) => [r.name, r.gamertag, ...(r.aliases ?? [])])
    if (namesAny(note, keys)) return { ok: false, code: 'note_names_out' } as const
    const rows = await tx.execute<{ id: string | number }>(sql`
      insert into news_gm_notes (match_id, night, player_id, note, asks_player, critical, status, is_test)
      values (null, ${args.night}::date, ${args.playerId}, ${note}, false, false, 'active', false)
      returning id`)
    const id = rows[0]?.id
    if (id === undefined) throw new Error('addGmNoteWithAudit: no row returned')
    const summary = `added GM note ${String(num(id))} for night ${args.night}`
    await writeAudit(tx, args.actor, { kind: 'gm_note', target: player.name, summary }, args.now)
    return { ok: true, summary } as const
  })
}

// ── Requests for the press service: profile and interview ────────────────────

/** True when a request of this kind for this person is waiting or running. */
export async function hasOpenRequestFor(
  tx: { execute: typeof db.execute },
  kind: PressBoxRequestKind,
  key: DossierKey,
): Promise<boolean> {
  const rows = await tx.execute<{ n: string | number }>(
    'playerId' in key
      ? sql`select count(*) as n from news_press_box_requests
          where kind = ${kind} and status in ('pending', 'running') and target_player_id = ${key.playerId}`
      : sql`select count(*) as n from news_press_box_requests
          where kind = ${kind} and status in ('pending', 'running')
            and target_discord_user_id = ${key.discordUserId}`,
  )
  return num(rows[0]?.n ?? 0) > 0
}

/**
 * Asks the press service to write or refresh a profile. Refused for a "Leave me out" member (no
 * profile is ever written for them) and when a profile request for the person already waits.
 */
export async function queueProfileRequest(args: {
  key: DossierKey
  actor: PressBoxActor
  now: Date
}): Promise<DossierActionResult & { requestId?: number }> {
  return queueRequest({ ...args, kind: 'profile', reporter: null, topic: null })
}

/** Asks the press service to offer the person an interview (the `/gm interview` offer). */
export async function queueInterviewRequest(args: {
  key: DossierKey
  reporter: NewsReporterId | null
  topic: string | null
  actor: PressBoxActor
  now: Date
}): Promise<DossierActionResult & { requestId?: number }> {
  if (args.reporter !== null && !REPORTER_IDS.includes(args.reporter)) {
    return { ok: false, code: 'bad_reporter' }
  }
  const topic = args.topic === null ? null : args.topic.replace(/\s+/g, ' ').trim()
  if (topic !== null && topic.length > INTERVIEW_TOPIC_MAX) return { ok: false, code: 'bad_topic' }
  return queueRequest({ ...args, kind: 'interview', topic: topic === '' ? null : topic })
}

async function queueRequest(args: {
  key: DossierKey
  kind: 'profile' | 'interview'
  reporter: NewsReporterId | null
  topic: string | null
  actor: PressBoxActor
  now: Date
}): Promise<DossierActionResult & { requestId?: number }> {
  return db.transaction(async (tx) => {
    let name: string
    if ('playerId' in args.key) {
      const player = await readPlayer(tx, args.key.playerId)
      if (player === null) return { ok: false, code: 'no_player' } as const
      if (player.press_level === 'out') return { ok: false, code: 'out' } as const
      name = player.name
      if (args.kind === 'interview') {
        const linked = await tx.execute<{ discord_user_id: string | null }>(
          playerDiscordUserIdSql(args.key.playerId),
        )
        const id = linked[0]?.discord_user_id ?? null
        if (id === null || !DISCORD_USER_ID_RE.test(id))
          return { ok: false, code: 'not_linked' } as const
      }
    } else {
      const known = await tx.execute<{ display_name: string | null }>(sql`
        select t.display_name from (
          select sp.display_name from news_scrum_people sp
          where sp.player_id is null and sp.discord_user_id = ${args.key.discordUserId}
          union all
          select iv.display_name from news_interviews iv
          where iv.player_id is null and iv.discord_user_id = ${args.key.discordUserId}
        ) t limit 1`)
      if (known[0] === undefined) return { ok: false, code: 'no_player' } as const
      name = known[0].display_name ?? 'a bench person'
    }
    if (await hasOpenRequestFor(tx, args.kind, args.key)) {
      return { ok: false, code: 'request_open' } as const
    }
    const rows = await tx
      .insert(newsPressBoxRequests)
      .values({
        kind: args.kind,
        requestedBy: args.actor.name,
        requestedAt: args.now,
        targetPlayerId: 'playerId' in args.key ? args.key.playerId : null,
        targetDiscordUserId: 'discordUserId' in args.key ? args.key.discordUserId : null,
        reporter: args.reporter,
        topic: args.topic,
      })
      .returning({ id: newsPressBoxRequests.id })
    const id = rows[0]?.id
    if (id === undefined) throw new Error('queueRequest: no row returned')
    const summary =
      args.kind === 'profile'
        ? `asked the press service to write a profile (request ${String(id)})`
        : `asked the press service to offer an interview (request ${String(id)})`
    await writeAudit(
      tx,
      args.actor,
      {
        kind: args.kind === 'profile' ? 'profile_request' : 'interview_request',
        target: name,
        summary,
      },
      args.now,
    )
    return { ok: true, summary, requestId: id } as const
  })
}

/** The most recent requests for one person (the page shows their state). */
export async function listPersonRequests(
  key: DossierKey,
  limit = 4,
): Promise<
  { id: number; kind: PressBoxRequestKind; status: string; at: Date; result: string | null }[]
> {
  const rows = await db
    .execute<{
      id: string | number
      kind: PressBoxRequestKind
      status: string
      requested_at: Date | string
      result: string | null
    }>(
      'playerId' in key
        ? sql`select id, kind, status, requested_at, result from news_press_box_requests
            where kind in ('profile', 'interview') and target_player_id = ${key.playerId}
            order by id desc limit ${limit}`
        : sql`select id, kind, status, requested_at, result from news_press_box_requests
            where kind in ('profile', 'interview') and target_discord_user_id = ${key.discordUserId}
            order by id desc limit ${limit}`,
    )
    .catch(() => [])
  return rows.map((r) => ({
    id: num(r.id),
    kind: r.kind,
    status: r.status,
    at: toDate(r.requested_at),
    result: r.result,
  }))
}

// ── For the press service: profile material and storing the profile ──────────

/** What the profile writer may read about one person. No unusable text; nothing for "Leave me out". */
export interface ProfileMaterial {
  name: string
  role: PressPersonRole
  /** Null for a bench person or the coach. */
  pressLevel: PressLevel | null
  playerId: number | null
  discordUserId: string | null
  /** Usable and joke answers, newest first. */
  quotes: DossierQuote[]
  takes: DossierTake[]
  /** Confirmed background facts only (task background-b1); nothing for "Leave me out". */
  background: WriterBackground
}

export async function getProfileMaterial(key: DossierKey): Promise<ProfileMaterial | null> {
  const identity =
    'playerId' in key
      ? await getMemberIdentity(key.playerId)
      : await getBenchIdentity(key.discordUserId)
  if (identity === null) return null
  const base = {
    name: identity.name,
    role: identity.role,
    pressLevel: identity.pressLevel,
    playerId: identity.playerId,
    discordUserId: identity.discordUserId,
  }
  // "Leave me out": nothing is read at all.
  if (identity.pressLevel === 'out') {
    return { ...base, quotes: [], takes: [], background: NO_BACKGROUND }
  }
  const [answers, takes, background] = await Promise.all([
    readAnswers(key, 12),
    identity.playerId === null ? Promise.resolve([]) : listDossierTakes(identity.playerId),
    getConfirmedBackground(key, identity.pressLevel),
  ])
  return { ...base, quotes: answers.quotes, takes: takes.filter((t) => t.active), background }
}

export interface NewProfile {
  key: DossierKey
  displayName: string
  text: string
  model: string
  costUsd: number
  at: Date
}

/** Stores (or replaces) the person's profile. One row per person. */
export async function savePlayerProfile(p: NewProfile): Promise<void> {
  const at = p.at.toISOString()
  if ('playerId' in p.key) {
    await db.execute(sql`
      insert into news_player_profiles (player_id, profile, written_at, rules_version, model, cost_usd)
      values (${p.key.playerId}, ${p.text}, ${at}::timestamptz, ${NEWS_RULES_VERSION}, ${p.model}, ${p.costUsd.toFixed(6)})
      on conflict (player_id) where player_id is not null do update set
        profile = excluded.profile, written_at = excluded.written_at,
        rules_version = excluded.rules_version, model = excluded.model, cost_usd = excluded.cost_usd`)
  } else {
    await db.execute(sql`
      insert into news_player_profiles (discord_user_id, display_name, profile, written_at, rules_version, model, cost_usd)
      values (${p.key.discordUserId}, ${p.displayName}, ${p.text}, ${at}::timestamptz, ${NEWS_RULES_VERSION}, ${p.model}, ${p.costUsd.toFixed(6)})
      on conflict (discord_user_id) where player_id is null do update set
        profile = excluded.profile, display_name = excluded.display_name, written_at = excluded.written_at,
        rules_version = excluded.rules_version, model = excluded.model, cost_usd = excluded.cost_usd`)
  }
}
