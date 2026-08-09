/**
 * CONCURRENT revocation vs promotion — audit finding C4.
 *
 * THE RACE
 * --------
 * The cascade's quarantine UPDATE qualified rows that ALREADY carried a
 * `reviewed` family:
 *
 *     UPDATE match_period_summaries SET … WHERE match_id = ANY(…)
 *       AND (goals_review_status = 'reviewed' OR …)
 *
 * Under READ COMMITTED, a row that does not satisfy the predicate at scan time is
 * never locked and never waited on. So while a promotion held those rows
 * `FOR UPDATE` with their families still `pending_review`, a concurrent rejection
 * saw ZERO qualifying rows, committed instantly, and the promotion then committed
 * `reviewed` values for an extraction that was already rejected.
 *
 * Nothing in the promotion looked at extraction state either, so neither side
 * could detect the other. The invariant this file pins:
 *
 *     the committed state must never contain a `reviewed` implicated family
 *     alongside a `rejected` extraction for that match/family.
 *
 * THE LOCK ORDER
 * --------------
 * Both paths take locks in ONE order, so they serialize instead of deadlocking:
 *
 *     1. ocr_extractions        (promotion: FOR SHARE; cascade: FOR UPDATE)
 *     2. matches / player_match_stats / opponent_player_match_stats
 *        (promotion only, FOR SHARE)
 *     3. match_period_summaries (both, FOR UPDATE, UNQUALIFIED by status)
 *
 * Step 1 is what makes the two paths mutually visible: the cascade cannot flip an
 * extraction to `rejected` between the promotion's barrier check and its write,
 * and the promotion cannot slip in after a rejection commits. Step 3 must be
 * unqualified — a status-qualified UPDATE silently skips locked pending rows,
 * which is the C4 defect itself.
 *
 * HOW THE INTERLEAVING IS MADE DETERMINISTIC
 * ------------------------------------------
 * Both production paths are single async calls, so the pause has to come from the
 * database. A BEFORE-UPDATE trigger on the table each path writes calls
 * `pg_advisory_xact_lock(K)`; a third, reserved connection holds K inside an open
 * transaction and releases it by committing. The paused path is therefore stopped
 * at a precise, repeatable point — after it has taken its locks and decided, and
 * before it commits — with no sleeps deciding the outcome.
 *
 * Build + run (focused):
 *   pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build
 *   set -a && source .env && set +a
 *   node apps/worker/scripts/with-test-db.mjs period-family-rejection-concurrency
 */

import test, { after, before, beforeEach } from 'node:test'
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
const MATCH = 9701
const ALL_MATCHES = [MATCH]
const REGULATION_TOI = 3600

/** Advisory-lock keys the pause triggers block on. Arbitrary but distinct. */
const PERIOD_WRITE_KEY = 970101
const EXTRACTION_WRITE_KEY = 970102

const hasDb = Boolean(process.env['DATABASE_URL'])

let goalsExtraction = 0

