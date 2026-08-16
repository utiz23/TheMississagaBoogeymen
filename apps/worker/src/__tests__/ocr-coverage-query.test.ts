/**
 * Regression test for `getOcrCoverageForMatches`'s `periods` stream predicate
 * (packages/db/src/queries/ocr-coverage.ts).
 *
 * THE DEFECT UNDER TEST
 * ---------------------
 * Migration 0056 split `match_period_summaries` review authorization into three
 * independent per-family columns (`goals_review_status` / `shots_review_status` /
 * `faceoffs_review_status`) because the single row-level `review_status` let a
 * goals-only verdict silently publish unreviewed shots/faceoffs. The column's own
 * comment states plainly: "review_status = 'reviewed' alone exposes nothing... do
 * not reintroduce it into any read-boundary authorization predicate."
 * `getMatchPeriodSummaries` (packages/db/src/queries/match-enrichments.ts) follows
 * that rule. The OCR-coverage `periods` stream must mirror it exactly, since it
 * exists to answer "does the match page have something to show here" — a pill
 * gated on the legacy column can promise coverage the match page then withholds
 * (or withhold a pill for a family that page genuinely shows).
 *
 * WHY THIS LIVES UNDER apps/worker/src/__tests__
 * ----------------------------------------------
 * It is a DB-mutating integration test, so it must run against a throwaway
 * clone, never the live database. `apps/worker/scripts/with-test-db.mjs` is this
 * repo's only such harness and discovers test files under `apps/worker/dist`
 * (see `period-family-review-gating.test.ts`, which asserts on the same table via
 * `@eanhl/db/queries`). This file imports `getOcrCoverageForMatches` directly —
 * no worker source is touched or exercised.
 *
 * Build + run (focused):
 *   pnpm --filter @eanhl/db build
 *   pnpm --filter @eanhl/worker build
 *   set -a && source .env && set +a
 *   node apps/worker/scripts/with-test-db.mjs ocr-coverage-query
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'

/**
 * Sentinel matches. Far above the live sequence (max real match id 3138 as of
 * this writing); dropped in `after`. Range 9661-9667 checked clear of every
 * other test file's sentinel usage in this repo.
 */
const MATCH_GOALS_ONLY = 9661 // legacy pending, goals family reviewed
const MATCH_SHOTS_ONLY = 9662 // legacy pending, shots family reviewed
const MATCH_FACEOFFS_ONLY = 9663 // legacy pending, faceoffs family reviewed
const MATCH_LEGACY_REVIEWED_FAMILIES_PENDING = 9664 // legacy reviewed, all families still pending
const MATCH_LEGACY_REVIEWED_FAMILIES_REJECTED = 9665 // legacy reviewed, all families rejected
const MATCH_EA_SOURCE_FAMILY_REVIEWED = 9666 // source='ea', a family reviewed — not OCR
const MATCH_NO_OCR = 9667 // no row in any OCR-bearing table at all

const ALL_SENTINELS = [
  MATCH_GOALS_ONLY,
  MATCH_SHOTS_ONLY,
  MATCH_FACEOFFS_ONLY,
  MATCH_LEGACY_REVIEWED_FAMILIES_PENDING,
  MATCH_LEGACY_REVIEWED_FAMILIES_REJECTED,
  MATCH_EA_SOURCE_FAMILY_REVIEWED,
  MATCH_NO_OCR,
]

const hasDb = Boolean(process.env.DATABASE_URL)

/**
 * Refuse to run unless `DATABASE_URL` points at a throwaway `eanhl_test_*`
 * clone (mirrors the guard in `period-family-review-gating.test.ts` /
 * `__tests__/fixtures/seed-fixture-db.ts`). This file writes sentinel rows;
 * they may never reach the live database.
 */
