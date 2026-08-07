/**
 * Per-stat-family review gating on `match_period_summaries` (migration 0056).
 *
 * THE DEFECT UNDER TEST
 * ---------------------
 * A `match_period_summaries` row packs three independently-captured stat
 * families — goals, shots, faceoffs (three separate Box Score tabs) — behind a
 * single `review_status`. The only verdict that can authorize promotion,
 * `reconcilePeriods()`, grades GOALS alone (EA publishes no per-period shot or
 * faceoff breakdown). Flipping the one row-level status therefore published
 * unvalidated shots, unvalidated faceoffs, partially-captured families and
 * phantom OT periods. Migration 0056 splits the status per family;
 * `getMatchPeriodSummaries` now authorizes each family independently, and the
 * whole-row promotion path fails closed.
 *
 * WHY THIS LIVES UNDER apps/worker/src/__tests__
 * ----------------------------------------------
 * It is a DB-mutating integration test, so it must run against a throwaway
 * clone, never the live database. `apps/worker/scripts/with-test-db.mjs` is this
 * repo's only such harness, and it discovers test files under `apps/worker/dist`
 * (see `match-250-benchmark.test.ts` / `quality-flag-class-*.test.ts`, which
 * likewise assert on `@eanhl/db/queries` behaviour). Sibling tests under
 * `packages/db/src/queries/__tests__/` run against whatever `DATABASE_URL`
 * points at — the live-contamination hazard this suite must not repeat. No
 * worker source is touched by this file.
 *
 * Migration 0056 is NOT applied to the live database by this slice, so the clone
 * arrives without the family columns; `before()` applies the migration to the
 * clone itself. That doubles as the migration test — and re-applying it proves
 * idempotency, including that a rerun does not clobber family statuses review
 * has since advanced.
 *
 * Build + run (focused):
 *   pnpm --filter @eanhl/db build
 *   pnpm --filter @eanhl/worker build
 *   set -a && source .env && set +a
 *   node apps/worker/scripts/with-test-db.mjs period-family-review-gating
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// apps/worker/dist/__tests__ → repo root
const REPO_ROOT = path.resolve(HERE, '../../../..')
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  'packages/db/migrations/0056_period_family_review_status.sql',
)

/** Sentinel matches. Far above the live sequence; dropped in `after`. */
const MATCH_MATRIX = 9301 // post-migration family-masking matrix
const MATCH_LEGACY = 9302 // pre-migration rows, exercised by the backfill

const hasDb = Boolean(process.env['DATABASE_URL'])

/**
 * Refuse to run unless `DATABASE_URL` points at a throwaway `eanhl_test_*` clone
 * (mirrors the guard in `__tests__/fixtures/seed-fixture-db.ts`). This file
 * applies DDL and writes sentinel rows; neither may ever reach the live DB.
 */