function assertCloneDb(): void {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('period-family-rejection-concurrency: DATABASE_URL is unset.')
  let dbName: string
  try {
    dbName = new URL(url).pathname.replace(/^\//, '')
  } catch {
    throw new Error(`period-family-rejection-concurrency: DATABASE_URL is not a valid URL: ${url}`)
  }
  if (!dbName.startsWith('eanhl_test')) {
    throw new Error(
      `period-family-rejection-concurrency: refusing to run — DATABASE_URL points at database ` +
        `"${dbName}", not an "eanhl_test_*" clone. This file applies DDL (migration 0056 plus ` +
        `pause triggers) and mutates review statuses; run it via ` +
        `apps/worker/scripts/with-test-db.mjs.`,
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

/**
 * Install the two pause triggers.
 *
 * Each is narrowly conditioned on the exact write the trace needs to freeze, so
 * fixture setup and the OTHER path's writes pass straight through.
 */
async function installPauseTriggers(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await pg
    .unsafe(
      `
    CREATE OR REPLACE FUNCTION test_pause_period_publish() RETURNS trigger AS $fn$
    BEGIN
      PERFORM pg_advisory_xact_lock(${String(PERIOD_WRITE_KEY)});
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;

    CREATE OR REPLACE FUNCTION test_pause_extraction_reject() RETURNS trigger AS $fn$
    BEGIN
      PERFORM pg_advisory_xact_lock(${String(EXTRACTION_WRITE_KEY)});
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  `,
    )
    .simple()
}

async function dropPauseTriggers(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await pg
    .unsafe(
      `
    DROP TRIGGER IF EXISTS test_pause_period_publish_trg ON match_period_summaries;
    DROP TRIGGER IF EXISTS test_pause_extraction_reject_trg ON ocr_extractions;
  `,
    )
    .simple()
}

async function armPeriodPublishPause(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await dropPauseTriggers()
  await pg
    .unsafe(
      `
    CREATE TRIGGER test_pause_period_publish_trg
      BEFORE UPDATE ON match_period_summaries
      FOR EACH ROW
      WHEN (OLD.goals_review_status = 'pending_review' AND NEW.goals_review_status = 'reviewed')
      EXECUTE FUNCTION test_pause_period_publish();
  `,
    )
    .simple()
}

async function armExtractionRejectPause(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await dropPauseTriggers()
  await pg
    .unsafe(
      `
    CREATE TRIGGER test_pause_extraction_reject_trg
      BEFORE UPDATE ON ocr_extractions
      FOR EACH ROW
      WHEN (OLD.review_status IS DISTINCT FROM 'rejected' AND NEW.review_status = 'rejected')
      EXECUTE FUNCTION test_pause_extraction_reject();
  `,
    )
    .simple()
}

async function cleanup(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await dropPauseTriggers().catch(() => undefined)
  await pg`DELETE FROM match_period_summaries WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM player_match_stats WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM opponent_player_match_stats WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM ocr_extractions WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM ocr_capture_batches WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM matches WHERE id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM players WHERE gamertag = 'REJECTION-CONCURRENCY-SENTINEL'`
}

/** Goals reconcile exactly (2-1, 1-0, 0-0 → 3-1, EA says 3-1). */
async function seedFixture(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await pg`
    INSERT INTO matches (
      id, game_title_id, ea_match_id, match_type, opponent_club_id, opponent_name,
      played_at, result, score_for, score_against, shots_for, shots_against,
      hits_for, hits_against
    ) VALUES (
      ${MATCH}, (SELECT id FROM game_titles ORDER BY id LIMIT 1),
      ${`rejection-concurrency-${MATCH}`}, 'gameType5', '999999', 'SENTINEL',
      now(), 'WIN', 3, 1, 20, 18, 5, 4
    )
  `
  const [player] = await pg<{ id: number }[]>`
    INSERT INTO players (gamertag, position)
    VALUES ('REJECTION-CONCURRENCY-SENTINEL', 'center')
    ON CONFLICT DO NOTHING
    RETURNING id
  `
  const playerId =
    player?.id ??
    (
      await pg<
        { id: number }[]
      >`SELECT id FROM players WHERE gamertag = 'REJECTION-CONCURRENCY-SENTINEL'`
    )[0]!.id
  await pg`
    INSERT INTO player_match_stats (player_id, match_id, position, is_goalie, goals, assists,
                                    faceoff_wins, faceoff_losses, toi_seconds)
    VALUES (${playerId}, ${MATCH}, 'center', false, 0, 0, 12, 0, ${REGULATION_TOI})
  `
  await pg`
    INSERT INTO opponent_player_match_stats (match_id, ea_player_id, opponent_club_id, gamertag,
                                             position, is_goalie, faceoff_wins, faceoff_losses,
                                             toi_seconds)
    VALUES (${MATCH}, ${`concurrency-${MATCH}`}, '999999', 'SENTINEL-OPP',
            'center', false, 8, 0, ${REGULATION_TOI})
  `
  const [batch] = await pg<{ id: number }[]>`
    INSERT INTO ocr_capture_batches (game_title_id, match_id, capture_kind, source_directory)
    VALUES ((SELECT id FROM game_titles ORDER BY id LIMIT 1), ${MATCH}, 'video_frames',
            ${`/rejection-concurrency-${MATCH}`})
    RETURNING id
  `
  const [extraction] = await pg<{ id: string }[]>`
    INSERT INTO ocr_extractions (batch_id, match_id, screen_type, source_path, raw_result_json,
                                 transform_status, review_status)
    VALUES (${batch!.id}, ${MATCH}, 'post_game_box_score_goals',
            ${`/frames/${String(MATCH)}-goals.png`}, '{}'::jsonb, 'success', 'pending_review')
    RETURNING id
  `
  goalsExtraction = Number(extraction!.id)

  for (const p of [
    { period: 1, gf: 2, ga: 1 },
    { period: 2, gf: 1, ga: 0 },
    { period: 3, gf: 0, ga: 0 },
  ]) {
    await pg`
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
    `
  }
}

async function resetAll(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await pg`
    UPDATE match_period_summaries
    SET goals_review_status = 'pending_review',
        shots_review_status = 'pending_review',
        faceoffs_review_status = 'pending_review',
        review_status = 'pending_review'
    WHERE match_id = ANY(${ALL_MATCHES})
  `
  await pg`
    UPDATE ocr_extractions SET review_status = 'pending_review', reviewed_at = NULL
    WHERE match_id = ANY(${ALL_MATCHES})
  `
}

async function goalsStatuses(): Promise<string[]> {
  const { sql: pg } = await import('@eanhl/db')
  const rows = await pg<{ goals_review_status: string }[]>`
    SELECT goals_review_status FROM match_period_summaries
    WHERE match_id = ${MATCH} ORDER BY period_number
  `
  return rows.map((r) => r.goals_review_status)
}

async function extractionStatus(): Promise<string> {
  const { sql: pg } = await import('@eanhl/db')
  const [row] = await pg<{ review_status: string }[]>`
    SELECT review_status FROM ocr_extractions WHERE id = ${goalsExtraction}
  `
  return row?.review_status ?? 'missing'
}

/**
 * The pause holder: one connection parked inside an open transaction holding the
 * advisory key, plus the polling primitive the traces use to know a path has
 * actually reached its blocking point.
 *
 * The transaction is held inside `sql.begin()` awaiting a JS gate rather than by
 * issuing `BEGIN` on a `sql.reserve()`d connection. postgres.js keeps a
 * `begin()` connection out of the pool for the whole callback; a reserved
 * connection driven with a manual `BEGIN` can be handed back to the pool between
 * statements, and a later pooled transaction that lands on it inherits the open
 * transaction — which makes the advisory lock re-entrant, silently defeats the
 * pause, and commits the holder's transaction when it finishes. That failure
 * mode looks exactly like "the fix works", so it must not be possible here.
 */
interface PauseHolder {
  waitForBlockedBackends(n: number, settled: () => boolean): Promise<void>
  release(): Promise<void>
}

async function holdPauseKey(key: number): Promise<PauseHolder> {
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
    await tx`SELECT pg_advisory_xact_lock(${key})`
    acquired(row!.pid)
    await gate
  })
  const holderPid = await ready

  // A dedicated connection for the polling, so a probe can never be pipelined
  // behind one of the blocked queries it is supposed to observe.
  const probe = await pg.reserve()

  let released = false
  return {
    async waitForBlockedBackends(n, settled) {
      const deadline = Date.now() + 30_000
      for (;;) {
        const [row] = await probe<{ n: number }[]>`
          SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> ${holderPid}
        `
        if ((row?.n ?? 0) >= n) return
        // A path that finished instead of blocking is equally decisive — that is
        // exactly the pre-fix behaviour the trace is meant to capture.
        if (settled()) return
        if (Date.now() > deadline) {
          // Dump the live backend state: a trace that never reaches its
          // interleaving is otherwise indistinguishable from a hung test.
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
            `period-family-rejection-concurrency: timed out waiting for ${String(n)} blocked ` +
              `backend(s); the trace never reached its interleaving. Backends: ` +
              JSON.stringify(activity),
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
  await installPauseTriggers()
  await seedFixture()
})

beforeEach(async () => {
  if (!hasDb) return
  await dropPauseTriggers()
  await resetAll()
})

after(async () => {
  if (!hasDb) return
  const { sql: pg } = await import('@eanhl/db')
  await cleanup().catch(() => undefined)
  await pg
    .unsafe(
      'DROP FUNCTION IF EXISTS test_pause_period_publish(); ' +
        'DROP FUNCTION IF EXISTS test_pause_extraction_reject();',
    )
    .simple()
    .catch(() => undefined)
  await pg.end({ timeout: 1 }).catch(() => undefined)
})

// ── trace 1: promotion holds the pending rows, THEN the rejection arrives ────

void test(
  'a rejection racing a promotion that already holds the pending rows still wins',
  { timeout: 120_000 },
  async (t) => {
    if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
    const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
    const { setExtractionStatus } = await import('../lib/review-cascade.js')

    await armPeriodPublishPause()
    const pause = await holdPauseKey(PERIOD_WRITE_KEY)
    try {
      // 1. Promotion runs until its publishing UPDATE. By then it holds every
      //    candidate period row FOR UPDATE with all three families pending, and
      //    has already classified them as promotable.
      const promotion = track(
        promoteOcrPeriodFamily({ matchId: MATCH, family: 'goals', maxPeriod: 3 }),
      )
      await pause.waitForBlockedBackends(1, promotion.settled)

      // 2. A second connection rejects the extraction. Pre-fix this committed
      //    immediately (its status-qualified UPDATE matched no `reviewed` row);
      //    post-fix it blocks on the promotion's extraction lock.
      const rejection = track(setExtractionStatus([goalsExtraction], 'rejected'))
      await pause.waitForBlockedBackends(2, rejection.settled)

      // 3. Let both finish.
      await pause.release()
      const [promoted] = await Promise.all([promotion.promise, rejection.promise])

      assert.equal(await extractionStatus(), 'rejected', 'the rejection is committed')
      const goals = await goalsStatuses()
      assert.ok(
        !goals.includes('reviewed'),
        `no goals family may be published alongside a rejected goals extraction (got ` +
          `${goals.join(',')}; promotion reported authorized=${String(promoted.authorized)})`,
      )
      for (const status of goals) {
        assert.equal(status, 'rejected', 'and the rejection is durable on every row')
      }
    } finally {
      await pause.release().catch(() => undefined)
      await dropPauseTriggers().catch(() => undefined)
    }
  },
)

// ── trace 2: the rejection takes its lock first, THEN promotion begins ──────

void test(
  'a promotion beginning after a rejection has locked the extraction must refuse',
  { timeout: 120_000 },
  async (t) => {
    if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
    const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
    const { setExtractionStatus } = await import('../lib/review-cascade.js')

    await armExtractionRejectPause()
    const pause = await holdPauseKey(EXTRACTION_WRITE_KEY)
    try {
      // 1. The rejection takes its extraction lock, then freezes before commit.
      const rejection = track(setExtractionStatus([goalsExtraction], 'rejected'))
      await pause.waitForBlockedBackends(1, rejection.settled)

      // 2. Promotion begins. It must WAIT on the extraction lock rather than
      //    read a stale `pending_review` and publish.
      const promotion = track(
        promoteOcrPeriodFamily({ matchId: MATCH, family: 'goals', maxPeriod: 3 }),
      )
      await pause.waitForBlockedBackends(2, promotion.settled)

      await pause.release()
      const [promoted] = await Promise.all([promotion.promise, rejection.promise])

      assert.equal(
        promoted.authorized,
        false,
        'promotion must observe the rejection and refuse, not publish',
      )
      assert.deepEqual(promoted.promotedPeriods, [], 'a refusal promotes nothing')
      assert.equal(await extractionStatus(), 'rejected')
      for (const status of await goalsStatuses()) {
        assert.notEqual(status, 'reviewed', 'nothing may be published under a rejection')
      }
    } finally {
      await pause.release().catch(() => undefined)
      await dropPauseTriggers().catch(() => undefined)
    }
  },
)

// ── trace 3: the two paths must not deadlock ─────────────────────────────────

void test(
  'concurrent promotion and revocation on the same match never deadlock',
  { timeout: 120_000 },
  async (t) => {
    if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
    const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
    const { setExtractionStatus } = await import('../lib/review-cascade.js')

    // No pause trigger: fire both directions at each other repeatedly and let
    // the real lock order arbitrate. A cycle would surface as a Postgres
    // deadlock error (40P01) out of one of the two calls.
    for (let round = 0; round < 6; round++) {
      await resetAll()
      const results = await Promise.allSettled([
        promoteOcrPeriodFamily({ matchId: MATCH, family: 'goals', maxPeriod: 3 }),
        setExtractionStatus([goalsExtraction], 'rejected'),
        promoteOcrPeriodFamily({ matchId: MATCH, family: 'faceoffs', maxPeriod: 3 }),
      ])
      for (const r of results) {
        if (r.status === 'rejected') {
          assert.doesNotMatch(
            String(r.reason),
            /deadlock/i,
            `round ${String(round)}: the two paths deadlocked`,
          )
        }
      }
      // Whatever the interleaving, the invariant holds once both have committed.
      assert.equal(await extractionStatus(), 'rejected')
      assert.ok(
        !(await goalsStatuses()).includes('reviewed'),
        `round ${String(round)}: a goals family survived alongside a rejected goals extraction`,
      )
    }
  },
)
