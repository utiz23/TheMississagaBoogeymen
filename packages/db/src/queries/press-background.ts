import { sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import {
  BACKGROUND_PARTS,
  BACKGROUND_PART_LABELS,
  type BackgroundFactSource,
  type BackgroundFactStatus,
  type BackgroundPart,
  type PressLevel,
} from '../schema/index.js'
import { DISCORD_USER_ID_RE } from './discord-ids.js'
import { listPressRoster } from './news-press.js'
import { writeAudit, type PressBoxActor } from './press-box.js'
import type { DossierKey } from './press-box-dossiers.js'

// Player background (Press Box dossier "Background", migration 0082, task background-b1).
//
// The rules that matter most here:
//   1. ONLY a confirmed fact is ever read by a writer (`confirmedBackgroundSql` filters on the
//      status; `pickWriterBackground` checks it again). "Leave me out" gets no fact to any writer.
//   2. The text of a source answer is selected only when that answer is usable or joke (and not a
//      test row): a case expression in `factSelectSql`, as `quotesSql` does for quotes. An
//      unusable or off-limits answer's text never leaves the database; `shapeSourceAnswer` is a
//      second layer.
//   3. Every change and its audit line are written in one transaction. The audit line holds the
//      fact id and part, never the fact text.
// Same shape as press-box-dossiers.ts: pure rules carry the tests; the async functions run a rule.
// This file must not import press-box-dossiers.ts at runtime (that file reads this one).

const num = (v: string | number): number => Number(v)
const toDate = (v: string | Date): Date => (v instanceof Date ? v : new Date(v))

export const FACT_MAX = 400

// ── Pure rules ───────────────────────────────────────────────────────────────

export const isBackgroundPart = (v: unknown): v is BackgroundPart =>
  typeof v === 'string' && (BACKGROUND_PARTS as readonly string[]).includes(v)

/** A fact is one short paragraph: whitespace collapsed, 1 to `FACT_MAX` characters; else null. */
export function normalizeFactText(raw: string): string | null {
  const t = raw.replace(/\s+/g, ' ').trim()
  return t === '' || Array.from(t).length > FACT_MAX ? null : t
}

/** A bank question for one person: `{name}` becomes their name. */
export const questionText = (template: string, name: string): string =>
  template.split('{name}').join(name)

export type FactAction = 'confirm' | 'reject' | 'delete'

/** Which status each action may start from: confirm and reject need a proposed fact, delete a confirmed one. */
export const FACT_ACTION_FROM: Readonly<Record<FactAction, BackgroundFactStatus>> = {
  confirm: 'proposed',
  reject: 'proposed',
  delete: 'confirmed',
}
export const FACT_ACTION_TO: Readonly<Record<FactAction, BackgroundFactStatus>> = {
  confirm: 'confirmed',
  reject: 'rejected',
  delete: 'rejected',
}

export function canApply(action: FactAction, status: BackgroundFactStatus): boolean {
  return FACT_ACTION_FROM[action] === status
}

/** Editing is allowed on a proposed or a confirmed fact; a rejected fact is closed. */
export const canEdit = (status: BackgroundFactStatus): boolean => status !== 'rejected'

export type AnswerUse = 'usable' | 'joke' | 'unusable'

/** The source answer of a fact as the admin sees it: the text only for a usable or joke answer. */
export interface BackgroundSourceAnswer {
  kind: 'scrum' | 'interview'
  usability: AnswerUse | null
  question: string | null
  text: string | null
}

export function shapeSourceAnswer(r: {
  answer_kind: 'scrum' | 'interview' | null
  answer_usability: AnswerUse | null
  answer_question: string | null
  answer_text: string | null
}): BackgroundSourceAnswer | null {
  if (r.answer_kind === null) return null
  const readable = r.answer_usability === 'usable' || r.answer_usability === 'joke'
  return {
    kind: r.answer_kind,
    usability: r.answer_usability,
    question: readable ? r.answer_question : null,
    text: readable ? r.answer_text : null,
  }
}

// ── Reading one person's background (the admin editor) ───────────────────────

export interface BackgroundFact {
  id: number
  part: BackgroundPart
  text: string
  status: BackgroundFactStatus
  source: BackgroundFactSource
  createdBy: string
  createdAt: Date
  reviewedBy: string | null
  reviewedAt: Date | null
  editedBy: string | null
  editedAt: Date | null
  /** The person the fact is filed under (the one whose answer or note it is). */
  ownerKey: string
  ownerName: string
  /** A fact about a teammate names that member. */
  subjectPlayerId: number | null
  subjectName: string | null
  questionId: number | null
  /** Null for a fact the admin typed. */
  answer: BackgroundSourceAnswer | null
}

type FactRow = {
  id: string | number
  part: BackgroundPart
  text: string
  status: BackgroundFactStatus
  source: BackgroundFactSource
  created_by: string
  created_at: Date | string
  reviewed_by: string | null
  reviewed_at: Date | string | null
  edited_by: string | null
  edited_at: Date | string | null
  player_id: string | number | null
  discord_user_id: string | null
  owner_name: string | null
  subject_player_id: string | number | null
  subject_name: string | null
  question_id: string | number | null
  answer_kind: 'scrum' | 'interview' | null
  answer_usability: AnswerUse | null
  answer_question: string | null
  answer_text: string | null
}

export function factFromRow(r: FactRow): BackgroundFact {
  return {
    id: num(r.id),
    part: r.part,
    text: r.text,
    status: r.status,
    source: r.source,
    createdBy: r.created_by,
    createdAt: toDate(r.created_at),
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at === null ? null : toDate(r.reviewed_at),
    editedBy: r.edited_by,
    editedAt: r.edited_at === null ? null : toDate(r.edited_at),
    ownerKey: r.player_id !== null ? String(num(r.player_id)) : `u${r.discord_user_id ?? ''}`,
    ownerName: r.owner_name ?? 'Unknown',
    subjectPlayerId: r.subject_player_id === null ? null : num(r.subject_player_id),
    subjectName: r.subject_name,
    questionId: r.question_id === null ? null : num(r.question_id),
    answer: shapeSourceAnswer(r),
  }
}

const STATUS_RANK: Readonly<Record<BackgroundFactStatus, number>> = {
  proposed: 0,
  confirmed: 1,
  rejected: 2,
}

/** Proposed facts first, then confirmed, then rejected; newest first inside each. */
export function sortFacts(facts: readonly BackgroundFact[]): BackgroundFact[] {
  return [...facts].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      b.createdAt.getTime() - a.createdAt.getTime() ||
      b.id - a.id,
  )
}

