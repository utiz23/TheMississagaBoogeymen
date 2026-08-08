/**
 * Review-cascade REVOCATION for period summaries — the asymmetric fail-closed
 * half of the migration-0056 provenance gap.
 *
 * THE DEFECT UNDER TEST
 * ---------------------
 * `setExtractionStatus` skipped `match_period_summaries` for EVERY status,
 * because per-family provenance is ambiguous (see
 * `review-cascade-period-provenance.test.ts` for the ambiguity itself).
 *
 * Skipping is CORRECT on approval: ambiguous attribution must never be used to
 * WIDEN publication, or reviewing the one extraction a row happens to name would
 * publish two other extractions' values.
 *
 * Skipping is UNSAFE on `pending_review` / `rejected`. Those directions NARROW
 * publication, and the same ambiguity now cuts the other way: an extraction that
 * may well have contributed to an already-published family gets demoted or
 * rejected, and the family stays visible — because the cascade declined to act.
 * Data an operator has explicitly rejected therefore keeps rendering on the
 * recap. Ambiguity is a reason to withhold MORE, never to keep showing.
 *
 * REQUIRED BEHAVIOUR — asymmetry:
 *   * `reviewed`         → still skip. Approval never widens through ambiguity.
 *   * `pending_review` /
 *     `rejected`         → conservatively quarantine every OCR period row of
 *                          every affected match, so nothing survives purely
 *                          because the cascade looked away.
 *
 * THE ASSOCIATION USED. Attribution is impossible, so the cascade does not
 * attempt it: it takes the MATCH as the unit. A match is affected if it is named
 * by any demoted extraction (`ocr_extractions.match_id`) OR if any of its period
 * rows names one (`match_period_summaries.ocr_extraction_id`). Both directions
 * are needed — the first catches a contributor no row names (the COALESCE merge
 * records only the first), the second catches a row naming an extraction whose
 * own `match_id` is absent. Over-withholding is the intended cost.
 *
 * Build + run (focused):
 *   pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build
 *   set -a && source .env && set +a
 *   node apps/worker/scripts/with-test-db.mjs review-cascade-period-revocation
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../../..')
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  'packages/db/migrations/0056_period_family_review_status.sql',
)
const REVIEW_CLI = path.join(REPO_ROOT, 'apps/worker/dist/ingest-ocr-review-cli.js')

/** Sentinel matches, far above the live sequence. Dropped in `after`. */
const MATCH_A = 9321
const MATCH_B = 9322
const ALL_MATCHES = [MATCH_A, MATCH_B]

const hasDb = Boolean(process.env['DATABASE_URL'])

/** MATCH_A's three Box Score tabs; only `goalsExtractionId` is named by a row. */
let goalsExtractionId = 0
let shotsExtractionId = 0
let faceoffsExtractionId = 0
/** MATCH_A's event/shot-type extraction — the reliable-provenance control. */
let eventsExtractionId = 0
/** MATCH_B's extraction. Nothing here may ever touch MATCH_B. */
let unrelatedExtractionId = 0

