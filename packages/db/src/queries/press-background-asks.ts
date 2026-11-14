import { sql, type SQL } from 'drizzle-orm'
import { db } from '../client.js'
import type { BackgroundAskKind, BackgroundPart } from '../schema/index.js'
import { normalizeFactText } from './press-background.js'
import { writeAudit, type PressBoxActor } from './press-box.js'

export * from './press-background-sql.js'

// The bots ask background questions (task background-b2, migration 0084).
//
// The rules that matter most here:
//   1. The switch is OFF by default and a missing table or row reads as OFF (fail closed).
//   2. A teammate is only ever offered as the subject of a question when the press level is "full":
//      "Go easy" and "Leave me out" teammates are never the subject (`eligibleSubjects`), and
//      "Leave me out" people get no background question at all.
//   3. A fact made from an answer is ALWAYS inserted as `proposed` (`insertProposedFactSql` has no
//      status parameter). Nothing is proposed from a test row, and a fact whose teammate has since
//      moved off "full" is not proposed.
//   4. A question is never asked twice to the same person (any earlier ask counts).
// Same shape as press-background.ts: pure rules carry the tests; the async functions run a rule.

const num = (v: string | number): number => Number(v)

/** A fact is proposed from an answer: at most this many per answer. */
export const MAX_PROPOSED_PER_ANSWER = 2
/** The name of the proposer in `created_by`. */
export const BACKGROUND_BOT_NAME = 'press bot'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AskableQuestion {
  id: number
  part: BackgroundPart
  /** The bank text, `{name}` still in it. */
  question: string
  aboutTeammate: boolean
}

// ── The switch (admin, logged) ───────────────────────────────────────────────

/** Is the admin switch on? Off when the table is missing, the row is missing or the read fails. */
export async function getBackgroundQuestionsOn(): Promise<boolean> {
  try {
    const rows = await db.execute<{ on: boolean | null }>(
      sql`select enabled as on from news_background_settings where id = 1`,
    )
    return rows[0]?.on === true
  } catch {
    return false
  }
}

/** Sets the switch and writes its audit line in the same transaction. */
export async function setBackgroundQuestionsWithAudit(args: {
  on: boolean
  actor: PressBoxActor
  now: Date
}): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await tx.execute<{ on: boolean }>(
      sql`select enabled as on from news_background_settings where id = 1`,
    )
    await tx.execute(sql`
      insert into news_background_settings (id, enabled)
      values (1, ${args.on})
      on conflict (id) do update set enabled = excluded.enabled, updated_at = now()`)
    await writeAudit(
      tx,
      args.actor,
      {
        kind: 'background_switch',
        target: 'background questions',
        summary: `${before[0]?.on === true ? 'on' : 'off'} -> ${args.on ? 'on' : 'off'}`,
      },
      args.now,
    )
  })
}

// ── Choosing a question ──────────────────────────────────────────────────────

/**
 * Active questions a member may be asked: generic or their own, with no fact of theirs linked to it
 * (any status: a rejected one stays closed) and never asked to them before (test asks count only
 * for test rows, so a trial run does not use up a real question).
 */
export function askableQuestionsSql(playerId: number, isTest: boolean): SQL {
  return sql`
    select q.id, q.part, q.question, q.about_teammate
    from news_background_questions q
    where q.active and (q.player_id is null or q.player_id = ${playerId})
      and not exists (
        select 1 from news_background_facts f where f.question_id = q.id and f.player_id = ${playerId}
      )
      and not exists (
        select 1 from news_background_asks a
        where a.question_id = q.id and a.player_id = ${playerId} and a.is_test = ${isTest}
      )
    order by q.sort_order, q.id`
}

export async function listAskableBackgroundQuestions(
  playerId: number,
  isTest: boolean,
): Promise<AskableQuestion[]> {
  const rows = await db.execute<{
    id: string | number
    part: BackgroundPart
    question: string
    about_teammate: boolean
  }>(askableQuestionsSql(playerId, isTest))
  return rows.map((r) => ({
    id: num(r.id),
    part: r.part,
    question: r.question,
    aboutTeammate: r.about_teammate,
  }))
}

/** Background asks of this member since a time (real or test rows, as asked). */
export function countAsksSinceSql(playerId: number, since: Date, isTest: boolean): SQL {
  return sql`
    select count(*) as n from news_background_asks a
    where a.player_id = ${playerId} and a.kind = 'scrum' and a.is_test = ${isTest}
      and a.asked_at >= ${since.toISOString()}::timestamptz`
}

export async function countBackgroundAsksSince(
  playerId: number,
  since: Date,
  isTest: boolean,
): Promise<number> {
  const rows = await db.execute<{ n: string | number }>(countAsksSinceSql(playerId, since, isTest))
  return num(rows[0]?.n ?? 0)
}

/** Background asks of one scrum person's panel (0 or 1) or one interview (0 or 1). */
export async function countBackgroundAsksFor(
  by: { scrumPersonId: number } | { interviewId: number },
): Promise<number> {
  const cond =
    'scrumPersonId' in by
      ? sql`a.scrum_person_id = ${by.scrumPersonId}`
      : sql`a.interview_id = ${by.interviewId}`
  const rows = await db.execute<{ n: string | number }>(
    sql`select count(*) as n from news_background_asks a where ${cond}`,
  )
  return num(rows[0]?.n ?? 0)
}

// ── The ask log ──────────────────────────────────────────────────────────────

export interface NewBackgroundAsk {
  questionId: number
  playerId: number
  subjectPlayerId: number | null
  kind: BackgroundAskKind
  scrumPersonId?: number
  interviewId?: number
  isTest: boolean
  at: Date
}

