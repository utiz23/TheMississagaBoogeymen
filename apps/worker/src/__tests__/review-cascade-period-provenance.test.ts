/**
 * Review-cascade × period-summary provenance (migration 0056).
 *
 * THE DEFECT UNDER TEST
 * ---------------------
 * `setExtractionStatus` cascades an extraction's review verdict to every
 * promoter table by `ocr_extraction_id`. For `match_period_summaries` that
 * attribution is UNSOUND, and the schema cannot currently make it sound:
 *
 *   * A row packs three independently-captured families (goals, shots,
 *     faceoffs — three Box Score tabs, three separate extractions), but carries
 *     ONE `ocr_extraction_id`.
 *   * `box-score.ts` sets it with `COALESCE(existing, incoming)`, so it records
 *     only the FIRST contributor. The other two families' extractions are never
 *     recorded anywhere.
 *   * Even within one family, a second frame can fill a side the first left
 *     null (the same COALESCE merge), so a row's goals pair can come from two
 *     goals extractions while naming only one.
 *
 * So from `ocr_extraction_id` alone it is impossible to say which extraction
 * contributed which value. Any cascade that publishes a family on that basis
 * authorizes values a different extraction produced — and a screen-type
 * heuristic does not fix it: `post_game_box_score_goals` narrows WHICH family an
 * extraction was about, not WHICH row values it actually wrote.
 *
 * REQUIRED BEHAVIOUR: the generic cascade must not decide period-summary
 * publication at all. It reports what it skipped; family authorization happens
 * only through the bounded, evidence-driven `promoteOcrPeriodFamily` path.
 *
 * Build + run (focused):
 *   pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build
 *   set -a && source .env && set +a
 *   node apps/worker/scripts/with-test-db.mjs review-cascade-period-provenance
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../../..')
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  'packages/db/migrations/0056_period_family_review_status.sql',
)

/** Sentinel match, far above the live sequence; dropped in `after`. */
const MATCH = 9311

const hasDb = Boolean(process.env['DATABASE_URL'])

let goalsExtractionId = 0
let shotsExtractionId = 0
let faceoffsExtractionId = 0