function assertCloneDb(): void {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('period-family-review-gating: DATABASE_URL is unset.')
  let dbName: string
  try {
    dbName = new URL(url).pathname.replace(/^\//, '')
  } catch {
    throw new Error(`period-family-review-gating: DATABASE_URL is not a valid URL: ${url}`)
  }
  if (!dbName.startsWith('eanhl_test')) {
    throw new Error(
      `period-family-review-gating: refusing to run — DATABASE_URL points at database ` +
        `"${dbName}", not an "eanhl_test_*" clone. This file applies migration 0056 and writes ` +
        `sentinel rows; run it via apps/worker/scripts/with-test-db.mjs.`,
    )
  }
}

// ── fixture ───────────────────────────────────────────────────────────────────

/**
 * Apply the migration file verbatim — BEGIN/COMMIT and all — the way `psql -f`
 * would, so what the test exercises is exactly what an operator will run.
 *
 * A reserved (pinned) connection is required: the file drives its own
 * transaction, and postgres.js rejects a bare `BEGIN` issued on a pooled
 * connection (`UNSAFE_TRANSACTION`). Simple protocol so the multi-statement
 * script and its `DO $$ … $$` blocks go through in one round trip.
 */
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

async function cleanupSentinels(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await pg`DELETE FROM match_period_summaries WHERE match_id IN (${MATCH_MATRIX}, ${MATCH_LEGACY})`
  await pg`DELETE FROM matches WHERE id IN (${MATCH_MATRIX}, ${MATCH_LEGACY})`
}

/**
 * Return the clone to a genuine PRE-0056 state.
 *
 * The suite shares one clone across test files, and more than one file now
 * applies 0056 (`period-family-promotion.test.ts` sorts before this one). 0056
 * is idempotent — it backfills a family only when the column is ABSENT — so if
 * another file already added the columns, the legacy rows this file seeds
 * afterwards would arrive with the DEFAULT `pending_review` and the backfill
 * assertions below would be testing nothing. Dropping first makes this file
 * self-contained and its results independent of execution order.
 */
async function dropFamilyColumns(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await pg`
    ALTER TABLE match_period_summaries
      DROP COLUMN IF EXISTS goals_review_status,
      DROP COLUMN IF EXISTS shots_review_status,
      DROP COLUMN IF EXISTS faceoffs_review_status
  `
}

async function seedSentinelMatches(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  for (const id of [MATCH_MATRIX, MATCH_LEGACY]) {
    await pg`
      INSERT INTO matches (
        id, game_title_id, ea_match_id, match_type, opponent_club_id, opponent_name,
        played_at, result, score_for, score_against, shots_for, shots_against,
        hits_for, hits_against
      ) VALUES (
        ${id}, (SELECT id FROM game_titles ORDER BY id LIMIT 1),
        ${`period-family-sentinel-${id}`}, 'gameType5', '999999', 'SENTINEL',
        now(), 'WIN', 3, 2, 20, 18, 5, 4
      )
    `
  }
}

/**
 * Rows as they exist BEFORE migration 0056 — legacy columns only, no family
 * statuses. These are what the backfill must preserve.
 */
async function seedPreMigrationLegacyRows(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  // Legacy REVIEWED: fully visible pre-migration, must stay fully visible.
  await pg`
    INSERT INTO match_period_summaries (
      match_id, period_number, period_label, goals_for, goals_against,
      shots_for, shots_against, faceoffs_for, faceoffs_against, source, review_status
    ) VALUES (${MATCH_LEGACY}, 1, '1st', 3, 2, 12, 9, 6, 5, 'ocr', 'reviewed')
  `
  // Legacy PENDING: invisible pre-migration, must stay invisible.
  await pg`
    INSERT INTO match_period_summaries (
      match_id, period_number, period_label, goals_for, goals_against,
      shots_for, shots_against, faceoffs_for, faceoffs_against, source, review_status
    ) VALUES (${MATCH_LEGACY}, 2, '2nd', 1, 1, 5, 4, 3, 3, 'ocr', 'pending_review')
  `
}

/**
 * The family-masking matrix, inserted post-migration in deliberately scrambled
 * period order so the ordering assertion is not satisfied by insertion order.
 */
async function seedFamilyMatrix(): Promise<void> {
  const { db, matchPeriodSummaries } = await import('@eanhl/db')
  await db.insert(matchPeriodSummaries).values([
    // p6 — two families reviewed, shots still pending.
    {
      matchId: MATCH_MATRIX,
      periodNumber: 6,
      periodLabel: 'OT3',
      goalsFor: 1,
      goalsAgainst: 2,
      shotsFor: 11,
      shotsAgainst: 10,
      faceoffsFor: 6,
      faceoffsAgainst: 7,
      source: 'ocr',
      reviewStatus: 'pending_review',
      goalsReviewStatus: 'reviewed',
      shotsReviewStatus: 'pending_review',
      faceoffsReviewStatus: 'reviewed',
    },
    // p2 — every family pending: the row must not survive at all.
    {
      matchId: MATCH_MATRIX,
      periodNumber: 2,
      periodLabel: '2nd',
      goalsFor: 9,
      goalsAgainst: 9,
      shotsFor: 9,
      shotsAgainst: 9,
      faceoffsFor: 9,
      faceoffsAgainst: 9,
      source: 'ocr',
      reviewStatus: 'pending_review',
      goalsReviewStatus: 'pending_review',
      shotsReviewStatus: 'pending_review',
      faceoffsReviewStatus: 'pending_review',
    },
    // p8 — LEGACY reviewed, but only goals reviewed per-family; faceoffs
    // explicitly rejected (rejected is not reviewed).
    {
      matchId: MATCH_MATRIX,
      periodNumber: 8,
      periodLabel: 'OT5',
      goalsFor: 5,
      goalsAgainst: 1,
      shotsFor: 22,
      shotsAgainst: 20,
      faceoffsFor: 9,
      faceoffsAgainst: 8,
      source: 'ocr',
      reviewStatus: 'reviewed',
      goalsReviewStatus: 'reviewed',
      shotsReviewStatus: 'pending_review',
      faceoffsReviewStatus: 'rejected',
    },
    // p4 — shots reviewed only, and half-read (shots_against never captured).
    {
      matchId: MATCH_MATRIX,
      periodNumber: 4,
      periodLabel: 'OT',
      goalsFor: 2,
      goalsAgainst: 2,
      shotsFor: 7,
      faceoffsFor: 4,
      faceoffsAgainst: 4,
      source: 'ocr',
      reviewStatus: 'pending_review',
      goalsReviewStatus: 'pending_review',
      shotsReviewStatus: 'reviewed',
      faceoffsReviewStatus: 'pending_review',
    },
    // p1 — EA source with every family pending: review must not apply at all.
    {
      matchId: MATCH_MATRIX,
      periodNumber: 1,
      periodLabel: '1st',
      goalsFor: 2,
      goalsAgainst: 1,
      shotsFor: 20,
      shotsAgainst: 18,
      faceoffsFor: 11,
      faceoffsAgainst: 9,
      source: 'ea',
      reviewStatus: 'pending_review',
      goalsReviewStatus: 'pending_review',
      shotsReviewStatus: 'pending_review',
      faceoffsReviewStatus: 'pending_review',
    },
    // p7 — LEGACY reviewed with every family pending: must not survive.
    {
      matchId: MATCH_MATRIX,
      periodNumber: 7,
      periodLabel: 'OT4',
      goalsFor: 4,
      goalsAgainst: 4,
      shotsFor: 4,
      shotsAgainst: 4,
      faceoffsFor: 4,
      faceoffsAgainst: 4,
      source: 'ocr',
      reviewStatus: 'reviewed',
      goalsReviewStatus: 'pending_review',
      shotsReviewStatus: 'pending_review',
      faceoffsReviewStatus: 'pending_review',
    },
    // p3 — goals reviewed only, and a legitimate 0-0 period.
    {
      matchId: MATCH_MATRIX,
      periodNumber: 3,
      periodLabel: '3rd',
      goalsFor: 0,
      goalsAgainst: 0,
      shotsFor: 14,
      shotsAgainst: 13,
      faceoffsFor: 7,
      faceoffsAgainst: 6,
      source: 'ocr',
      reviewStatus: 'pending_review',
      goalsReviewStatus: 'reviewed',
      shotsReviewStatus: 'pending_review',
      faceoffsReviewStatus: 'pending_review',
    },
    // p5 — manual source, faceoffs reviewed only.
    {
      matchId: MATCH_MATRIX,
      periodNumber: 5,
      periodLabel: 'OT2',
      goalsFor: 3,
      goalsAgainst: 3,
      shotsFor: 8,
      shotsAgainst: 8,
      faceoffsFor: 5,
      faceoffsAgainst: 4,
      source: 'manual',
      reviewStatus: 'pending_review',
      goalsReviewStatus: 'pending_review',
      shotsReviewStatus: 'pending_review',
      faceoffsReviewStatus: 'reviewed',
    },
  ])
}

// ── helpers ───────────────────────────────────────────────────────────────────

type VisibleRow = Awaited<
  ReturnType<typeof import('@eanhl/db/queries').getMatchPeriodSummaries>
>[number]

function period(rows: VisibleRow[], n: number): VisibleRow {
  const row = rows.find((r) => r.periodNumber === n)
  assert.ok(row, `expected period ${n} to be visible, got [${rows.map((r) => r.periodNumber)}]`)
  return row
}

/** Raw (ungated) read, for asserting stored state rather than exposed state. */
async function rawRows(matchId: number) {
  const { db, matchPeriodSummaries } = await import('@eanhl/db')
  const { asc, eq } = await import('drizzle-orm')
  return db
    .select()
    .from(matchPeriodSummaries)
    .where(eq(matchPeriodSummaries.matchId, matchId))
    .orderBy(asc(matchPeriodSummaries.periodNumber))
}

// ── lifecycle ─────────────────────────────────────────────────────────────────

before(async () => {
  if (!hasDb) return
  assertCloneDb()
  await cleanupSentinels()
  // Undo any 0056 an earlier test file applied to the shared clone, so this file
  // always exercises the real pre-migration → migration transition.
  await dropFamilyColumns()
  await seedSentinelMatches()
  // Legacy rows must exist BEFORE the migration so the backfill acts on them.
  await seedPreMigrationLegacyRows()
  await applyMigration0056()
  await seedFamilyMatrix()
})

after(async () => {
  if (!hasDb) return
  const { sql: pg } = await import('@eanhl/db')
  await cleanupSentinels().catch(() => undefined)
  await pg.end({ timeout: 1 }).catch(() => undefined)
})

// ── migration ─────────────────────────────────────────────────────────────────

void test('0056 adds three NOT NULL family statuses defaulting to pending_review', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { sql: pg } = await import('@eanhl/db')
  const cols = await pg<{ column_name: string; is_nullable: string; column_default: string }[]>`
    SELECT column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'match_period_summaries'
      AND column_name IN ('goals_review_status', 'shots_review_status', 'faceoffs_review_status')
    ORDER BY column_name
  `
  assert.equal(cols.length, 3)
  for (const c of cols) {
    assert.equal(c.is_nullable, 'NO', `${c.column_name} must be NOT NULL`)
    assert.match(c.column_default, /pending_review/, `${c.column_name} must default pending_review`)
  }

  const checks = await pg<{ conname: string }[]>`
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'match_period_summaries'::regclass AND contype = 'c'
    ORDER BY conname
  `
  const names = checks.map((c) => c.conname)
  for (const family of ['goals', 'shots', 'faceoffs']) {
    assert.ok(
      names.includes(`match_period_summaries_${family}_review_status_chk`),
      `missing CHECK for ${family}: got ${names.join(', ')}`,
    )
  }
})