function assertCloneDb(): void {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('review-cascade-period-revocation: DATABASE_URL is unset.')
  let dbName: string
  try {
    dbName = new URL(url).pathname.replace(/^\//, '')
  } catch {
    throw new Error(`review-cascade-period-revocation: DATABASE_URL is not a valid URL: ${url}`)
  }
  if (!dbName.startsWith('eanhl_test')) {
    throw new Error(
      `review-cascade-period-revocation: refusing to run — DATABASE_URL points at database ` +
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
  await pg`DELETE FROM match_period_summaries WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM match_shot_type_summaries WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM match_events WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM ocr_extractions WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM ocr_capture_batches WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM matches WHERE id = ANY(${ALL_MATCHES})`
}

async function seedMatch(matchId: number): Promise<{ batchId: number }> {
  const { sql: pg } = await import('@eanhl/db')
  await pg`
    INSERT INTO matches (
      id, game_title_id, ea_match_id, match_type, opponent_club_id, opponent_name,
      played_at, result, score_for, score_against, shots_for, shots_against,
      hits_for, hits_against
    ) VALUES (
      ${matchId}, (SELECT id FROM game_titles ORDER BY id LIMIT 1),
      ${`cascade-revocation-${matchId}`}, 'gameType5', '999999', 'SENTINEL',
      now(), 'WIN', 3, 2, 20, 18, 5, 4
    )
  `
  const [batch] = await pg<{ id: number }[]>`
    INSERT INTO ocr_capture_batches (game_title_id, match_id, capture_kind, source_directory)
    VALUES ((SELECT id FROM game_titles ORDER BY id LIMIT 1), ${matchId}, 'video_frames',
            ${`/cascade-revocation-${matchId}`})
    RETURNING id
  `
  return { batchId: batch!.id }
}

async function insertExtraction(
  batchId: number,
  matchId: number,
  screenType: string,
  suffix: string,
): Promise<number> {
  const { sql: pg } = await import('@eanhl/db')
  // bigserial arrives as a string over the wire; coerce so ids compare as numbers.
  const [row] = await pg<{ id: string }[]>`
    INSERT INTO ocr_extractions (batch_id, match_id, screen_type, source_path, raw_result_json,
                                 transform_status, review_status)
    VALUES (${batchId}, ${matchId}, ${screenType}, ${`/frames/${String(matchId)}-${suffix}.png`},
            '{}'::jsonb, 'success', 'pending_review')
    RETURNING id
  `
  return Number(row!.id)
}

/** Three period rows, every family populated, naming ONE contributor. */
async function insertPeriodRows(matchId: number, namedExtractionId: number): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
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
        ${matchId}, ${period}, ${label}, 1, 1, 10, 9, 5, 4, 'ocr',
        ${namedExtractionId}, 'pending_review',
        'pending_review', 'pending_review', 'pending_review'
      )
    `
  }
}

interface FamilyStatusRow {
  periodNumber: number
  goals: string
  shots: string
  faceoffs: string
  legacy: string
}

async function familyStatuses(matchId: number): Promise<FamilyStatusRow[]> {
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
    FROM match_period_summaries WHERE match_id = ${matchId} ORDER BY period_number
  `
  return rows.map((r) => ({
    periodNumber: r.period_number,
    goals: r.goals_review_status,
    shots: r.shots_review_status,
    faceoffs: r.faceoffs_review_status,
    legacy: r.review_status,
  }))
}

/** Publish every family of a match's period rows, simulating a prior promotion. */
async function publishAll(matchId: number): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await pg`
    UPDATE match_period_summaries
    SET goals_review_status = 'reviewed',
        shots_review_status = 'reviewed',
        faceoffs_review_status = 'reviewed'
    WHERE match_id = ${matchId}
  `
}

async function resetExtractionStatuses(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await pg`
    UPDATE ocr_extractions SET review_status = 'pending_review', reviewed_at = NULL
    WHERE match_id = ANY(${ALL_MATCHES})
  `
}

/** Nothing of this family is visible on any row of the match. */
function assertFullyQuarantined(rows: FamilyStatusRow[], why: string): void {
  assert.ok(rows.length > 0, 'fixture must have period rows')
  for (const row of rows) {
    assert.notEqual(row.goals, 'reviewed', `${why} (P${String(row.periodNumber)} goals)`)
    assert.notEqual(row.shots, 'reviewed', `${why} (P${String(row.periodNumber)} shots)`)
    assert.notEqual(row.faceoffs, 'reviewed', `${why} (P${String(row.periodNumber)} faceoffs)`)
  }
}

before(async () => {
  if (!hasDb) return
  assertCloneDb()
  await cleanup()
  await applyMigration0056()

  const { sql: pg } = await import('@eanhl/db')

  const a = await seedMatch(MATCH_A)
  goalsExtractionId = await insertExtraction(a.batchId, MATCH_A, 'post_game_box_score_goals', 'g')
  shotsExtractionId = await insertExtraction(a.batchId, MATCH_A, 'post_game_box_score_shots', 's')
  faceoffsExtractionId = await insertExtraction(
    a.batchId,
    MATCH_A,
    'post_game_box_score_faceoffs',
    'f',
  )
  eventsExtractionId = await insertExtraction(a.batchId, MATCH_A, 'post_game_events', 'e')
  await insertPeriodRows(MATCH_A, goalsExtractionId)

  // Reliable-provenance controls: single-family tables whose one
  // ocr_extraction_id genuinely does identify the writer.
  await pg`
    INSERT INTO match_shot_type_summaries (
      match_id, team_side, period_number, period_label, total_shots, wrist_shots, source,
      ocr_extraction_id, review_status
    ) VALUES (${MATCH_A}, 'for', 1, '1st', 10, 4, 'ocr', ${eventsExtractionId}, 'reviewed')
  `
  await pg`
    INSERT INTO match_events (
      match_id, period_number, period_label, event_type, team_side, source,
      ocr_extraction_id, review_status
    ) VALUES (${MATCH_A}, 1, '1st', 'goal', 'for', 'ocr', ${eventsExtractionId}, 'reviewed')
  `

  // MATCH_B is a bystander: fully published, referenced by nothing above.
  const b = await seedMatch(MATCH_B)
  unrelatedExtractionId = await insertExtraction(
    b.batchId,
    MATCH_B,
    'post_game_box_score_goals',
    'g',
  )
  await insertPeriodRows(MATCH_B, unrelatedExtractionId)
  await publishAll(MATCH_B)
})

