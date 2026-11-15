import { sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import {
  BIO_MAX,
  CATCHPHRASES_MAX,
  CATCHPHRASES_MIN,
  CATCHPHRASE_MAX_CHARS,
  VOICE_NOTES_MAX,
  defaultCatchphrases,
  defaultVoiceNotes,
  isDefaultOverride,
  type ReporterOverride,
} from '../news/character.js'
import type { Disposition } from '../news/relationships.js'
import { REPORTERS, REPORTER_IDS, type ReporterId } from '../news/reporters.js'
import { listPressRosterSql } from './news-press.js'
import { namesAny } from './press-box-dossiers.js'
import { writeAudit, listRelationshipBoard, type PressBoxActor, type Tx } from './press-box.js'
import {
  interviewAnswerIsAboutTeammateSql,
  scrumAnswerIsAboutTeammateSql,
} from './press-background-sql.js'
import { crudeHit } from './press-text-check.js'
import {
  listReporterOverrides,
  overrideFromRow,
  refreshReporterOverrides,
  reporterOverridesSql,
} from './reporter-overrides.js'

export * from './reporter-overrides.js'

// Press Box reporters (the admin page /admin/press-box/reporters, migration 0087, task
// press-box-l4). Pure rules first (they carry the tests); the async functions run a rule and its
// audit line in ONE transaction, so a change and its log line are written together or not at all.
//
// What an edit is checked for: the desk's own crude and slur lists (`crudeHit`), a "Leave me out"
// player's name, a line that tries to switch the rules off, the shapes and limits below. No model
// reads the text on save. The locked safety rules are not an input at all: they live in code
// (`LOCKED_RULES`) and every writer prompt adds them after the character text.

const num = (v: string | number): number => Number(v)

// ── Pure rules ───────────────────────────────────────────────────────────────

export type ReporterErrorCode =
  | 'bad_reporter'
  | 'bad_bio'
  | 'bad_voice'
  | 'bad_catchphrases'
  | 'bad_disposition'
  | 'crude'
  | 'names_out'
  | 'rules_text'
  | 'no_change'
  | 'request_open'

export type ReporterActionResult =
  | { ok: true; summary: string; version: number }
  | { ok: false; code: ReporterErrorCode }

/** What the editor form sends: the four fields as typed. `disposition`: '-2'..'2' or 'default'. */
export interface ReporterEditInput {
  bio: string
  voiceNotes: string
  /** One catchphrase per line. */
  catchphrases: string
  disposition: string
}

/** The four fields as stored: null = the code default. */
export interface ReporterFields {
  bio: string | null
  voiceNotes: string | null
  catchphrases: readonly string[] | null
  disposition: Disposition | null
}

/** One paragraph per blank-line block; spaces inside a paragraph collapsed. */
export function normalizeParagraphs(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p !== '')
    .join('\n\n')
}

const collapseLine = (raw: string): string => raw.replace(/\s+/g, ' ').trim()

/**
 * Text that tries to switch the rules off or to talk to the model instead of describing a
 * character. This is a coarse code check (a person can word it another way); the real guard is that
 * the locked rules come last in every prompt. The default texts in code never match it (a test).
 */
export const RULES_TEXT =
  /\b(?:ignore|disregard|forget|override|bypass|disable|lift|remove|drop|skip|turn off|switch off)\b[^.\n]{0,50}\b(?:rules?|instructions?|restrictions?|filters?|safety|guidelines?|limits?|checks?|hard lines?)\b|\bno (?:rules|limits|filter|filters)\b|locked rules|system prompt|you are now|jailbreak|\bpretend\b|\b(?:allowed|free|permitted|OK) to (?:swear|curse|insult|quote)\b/i