void test('0056 CHECK rejects a status outside the OcrReviewStatus union', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { sql: pg } = await import('@eanhl/db')
  await assert.rejects(
    () => pg`
      UPDATE match_period_summaries SET goals_review_status = 'approved'
      WHERE match_id = ${MATCH_MATRIX} AND period_number = 3
    `,
    /match_period_summaries_goals_review_status_chk|violates check constraint/i,
  )
  const rows = await rawRows(MATCH_MATRIX)
  assert.equal(rows.find((r) => r.periodNumber === 3)?.goalsReviewStatus, 'reviewed')
})

void test('a new row defaults all three family statuses to pending_review', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { db, matchPeriodSummaries } = await import('@eanhl/db')
  const { and, eq } = await import('drizzle-orm')
  // Period 9 stays invisible (all families pending), so it cannot perturb the
  // masking/ordering assertions below.
  await db.insert(matchPeriodSummaries).values({
    matchId: MATCH_MATRIX,
    periodNumber: 9,
    periodLabel: 'OT6',
    goalsFor: 1,
    goalsAgainst: 1,
    source: 'ocr',
  })
  const [row] = await db
    .select()
    .from(matchPeriodSummaries)
    .where(
      and(eq(matchPeriodSummaries.matchId, MATCH_MATRIX), eq(matchPeriodSummaries.periodNumber, 9)),
    )
  assert.ok(row)
  assert.equal(row.goalsReviewStatus, 'pending_review')
  assert.equal(row.shotsReviewStatus, 'pending_review')
  assert.equal(row.faceoffsReviewStatus, 'pending_review')
  assert.equal(row.reviewStatus, 'pending_review')
})

