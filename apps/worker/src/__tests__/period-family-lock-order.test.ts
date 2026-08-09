/**
 * LOCK ORDER — promotion vs. the rejection/cascade path, on `match_period_summaries`.
 *
 * THE DEFECT
 * ----------
 * `promoteOcrPeriodFamily` locked its candidate period rows `ORDER BY period_number`.
 * `setExtractionStatus` (the rejection/cascade path) locked the SAME rows
 * `ORDER BY id`, unqualified by status. A row's `id` is assigned by INSERT order,
 * which follows OCR ingestion order — not the game clock — so it does not
 * generally track `period_number`. When the two orders disagree, two
 * transactions reaching for the SAME period rows in OPPOSITE sequence can each
 * come to hold one row and wait on the other's: a classic lock-order deadlock.
 *
 * WHY THE EXISTING CONCURRENCY-TRACE FILE NEVER SAW THIS
 * --------------------------------------------------------
 * `period-family-rejection-concurrency.test.ts` always promotes and rejects the
 * SAME extraction. `ocr_extractions` is locked first by both paths, in the same
 * (id) order, so that shared lock fully serializes the two transactions before
 * either ever touches a period row — the mismatched period-row order downstream
 * is never actually exercised concurrently. Its own fixture also happens to
 * insert periods 1, 2, 3 in order, so even the row ids agree with period_number.
 * This file removes BOTH accidental protections: two DIFFERENT extractions
 * (goals + faceoffs) of the same match, so the extraction locks are disjoint and
 * both paths reach the period rows independently; and period rows inserted in
 * REVERSE period order, so id order is the exact opposite of period_number order.
 *
 * HOW THE DEADLOCK IS MADE DETERMINISTIC
 * ---------------------------------------
 * A third connection locks ONLY the period-2 row `FOR UPDATE` and holds it open.
 *   * Promotion's order (period_number asc: 1, 2, 3) locks period 1 uncontested,
 *     then blocks reaching for period 2 (held by the third connection).
 *   * The cascade's order (id asc: period 3, period 2, period 1— id(period 3) <
 *     id(period 2) < id(period 1) by construction) locks period 3 uncontested,
 *     then ALSO blocks reaching for period 2.
 * Both are confirmed blocked (via `pg_stat_activity`) before the third
 * connection's lock is released. Whichever of the two Postgres's lock queue
 * then grants period 2 to next reaches for the row the OTHER already holds —
 * promotion's remaining row is period 3 (held by the cascade), the cascade's
 * remaining row is period 1 (held by promotion) — a genuine circular wait
 * either way. No timing luck is needed for which side "wins" period 2; the
 * deadlock follows from both having already locked their own first-pick row
 * before either is allowed to reach for the shared one.
 *
 * Build + run (focused):
 *   pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build
 *   set -a && source .env && set +a
 *   node apps/worker/scripts/with-test-db.mjs period-family-lock-order
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

/** Sentinel match id, disjoint from every other period-family test file. */
const MATCH = 9801
const ALL_MATCHES = [MATCH]
const REGULATION_TOI = 3600

const hasDb = Boolean(process.env['DATABASE_URL'])

let goalsExtraction = 0
let faceoffsExtraction = 0
/** period_number -> match_period_summaries.id, populated by seedFixture(). */
let periodRowIds: Record<number, number> = {}