after(async () => {
  if (!hasDb) return
  const { sql: pg } = await import('@eanhl/db')
  await cleanup().catch(() => undefined)
  await pg.end({ timeout: 1 }).catch(() => undefined)
})

// ── 1. approval must NOT widen ───────────────────────────────────────────────

void test('approving an extraction publishes no period family and demotes nothing', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')
  await resetExtractionStatuses()

  const counts = await setExtractionStatus([goalsExtractionId], 'reviewed')

  assert.equal(counts.periodSummaries, 0, 'approval must never authorize a family')
  assert.equal(counts.periodSummariesSkipped, 3, 'and must report the rows it declined to touch')
  assert.equal(counts.periodSummariesQuarantined, 0, 'approval quarantines nothing')

  for (const row of await familyStatuses(MATCH_A)) {
    assert.equal(row.goals, 'pending_review')
    assert.equal(row.shots, 'pending_review')
    assert.equal(row.faceoffs, 'pending_review')
    assert.equal(row.legacy, 'pending_review')
  }
})

void test('approval does not demote an ALREADY published family either', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')
  await resetExtractionStatuses()
  await publishAll(MATCH_A)

  const counts = await setExtractionStatus([goalsExtractionId], 'reviewed')
  assert.equal(counts.periodSummariesQuarantined, 0)
  for (const row of await familyStatuses(MATCH_A)) {
    assert.equal(row.goals, 'reviewed', 'approval is not a revocation')
    assert.equal(row.shots, 'reviewed')
    assert.equal(row.faceoffs, 'reviewed')
  }
})

// ── 2. demotion must hide ────────────────────────────────────────────────────

void test('demoting a possibly-contributing extraction hides published period data', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')
  await resetExtractionStatuses()
  await publishAll(MATCH_A)

  const counts = await setExtractionStatus([goalsExtractionId], 'pending_review')

  assert.equal(counts.periodSummaries, 0, 'the cascade still publishes nothing')
  assert.equal(counts.periodSummariesQuarantined, 3, 'all three rows were quarantined')
  assert.equal(counts.periodSummariesSkipped, 0, 'a revocation skips nothing')
  assertFullyQuarantined(
    await familyStatuses(MATCH_A),
    'a demoted contributor must not leave its data visible',
  )
})

// ── 3. rejection must hide ───────────────────────────────────────────────────

void test('rejecting a possibly-contributing extraction hides published period data', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')
  await resetExtractionStatuses()
  await publishAll(MATCH_A)

  const counts = await setExtractionStatus([goalsExtractionId], 'rejected')

  assert.equal(counts.periodSummariesQuarantined, 3)
  assertFullyQuarantined(
    await familyStatuses(MATCH_A),
    'rejected data must never stay on the recap',
  )
})

// ── 4. ambiguous contributors are over-withheld ──────────────────────────────

void test('rejecting an extraction NO row names still quarantines the match', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')
  await resetExtractionStatuses()
  await publishAll(MATCH_A)

  // The shots extraction contributed the shots columns, but the COALESCE merge
  // recorded only the goals extraction, so NO row points at it. Attribution says
  // "unrelated"; the truth is "contributor we cannot see". Over-withhold.
  const counts = await setExtractionStatus([shotsExtractionId], 'rejected')

  assert.equal(counts.periodSummariesQuarantined, 3)
  assertFullyQuarantined(
    await familyStatuses(MATCH_A),
    'an unnamed contributor is still a contributor',
  )
})

void test('a mixed batch quarantines every match any member could have touched', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')
  await resetExtractionStatuses()
  await publishAll(MATCH_A)
  await publishAll(MATCH_B)

  const counts = await setExtractionStatus(
    [faceoffsExtractionId, unrelatedExtractionId],
    'rejected',
  )

  assert.equal(counts.periodSummariesQuarantined, 6, 'both matches quarantine, 3 rows each')
  assertFullyQuarantined(await familyStatuses(MATCH_A), 'MATCH_A had a rejected contributor')
  assertFullyQuarantined(await familyStatuses(MATCH_B), 'MATCH_B had a rejected contributor')
})