void test('0056 backfills each family verbatim from the legacy review_status', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const rows = await rawRows(MATCH_LEGACY)
  const legacyReviewed = rows.find((r) => r.periodNumber === 1)
  const legacyPending = rows.find((r) => r.periodNumber === 2)
  assert.ok(legacyReviewed && legacyPending)

  assert.equal(legacyReviewed.goalsReviewStatus, 'reviewed')
  assert.equal(legacyReviewed.shotsReviewStatus, 'reviewed')
  assert.equal(legacyReviewed.faceoffsReviewStatus, 'reviewed')

  assert.equal(legacyPending.goalsReviewStatus, 'pending_review')
  assert.equal(legacyPending.shotsReviewStatus, 'pending_review')
  assert.equal(legacyPending.faceoffsReviewStatus, 'pending_review')
})

void test('backfilled legacy rows keep exactly their pre-migration visibility', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { getMatchPeriodSummaries } = await import('@eanhl/db/queries')
  const rows = await getMatchPeriodSummaries(MATCH_LEGACY)
  // Pre-migration: the reviewed row was visible with every value, the pending
  // row was excluded. Both must be unchanged — 0056 remediates nothing.
  assert.deepEqual(
    rows.map((r) => r.periodNumber),
    [1],
  )
  const p1 = period(rows, 1)
  assert.equal(p1.goalsFor, 3)
  assert.equal(p1.goalsAgainst, 2)
  assert.equal(p1.shotsFor, 12)
  assert.equal(p1.shotsAgainst, 9)
  assert.equal(p1.faceoffsFor, 6)
  assert.equal(p1.faceoffsAgainst, 5)
})

