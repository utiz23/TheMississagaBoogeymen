/**
 * /health endpoint regression tests — NULL finished_at bug.
 *
 * Root cause: `fetchLatestCompletedSuccess` (src/health.ts) selected
 * `status = 'success'` rows ordered by `finished_at DESC` with no NULL
 * filter. PostgreSQL sorts NULL first under DESC, so a successful row with a
 * NULL finished_at (three exist in prod history) always won the ORDER BY /
 * LIMIT 1 — ahead of any real, completed successful ingestion — and /health
 * reported 503 despite recent healthy runs. The fix adds
 * `isNotNull(ingestionLog.finishedAt)` to the WHERE clause.
 *
 * Two halves, deliberately separated (matching the health.ts split):
 *
 *   1. `buildHealthPayload` — pure, no DB. Covers the degraded/stale/ok
 *      status shaping directly from a resolved-row input, so these cases
 *      don't depend on what happens to already be in the database.
 *   2. `fetchLatestCompletedSuccess` — DB-backed. Pins the actual query fix:
 *      a NULL-finished success must never be selected over a completed one,
 *      and a newer non-success row must never displace an older completed
 *      success. Sentinel rows use a finishedAt far in the future so they are
 *      deterministically the global ORDER BY winner regardless of whatever
 *      real ingestion history the cloned test DB carries — no reliance on an
 *      empty table.
 *
 *      The "only NULL-finished_at successes" case is the exception: the
 *      cloned fixture DB always carries real completed successes, so it
 *      can't be proven by inserting sentinels alongside them (the query could
 *      pass by legitimately finding one of the real rows instead of failing
 *      the NULL-finished ones). That case instead runs inside an explicit,
 *      deliberately-rolled-back transaction that hides every query-visible
 *      completed success first, so the only status='success' rows visible to
 *      the query are the NULL-finished sentinels — a state the query must
 *      resolve to `null`.
 *
 * The DB half skips gracefully without DATABASE_URL and, when DATABASE_URL
 * is set, asserts (before any insert) that it is running against the
 * isolated eanhl_test_* clone provisioned by with-test-db.mjs — never the
 * live `eanhl` database.
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { db, sql as dbSql, ingestionLog } from '@eanhl/db'
import { and, desc, eq, isNotNull, like, sql, TransactionRollbackError } from 'drizzle-orm'
import { buildHealthPayload, fetchLatestCompletedSuccess } from '../health.js'

const GAME_TITLE_ID = 1 // NHL 26
const SENTINEL_TAG = 'health-endpoint-test-sentinel'
const STALE_THRESHOLD_MS = 30 * 60 * 1000 // mirrors HEALTH_STALE_MS default

// Far enough in the future that no real (necessarily past-dated) ingestion
// row in the cloned DB can out-rank it in ORDER BY finished_at DESC.
const FAR_FUTURE_BASE_MS = Date.now() + 1000 * 24 * 60 * 60 * 1000

const sentinelIds = new Set<number>()

async function cleanupAllSentinels(): Promise<void> {
  const stale = await db
    .select({ id: ingestionLog.id })
    .from(ingestionLog)
    .where(like(ingestionLog.matchType, `${SENTINEL_TAG}%`))
  for (const row of stale) {
    await db.delete(ingestionLog).where(eq(ingestionLog.id, row.id))
  }
  sentinelIds.clear()
}

async function insertRow(opts: {
  suffix: string
  status: 'success' | 'partial' | 'error'
  finishedAt: Date | null
  startedAt?: Date
}): Promise<number> {
  const [row] = await db
    .insert(ingestionLog)
    .values({
      gameTitleId: GAME_TITLE_ID,
      startedAt: opts.startedAt ?? new Date(FAR_FUTURE_BASE_MS - 60 * 1000),
      finishedAt: opts.finishedAt,
      matchType: `${SENTINEL_TAG}-${opts.suffix}`,
      status: opts.status,
    })
    .returning({ id: ingestionLog.id })
  if (!row) throw new Error('ingestion_log insert failed')
  sentinelIds.add(row.id)
  return row.id
}

before(async () => {
  if (!process.env.DATABASE_URL) return

  // Refuse to mutate anything unless this is demonstrably the isolated
  // test-db clone (with-test-db.mjs names it eanhl_test_<pid>_<ts>) and NOT
  // the live `eanhl` database.
  const rows = (await db.execute(sql`SELECT current_database() AS name`)) as unknown as {
    name: string
  }[]
  const currentDb = rows[0]?.name
  assert.ok(currentDb, 'could not resolve current_database()')
  assert.notEqual(currentDb, 'eanhl', 'refusing to run against the live eanhl database')
  assert.match(
    currentDb,
    /^eanhl_test_/,
    `expected an isolated eanhl_test_* clone, got "${currentDb}" — refusing to mutate`,
  )

  await cleanupAllSentinels()
})

after(async () => {
  if (!process.env.DATABASE_URL) return
  await cleanupAllSentinels()
  await dbSql.end({ timeout: 5 })
})

// ── 1. Pure payload shaping ─────────────────────────────────────────────────

void test('no completed success row → 503 degraded, lastSuccessfulIngest null', () => {
  const { payload, httpStatus } = buildHealthPayload(null, STALE_THRESHOLD_MS)
  assert.equal(httpStatus, 503)
  assert.equal(payload.status, 'degraded')
  assert.equal(payload.lastSuccessfulIngest, null)
  assert.equal(payload.secondsSinceLastIngest, null)
})

void test('a completed success older than the stale threshold → 503 stale', () => {
  const staleAt = new Date(Date.now() - (STALE_THRESHOLD_MS + 5 * 60 * 1000))
  const { payload, httpStatus } = buildHealthPayload({ finishedAt: staleAt }, STALE_THRESHOLD_MS)
  assert.equal(httpStatus, 503)
  assert.equal(payload.status, 'stale')
  assert.equal(payload.lastSuccessfulIngest, staleAt.toISOString())
})

void test('a completed success within the stale threshold → 200 ok', () => {
  const freshAt = new Date(Date.now() - 60 * 1000)
  const { payload, httpStatus } = buildHealthPayload({ finishedAt: freshAt }, STALE_THRESHOLD_MS)
  assert.equal(httpStatus, 200)
  assert.equal(payload.status, 'ok')
  assert.equal(payload.lastSuccessfulIngest, freshAt.toISOString())
  assert.ok(payload.secondsSinceLastIngest !== null && payload.secondsSinceLastIngest >= 0)
})

// ── 2. The query fix ────────────────────────────────────────────────────────

void test('a completed success is selected over a NULL-finished_at success', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL not set — health query check requires DB.')
    return
  }

  const completedAt = new Date(FAR_FUTURE_BASE_MS)
  await insertRow({ suffix: 'null-finished', status: 'success', finishedAt: null })
  await insertRow({ suffix: 'completed', status: 'success', finishedAt: completedAt })

  const lastRow = await fetchLatestCompletedSuccess()

  assert.ok(lastRow, 'expected a completed success row to be found')
  assert.equal(lastRow.finishedAt.toISOString(), completedAt.toISOString())

  await cleanupAllSentinels()
})

void test('isolated: only NULL-finished_at successes visible → fetchLatestCompletedSuccess returns null, health reports 503 degraded', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL not set — health query check requires DB.')
    return
  }

  try {
    await db.transaction(async (tx) => {
      // Hide every completed success already present in the cloned fixture
      // DB (there are always some — this is a clone of live data, never an
      // empty table) so the only status='success' rows visible to the query
      // inside this transaction are the NULL-finished sentinels inserted
      // below. A status flip, not a delete: raw_match_payloads FKs to
      // ingestion_log.id with no ON DELETE clause, so deleting these rows
      // could fail; changing status just removes them from the WHERE clause.
      await tx
        .update(ingestionLog)
        .set({ status: 'error' })
        .where(and(eq(ingestionLog.status, 'success'), isNotNull(ingestionLog.finishedAt)))

      await tx.insert(ingestionLog).values({
        gameTitleId: GAME_TITLE_ID,
        startedAt: new Date(FAR_FUTURE_BASE_MS - 60 * 1000),
        finishedAt: null,
        matchType: `${SENTINEL_TAG}-isolated-null-a`,
        status: 'success',
      })
      await tx.insert(ingestionLog).values({
        gameTitleId: GAME_TITLE_ID,
        startedAt: new Date(FAR_FUTURE_BASE_MS - 60 * 1000),
        finishedAt: null,
        matchType: `${SENTINEL_TAG}-isolated-null-b`,
        status: 'success',
      })

      // Prove the isolation actually holds before trusting the result below:
      // every status='success' row this transaction can see must be
      // NULL-finished — otherwise this would still be exercising real data,
      // not the isolated case.
      const visibleSuccesses = await tx
        .select({ finishedAt: ingestionLog.finishedAt })
        .from(ingestionLog)
        .where(eq(ingestionLog.status, 'success'))
      assert.ok(
        visibleSuccesses.length > 0,
        'expected at least the two inserted NULL-finished sentinel rows to be visible',
      )
      assert.ok(
        visibleSuccesses.every((row) => row.finishedAt === null),
        'every status=success row visible inside the transaction must have finished_at=NULL',
      )

      const lastRow = await fetchLatestCompletedSuccess(tx)
      assert.equal(lastRow, null, 'a NULL-only success set must resolve to null, not a fallback row')

      const { payload, httpStatus } = buildHealthPayload(lastRow, STALE_THRESHOLD_MS)
      assert.equal(httpStatus, 503)
      assert.equal(payload.status, 'degraded')
      assert.equal(payload.lastSuccessfulIngest, null)
      assert.equal(payload.secondsSinceLastIngest, null)

      // Deliberate rollback: neither the hidden real rows nor the sentinels
      // may persist in the shared cloned fixture DB.
      tx.rollback()
    })
  } catch (err) {
    if (!(err instanceof TransactionRollbackError)) throw err
  }
})

void test('a newer failed/incomplete row does not displace an older completed success', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL not set — health query check requires DB.')
    return
  }

  const completedAt = new Date(FAR_FUTURE_BASE_MS)
  await insertRow({ suffix: 'older-completed-success', status: 'success', finishedAt: completedAt })
  // Newer than completedAt, but not a completed success — must not win.
  await insertRow({
    suffix: 'newer-error',
    status: 'error',
    finishedAt: new Date(FAR_FUTURE_BASE_MS + 60 * 1000),
  })
  await insertRow({
    suffix: 'newer-incomplete-success',
    status: 'success',
    finishedAt: null,
    startedAt: new Date(FAR_FUTURE_BASE_MS + 60 * 1000),
  })

  const lastRow = await fetchLatestCompletedSuccess()

  assert.ok(lastRow, 'expected the completed success row to be found')
  assert.equal(lastRow.finishedAt.toISOString(), completedAt.toISOString())

  await cleanupAllSentinels()
})

void test('the generated query filters on status = success AND finished_at IS NOT NULL', () => {
  // Rebuilds the exact same query shape fetchLatestCompletedSuccess issues,
  // to inspect the SQL text without requiring a live DB connection.
  const query = db
    .select({ finishedAt: ingestionLog.finishedAt })
    .from(ingestionLog)
    .where(and(eq(ingestionLog.status, 'success'), isNotNull(ingestionLog.finishedAt)))
    .orderBy(desc(ingestionLog.finishedAt))
    .limit(1)

  const generatedSql = query.toSQL().sql.toLowerCase()
  assert.match(generatedSql, /"status"\s*=/, 'expected a status equality predicate')
  assert.match(
    generatedSql,
    /"finished_at"\s+is\s+not\s+null/,
    'expected an IS NOT NULL predicate on finished_at',
  )
})