const CATCHPHRASE_RE = /^[\p{L}][\p{L}' &-]{0,39}$/u

const DISPOSITIONS: readonly Disposition[] = [-2, -1, 0, 1, 2]

/** The most the editor accepts in one field, for the form's counters. */
export const REPORTER_LIMITS = {
  bio: BIO_MAX,
  voice: VOICE_NOTES_MAX,
  catchphrasesMin: CATCHPHRASES_MIN,
  catchphrasesMax: CATCHPHRASES_MAX,
  catchphraseChars: CATCHPHRASE_MAX_CHARS,
} as const

type Checked<T> = { ok: true; value: T } | { ok: false; code: ReporterErrorCode }

function checkFreeText(
  text: string,
  bad: ReporterErrorCode,
  max: number,
  outKeys: readonly string[],
  noDigits: boolean,
): { ok: true } | { ok: false; code: ReporterErrorCode } {
  if (text === '' || Array.from(text).length > max) return { ok: false, code: bad }
  if (crudeHit(text)) return { ok: false, code: 'crude' }
  if (RULES_TEXT.test(text)) return { ok: false, code: 'rules_text' }
  if (noDigits && /\d/.test(text)) return { ok: false, code: bad }
  if (namesAny(text, outKeys)) return { ok: false, code: 'names_out' }
  return { ok: true }
}

/**
 * Checks the four typed fields for one reporter and turns each into what is stored. A field equal to
 * the code default (after tidying spaces) is stored as null, so it keeps following the code.
 */
export function checkReporterEdit(
  reporter: string,
  input: ReporterEditInput,
  outKeys: readonly string[],
): Checked<{ reporter: ReporterId; fields: ReporterFields }> {
  const id = REPORTER_IDS.find((r) => r === reporter)
  if (id === undefined) return { ok: false, code: 'bad_reporter' }
  const base = REPORTERS[id]

  const bioText = collapseLine(input.bio)
  const bioCheck = checkFreeText(bioText, 'bad_bio', BIO_MAX, outKeys, true)
  if (!bioCheck.ok) return bioCheck
  const bio = bioText === collapseLine(base.bio) ? null : bioText

  const voiceText = normalizeParagraphs(input.voiceNotes)
  const voiceCheck = checkFreeText(voiceText, 'bad_voice', VOICE_NOTES_MAX, outKeys, false)
  if (!voiceCheck.ok) return voiceCheck
  const voiceNotes = voiceText === normalizeParagraphs(defaultVoiceNotes(id)) ? null : voiceText

  const lines = input.catchphrases
    .split(/\r?\n/)
    .map(collapseLine)
    .filter((l) => l !== '')
  const seen = new Set<string>()
  const list: string[] = []
  for (const line of lines) {
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    list.push(line)
  }
  if (list.length < CATCHPHRASES_MIN || list.length > CATCHPHRASES_MAX) {
    return { ok: false, code: 'bad_catchphrases' }
  }
  for (const phrase of list) {
    if (Array.from(phrase).length > CATCHPHRASE_MAX_CHARS || !CATCHPHRASE_RE.test(phrase)) {
      return { ok: false, code: 'bad_catchphrases' }
    }
    if (crudeHit(phrase)) return { ok: false, code: 'crude' }
    if (RULES_TEXT.test(phrase)) return { ok: false, code: 'rules_text' }
    if (namesAny(phrase, outKeys)) return { ok: false, code: 'names_out' }
  }
  const def = defaultCatchphrases(id)
  const catchphrases =
    list.length === def.length && list.every((p, i) => p === def[i]) ? null : list

  let disposition: Disposition | null
  if (input.disposition === 'default') disposition = null
  else {
    const d = DISPOSITIONS.find((x) => String(x) === input.disposition)
    if (d === undefined) return { ok: false, code: 'bad_disposition' }
    disposition = d === base.disposition ? null : d
  }

  return {
    ok: true,
    value: { reporter: id, fields: { bio, voiceNotes, catchphrases, disposition } },
  }
}

const sameList = (a: readonly string[] | null, b: readonly string[] | null): boolean =>
  a === null || b === null ? a === b : a.length === b.length && a.every((x, i) => x === b[i])

/** The field names that differ between the stored override (or none) and the new fields. */
export function changedReporterFields(
  before: ReporterFields | null,
  after: ReporterFields,
): string[] {
  const b: ReporterFields = before ?? {
    bio: null,
    voiceNotes: null,
    catchphrases: null,
    disposition: null,
  }
  const out: string[] = []
  if (b.bio !== after.bio) out.push('bio')
  if (b.voiceNotes !== after.voiceNotes) out.push('voice notes')
  if (!sameList(b.catchphrases, after.catchphrases)) out.push('catchphrases')
  if (b.disposition !== after.disposition) out.push('disposition')
  return out
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

const arraySql = (list: readonly string[] | null): SQL =>
  list === null
    ? sql`null::text[]`
    : sql`array[${sql.join(
        list.map((v) => sql`${v}`),
        sql`, `,
      )}]::text[]`

async function lockOverride(tx: Tx, id: ReporterId): Promise<ReporterOverride | null> {
  const rows = await tx.execute<Parameters<typeof overrideFromRow>[0]>(
    sql`${reporterOverridesSql()} where reporter = ${id} for update`,
  )
  return rows[0] === undefined ? null : overrideFromRow(rows[0])
}

async function writeOverride(
  tx: Tx,
  id: ReporterId,
  f: ReporterFields,
  version: number,
  actor: PressBoxActor,
  now: Date,
): Promise<void> {
  const at = now.toISOString()
  await tx.execute(sql`
    insert into news_reporter_overrides
      (reporter, bio, voice_notes, catchphrases, disposition, character_version, updated_by, updated_at)
    values (${id}, ${f.bio}, ${f.voiceNotes}, ${arraySql(f.catchphrases)}, ${f.disposition},
      ${version}, ${actor.name}, ${at}::timestamptz)
    on conflict (reporter) do update set
      bio = excluded.bio, voice_notes = excluded.voice_notes, catchphrases = excluded.catchphrases,
      disposition = excluded.disposition, character_version = excluded.character_version,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
}

/**
 * Saves the four fields of one reporter as overrides and bumps the character version, in one
 * transaction with the audit line (field names only, never the text). A save that changes nothing
 * writes nothing and does not bump the version.
 */
export async function saveReporterCharacterWithAudit(args: {
  reporter: string
  input: ReporterEditInput
  actor: PressBoxActor
  now: Date
}): Promise<ReporterActionResult> {
  return db.transaction(async (tx) => {
    const checked = checkReporterEdit(args.reporter, args.input, await outKeysOf(tx))
    if (!checked.ok) return { ok: false, code: checked.code } as const
    const { reporter, fields } = checked.value
    const before = await lockOverride(tx, reporter)
    const changed = changedReporterFields(before, fields)
    if (changed.length === 0) return { ok: false, code: 'no_change' } as const
    const version = (before?.characterVersion ?? 0) + 1
    await writeOverride(tx, reporter, fields, version, args.actor, args.now)
    const summary = `changed ${changed.join(', ')}; character version ${String(version)}`
    await writeAudit(
      tx,
      args.actor,
      { kind: 'reporter_edit', target: REPORTERS[reporter].name, summary },
      args.now,
    )
    return { ok: true, summary, version } as const
  })
}

/** Resets a reporter to the code defaults (all four fields null) and still adds 1 to the version. */
export async function resetReporterCharacterWithAudit(args: {
  reporter: string
  actor: PressBoxActor
  now: Date
}): Promise<ReporterActionResult> {
  const id = REPORTER_IDS.find((r) => r === args.reporter)
  if (id === undefined) return { ok: false, code: 'bad_reporter' }
  return db.transaction(async (tx) => {
    const before = await lockOverride(tx, id)
    if (before === null || isDefaultOverride(before))
      return { ok: false, code: 'no_change' } as const
    const version = before.characterVersion + 1
    await writeOverride(
      tx,
      id,
      { bio: null, voiceNotes: null, catchphrases: null, disposition: null },
      version,
      args.actor,
      args.now,
    )
    const summary = `reset to the default character; character version ${String(version)}`
    await writeAudit(
      tx,
      args.actor,
      { kind: 'reporter_reset', target: REPORTERS[id].name, summary },
      args.now,
    )
    return { ok: true, summary, version } as const
  })
}

/**
 * Asks the press service for ONE sample line from this reporter (the "Preview a sample line"
 * button): one request row and its audit line, in one transaction. One preview waits at a time.
 * The page cannot call a model (no key here): the press service does it on its next pass, with the
 * desk's writer, and counts the cost in the monthly spend.
 */
export async function queueReporterPreviewWithAudit(args: {
  reporter: string
  actor: PressBoxActor
  now: Date
}): Promise<ReporterActionResult> {
  const id = REPORTER_IDS.find((r) => r === args.reporter)
  if (id === undefined) return { ok: false, code: 'bad_reporter' }
  return db.transaction(async (tx) => {
    const open = await tx.execute<{ n: string | number }>(sql`
      select count(*) as n from news_press_box_requests
      where kind = 'preview' and status in ('pending', 'running')`)
    if (num(open[0]?.n ?? 0) > 0) return { ok: false, code: 'request_open' } as const
    const rows = await tx.execute<{ id: string | number }>(sql`
      insert into news_press_box_requests (kind, requested_by, requested_at, reporter)
      values ('preview', ${args.actor.name}, ${args.now.toISOString()}::timestamptz, ${id})
      returning id`)
    const requestId = num(rows[0]?.id ?? 0)
    if (requestId === 0) throw new Error('queueReporterPreviewWithAudit: no row returned')
    const summary = `requested one sample line (request ${String(requestId)})`
    await writeAudit(
      tx,
      args.actor,
      { kind: 'reporter_preview', target: REPORTERS[id].name, summary },
      args.now,
    )
    return { ok: true, summary, version: 0 } as const
  })
}

// ── Reads for the page ───────────────────────────────────────────────────────

export interface ReporterRecord {
  /** Posts and articles this calendar month (America/Edmonton). Test, deleted and correction items are left out. */
  postsMonth: number
  articlesMonth: number
  /** Scrum answers to this reporter's questions, and interview answers (counts only). */
  scrumAnswers: number
  interviewAnswers: number
  /** Usable and joke answers the reporter drew out (a count; the text is never read here). */
  quotesDrawn: number
  /** Pairs now: on the feud side (feud or open war), on the favour side (fan or glazing), and all stored pairs. */
  feuds: number
  fans: number
  pairs: number
  /** Items by the character version that wrote them (null = written before versions were recorded). */
  byVersion: { version: number | null; items: number }[]
}

export const EMPTY_RECORD: ReporterRecord = {
  postsMonth: 0,
  articlesMonth: 0,
  scrumAnswers: 0,
  interviewAnswers: 0,
  quotesDrawn: 0,
  feuds: 0,
  fans: 0,
  pairs: 0,
  byVersion: [],
}

const monthStartSql = (now: Date): SQL =>
  sql`(date_trunc('month', ${now.toISOString()}::timestamptz at time zone 'America/Edmonton') at time zone 'America/Edmonton')`

/** Items per reporter this month. No text column is read. */
export function itemCountsSql(now: Date): SQL {
  return sql`
    select i.reporter, i.kind, count(*) as n
    from news_items i
    where i.is_test = false and i.deleted_at is null and i.is_correction = false
      and i.created_at >= ${monthStartSql(now)}
    group by i.reporter, i.kind`
}

/** Items per reporter and character version (all time). */
export function versionCountsSql(): SQL {
  return sql`
    select i.reporter, i.character_version, count(*) as n
    from news_items i
    where i.is_test = false and i.deleted_at is null and i.is_correction = false
    group by i.reporter, i.character_version`
}

/** Answers per asking reporter this far back (no answer text is selected). */
export function reporterAnswerCountsSql(withAsks: boolean): SQL {
  return sql`
    select x.reporter, x.src, count(*) as answers,
      count(*) filter (where x.usability in ('usable', 'joke')) as quotes
    from (
      select coalesce(a.reporter, s.reporter) as reporter, 'scrum' as src, a.usability
      from news_scrum_answers a join news_scrums s on s.id = a.scrum_id
      where not a.is_test
        ${withAsks ? sql`and not ${scrumAnswerIsAboutTeammateSql('a')}` : sql``}
      union all
      select ia.reporter, 'interview' as src, ia.usability
      from news_interview_answers ia
      where not ia.is_test
        ${withAsks ? sql`and not ${interviewAnswerIsAboutTeammateSql('ia')}` : sql``}
    ) x
    group by x.reporter, x.src`
}

export interface ReporterBoardRow {
  id: ReporterId
  enabled: boolean
  override: ReporterOverride | null
  postsMonth: number
  feuds: number
}

/** The list rail: every reporter with the on/off state, the edit state, posts this month and feuds. */
export async function listReporterBoard(now: Date): Promise<ReporterBoardRow[]> {
  await refreshReporterOverrides({ maxAgeMs: 0 })
  const [overrides, disabled, items, board] = await Promise.all([
    listReporterOverrides().catch(() => [] as ReporterOverride[]),
    db.execute<{ reporter: ReporterId }>(
      sql`select reporter from news_reporter_switch where enabled = false`,
    ),
    db.execute<{ reporter: ReporterId; kind: string; n: string | number }>(itemCountsSql(now)),
    listRelationshipBoard(now),
  ])
  const off = new Set(disabled.map((d) => d.reporter))
  const byId = new Map(overrides.map((o) => [o.reporter, o]))
  return REPORTER_IDS.map((id) => ({
    id,
    enabled: !off.has(id),
    override: byId.get(id) ?? null,
    postsMonth: items
      .filter((r) => r.reporter === id && r.kind === 'post')
      .reduce((a, r) => a + num(r.n), 0),
    feuds: board.cells.filter((c) => c.reporter === id && (c.level === 'feud' || c.level === 'war'))
      .length,
  }))
}

/** One reporter's record for the detail page (counts only). */
export async function getReporterRecord(id: ReporterId, now: Date): Promise<ReporterRecord> {
  await refreshReporterOverrides({ maxAgeMs: 0 })
  type CountRow = {
    reporter: ReporterId
    src: string
    answers: string | number
    quotes: string | number
  }
  const [items, versions, answers, board] = await Promise.all([
    db.execute<{ reporter: ReporterId; kind: string; n: string | number }>(itemCountsSql(now)),
    db
      .execute<{ reporter: ReporterId; character_version: number | null; n: string | number }>(
        versionCountsSql(),
      )
      // Before migration 0087 there is no version column.
      .catch(
        () =>
          [] as { reporter: ReporterId; character_version: number | null; n: string | number }[],
      ),
    db
      .execute<CountRow>(reporterAnswerCountsSql(true))
      // Before migration 0084 there is no ask table, so no answer about a teammate to leave out.
      .catch(() => db.execute<CountRow>(reporterAnswerCountsSql(false))),
    listRelationshipBoard(now),
  ])
  const mine = board.cells.filter((c) => c.reporter === id)
  const sum = (rows: readonly CountRow[], src: string, f: 'answers' | 'quotes') =>
    rows.filter((r) => r.reporter === id && r.src === src).reduce((a, r) => a + num(r[f]), 0)
  return {
    postsMonth: items
      .filter((r) => r.reporter === id && r.kind === 'post')
      .reduce((a, r) => a + num(r.n), 0),
    articlesMonth: items
      .filter((r) => r.reporter === id && r.kind === 'article')
      .reduce((a, r) => a + num(r.n), 0),
    scrumAnswers: sum(answers, 'scrum', 'answers'),
    interviewAnswers: sum(answers, 'interview', 'answers'),
    quotesDrawn: sum(answers, 'scrum', 'quotes') + sum(answers, 'interview', 'quotes'),
    feuds: mine.filter((c) => c.level === 'feud' || c.level === 'war').length,
    fans: mine.filter((c) => c.level === 'fan' || c.level === 'glazing').length,
    pairs: mine.length,
    byVersion: versions
      .filter((v) => v.reporter === id)
      .map((v) => ({
        version: v.character_version === null ? null : num(v.character_version),
        items: num(v.n),
      }))
      .sort((a, b) => (b.version ?? -1) - (a.version ?? -1)),
  }
}

/** One reporter's stored override, or null. */
export async function getReporterOverride(id: ReporterId): Promise<ReporterOverride | null> {
  const all = await listReporterOverrides().catch(() => [] as ReporterOverride[])
  return all.find((o) => o.reporter === id) ?? null
}

export interface ReporterPreview {
  status: 'pending' | 'running' | 'done' | 'failed'
  /** The sample line when done, else a short private line. Written by the press service. */
  result: string | null
  requestedAt: Date
  handledAt: Date | null
}

/** The newest preview request for this reporter, or null. */
export async function getLatestReporterPreview(id: ReporterId): Promise<ReporterPreview | null> {
  const rows = await db.execute<{
    status: ReporterPreview['status']
    result: string | null
    requested_at: Date | string
    handled_at: Date | string | null
  }>(sql`
    select status, result, requested_at, handled_at from news_press_box_requests
    where kind = 'preview' and reporter = ${id} order by id desc limit 1`)
  const r = rows[0]
  return r === undefined
    ? null
    : {
        status: r.status,
        result: r.result,
        requestedAt: new Date(r.requested_at),
        handledAt: r.handled_at === null ? null : new Date(r.handled_at),
      }
}