/** Logs an ask. The unique index (one per scrum panel) makes a second one for the panel a no-op: null. */
export async function insertBackgroundAsk(a: NewBackgroundAsk): Promise<number | null> {
  const rows = await db.execute<{ id: string | number }>(sql`
    insert into news_background_asks
      (question_id, player_id, subject_player_id, kind, scrum_person_id, interview_id, is_test, asked_at)
    values (${a.questionId}, ${a.playerId}, ${a.subjectPlayerId}, ${a.kind},
      ${a.scrumPersonId ?? null}, ${a.interviewId ?? null}, ${a.isTest}, ${a.at.toISOString()}::timestamptz)
    on conflict do nothing
    returning id`)
  return rows[0] === undefined ? null : num(rows[0].id)
}

export interface OpenBackgroundAsk {
  id: number
  questionId: number
  playerId: number
  subjectPlayerId: number | null
  subjectName: string | null
  part: BackgroundPart
  /** The bank text with `{name}` still in it. */
  question: string
  aboutTeammate: boolean
  isTest: boolean
}

/** The ask of this scrum person or interview that has no answer yet, or null. */
export async function getOpenBackgroundAsk(
  by: { scrumPersonId: number } | { interviewId: number },
): Promise<OpenBackgroundAsk | null> {
  const cond =
    'scrumPersonId' in by
      ? sql`a.scrum_person_id = ${by.scrumPersonId}`
      : sql`a.interview_id = ${by.interviewId}`
  const rows = await db.execute<{
    id: string | number
    question_id: string | number
    player_id: number
    subject_player_id: number | null
    subject_name: string | null
    part: BackgroundPart
    question: string
    about_teammate: boolean
    is_test: boolean
  }>(sql`
    select a.id, a.question_id, a.player_id, a.subject_player_id,
      coalesce(nullif(btrim(spp.player_name), ''), sp.gamertag) as subject_name,
      q.part, q.question, q.about_teammate, a.is_test
    from news_background_asks a
    join news_background_questions q on q.id = a.question_id
    left join players sp on sp.id = a.subject_player_id
    left join player_profiles spp on spp.player_id = a.subject_player_id
    where ${cond} and a.answered_at is null
    order by a.id desc
    limit 1`)
  const r = rows[0]
  if (r === undefined) return null
  return {
    id: num(r.id),
    questionId: num(r.question_id),
    playerId: r.player_id,
    subjectPlayerId: r.subject_player_id,
    subjectName: r.subject_name,
    part: r.part,
    question: r.question,
    aboutTeammate: r.about_teammate,
    isTest: r.is_test,
  }
}

/** Marks the ask answered (first answer only); false when it was already answered. */
export async function completeBackgroundAsk(
  askId: number,
  answer: { scrumAnswerId: number } | { interviewAnswerId: number },
  at: Date,
): Promise<boolean> {
  const rows = await db.execute<{ id: string | number }>(sql`
    update news_background_asks
    set answered_at = ${at.toISOString()}::timestamptz,
      answer_scrum_id = ${'scrumAnswerId' in answer ? answer.scrumAnswerId : null},
      answer_interview_id = ${'interviewAnswerId' in answer ? answer.interviewAnswerId : null}
    where id = ${askId} and answered_at is null
    returning id`)
  return rows.length > 0
}

// ── Proposing facts ──────────────────────────────────────────────────────────

/**
 * The insert of one proposed fact from a completed, real (not test) ask. The status is the literal
 * 'proposed': there is no way to insert any other status here. A fact about a teammate is left out
 * when that teammate is no longer at "full", and nothing is proposed for an owner on "Leave me
 * out". Never more than `MAX_PROPOSED_PER_ANSWER` facts per answer.
 */
export function insertProposedFactSql(askId: number, text: string, at: Date): SQL {
  return sql`
    insert into news_background_facts
      (player_id, subject_player_id, question_id, part, text, status, source,
       source_scrum_answer_id, source_interview_answer_id, created_by, created_at)
    select a.player_id, a.subject_player_id, a.question_id, q.part, ${text}, 'proposed', 'answer',
      a.answer_scrum_id, a.answer_interview_id, ${BACKGROUND_BOT_NAME}, ${at.toISOString()}::timestamptz
    from news_background_asks a
    join news_background_questions q on q.id = a.question_id
    left join player_profiles opp on opp.player_id = a.player_id
    left join player_profiles spp on spp.player_id = a.subject_player_id
    where a.id = ${askId} and a.answered_at is not null and not a.is_test
      and coalesce(opp.press_level, 'full') <> 'out'
      and (a.subject_player_id is null or coalesce(spp.press_level, 'full') = 'full')
      and (select count(*) from news_background_facts f
           where f.source = 'answer'
             and ((a.answer_scrum_id is not null and f.source_scrum_answer_id = a.answer_scrum_id)
               or (a.answer_interview_id is not null and f.source_interview_answer_id = a.answer_interview_id)))
          < ${MAX_PROPOSED_PER_ANSWER}
    returning id`
}

/** Inserts the facts (already checked by the caller) as PROPOSED. Returns the new fact ids. */
export async function insertProposedBackgroundFacts(
  askId: number,
  texts: readonly string[],
  at: Date,
): Promise<number[]> {
  const ids: number[] = []
  for (const raw of texts.slice(0, MAX_PROPOSED_PER_ANSWER)) {
    const text = normalizeFactText(raw)
    if (text === null) continue
    const rows = await db.execute<{ id: string | number }>(insertProposedFactSql(askId, text, at))
    if (rows[0] !== undefined) ids.push(num(rows[0].id))
  }
  return ids
}