function assertCloneDb(): void {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('period-family-lock-order: DATABASE_URL is unset.')
  let dbName: string
  try {
    dbName = new URL(url).pathname.replace(/^\//, '')
  } catch {
    throw new Error(`period-family-lock-order: DATABASE_URL is not a valid URL: ${url}`)
  }
  if (!dbName.startsWith('eanhl_test')) {
    throw new Error(
      `period-family-lock-order: refusing to run — DATABASE_URL points at database ` +
        `"${dbName}", not an "eanhl_test_*" clone. This file applies migration 0056 and locks a ` +
        `row open for the duration of the trace; run it via apps/worker/scripts/with-test-db.mjs.`,
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
  await pg`DELETE FROM player_match_stats WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM opponent_player_match_stats WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM ocr_extractions WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM ocr_capture_batches WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM matches WHERE id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM players WHERE gamertag = 'LOCK-ORDER-SENTINEL'`
}

/**
 * Goals reconcile exactly (2-1, 1-0, 0-0 -> 3-1, EA says 3-1) so promotion
 * genuinely authorizes rather than refusing on the evidence — the deadlock this
 * file pins has to be caught before that decision ever happens.
 *
 * Rows are inserted period 3, THEN period 2, THEN period 1 — the reverse of
 * period_number order — so id(period 3) < id(period 2) < id(period 1).
 */
async function seedFixture(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await pg`
    INSERT INTO matches (
      id, game_title_id, ea_match_id, match_type, opponent_club_id, opponent_name,
      played_at, result, score_for, score_against, shots_for, shots_against,
      hits_for, hits_against
    ) VALUES (
      ${MATCH}, (SELECT id FROM game_titles ORDER BY id LIMIT 1),
      ${`lock-order-${MATCH}`}, 'gameType5', '999999', 'SENTINEL',
      now(), 'WIN', 3, 1, 20, 18, 5, 4
    )
  `
  const [player] = await pg<{ id: number }[]>`
    INSERT INTO players (gamertag, position)
    VALUES ('LOCK-ORDER-SENTINEL', 'center')
    ON CONFLICT DO NOTHING
    RETURNING id
  `
  const playerId =
    player?.id ??
    (await pg<{ id: number }[]>`SELECT id FROM players WHERE gamertag = 'LOCK-ORDER-SENTINEL'`)[0]!
      .id
  await pg`
    INSERT INTO player_match_stats (player_id, match_id, position, is_goalie, goals, assists,
                                    faceoff_wins, faceoff_losses, toi_seconds)
    VALUES (${playerId}, ${MATCH}, 'center', false, 0, 0, 12, 0, ${REGULATION_TOI})
  `
  await pg`
    INSERT INTO opponent_player_match_stats (match_id, ea_player_id, opponent_club_id, gamertag,
                                             position, is_goalie, faceoff_wins, faceoff_losses,
                                             toi_seconds)
    VALUES (${MATCH}, ${`lock-order-${MATCH}`}, '999999', 'SENTINEL-OPP',
            'center', false, 8, 0, ${REGULATION_TOI})
  `
  const [batch] = await pg<{ id: number }[]>`
    INSERT INTO ocr_capture_batches (game_title_id, match_id, capture_kind, source_directory)
    VALUES ((SELECT id FROM game_titles ORDER BY id LIMIT 1), ${MATCH}, 'video_frames',
            ${`/lock-order-${MATCH}`})
    RETURNING id
  `
  const batchId = batch!.id

  const [goalsRow] = await pg<{ id: string }[]>`
    INSERT INTO ocr_extractions (batch_id, match_id, screen_type, source_path, raw_result_json,
                                 transform_status, review_status)
    VALUES (${batchId}, ${MATCH}, 'post_game_box_score_goals',
            ${`/frames/${String(MATCH)}-goals.png`}, '{}'::jsonb, 'success', 'pending_review')
    RETURNING id
  `
  goalsExtraction = Number(goalsRow!.id)

  const [faceoffsRow] = await pg<{ id: string }[]>`
    INSERT INTO ocr_extractions (batch_id, match_id, screen_type, source_path, raw_result_json,
                                 transform_status, review_status)
    VALUES (${batchId}, ${MATCH}, 'post_game_box_score_faceoffs',
            ${`/frames/${String(MATCH)}-faceoffs.png`}, '{}'::jsonb, 'success', 'pending_review')
    RETURNING id
  `
  faceoffsExtraction = Number(faceoffsRow!.id)

  const PERIODS_REVERSED = [
    { period: 3, gf: 0, ga: 0 },
    { period: 2, gf: 1, ga: 0 },
    { period: 1, gf: 2, ga: 1 },
  ] as const

  periodRowIds = {}
  for (const p of PERIODS_REVERSED) {
    const [row] = await pg<{ id: string }[]>`
      INSERT INTO match_period_summaries (
        match_id, period_number, period_label, goals_for, goals_against,
        shots_for, shots_against, faceoffs_for, faceoffs_against, source,
        ocr_extraction_id, review_status,
        goals_review_status, shots_review_status, faceoffs_review_status
      ) VALUES (
        ${MATCH}, ${p.period}, ${`P${String(p.period)}`}, ${p.gf}, ${p.ga},
        11, 9, 5, 4, 'ocr', ${goalsExtraction}, 'pending_review',
        'pending_review', 'pending_review', 'pending_review'
      )
      RETURNING id
    `
    periodRowIds[p.period] = Number(row!.id)
  }
}

async function extractionStatus(id: number): Promise<string> {
  const { sql: pg } = await import('@eanhl/db')
  const [row] = await pg<{ review_status: string }[]>`
    SELECT review_status FROM ocr_extractions WHERE id = ${id}
  `
  return row?.review_status ?? 'missing'
}

async function faceoffsStatuses(): Promise<string[]> {
  const { sql: pg } = await import('@eanhl/db')
  const rows = await pg<{ faceoffs_review_status: string }[]>`
    SELECT faceoffs_review_status FROM match_period_summaries
    WHERE match_id = ${MATCH} ORDER BY period_number
  `
  return rows.map((r) => r.faceoffs_review_status)
}

/**
 * Holds a single `match_period_summaries` row `FOR UPDATE` on a dedicated
 * connection until released, with a poller that reports how many OTHER backends
 * are currently blocked waiting on a lock.
 *
 * Modeled on `holdPauseKey` in period-family-rejection-concurrency.test.ts, but
 * holds a genuine row lock rather than an advisory key behind a trigger — there
 * is no BEFORE-UPDATE hook available here because both production paths reach
 * the contested row via a plain `SELECT ... FOR UPDATE`, which fires no trigger.
 * The transaction is held inside `sql.begin()` awaiting a JS gate rather than a
 * manually-issued `BEGIN` on a `sql.reserve()`d connection, for the same reason
 * documented there: a reserved connection can be handed back to the pool between
 * statements, silently defeating the hold.
 */
interface RowHolder {
  waitForBlockedBackends(n: number, ...settled: (() => boolean)[]): Promise<void>
  release(): Promise<void>
}

async function holdRowLock(rowId: number): Promise<RowHolder> {
  const { sql: pg } = await import('@eanhl/db')

  let openGate!: () => void
  const gate = new Promise<void>((resolve) => {
    openGate = resolve
  })
  let acquired!: (pid: number) => void
  const ready = new Promise<number>((resolve) => {
    acquired = resolve
  })

  const held = pg.begin(async (tx) => {
    const [row] = await tx<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
    await tx`SELECT id FROM match_period_summaries WHERE id = ${rowId} FOR UPDATE`
    acquired(row!.pid)
    await gate
  })
  const holderPid = await ready

  // A dedicated connection for polling, so a probe can never be pipelined behind
  // one of the blocked queries it is supposed to observe.
  const probe = await pg.reserve()

  let released = false
  return {
    async waitForBlockedBackends(n, ...settledFns) {
      const deadline = Date.now() + 30_000
      for (;;) {
        const [row] = await probe<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> ${holderPid}
        `
        if ((row?.n ?? 0) >= n) return
        // A path that finished instead of blocking is equally decisive — it
        // means it never contended for the held row at all.
        if (settledFns.some((settled) => settled())) return
        if (Date.now() > deadline) {
          const activity = await probe<
            {
              pid: number
              state: string | null
              wait_event_type: string | null
              wait_event: string | null
              query: string | null
            }[]
          >`
            SELECT pid, state, wait_event_type, wait_event, left(query, 120) AS query
            FROM pg_stat_activity WHERE datname = current_database() ORDER BY pid
          `
          throw new Error(
            `period-family-lock-order: timed out waiting for ${String(n)} blocked backend(s); ` +
              `the trace never reached its interleaving. Backends: ${JSON.stringify(activity)}`,
          )
        }
        await new Promise((r) => setTimeout(r, 20))
      }
    },
    async release() {
      if (released) return
      released = true
      openGate()
      await held
      probe.release()
    },
  }
}

/**
 * `postgres` reports a deadlock as a `PostgresError` (message "deadlock
 * detected", code 40P01) wrapped in drizzle's own "Failed query: ..." error as
 * `.cause` — the text that actually says "deadlock" is never in the outer
 * error's own `.message`. Concatenate the whole `.cause` chain so a substring
 * match against it is meaningful.
 */
function errorChainText(err: unknown, depth = 0): string {
  if (err == null || depth > 5) return ''
  const cause = err instanceof Error ? err.cause : undefined
  return `${String(err)}\n${errorChainText(cause, depth + 1)}`
}

/** Wrap a promise so the trace can tell whether it has settled yet. */
function track<T>(p: Promise<T>): { promise: Promise<T>; settled: () => boolean } {
  let done = false
  const promise = p.finally(() => {
    done = true
  })
  return { promise, settled: () => done }
}

before(async () => {
  if (!hasDb) return
  assertCloneDb()
  await cleanup()
  await applyMigration0056()
  await seedFixture()
  assert.ok(
    periodRowIds[3]! < periodRowIds[2]! && periodRowIds[2]! < periodRowIds[1]!,
    `fixture must assign row ids opposite to period_number order for this trace to mean ` +
      `anything; got ${JSON.stringify(periodRowIds)}`,
  )
})

after(async () => {
  if (!hasDb) return
  const { sql: pg } = await import('@eanhl/db')
  await cleanup().catch(() => undefined)
  await pg.end({ timeout: 1 }).catch(() => undefined)
})

void test(
  'promotion and a disjoint rejection do not deadlock when period-row id order ' +
    'runs opposite to period_number order',
  { timeout: 120_000 },
  async (t) => {
    if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
    const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
    const { setExtractionStatus } = await import('../lib/review-cascade.js')

    const holder = await holdRowLock(periodRowIds[2]!)
    try {
      // 1. Promotion (period_number order: 1, 2, 3) locks period 1 uncontested,
      //    then blocks reaching for period 2.
      const promotion = track(
        promoteOcrPeriodFamily({ matchId: MATCH, family: 'goals', maxPeriod: 3 }),
      )
      await holder.waitForBlockedBackends(1, promotion.settled)

      // 2. The cascade rejects a DIFFERENT extraction (faceoffs, not goals) of
      //    the SAME match — its `ocr_extractions` lock is disjoint from
      //    promotion's, so nothing upstream serializes the two paths. Its order
      //    (id asc: period 3, period 2, period 1) locks period 3 uncontested,
      //    then ALSO blocks reaching for period 2.
      const cascade = track(setExtractionStatus([faceoffsExtraction], 'rejected'))
      await holder.waitForBlockedBackends(2, promotion.settled, cascade.settled)

      // 3. Release period 2. Whichever side the lock queue grants it to next
      //    reaches for the row the OTHER already holds — a circular wait either
      //    way, unless both paths lock in the same order.
      await holder.release()
      const [promoted, cascaded] = await Promise.allSettled([promotion.promise, cascade.promise])

      for (const [label, result] of [
        ['promotion', promoted],
        ['cascade', cascaded],
      ] as const) {
        if (result.status === 'rejected') {
          assert.doesNotMatch(
            errorChainText(result.reason),
            /deadlock/i,
            `${label} deadlocked against the other path: ${errorChainText(result.reason)}`,
          )
          // Some other failure — surface it rather than silently passing.
          throw result.reason
        }
      }

      // Both committed: the cascade's own effects must have landed regardless of
      // interleaving order.
      assert.equal(await extractionStatus(faceoffsExtraction), 'rejected')
      for (const status of await faceoffsStatuses()) {
        assert.equal(status, 'rejected', 'the rejected family is durable on every period row')
      }
    } finally {
      await holder.release().catch(() => undefined)
    }
  },
)