/**
 * The columns of a fact with its owner, its subject and its source answer. The answer's question
 * and text are selected only for a usable or joke answer that is not a test row (a case
 * expression, so an unusable answer's text never leaves the database); its usability is always
 * selected (a count-like fact, not a text).
 */
export function factSelectSql(where: SQL): SQL {
  return sql`
    select f.id, f.part, f.text, f.status, f.source, f.created_by, f.created_at,
      f.reviewed_by, f.reviewed_at, f.edited_by, f.edited_at,
      f.player_id, f.discord_user_id,
      coalesce(nullif(btrim(opp.player_name), ''), op.gamertag, f.display_name) as owner_name,
      f.subject_player_id,
      coalesce(nullif(btrim(spp.player_name), ''), sp.gamertag) as subject_name,
      f.question_id,
      case when sa.id is not null then 'scrum' when ia.id is not null then 'interview' end as answer_kind,
      coalesce(sa.usability, ia.usability) as answer_usability,
      case
        when sa.usability in ('usable', 'joke') and not sa.is_test then sa.question
        when ia.usability in ('usable', 'joke') and not ia.is_test then ia.question
      end as answer_question,
      case
        when sa.usability in ('usable', 'joke') and not sa.is_test then sa.answer
        when ia.usability in ('usable', 'joke') and not ia.is_test then ia.answer
      end as answer_text
    from news_background_facts f
    left join players op on op.id = f.player_id
    left join player_profiles opp on opp.player_id = f.player_id
    left join players sp on sp.id = f.subject_player_id
    left join player_profiles spp on spp.player_id = f.subject_player_id
    left join news_scrum_answers sa on sa.id = f.source_scrum_answer_id
    left join news_interview_answers ia on ia.id = f.source_interview_answer_id
    where ${where}
    order by f.id`
}