void test('0056 re-applies safely and does not clobber advanced family statuses', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  // p8 is the trap: review_status = 'reviewed' but faceoffs explicitly
  // 'rejected' and shots still pending. An unconditional re-backfill from
  // review_status would silently promote both to 'reviewed'.
  await applyMigration0056()
  await applyMigration0056()

  const rows = await rawRows(MATCH_MATRIX)
  const p8 = rows.find((r) => r.periodNumber === 8)
  assert.ok(p8)
  assert.equal(p8.reviewStatus, 'reviewed')
  assert.equal(p8.goalsReviewStatus, 'reviewed')
  assert.equal(p8.shotsReviewStatus, 'pending_review')
  assert.equal(p8.faceoffsReviewStatus, 'rejected')

  // …and p7 (legacy reviewed, all families pending) must stay quarantined.
  const p7 = rows.find((r) => r.periodNumber === 7)
  assert.ok(p7)
  assert.equal(p7.goalsReviewStatus, 'pending_review')
  assert.equal(p7.shotsReviewStatus, 'pending_review')
  assert.equal(p7.faceoffsReviewStatus, 'pending_review')

  // Still exactly three family columns and three CHECKs — no duplication.
  const { sql: pg } = await import('@eanhl/db')
  const familyCols = await pg<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'match_period_summaries'
      AND column_name IN ('goals_review_status', 'shots_review_status', 'faceoffs_review_status')
  `
  assert.equal(familyCols.length, 3)
})

// ── read-boundary masking ─────────────────────────────────────────────────────

void test('EA rows bypass family masking entirely', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { getMatchPeriodSummaries } = await import('@eanhl/db/queries')
  const p1 = period(await getMatchPeriodSummaries(MATCH_MATRIX), 1)
  assert.equal(p1.source, 'ea')
  // Every family status on this row is 'pending_review'.
  assert.equal(p1.goalsReviewStatus, 'pending_review')
  assert.equal(p1.goalsFor, 2)
  assert.equal(p1.goalsAgainst, 1)
  assert.equal(p1.shotsFor, 20)
  assert.equal(p1.shotsAgainst, 18)
  assert.equal(p1.faceoffsFor, 11)
  assert.equal(p1.faceoffsAgainst, 9)
})

void test('non-EA rows with every family pending are excluded', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { getMatchPeriodSummaries } = await import('@eanhl/db/queries')
  const rows = await getMatchPeriodSummaries(MATCH_MATRIX)
  assert.equal(
    rows.find((r) => r.periodNumber === 2),
    undefined,
    'p2 (ocr, all families pending) must not be returned',
  )
  assert.equal(
    rows.find((r) => r.periodNumber === 9),
    undefined,
    'p9 (ocr, defaulted statuses) must not be returned',
  )
})

void test('legacy review_status=reviewed alone exposes nothing', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { getMatchPeriodSummaries } = await import('@eanhl/db/queries')
  const rows = await getMatchPeriodSummaries(MATCH_MATRIX)
  // p7: review_status = 'reviewed', all three families pending → dropped.
  assert.equal(
    rows.find((r) => r.periodNumber === 7),
    undefined,
    'legacy review_status must not be an authorization signal',
  )
  // p8: review_status = 'reviewed', only goals reviewed per-family → the other
  // two families stay masked despite the legacy status.
  const p8 = period(rows, 8)
  assert.equal(p8.reviewStatus, 'reviewed')
  assert.equal(p8.goalsFor, 5)
  assert.equal(p8.goalsAgainst, 1)
  assert.equal(p8.shotsFor, null)
  assert.equal(p8.shotsAgainst, null)
  assert.equal(p8.faceoffsFor, null, 'rejected is not reviewed')
  assert.equal(p8.faceoffsAgainst, null, 'rejected is not reviewed')
})

void test('goals reviewed alone: goals visible, shots and faceoffs null', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { getMatchPeriodSummaries } = await import('@eanhl/db/queries')
  const p3 = period(await getMatchPeriodSummaries(MATCH_MATRIX), 3)
  assert.equal(p3.goalsFor, 0)
  assert.equal(p3.goalsAgainst, 0)
  assert.equal(p3.shotsFor, null)
  assert.equal(p3.shotsAgainst, null)
  assert.equal(p3.faceoffsFor, null)
  assert.equal(p3.faceoffsAgainst, null)

  // The nulls above are a READ-BOUNDARY mask, not absent data: the unreviewed
  // values are still stored, awaiting review. (If they weren't, this test would
  // pass for the wrong reason.)
  const stored = (await rawRows(MATCH_MATRIX)).find((r) => r.periodNumber === 3)
  assert.ok(stored)
  assert.equal(stored.shotsFor, 14)
  assert.equal(stored.shotsAgainst, 13)
  assert.equal(stored.faceoffsFor, 7)
  assert.equal(stored.faceoffsAgainst, 6)
})

void test('a reviewed family preserves legitimate zeros (0 is not null)', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { getMatchPeriodSummaries } = await import('@eanhl/db/queries')
  const p3 = period(await getMatchPeriodSummaries(MATCH_MATRIX), 3)
  assert.strictEqual(p3.goalsFor, 0)
  assert.strictEqual(p3.goalsAgainst, 0)
  assert.notStrictEqual(p3.goalsFor, null)
  assert.notStrictEqual(p3.goalsAgainst, null)
})

void test('shots reviewed independently, and a half-read family keeps its null side', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { getMatchPeriodSummaries } = await import('@eanhl/db/queries')
  const p4 = period(await getMatchPeriodSummaries(MATCH_MATRIX), 4)
  assert.equal(p4.shotsFor, 7)
  assert.equal(p4.shotsAgainst, null, 'never captured — stays null, not fabricated')
  assert.equal(p4.goalsFor, null)
  assert.equal(p4.goalsAgainst, null)
  assert.equal(p4.faceoffsFor, null)
  assert.equal(p4.faceoffsAgainst, null)
})

void test('faceoffs reviewed independently on a manual-source row', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { getMatchPeriodSummaries } = await import('@eanhl/db/queries')
  const p5 = period(await getMatchPeriodSummaries(MATCH_MATRIX), 5)
  assert.equal(p5.source, 'manual')
  assert.equal(p5.faceoffsFor, 5)
  assert.equal(p5.faceoffsAgainst, 4)
  assert.equal(p5.goalsFor, null)
  assert.equal(p5.goalsAgainst, null)
  assert.equal(p5.shotsFor, null)
  assert.equal(p5.shotsAgainst, null)
})

void test('multiple reviewed families in one row are exposed together', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { getMatchPeriodSummaries } = await import('@eanhl/db/queries')
  const p6 = period(await getMatchPeriodSummaries(MATCH_MATRIX), 6)
  assert.equal(p6.goalsFor, 1)
  assert.equal(p6.goalsAgainst, 2)
  assert.equal(p6.faceoffsFor, 6)
  assert.equal(p6.faceoffsAgainst, 7)
  assert.equal(p6.shotsFor, null)
  assert.equal(p6.shotsAgainst, null)
})

void test('rows come back ordered by period_number ascending', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { getMatchPeriodSummaries } = await import('@eanhl/db/queries')
  const rows = await getMatchPeriodSummaries(MATCH_MATRIX)
  assert.deepEqual(
    rows.map((r) => r.periodNumber),
    [1, 3, 4, 5, 6, 8],
  )
})

void test('the returned row shape stays compatible (ids, provenance, statuses)', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { getMatchPeriodSummaries } = await import('@eanhl/db/queries')
  const p6 = period(await getMatchPeriodSummaries(MATCH_MATRIX), 6)
  for (const key of [
    'id',
    'matchId',
    'periodNumber',
    'periodLabel',
    'goalsFor',
    'goalsAgainst',
    'shotsFor',
    'shotsAgainst',
    'faceoffsFor',
    'faceoffsAgainst',
    'source',
    'ocrExtractionId',
    'reviewStatus',
    'goalsReviewStatus',
    'shotsReviewStatus',
    'faceoffsReviewStatus',
    'bgmAttackDirection',
  ]) {
    assert.ok(key in p6, `missing key ${key} in returned row`)
  }
  assert.equal(typeof p6.id, 'number')
  assert.equal(p6.matchId, MATCH_MATRIX)
  assert.equal(p6.periodLabel, 'OT3')
  assert.equal(p6.ocrExtractionId, null)
})

// ── the closed bypass ─────────────────────────────────────────────────────────

void test('markOcrPeriodSummariesReviewed throws before touching any row', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { markOcrPeriodSummariesReviewed } = await import('@eanhl/db/queries')

  const before = await rawRows(MATCH_LEGACY)
  const beforeMatrix = await rawRows(MATCH_MATRIX)

  await assert.rejects(
    () => markOcrPeriodSummariesReviewed(MATCH_LEGACY),
    /disabled: whole-row promotion/i,
  )

  const after = await rawRows(MATCH_LEGACY)
  const afterMatrix = await rawRows(MATCH_MATRIX)
  assert.deepEqual(after, before, 'no row of the target match may be mutated')
  assert.deepEqual(afterMatrix, beforeMatrix, 'no row of any other match may be mutated')

  // The pending legacy row specifically must still be quarantined.
  const p2 = after.find((r) => r.periodNumber === 2)
  assert.ok(p2)
  assert.equal(p2.reviewStatus, 'pending_review')
  assert.equal(p2.goalsReviewStatus, 'pending_review')
  assert.equal(p2.shotsReviewStatus, 'pending_review')
  assert.equal(p2.faceoffsReviewStatus, 'pending_review')
})

void test('the disabled promotion path is still exported and still typed', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const mod = await import('@eanhl/db/queries')
  assert.equal(typeof mod.markOcrPeriodSummariesReviewed, 'function')
  // countPendingOcrPeriodSummaries stays read-only and unchanged.
  const pending = await mod.countPendingOcrPeriodSummaries(MATCH_LEGACY)
  assert.equal(pending, 1, 'one legacy pending OCR row on the sentinel match')
})
