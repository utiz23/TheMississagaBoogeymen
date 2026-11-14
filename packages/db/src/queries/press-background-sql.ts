import { sql, type SQL } from 'drizzle-orm'

// Leaf file (drizzle only, no other import of ours): news-press.ts, news-interviews.ts and
// press-box-dossiers.ts use these fragments, and they must not pull press-background.ts in (a cycle).

// ── Answers about a teammate are never a quote ───────────────────────────────

/**
 * SQL: this scrum answer (alias or table name `alias`) answered a background question about a
 * teammate. Such an answer is NEVER offered to a writer as a quote or as history: only a fact the
 * admin confirmed is. `alias` is a fixed table alias from the callers, never user input.
 */
export const scrumAnswerIsAboutTeammateSql = (alias: string): SQL =>
  sql`exists (select 1 from news_background_asks ba
    where ba.answer_scrum_id = ${sql.raw(alias)}.id and ba.subject_player_id is not null)`

/** The same for an interview answer. */
export const interviewAnswerIsAboutTeammateSql = (alias: string): SQL =>
  sql`exists (select 1 from news_background_asks ba
    where ba.answer_interview_id = ${sql.raw(alias)}.id and ba.subject_player_id is not null)`