function assertCloneDb(): void {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('ocr-coverage-query: DATABASE_URL is unset.')
  let dbName: string
  try {
    dbName = new URL(url).pathname.replace(/^\//, '')
  } catch {
    throw new Error(`ocr-coverage-query: DATABASE_URL is not a valid URL: ${url}`)
  }
  if (!dbName.startsWith('eanhl_test')) {
    throw new Error(
      `ocr-coverage-query: refusing to run — DATABASE_URL points at database "${dbName}", ` +
        `not an "eanhl_test_*" clone. This file writes sentinel rows; run it via ` +
        `apps/worker/scripts/with-test-db.mjs.`,
    )
  }
}

async function cleanupSentinels(): Promise<void> {
  const { db, matches, matchPeriodSummaries } = await import('@eanhl/db')
  const { inArray } = await import('drizzle-orm')
  await db.delete(matchPeriodSummaries).where(inArray(matchPeriodSummaries.matchId, ALL_SENTINELS))
  await db.delete(matches).where(inArray(matches.id, ALL_SENTINELS))
}

async function seedSentinelMatches(): Promise<void> {
  const { db, matches, gameTitles } = await import('@eanhl/db')
  const { asc } = await import('drizzle-orm')
  const [title] = await db
    .select({ id: gameTitles.id })
    .from(gameTitles)
    .orderBy(asc(gameTitles.id))
    .limit(1)
  if (!title)
    throw new Error('ocr-coverage-query: no game_titles row to seed sentinel matches against.')

  await db.insert(matches).values(
    ALL_SENTINELS.map((id) => ({
      id,
      gameTitleId: title.id,
      eaMatchId: `ocr-coverage-query-sentinel-${String(id)}`,
      matchType: 'gameType5' as const,
      opponentClubId: '999999',
      opponentName: 'SENTINEL',
      playedAt: new Date(),
      result: 'WIN' as const,
      scoreFor: 3,
      scoreAgainst: 2,
      shotsFor: 20,
      shotsAgainst: 18,
      hitsFor: 5,
      hitsAgainst: 4,
    })),
  )
}

async function seedPeriodRows(): Promise<void> {
  const { db, matchPeriodSummaries } = await import('@eanhl/db')
  await db.insert(matchPeriodSummaries).values([
    // Legacy pending, only goals family reviewed.
    {
      matchId: MATCH_GOALS_ONLY,
      periodNumber: 1,
      periodLabel: '1st',
      goalsFor: 2,
      goalsAgainst: 1,
      shotsFor: 10,
      shotsAgainst: 9,
      faceoffsFor: 6,
      faceoffsAgainst: 5,
      source: 'ocr',
      reviewStatus: 'pending_review',
      goalsReviewStatus: 'reviewed',
      shotsReviewStatus: 'pending_review',
      faceoffsReviewStatus: 'pending_review',
    },
    // Legacy pending, only shots family reviewed.
    {
      matchId: MATCH_SHOTS_ONLY,
      periodNumber: 1,
      periodLabel: '1st',
      goalsFor: 1,
      goalsAgainst: 1,
      shotsFor: 11,
      shotsAgainst: 8,
      faceoffsFor: 7,
      faceoffsAgainst: 6,
      source: 'ocr',
      reviewStatus: 'pending_review',
      goalsReviewStatus: 'pending_review',
      shotsReviewStatus: 'reviewed',
      faceoffsReviewStatus: 'pending_review',
    },
    // Legacy pending, only faceoffs family reviewed.
    {
      matchId: MATCH_FACEOFFS_ONLY,
      periodNumber: 1,
      periodLabel: '1st',
      goalsFor: 0,
      goalsAgainst: 0,
      shotsFor: 9,
      shotsAgainst: 9,
      faceoffsFor: 8,
      faceoffsAgainst: 7,
      source: 'ocr',
      reviewStatus: 'pending_review',
      goalsReviewStatus: 'pending_review',
      shotsReviewStatus: 'pending_review',
      faceoffsReviewStatus: 'reviewed',
    },
    // Legacy reviewed, but every family still pending — the exact anti-pattern
    // migration 0056 closes. Must NOT count as period coverage.
    {
      matchId: MATCH_LEGACY_REVIEWED_FAMILIES_PENDING,
      periodNumber: 1,
      periodLabel: '1st',
      goalsFor: 4,
      goalsAgainst: 4,
      shotsFor: 20,
      shotsAgainst: 20,
      faceoffsFor: 10,
      faceoffsAgainst: 10,
      source: 'ocr',
      reviewStatus: 'reviewed',
      goalsReviewStatus: 'pending_review',
      shotsReviewStatus: 'pending_review',
      faceoffsReviewStatus: 'pending_review',
    },
    // Legacy reviewed, every family explicitly rejected. Rejected is not
    // reviewed — must NOT count as period coverage either.
    {
      matchId: MATCH_LEGACY_REVIEWED_FAMILIES_REJECTED,
      periodNumber: 1,
      periodLabel: '1st',
      goalsFor: 5,
      goalsAgainst: 5,
      shotsFor: 15,
      shotsAgainst: 15,
      faceoffsFor: 3,
      faceoffsAgainst: 3,
      source: 'ocr',
      reviewStatus: 'reviewed',
      goalsReviewStatus: 'rejected',
      shotsReviewStatus: 'rejected',
      faceoffsReviewStatus: 'rejected',
    },
    // EA source with a reviewed family — EA rows are out of scope for an OCR
    // coverage pill regardless of family status.
    {
      matchId: MATCH_EA_SOURCE_FAMILY_REVIEWED,
      periodNumber: 1,
      periodLabel: '1st',
      goalsFor: 3,
      goalsAgainst: 2,
      shotsFor: 22,
      shotsAgainst: 19,
      faceoffsFor: 12,
      faceoffsAgainst: 9,
      source: 'ea',
      reviewStatus: 'pending_review',
      goalsReviewStatus: 'reviewed',
      shotsReviewStatus: 'pending_review',
      faceoffsReviewStatus: 'pending_review',
    },
    // MATCH_NO_OCR intentionally gets no row in any table.
  ])
}

before(async () => {
  if (!hasDb) return
  assertCloneDb()
  await cleanupSentinels()
  await seedSentinelMatches()
  await seedPeriodRows()
})

after(async () => {
  if (!hasDb) return
  const { sql: pg } = await import('@eanhl/db')
  await cleanupSentinels().catch(() => undefined)
  await pg.end({ timeout: 1 }).catch(() => undefined)
})

void test('a single reviewed family (goals) counts as period coverage', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set — requires the test-DB clone.')
    return
  }
  const { getOcrCoverageForMatches } = await import('@eanhl/db/queries')
  const coverage = await getOcrCoverageForMatches([MATCH_GOALS_ONLY])
  assert.equal(coverage.get(MATCH_GOALS_ONLY)?.periods, true)
})