void test('an already-rejected family is not weakened back to pending', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { sql: pg } = await import('@eanhl/db')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')
  await resetExtractionStatuses()
  await publishAll(MATCH_A)
  await pg`
    UPDATE match_period_summaries SET shots_review_status = 'rejected'
    WHERE match_id = ${MATCH_A} AND period_number = 2
  `

  await setExtractionStatus([goalsExtractionId], 'rejected')

  const rows = await familyStatuses(MATCH_A)
  assert.equal(
    rows.find((r) => r.periodNumber === 2)?.shots,
    'rejected',
    'quarantine withholds; it must not erase an explicit operator rejection',
  )
  assertFullyQuarantined(rows, 'everything else is quarantined')
})

// ── 5. unrelated matches are untouched ───────────────────────────────────────

void test('an unrelated match keeps its published period families', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')
  await resetExtractionStatuses()
  await publishAll(MATCH_A)
  await publishAll(MATCH_B)

  const counts = await setExtractionStatus([goalsExtractionId], 'rejected')

  assert.equal(counts.periodSummariesQuarantined, 3, 'only MATCH_A’s three rows')
  for (const row of await familyStatuses(MATCH_B)) {
    assert.equal(row.goals, 'reviewed', 'MATCH_B shares no extraction with MATCH_A')
    assert.equal(row.shots, 'reviewed')
    assert.equal(row.faceoffs, 'reviewed')
  }
})

// ── 6. reliable-provenance tables still cascade both ways ────────────────────

void test('tables with reliable single-extraction provenance still cascade', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { sql: pg } = await import('@eanhl/db')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')
  await resetExtractionStatuses()

  const rejected = await setExtractionStatus([eventsExtractionId], 'rejected')
  assert.equal(rejected.events, 1, 'match_events still cascades by ocr_extraction_id')
  assert.equal(rejected.shotTypeSummaries, 1, 'match_shot_type_summaries still cascades')

  const [event] = await pg<{ review_status: string }[]>`
    SELECT review_status FROM match_events WHERE ocr_extraction_id = ${eventsExtractionId}
  `
  assert.equal(event?.review_status, 'rejected')

  const promoted = await setExtractionStatus([eventsExtractionId], 'reviewed')
  assert.equal(promoted.events, 1, 'and back again — approval still cascades to those tables')
  const [again] = await pg<{ review_status: string }[]>`
    SELECT review_status FROM match_events WHERE ocr_extraction_id = ${eventsExtractionId}
  `
  assert.equal(again?.review_status, 'reviewed')
})

// ── 7. counts and CLI reporting describe what happened ───────────────────────

void test('the counters are additive and formatted for the CLIs', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { emptyCascadeCounts, addCascadeCounts, formatCascadeCounts } =
    await import('../lib/review-cascade.js')
  const empty = emptyCascadeCounts()
  assert.equal(empty.periodSummariesQuarantined, 0)

  const summed = addCascadeCounts(
    { ...empty, periodSummariesSkipped: 3 },
    { ...empty, periodSummariesQuarantined: 6 },
  )
  assert.equal(summed.periodSummariesSkipped, 3, 'skips accumulate across a sweep')
  assert.equal(summed.periodSummariesQuarantined, 6, 'quarantines accumulate too')
  assert.match(formatCascadeCounts(summed), /period_summaries_skipped=3/)
  assert.match(formatCascadeCounts(summed), /period_summaries_quarantined=6/)
})

void test('the review CLI reports a quarantine distinctly from a skip', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  await resetExtractionStatuses()
  await publishAll(MATCH_A)

  const rejectRun = spawnSync(
    'node',
    [REVIEW_CLI, '--extraction', String(goalsExtractionId), '--status', 'rejected'],
    { encoding: 'utf8', env: process.env, maxBuffer: 8 * 1024 * 1024 },
  )
  assert.equal(rejectRun.status, 0, rejectRun.stderr)
  assert.match(rejectRun.stdout, /period_summaries_quarantined=3/)
  assert.match(
    rejectRun.stdout,
    /quarantin/i,
    'an operator must be told publication was withdrawn, not silently left alone',
  )

  const approveRun = spawnSync(
    'node',
    [REVIEW_CLI, '--extraction', String(goalsExtractionId), '--status', 'reviewed'],
    { encoding: 'utf8', env: process.env, maxBuffer: 8 * 1024 * 1024 },
  )
  assert.equal(approveRun.status, 0, approveRun.stderr)
  assert.match(approveRun.stdout, /period_summaries_skipped=3/)
  assert.match(approveRun.stdout, /NOT changed/, 'an approval must say it published nothing')

  // …and the approval genuinely did not re-publish what the rejection withdrew.
  assertFullyQuarantined(
    await familyStatuses(MATCH_A),
    'approving after a rejection must not undo the quarantine',
  )
})
