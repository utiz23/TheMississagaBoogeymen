import type { NewsScrumRow } from '@eanhl/db/queries'

/**
 * T8, `/gm testscrum`: the marker of a test scrum. A test scrum is `is_test` and its `buzz_level`
 * is this value (no migration: `buzz_level` is free text). It makes NO model call: its questions,
 * follow-ups, acknowledgements and closings come from the reporters' fixed pools, its hard-line
 * screen is the code layer only, its judge is a fixed rule, and it gives no feud points. Its
 * answers never reach a story (the db queries leave the marker out).
 *
 * The same value is `TEST_SCRUM_BUZZ` in `packages/db/src/queries/news-press.ts`; `test-scrum-db.ts`
 * checks at start-up that the two match. This file stays free of database imports.
 */
export const TEST_SCRUM_BUZZ_VALUE = 'testscrum'

/** Is this scrum a test scrum? */
export function isTestScrum(scrum: Pick<NewsScrumRow, 'isTest' | 'buzzLevel'>): boolean {
  return scrum.isTest && scrum.buzzLevel === TEST_SCRUM_BUZZ_VALUE
}

/** A test scrum stays open this long, however old its game is. */
export const TEST_SCRUM_OPEN_MS = 3_600_000