const ownerCondition = (key: DossierKey): SQL =>
  'playerId' in key
    ? sql`f.player_id = ${key.playerId}`
    : sql`f.player_id is null and f.discord_user_id = ${key.discordUserId}`

/** The facts filed under this person (all statuses). */
export function ownFactsSql(key: DossierKey): SQL {
  return factSelectSql(ownerCondition(key))
}

/** Facts other people's answers made about this member ("what teammates said"); not the rejected ones. */
export function teammateFactsSql(playerId: number): SQL {
  return factSelectSql(
    sql`f.subject_player_id = ${playerId} and f.status <> 'rejected'
      and (f.player_id is null or f.player_id <> ${playerId})`,
  )
}

export interface BackgroundQuestion {
  id: number
  part: BackgroundPart
  /** The question with the person's name in it. */
  text: string
  aboutTeammate: boolean
}

export interface BackgroundOpenPart {
  part: BackgroundPart
  label: string
  questions: BackgroundQuestion[]
}

/**
 * Questions this person still has open: active ones that are generic or theirs, with no fact of
 * theirs (any status, so a rejected one stays closed) linked to the question. A bench person gets
 * the generic ones only.
 */
export function openQuestionsSql(key: DossierKey): SQL {
  const forPerson =
    'playerId' in key
      ? sql`(q.player_id is null or q.player_id = ${key.playerId})`
      : sql`q.player_id is null`
  return sql`
    select q.id, q.part, q.question, q.about_teammate
    from news_background_questions q
    where q.active and ${forPerson}
      and not exists (
        select 1 from news_background_facts f where f.question_id = q.id and ${ownerCondition(key)}
      )
    order by q.sort_order, q.id`
}

/** Groups open questions by part, in the worksheet order; the person's name goes into each. */
export function groupOpenQuestions(
  rows: readonly {
    id: string | number
    part: BackgroundPart
    question: string
    about_teammate: boolean
  }[],
  name: string,
): BackgroundOpenPart[] {
  const out: BackgroundOpenPart[] = []
  for (const part of BACKGROUND_PARTS) {
    const questions = rows
      .filter((r) => r.part === part)
      .map((r) => ({
        id: num(r.id),
        part,
        text: questionText(r.question, name),
        aboutTeammate: r.about_teammate,
      }))
    if (questions.length > 0) out.push({ part, label: BACKGROUND_PART_LABELS[part], questions })
  }
  return out
}

export interface BackgroundView {
  /** Filed under this person: proposed first, then confirmed, then rejected. */
  facts: BackgroundFact[]
  /** Other people's answers about this member (confirm-only). Empty for a bench person. */
  fromTeammates: BackgroundFact[]
  open: BackgroundOpenPart[]
  /** Members this person's facts may name as the second player. */
  teammates: { playerId: number; name: string }[]
  /** Proposed facts waiting: own plus from teammates. */
  waiting: number
}

export const EMPTY_BACKGROUND: BackgroundView = {
  facts: [],
  fromTeammates: [],
  open: [],
  teammates: [],
  waiting: 0,
}

/**
 * Everything the Background section shows for one person. The tables may not exist before the
 * migration is applied: the section then shows empty.
 */