void test('a single reviewed family (shots) counts as period coverage', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set — requires the test-DB clone.')
    return
  }
  const { getOcrCoverageForMatches } = await import('@eanhl/db/queries')
  const coverage = await getOcrCoverageForMatches([MATCH_SHOTS_ONLY])
  assert.equal(coverage.get(MATCH_SHOTS_ONLY)?.periods, true)
})

void test('a single reviewed family (faceoffs) counts as period coverage', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set — requires the test-DB clone.')
    return
  }
  const { getOcrCoverageForMatches } = await import('@eanhl/db/queries')
  const coverage = await getOcrCoverageForMatches([MATCH_FACEOFFS_ONLY])
  assert.equal(coverage.get(MATCH_FACEOFFS_ONLY)?.periods, true)
})

void test('legacy review_status=reviewed with every family pending does NOT count', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set — requires the test-DB clone.')
    return
  }
  const { getOcrCoverageForMatches } = await import('@eanhl/db/queries')
  const coverage = await getOcrCoverageForMatches([MATCH_LEGACY_REVIEWED_FAMILIES_PENDING])
  assert.equal(
    coverage.get(MATCH_LEGACY_REVIEWED_FAMILIES_PENDING),
    undefined,
    'the legacy column must not be an authorization signal',
  )
})

void test('legacy review_status=reviewed with every family rejected does NOT count', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set — requires the test-DB clone.')
    return
  }
  const { getOcrCoverageForMatches } = await import('@eanhl/db/queries')
  const coverage = await getOcrCoverageForMatches([MATCH_LEGACY_REVIEWED_FAMILIES_REJECTED])
  assert.equal(
    coverage.get(MATCH_LEGACY_REVIEWED_FAMILIES_REJECTED),
    undefined,
    'rejected is not reviewed',
  )
})

void test('an EA-source row with a reviewed family does NOT count as OCR period coverage', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set — requires the test-DB clone.')
    return
  }
  const { getOcrCoverageForMatches } = await import('@eanhl/db/queries')
  const coverage = await getOcrCoverageForMatches([MATCH_EA_SOURCE_FAMILY_REVIEWED])
  assert.equal(
    coverage.get(MATCH_EA_SOURCE_FAMILY_REVIEWED),
    undefined,
    'EA rows are out of scope for an OCR coverage pill regardless of family status',
  )
})

void test('a match with no row in any OCR-bearing table is absent from the map', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set — requires the test-DB clone.')
    return
  }
  const { getOcrCoverageForMatches } = await import('@eanhl/db/queries')
  const coverage = await getOcrCoverageForMatches([MATCH_NO_OCR])
  assert.equal(coverage.get(MATCH_NO_OCR), undefined)
})

void test('a batched call returns qualifying matches as periods=true and drops the rest', async (t) => {
  if (!hasDb) {
    t.skip('DATABASE_URL not set — requires the test-DB clone.')
    return
  }
  const { getOcrCoverageForMatches } = await import('@eanhl/db/queries')
  const coverage = await getOcrCoverageForMatches(ALL_SENTINELS)

  assert.equal(coverage.get(MATCH_GOALS_ONLY)?.periods, true)
  assert.equal(coverage.get(MATCH_SHOTS_ONLY)?.periods, true)
  assert.equal(coverage.get(MATCH_FACEOFFS_ONLY)?.periods, true)

  assert.equal(coverage.has(MATCH_LEGACY_REVIEWED_FAMILIES_PENDING), false)
  assert.equal(coverage.has(MATCH_LEGACY_REVIEWED_FAMILIES_REJECTED), false)
  assert.equal(coverage.has(MATCH_EA_SOURCE_FAMILY_REVIEWED), false)
  assert.equal(coverage.has(MATCH_NO_OCR), false)
})