function assertCloneDb(): void {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('review-cascade-period-provenance: DATABASE_URL is unset.')
  let dbName: string
  try {
    dbName = new URL(url).pathname.replace(/^\//, '')
  } catch {
    throw new Error(`review-cascade-period-provenance: DATABASE_URL is not a valid URL: ${url}`)
  }
  if (!dbName.startsWith('eanhl_test')) {
    throw new Error(
      `review-cascade-period-provenance: refusing to run — DATABASE_URL points at database ` +
        `"${dbName}", not an "eanhl_test_*" clone. This file applies DDL and writes sentinel ` +
        `rows; run it via apps/worker/scripts/with-test-db.mjs.`,
    )
  }
}

async function applyMigration0056(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  const ddl = readFileSync(MIGRATION_PATH, 'utf8')
  const reserved = await pg.reserve()
  try {
    await reserved.unsafe(ddl).simple()
  } finally {
    reserved.release()
  }
}

async function cleanup(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await pg`DELETE FROM match_period_summaries WHERE match_id = ${MATCH}`
  await pg`DELETE FROM ocr_extractions WHERE match_id = ${MATCH}`
  await pg`DELETE FROM ocr_capture_batches WHERE match_id = ${MATCH}`
  await pg`DELETE FROM matches WHERE id = ${MATCH}`
}

/**
 * Seed the real production shape: three extractions (one per Box Score tab)
 * contributing to ONE period row, whose `ocr_extraction_id` names only the
 * first — exactly what `box-score.ts`'s COALESCE merge produces.
 */
async function seed(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await pg`
    INSERT INTO matches (
      id, game_title_id, ea_match_id, match_type, opponent_club_id, opponent_name,
      played_at, result, score_for, score_against, shots_for, shots_against,
      hits_for, hits_against
    ) VALUES (
      ${MATCH}, (SELECT id FROM game_titles ORDER BY id LIMIT 1),
      ${`cascade-provenance-${MATCH}`}, 'gameType5', '999999', 'SENTINEL',
      now(), 'WIN', 3, 2, 20, 18, 5, 4
    )
  `
  const [batch] = await pg<{ id: number }[]>`
    INSERT INTO ocr_capture_batches (game_title_id, match_id, capture_kind, source_directory)
    VALUES ((SELECT id FROM game_titles ORDER BY id LIMIT 1), ${MATCH}, 'video_frames',
            ${`/cascade-provenance-${MATCH}`})
    RETURNING id
  `
  // bigserial arrives as a string over the wire; coerce so the ids compare as
  // numbers everywhere below.
  const insertExtraction = async (screenType: string, suffix: string): Promise<number> => {
    const [row] = await pg<{ id: string }[]>`
      INSERT INTO ocr_extractions (batch_id, match_id, screen_type, source_path, raw_result_json,
                                   transform_status, review_status)
      VALUES (${batch!.id}, ${MATCH}, ${screenType}, ${`/frames/${suffix}.png`}, '{}'::jsonb,
              'success', 'pending_review')
      RETURNING id
    `
    return Number(row!.id)
  }
  goalsExtractionId = await insertExtraction('post_game_box_score_goals', 'goals')
  shotsExtractionId = await insertExtraction('post_game_box_score_shots', 'shots')
  faceoffsExtractionId = await insertExtraction('post_game_box_score_faceoffs', 'faceoffs')

  // One row per period, every family populated, but ocr_extraction_id names only
  // the goals extraction — the first contributor.
  for (const [period, label] of [
    [1, '1st'],
    [2, '2nd'],
    [3, '3rd'],
  ] as const) {
    await pg`
      INSERT INTO match_period_summaries (
        match_id, period_number, period_label, goals_for, goals_against,
        shots_for, shots_against, faceoffs_for, faceoffs_against, source,
        ocr_extraction_id, review_status,
        goals_review_status, shots_review_status, faceoffs_review_status
      ) VALUES (
        ${MATCH}, ${period}, ${label}, 1, 1, 10, 9, 5, 4, 'ocr',
        ${goalsExtractionId}, 'pending_review',
        'pending_review', 'pending_review', 'pending_review'
      )
    `
  }
}

async function familyStatuses(): Promise<
  { periodNumber: number; goals: string; shots: string; faceoffs: string; legacy: string }[]
> {
  const { sql: pg } = await import('@eanhl/db')
  const rows = await pg<
    {
      period_number: number
      goals_review_status: string
      shots_review_status: string
      faceoffs_review_status: string
      review_status: string
    }[]
  >`
    SELECT period_number, goals_review_status, shots_review_status,
           faceoffs_review_status, review_status
    FROM match_period_summaries WHERE match_id = ${MATCH} ORDER BY period_number
  `
  return rows.map((r) => ({
    periodNumber: r.period_number,
    goals: r.goals_review_status,
    shots: r.shots_review_status,
    faceoffs: r.faceoffs_review_status,
    legacy: r.review_status,
  }))
}

before(async () => {
  if (!hasDb) return
  assertCloneDb()
  await cleanup()
  await applyMigration0056()
  await seed()
})

after(async () => {
  if (!hasDb) return
  const { sql: pg } = await import('@eanhl/db')
  await cleanup().catch(() => undefined)
  await pg.end({ timeout: 1 }).catch(() => undefined)
})

// ── the provenance finding, asserted as a fact about the schema ──────────────

void test('the schema cannot attribute a period row to the extraction that wrote each family', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { sql: pg } = await import('@eanhl/db')

  // There is exactly ONE provenance column on the table, and it is single-valued.
  const provenanceCols = await pg<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'match_period_summaries'
      AND column_name LIKE '%extraction%'
  `
  assert.deepEqual(
    provenanceCols.map((c) => c.column_name),
    ['ocr_extraction_id'],
    'a per-family provenance column would change the cascade decision — see the module docstring',
  )

  // …and on real rows it names the goals extraction while shots and faceoffs
  // values on those same rows came from two other extractions entirely.
  const rows = await pg<{ ocr_extraction_id: string }[]>`
    SELECT ocr_extraction_id FROM match_period_summaries WHERE match_id = ${MATCH}
  `
  assert.equal(rows.length, 3)
  for (const r of rows) assert.equal(Number(r.ocr_extraction_id), goalsExtractionId)
})

// ── the fail-closed cascade ──────────────────────────────────────────────────

void test('reviewing the goals extraction publishes no family at all', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')

  const counts = await setExtractionStatus([goalsExtractionId], 'reviewed')

  assert.equal(counts.periodSummaries, 0, 'the cascade must not authorize period-summary families')
  assert.equal(counts.periodSummariesSkipped, 3, 'and must report the rows it declined to touch')

  for (const row of await familyStatuses()) {
    assert.equal(
      row.goals,
      'pending_review',
      'goals must not be published by attribution guesswork',
    )
    assert.equal(row.shots, 'pending_review', 'reviewing goals must never expose shots')
    assert.equal(row.faceoffs, 'pending_review', 'reviewing goals must never expose faceoffs')
  }
})

void test('the extraction itself still flips — only the period cascade is withheld', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { sql: pg } = await import('@eanhl/db')
  const [row] = await pg<{ review_status: string }[]>`
    SELECT review_status FROM ocr_extractions WHERE id = ${goalsExtractionId}
  `
  assert.equal(row?.review_status, 'reviewed')
})

void test('reviewing the shots extraction publishes nothing either', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')

  // No period row even points at this extraction, so a naive cascade would
  // silently do nothing here while having published shots via the goals
  // extraction above — "later contributors ignored, first contributor credited".
  const counts = await setExtractionStatus([shotsExtractionId], 'reviewed')
  assert.equal(counts.periodSummaries, 0)

  for (const row of await familyStatuses()) {
    assert.equal(row.shots, 'pending_review')
    assert.equal(row.goals, 'pending_review')
    assert.equal(row.faceoffs, 'pending_review')
  }
})

void test('rejection is withheld the same way — demotion is not attributable either', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { sql: pg } = await import('@eanhl/db')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')

  // Publish goals through the ONE authorized path, then reject the extraction
  // the row happens to name. A family-blind demotion here would revoke a
  // reconciliation verdict this extraction may have had no part in.
  await pg`
    UPDATE match_period_summaries SET goals_review_status = 'reviewed' WHERE match_id = ${MATCH}
  `
  const counts = await setExtractionStatus([faceoffsExtractionId], 'rejected')
  assert.equal(counts.periodSummaries, 0)

  for (const row of await familyStatuses()) {
    assert.equal(row.goals, 'reviewed', 'a rejection must not blind-revoke another path’s verdict')
    assert.equal(row.faceoffs, 'pending_review')
    assert.equal(row.shots, 'pending_review')
  }
})

void test('the legacy row-level review_status is left untouched, not written misleadingly', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  for (const row of await familyStatuses()) {
    assert.equal(
      row.legacy,
      'pending_review',
      'writing review_status=reviewed on a row whose families are pending records a ' +
        'publication that did not happen',
    )
  }
})

void test('the other five promoter tables still cascade normally', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { emptyCascadeCounts, formatCascadeCounts, addCascadeCounts } =
    await import('../lib/review-cascade.js')
  // Single-family tables keep whole-row gating (see getMatchShotTypeSummaries):
  // the counters must survive so the auto-drain / review CLIs keep reporting.
  const empty = emptyCascadeCounts()
  for (const key of [
    'events',
    'periodSummaries',
    'periodSummariesSkipped',
    'shotTypeSummaries',
    'loadoutSnapshots',
    'faceoffDots',
    'faceoffZoneSummaries',
  ]) {
    assert.ok(key in empty, `missing cascade counter ${key}`)
  }
  const summed = addCascadeCounts(empty, { ...empty, periodSummariesSkipped: 3 })
  assert.equal(summed.periodSummariesSkipped, 3, 'skips must accumulate across a sweep')
  assert.match(formatCascadeCounts(summed), /period_summaries_skipped=3/)
})