export async function getBackgroundView(args: {
  key: DossierKey
  name: string
  pressLevel: PressLevel | null
}): Promise<BackgroundView> {
  const { key, name, pressLevel } = args
  const memberId = 'playerId' in key ? key.playerId : null
  try {
    const [own, theirs, open, roster] = await Promise.all([
      db.execute<FactRow>(ownFactsSql(key)),
      memberId === null
        ? Promise.resolve([] as FactRow[])
        : db.execute<FactRow>(teammateFactsSql(memberId)),
      // "Leave me out": no question is offered for the person (the facts stay visible to the admin).
      pressLevel === 'out'
        ? Promise.resolve([])
        : db.execute<{
            id: string | number
            part: BackgroundPart
            question: string
            about_teammate: boolean
          }>(openQuestionsSql(key)),
      listPressRoster(),
    ])
    const facts = sortFacts(own.map(factFromRow))
    const fromTeammates = sortFacts(theirs.map(factFromRow))
    return {
      facts,
      fromTeammates,
      open: groupOpenQuestions(open, name),
      teammates: roster
        .filter((r) => r.playerId !== memberId)
        .map((r) => ({ playerId: r.playerId, name: r.name })),
      waiting:
        facts.filter((f) => f.status === 'proposed').length +
        fromTeammates.filter((f) => f.status === 'proposed').length,
    }
  } catch {
    return EMPTY_BACKGROUND
  }
}

export interface WaitingBackgroundPerson {
  /** The page key of the person the facts are filed under. */
  key: string
  name: string
  count: number
}

/** The proposed facts waiting for the admin, per person (the Overview line). Counts and names only. */
export function waitingBackgroundSql(): SQL {
  return sql`
    select f.player_id, f.discord_user_id,
      coalesce(nullif(btrim(opp.player_name), ''), op.gamertag, max(f.display_name)) as name,
      count(*) as n
    from news_background_facts f
    left join players op on op.id = f.player_id
    left join player_profiles opp on opp.player_id = f.player_id
    where f.status = 'proposed'
    group by f.player_id, f.discord_user_id, opp.player_name, op.gamertag
    order by n desc, name`
}

/** Who has proposed facts waiting. Empty before the migration. */
export async function listWaitingBackground(): Promise<WaitingBackgroundPerson[]> {
  const rows = await db
    .execute<{
      player_id: string | number | null
      discord_user_id: string | null
      name: string | null
      n: string | number
    }>(waitingBackgroundSql())
    .catch(() => [])
  return rows.map((r) => ({
    key: r.player_id !== null ? String(num(r.player_id)) : `u${r.discord_user_id ?? ''}`,
    name: r.name ?? 'Unknown',
    count: num(r.n),
  }))
}

// ── For the writers: confirmed facts only ────────────────────────────────────

export interface WriterFact {
  part: BackgroundPart
  text: string
}

/** What a writer may read about one person. Confirmed facts only; nothing for "Leave me out". */
export interface WriterBackground {
  /** Facts filed under the person (about the person, not about another teammate). */
  own: WriterFact[]
  /** Confirmed facts that other people's answers made about this person. */
  fromTeammates: WriterFact[]
}

export const NO_BACKGROUND: WriterBackground = { own: [], fromTeammates: [] }
export const WRITER_OWN_MAX = 24
export const WRITER_TEAMMATE_MAX = 12

type WriterRow = {
  scope: 'own' | 'teammate'
  part: BackgroundPart
  text: string
  status: BackgroundFactStatus
  owner_level: PressLevel | null
  subject_level: PressLevel | null
  has_subject: boolean
}

/**
 * The SQL for the writers. Everything is filtered to `status = 'confirmed'` here, and a fact is
 * left out when its owner or its subject is on "Leave me out". An own fact that names a teammate
 * is not offered under its owner (it belongs under that teammate: the profile of one person may
 * not name another teammate).
 */
export function confirmedBackgroundSql(key: DossierKey): SQL {
  const own = ownerCondition(key)
  const forTeammates = 'playerId' in key ? sql`f.subject_player_id = ${key.playerId}` : sql`false`
  return sql`
    select case when f.subject_player_id is null then 'own' else 'teammate' end as scope,
      f.part, f.text, f.status,
      coalesce(opp.press_level, 'full') as owner_level,
      case when f.subject_player_id is null then null else coalesce(spp.press_level, 'full') end as subject_level,
      f.subject_player_id is not null as has_subject
    from news_background_facts f
    left join player_profiles opp on opp.player_id = f.player_id
    left join player_profiles spp on spp.player_id = f.subject_player_id
    where f.status = 'confirmed'
      and coalesce(opp.press_level, 'full') <> 'out'
      and (f.subject_player_id is null or coalesce(spp.press_level, 'full') <> 'out')
      and ((f.subject_player_id is null and ${own}) or (${forTeammates} and not (${own})))
    order by f.id`
}

/** Second layer over the SQL: whatever rows it is given, only a confirmed, non-"out" fact comes out. */
export function pickWriterBackground(
  rows: readonly WriterRow[],
  pressLevel: PressLevel | null,
): WriterBackground {
  if (pressLevel === 'out') return { own: [], fromTeammates: [] }
  const usable = rows.filter(
    (r) => r.status === 'confirmed' && r.owner_level !== 'out' && r.subject_level !== 'out',
  )
  const order = (a: WriterRow, b: WriterRow): number =>
    BACKGROUND_PARTS.indexOf(a.part) - BACKGROUND_PARTS.indexOf(b.part)
  const pick = (rs: WriterRow[], max: number): WriterFact[] =>
    rs
      .sort(order)
      .slice(0, max)
      .map((r) => ({ part: r.part, text: r.text }))
  return {
    own: pick(
      usable.filter((r) => r.scope === 'own' && !r.has_subject),
      WRITER_OWN_MAX,
    ),
    fromTeammates: pick(
      usable.filter((r) => r.scope === 'teammate' && r.has_subject),
      WRITER_TEAMMATE_MAX,
    ),
  }
}

/**
 * The confirmed background a writer may use. No read at all for "Leave me out"; a missing table
 * (before the migration) gives no facts.
 */
export async function getConfirmedBackground(
  key: DossierKey,
  pressLevel: PressLevel | null,
): Promise<WriterBackground> {
  if (pressLevel === 'out') return { own: [], fromTeammates: [] }
  const rows = await db.execute<WriterRow>(confirmedBackgroundSql(key)).catch(() => [])
  return pickWriterBackground(rows, pressLevel)
}

// ── Actions (database): each one writes its audit line in the same transaction ──

export const BACKGROUND_ERROR_CODES = [
  'no_person',
  'no_fact',
  'bad_state',
  'bad_fact',
  'bad_part',
  'bad_subject',
  'bad_question',
] as const
export type BackgroundErrorCode = (typeof BACKGROUND_ERROR_CODES)[number]

export type BackgroundActionResult =
  | { ok: true; summary: string; factId: number }
  | { ok: false; code: BackgroundErrorCode }

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

interface PersonRow {
  name: string
  press_level: PressLevel | null
  player_id: number | null
}

/** The person a fact is filed under (a member, or a bench person or the coach). */
async function readPerson(tx: Tx, key: DossierKey): Promise<PersonRow | null> {
  if ('playerId' in key) {
    const rows = await tx.execute<{ name: string; press_level: PressLevel }>(sql`
      select coalesce(nullif(btrim(pp.player_name), ''), p.gamertag) as name,
        coalesce(pp.press_level, 'full') as press_level
      from players p left join player_profiles pp on pp.player_id = p.id
      where p.id = ${key.playerId} and p.ai_goalie_side is null`)
    const r = rows[0]
    return r === undefined ? null : { ...r, player_id: key.playerId }
  }
  if (!DISCORD_USER_ID_RE.test(key.discordUserId)) return null
  const rows = await tx.execute<{ display_name: string | null }>(sql`
    select t.display_name from (
      select sp.display_name, sp.created_at from news_scrum_people sp
      where sp.player_id is null and sp.discord_user_id = ${key.discordUserId}
      union all
      select iv.display_name, iv.created_at from news_interviews iv
      where iv.player_id is null and iv.discord_user_id = ${key.discordUserId}
    ) t order by t.created_at desc limit 1`)
  const r = rows[0]
  return r === undefined
    ? null
    : { name: r.display_name ?? 'Unknown', press_level: null, player_id: null }
}

const partWord = (part: BackgroundPart): string => BACKGROUND_PART_LABELS[part]

/**
 * The admin types a fact. It is confirmed at once (the admin is the authority; `reviewed_by` is
 * the admin). A question id files it as that question's answer (the part is then the question's
 * part); a subject names a second member (a fact about a teammate).
 */
export async function addBackgroundFactWithAudit(args: {
  key: DossierKey
  part: BackgroundPart | null
  text: string
  subjectPlayerId: number | null
  questionId: number | null
  actor: PressBoxActor
  now: Date
}): Promise<BackgroundActionResult> {
  const text = normalizeFactText(args.text)
  if (text === null) return { ok: false, code: 'bad_fact' }
  if (args.questionId === null && !isBackgroundPart(args.part)) {
    return { ok: false, code: 'bad_part' }
  }
  return db.transaction(async (tx) => {
    const person = await readPerson(tx, args.key)
    if (person === null) return { ok: false, code: 'no_person' } as const
    let part: BackgroundPart | null = args.part
    if (args.questionId !== null) {
      const q = await tx.execute<{ part: BackgroundPart }>(sql`
        select part from news_background_questions
        where id = ${args.questionId} and active
          and (player_id is null or player_id = ${person.player_id})`)
      if (q[0] === undefined) return { ok: false, code: 'bad_question' } as const
      part = q[0].part
    }
    if (part === null) return { ok: false, code: 'bad_part' } as const
    let subjectName: string | null = null
    if (args.subjectPlayerId !== null) {
      if (args.subjectPlayerId === person.player_id)
        return { ok: false, code: 'bad_subject' } as const
      const s = await tx.execute<{ name: string }>(sql`
        select coalesce(nullif(btrim(pp.player_name), ''), p.gamertag) as name
        from players p left join player_profiles pp on pp.player_id = p.id
        where p.id = ${args.subjectPlayerId} and p.ai_goalie_side is null`)
      if (s[0] === undefined) return { ok: false, code: 'bad_subject' } as const
      subjectName = s[0].name
    }
    const at = args.now.toISOString()
    const displayName = 'discordUserId' in args.key ? person.name : null
    const rows = await tx.execute<{ id: string | number }>(sql`
      insert into news_background_facts
        (player_id, discord_user_id, display_name, subject_player_id, question_id, part, text,
         status, source, created_by, created_at, reviewed_by, reviewed_at)
      values (${person.player_id}, ${'discordUserId' in args.key ? args.key.discordUserId : null},
        ${displayName}, ${args.subjectPlayerId}, ${args.questionId}, ${part}, ${text},
        'confirmed', 'admin', ${args.actor.name}, ${at}::timestamptz, ${args.actor.name}, ${at}::timestamptz)
      returning id`)
    const id = num(rows[0]?.id ?? 0)
    if (id === 0) throw new Error('addBackgroundFactWithAudit: no row returned')
    const summary = `added fact ${String(id)} (${partWord(part)})${
      subjectName === null ? '' : ` about ${subjectName}`
    }`
    await writeAudit(
      tx,
      args.actor,
      { kind: 'background_add', target: person.name, summary },
      args.now,
    )
    return { ok: true, summary, factId: id } as const
  })
}

type FactHead = {
  status: BackgroundFactStatus
  part: BackgroundPart
  owner_name: string | null
  subject_name: string | null
}

async function lockFact(tx: Tx, factId: number): Promise<FactHead | null> {
  const rows = await tx.execute<FactHead>(sql`
    select f.status, f.part,
      coalesce(nullif(btrim(opp.player_name), ''), op.gamertag, f.display_name) as owner_name,
      coalesce(nullif(btrim(spp.player_name), ''), sp.gamertag) as subject_name
    from news_background_facts f
    left join players op on op.id = f.player_id
    left join player_profiles opp on opp.player_id = f.player_id
    left join players sp on sp.id = f.subject_player_id
    left join player_profiles spp on spp.player_id = f.subject_player_id
    where f.id = ${factId}
    for update of f`)
  return rows[0] ?? null
}

const AUDIT_KIND = {
  confirm: 'background_confirm',
  reject: 'background_reject',
  delete: 'background_delete',
} as const

const AUDIT_VERB = {
  confirm: 'confirmed',
  reject: 'rejected',
  delete: 'removed (was confirmed)',
} as const

/** Confirm or reject a proposed fact, or remove (soft delete: status rejected) a confirmed one. */
export async function decideBackgroundFactWithAudit(args: {
  factId: number
  action: FactAction
  actor: PressBoxActor
  now: Date
}): Promise<BackgroundActionResult> {
  return db.transaction(async (tx) => {
    const fact = await lockFact(tx, args.factId)
    if (fact === null) return { ok: false, code: 'no_fact' } as const
    if (!canApply(args.action, fact.status)) return { ok: false, code: 'bad_state' } as const
    await tx.execute(sql`
      update news_background_facts
      set status = ${FACT_ACTION_TO[args.action]}, reviewed_by = ${args.actor.name},
        reviewed_at = ${args.now.toISOString()}::timestamptz
      where id = ${args.factId}`)
    const summary = `${AUDIT_VERB[args.action]} fact ${String(args.factId)} (${partWord(fact.part)})${
      fact.subject_name === null ? '' : ` about ${fact.subject_name}`
    }`
    await writeAudit(
      tx,
      args.actor,
      { kind: AUDIT_KIND[args.action], target: fact.owner_name ?? 'Unknown', summary },
      args.now,
    )
    return { ok: true, summary, factId: args.factId } as const
  })
}

/**
 * Change a fact's text. A proposed fact may be confirmed in the same step (`confirm`); a confirmed
 * fact stays confirmed with the admin's new text; a rejected fact cannot be edited.
 */
export async function editBackgroundFactWithAudit(args: {
  factId: number
  text: string
  confirm: boolean
  actor: PressBoxActor
  now: Date
}): Promise<BackgroundActionResult> {
  const text = normalizeFactText(args.text)
  if (text === null) return { ok: false, code: 'bad_fact' }
  return db.transaction(async (tx) => {
    const fact = await lockFact(tx, args.factId)
    if (fact === null) return { ok: false, code: 'no_fact' } as const
    if (!canEdit(fact.status)) return { ok: false, code: 'bad_state' } as const
    const at = args.now.toISOString()
    const confirms = args.confirm && fact.status === 'proposed'
    await tx.execute(
      confirms
        ? sql`update news_background_facts
            set text = ${text}, edited_by = ${args.actor.name}, edited_at = ${at}::timestamptz,
              status = 'confirmed', reviewed_by = ${args.actor.name}, reviewed_at = ${at}::timestamptz
            where id = ${args.factId}`
        : sql`update news_background_facts
            set text = ${text}, edited_by = ${args.actor.name}, edited_at = ${at}::timestamptz
            where id = ${args.factId}`,
    )
    const summary = `edited fact ${String(args.factId)} (${partWord(fact.part)})${
      confirms ? ' and confirmed it' : ''
    }`
    await writeAudit(
      tx,
      args.actor,
      { kind: 'background_edit', target: fact.owner_name ?? 'Unknown', summary },
      args.now,
    )
    return { ok: true, summary, factId: args.factId } as const
  })
}
