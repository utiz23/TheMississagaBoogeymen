/**
 * Decoder-run provenance recurrence regression.
 *
 * The bug (docs/operations/decoder-provenance-repair-main-sync-2026-08-16.md
 * §"Unresolved source-level follow-up"): a rescue-like attachment can insert
 * `ocr_segments` carrying a new decoder version under an existing run's
 * `run_id` without refreshing the parent `ocr_decoder_runs.decoder_version`.
 * 38 production rows drifted this way (parent said
 * `legacy-passthrough-v0-video` while owning both that decoder's segments AND
 * `rescue-b2-anchor-v1` segments) before being manually repaired. No source
 * path guaranteed the parent got refreshed on attachment — so the same drift
 * could recur on any future rescue-like write.
 *
 * This test reproduces the defect against `writeSegmentForBatch` (exported
 * from `ingest-ocr.ts` for this purpose) — the exact function every ingest
 * path (including the rescue executor's `ingest-ocr-cli.ts` subprocess calls)
 * uses to attach a segment under a `run_id`.
 *
 * Gated on DATABASE_URL; runs against the isolated clone via `with-test-db.mjs`.
 * All rows are cleaned up in `finally`.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import type { sql as eanhlSql } from '@eanhl/db'

/**
 * The `postgres` reserved-connection handle, derived from `@eanhl/db`'s own
 * pool rather than imported from `postgres` directly (which is a transitive
 * dependency of this workspace, not a declared one).
 */
type ReservedSql = Awaited<ReturnType<(typeof eanhlSql)['reserve']>>

const TAG = 'provrefresh-inttest'
const LEGACY_DECODER = 'legacy-passthrough-v0-video'
const RESCUE_DECODER = 'rescue-b2-anchor-v1'
const SINGLE_DECODER = `${TAG}-single-decoder-v1`

after(async () => {
  if (process.env.DATABASE_URL) {
    const { sql } = await import('@eanhl/db')
    await sql.end({ timeout: 1 }).catch(() => undefined)
  }
})

void test('writeSegmentForBatch refreshes parent run provenance on multi-decoder attachment', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL not set — provenance-refresh integration requires DB.')
    return
  }

  const { db, ocrDecoderRuns, ocrSegments, matches } = await import('@eanhl/db')
  const { writeSegmentForBatch } = await import('../ingest-ocr.js')
  const { eq, and, sql, ne } = await import('drizzle-orm')

  const [anyMatch] = await db.select({ id: matches.id }).from(matches).limit(1)
  assert.ok(anyMatch, 'test DB needs at least one match row')
  const matchId = anyMatch.id

  let mixedRunId: number | undefined
  let singleRunId: number | undefined
  let controlRunId: number | undefined

  try {
    // ── Fixture A: a synthetic run claiming a single legacy decoder, already
    // owning one child segment with that decoder — mirrors the 38 drifted
    // production rows' starting state.
    const [mixedRun] = await db
      .insert(ocrDecoderRuns)
      .values({
        matchId,
        videoSha256: null,
        decoderVersion: LEGACY_DECODER,
        weightsHash: `${TAG}-weights`,
        configHash: `${TAG}-config`,
        isActive: false,
        notes: `synthetic backfill (${TAG}): videos=[none] decoders=[${LEGACY_DECODER}] has_manual=false`,
      })
      .returning({ id: ocrDecoderRuns.id })
    assert.ok(mixedRun, 'mixed-fixture run insert returned a row')
    mixedRunId = mixedRun.id

    await db.insert(ocrSegments).values({
      matchId,
      segmentKey: `${TAG}-mixed-seg-legacy`,
      state: 'post_game_box_score_goals',
      uiVersion: `${TAG}-ui`,
      decoderVersion: LEGACY_DECODER,
      captureBatchId: null,
      runId: mixedRunId,
    })

    // ── An unrelated control run that must never be touched by the refresh.
    const [controlRun] = await db
      .insert(ocrDecoderRuns)
      .values({
        matchId,
        videoSha256: null,
        decoderVersion: LEGACY_DECODER,
        weightsHash: `${TAG}-control-weights`,
        configHash: `${TAG}-config`,
        isActive: false,
        notes: `synthetic backfill (${TAG}-control): videos=[none] decoders=[${LEGACY_DECODER}] has_manual=false`,
      })
      .returning({ id: ocrDecoderRuns.id })
    assert.ok(controlRun, 'control run insert returned a row')
    controlRunId = controlRun.id
    await db.insert(ocrSegments).values({
      matchId,
      segmentKey: `${TAG}-control-seg`,
      state: 'post_game_box_score_goals',
      uiVersion: `${TAG}-ui`,
      decoderVersion: LEGACY_DECODER,
      captureBatchId: null,
      runId: controlRunId,
    })

    // ── The behaviour under test: attach a SECOND segment under the SAME run,
    // carrying a different (rescue) decoder version — the exact shape of the
    // Stage-B rescue's attachment.
    await writeSegmentForBatch({
      matchId,
      batchId: -1,
      screen: 'post_game_box_score_shots',
      frameCount: 1,
      results: [],
      videoSha256: null,
      videoSegmentIndex: null,
      videoSegmentStartSec: null,
      videoSegmentEndSec: null,
      uiVersion: `${TAG}-ui`,
      decoderVersion: RESCUE_DECODER,
      runId: mixedRunId,
      // segmentKey is derived internally from batchId when no video meta is
      // given (`batch-${batchId}`); -1 keeps it distinct from the fixture's
      // segment key above.
    } as Parameters<typeof writeSegmentForBatch>[0])

    // Both child segments keep their real, truthful decoder tags — untouched.
    const childSegs = await db
      .select({ segmentKey: ocrSegments.segmentKey, decoderVersion: ocrSegments.decoderVersion })
      .from(ocrSegments)
      .where(eq(ocrSegments.runId, mixedRunId))
    assert.equal(childSegs.length, 2, 'run now owns exactly 2 child segments')
    const bySegKey = Object.fromEntries(childSegs.map((s) => [s.segmentKey, s.decoderVersion]))
    assert.equal(
      bySegKey[`${TAG}-mixed-seg-legacy`],
      LEGACY_DECODER,
      'original segment decoder unchanged',
    )
    assert.equal(
      bySegKey['batch--1'],
      RESCUE_DECODER,
      'new segment carries the real rescue decoder',
    )

    // The exact parent run becomes legacy-mixed and discloses both decoders.
    const [afterMixed] = await db
      .select({ decoderVersion: ocrDecoderRuns.decoderVersion, notes: ocrDecoderRuns.notes })
      .from(ocrDecoderRuns)
      .where(eq(ocrDecoderRuns.id, mixedRunId))
    assert.equal(afterMixed?.decoderVersion, 'legacy-mixed', 'parent run promoted to legacy-mixed')
    assert.match(afterMixed.notes ?? '', /decoders=\[/, 'notes still disclose a decoder set')
    assert.match(
      afterMixed.notes ?? '',
      new RegExp(LEGACY_DECODER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'notes disclose the legacy decoder',
    )
    assert.match(
      afterMixed.notes ?? '',
      new RegExp(RESCUE_DECODER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'notes disclose the rescue decoder',
    )

    // No OTHER run was touched by the refresh.
    const [afterControl] = await db
      .select({ decoderVersion: ocrDecoderRuns.decoderVersion, notes: ocrDecoderRuns.notes })
      .from(ocrDecoderRuns)
      .where(eq(ocrDecoderRuns.id, controlRunId))
    assert.equal(
      afterControl?.decoderVersion,
      LEGACY_DECODER,
      'unrelated run decoder_version untouched',
    )
    assert.match(afterControl.notes ?? '', /decoders=\[/, 'control notes shape unchanged')
    assert.doesNotMatch(
      afterControl.notes ?? '',
      new RegExp(RESCUE_DECODER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'control run must not disclose the rescue decoder it never owned',
    )

    // Sanity: no stray row outside our two fixture runs got mutated either.
    const [strayCount] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(ocrDecoderRuns)
      .where(
        and(
          eq(ocrDecoderRuns.decoderVersion, 'legacy-mixed'),
          ne(ocrDecoderRuns.id, mixedRunId),
          sql`${ocrDecoderRuns.notes} LIKE ${'%' + TAG + '%'}`,
        ),
      )
    assert.equal(strayCount?.n ?? 0, 0, 'no other fixture run flipped to legacy-mixed')

    // ── Single-decoder case stays single-decoder.
    const [singleRun] = await db
      .insert(ocrDecoderRuns)
      .values({
        matchId,
        videoSha256: null,
        decoderVersion: SINGLE_DECODER,
        weightsHash: `${TAG}-single-weights`,
        configHash: `${TAG}-config`,
        isActive: false,
        notes: `synthetic backfill (${TAG}-single): videos=[none] decoders=[${SINGLE_DECODER}] has_manual=false`,
      })
      .returning({ id: ocrDecoderRuns.id })
    assert.ok(singleRun, 'single-fixture run insert returned a row')
    singleRunId = singleRun.id

    await writeSegmentForBatch({
      matchId,
      batchId: -2,
      screen: 'post_game_box_score_shots',
      frameCount: 1,
      results: [],
      videoSha256: null,
      videoSegmentIndex: null,
      videoSegmentStartSec: null,
      videoSegmentEndSec: null,
      uiVersion: `${TAG}-ui`,
      decoderVersion: SINGLE_DECODER,
      runId: singleRunId,
    } as Parameters<typeof writeSegmentForBatch>[0])

    const [afterSingle1] = await db
      .select({ decoderVersion: ocrDecoderRuns.decoderVersion, notes: ocrDecoderRuns.notes })
      .from(ocrDecoderRuns)
      .where(eq(ocrDecoderRuns.id, singleRunId))
    assert.equal(
      afterSingle1?.decoderVersion,
      SINGLE_DECODER,
      'single-decoder run stays single-decoder',
    )
    const notesAfterFirst = afterSingle1.notes ?? ''

    // Idempotent re-upsert of the SAME segment (same key, same decoder) must
    // not corrupt provenance — decoder_version and notes stay stable.
    await writeSegmentForBatch({
      matchId,
      batchId: -2,
      screen: 'post_game_box_score_shots',
      frameCount: 1,
      results: [],
      videoSha256: null,
      videoSegmentIndex: null,
      videoSegmentStartSec: null,
      videoSegmentEndSec: null,
      uiVersion: `${TAG}-ui`,
      decoderVersion: SINGLE_DECODER,
      runId: singleRunId,
    } as Parameters<typeof writeSegmentForBatch>[0])

    const [afterSingle2] = await db
      .select({ decoderVersion: ocrDecoderRuns.decoderVersion, notes: ocrDecoderRuns.notes })
      .from(ocrDecoderRuns)
      .where(eq(ocrDecoderRuns.id, singleRunId))
    assert.equal(
      afterSingle2?.decoderVersion,
      SINGLE_DECODER,
      'repeated idempotent upsert keeps single-decoder value',
    )
    assert.equal(
      afterSingle2.notes,
      notesAfterFirst,
      'repeated idempotent upsert does not mutate notes',
    )
  } finally {
    if (mixedRunId != null) {
      await db.delete(ocrSegments).where(eq(ocrSegments.runId, mixedRunId))
      await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.id, mixedRunId))
    }
    if (controlRunId != null) {
      await db.delete(ocrSegments).where(eq(ocrSegments.runId, controlRunId))
      await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.id, controlRunId))
    }
    if (singleRunId != null) {
      await db.delete(ocrSegments).where(eq(ocrSegments.runId, singleRunId))
      await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.id, singleRunId))
    }
  }
})

// ─────────────────────────────────────────────────────────────────────────
// Concurrency regressions for the run-scoped provenance write.
//
// THE RACE
// --------
// `refreshDecoderRunProvenance` reads the parent run, reads its child
// segments, then writes a derived decoder_version/notes back. Without an
// exclusive lock on the parent row, that read can miss a sibling segment that
// is concurrently being attached (by a second, independent transaction) but
// has not committed yet: the writer computes its result from an incomplete
// view, and its UPDATE then commits that stale, incomplete decoder set as if
// it were final — even though the sibling's segment lands in the very same run
// moments later (the same shape as the 38-row production drift this file's
// first test reproduces, but from concurrency instead of a single skipped
// refresh).
//
// THE LOCK, AND WHY IT COMES BEFORE THE CHILD WRITE
// -------------------------------------------------
// `writeSegmentForBatch` takes `lockDecoderRunForProvenance` — a
// `SELECT ... FOR UPDATE` on the exact parent run row — as the FIRST statement
// of its transaction, BEFORE the segment upsert.
//
// Locking only inside `refreshDecoderRunProvenance` (i.e. AFTER the child
// insert) is NOT sufficient and is NOT acceptable behavior. Inserting a segment
// that references `run_id` makes Postgres take `FOR KEY SHARE` on the parent
// row for the FK check, and `FOR KEY SHARE` is compatible with itself: two
// cooperating writers for the same run would both complete their inserts, then
// each try to escalate past the OTHER's still-held `FOR KEY SHARE`, and
// Postgres would break the circular wait by aborting one of them (40P01).
// `ingestOcrBatch` catches a failed segment write and continues, so that abort
// silently drops a legitimate segment from the ingest result. Fail-closed for
// provenance, but a lost segment — not a working concurrency implementation.
//
// Taking `FOR UPDATE` first removes the upgrade entirely: the second writer
// queues at the very first statement, while it holds no child-row lock the
// first writer could ever need. The two writers serialize, and BOTH commit.
// `refreshDecoderRunProvenance` still re-asserts `FOR UPDATE` on the same row;
// re-acquiring a lock the transaction already holds is a no-op, so that is an
// idempotent assertion rather than a second acquisition.
//
// The two tests below:
//   1. SYMMETRIC — two real, production-shaped `writeSegmentForBatch` writers
//      for the same run, distinct segment keys, distinct decoder versions.
//      Both must commit; neither may fail with 40P01. This is the acceptance
//      test for the ordering.
//   2. ASYMMETRIC — one real writer against a raw, still-uncommitted sibling
//      INSERT held open by another connection. Additional coverage for the
//      stale-read half of the invariant (the writer must not publish a
//      provenance set that omits a sibling that lands in the same run).
//
// Both make the interleaving deterministic with a real row-lock gate held on a
// third connection plus `pg_stat_activity` polling — never `Promise.all`
// timing. Both writers are confirmed blocked, simultaneously, before the gate
// is released.
// ─────────────────────────────────────────────────────────────────────────

const CONC_TAG = 'provrefresh-conc-inttest'
const CONC_DECODER_A = `${CONC_TAG}-decoder-A`
const CONC_DECODER_B = `${CONC_TAG}-decoder-B`

/** Wrap a promise so the trace can tell whether it has settled yet. */
function track<T>(p: Promise<T>): { promise: Promise<T>; settled: () => boolean } {
  let done = false
  const promise = p.finally(() => {
    done = true
  })
  return { promise, settled: () => done }
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
  const text = err instanceof Error ? err.toString() : JSON.stringify(err)
  return `${text}\n${errorChainText(cause, depth + 1)}`
}

/**
 * Assert a settled writer actually committed, naming a deadlock explicitly so
 * a 40P01 abort can never be mistaken for some unrelated failure.
 */
function assertCommitted(label: string, result: PromiseSettledResult<unknown>): void {
  if (result.status === 'fulfilled') return
  const text = errorChainText(result.reason)
  assert.doesNotMatch(
    text,
    /deadlock|40P01/i,
    `${label} failed with a lock error instead of committing — the pre-insert run lock is not ` +
      `serializing cooperating writers: ${text}`,
  )
  throw result.reason
}

/** Poll `pg_stat_activity` until `n` backends other than `excludePids` are lock-blocked. */
async function waitForBlockedBackends(
  probe: ReservedSql,
  n: number,
  excludePids: readonly number[],
  settledFns: readonly (() => boolean)[],
): Promise<void> {
  const deadline = Date.now() + 30_000
  for (;;) {
    const [row] = await probe<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND NOT (pid = ANY(${[...excludePids]}))
    `
    if ((row?.n ?? 0) >= n) return
    // A writer that finished instead of blocking is equally decisive — it means
    // the interleaving this trace needs never happened. Return so the caller's
    // own explicit assertion reports it.
    if (settledFns.some((settled) => settled())) return
    if (Date.now() > deadline) {
      const activity = await probe<
        {
          pid: number
          state: string | null
          wait_event_type: string | null
          query: string | null
        }[]
      >`
        SELECT pid, state, wait_event_type, left(query, 120) AS query
        FROM pg_stat_activity WHERE datname = current_database() ORDER BY pid
      `
      throw new Error(
        `decoder-run-provenance-refresh: timed out waiting for ${String(n)} blocked backend(s); ` +
          `the trace never reached its interleaving. Backends: ${JSON.stringify(activity)}`,
      )
    }
    await new Promise((r) => setTimeout(r, 20))
  }
}

interface Gate {
  /** pids that belong to the gate itself, never to a writer under test. */
  ownPids: number[]
  probe: ReservedSql
  release(): Promise<void>
}

/**
 * Holds `SELECT ... FOR UPDATE` on one `ocr_decoder_runs` row on a dedicated
 * connection until released.
 *
 * This is the same lock `writeSegmentForBatch` takes as its first statement, so
 * every writer for that run parks behind it — deterministically, at a known
 * point, with no child-row work done yet. (Under the mutated ordering, where
 * the lock is taken only after the insert, writers park on the insert's own FK
 * `FOR KEY SHARE` instead; either way both are blocked before release, which is
 * what makes the mutation's deadlock reproducible rather than timing-dependent.)
 *
 * The transaction is held inside `sql.begin()` awaiting a JS gate rather than a
 * manually-issued `BEGIN` on a `sql.reserve()`d connection: a reserved
 * connection can be handed back to the pool between statements, silently
 * defeating the hold.
 */
async function holdRunRowLock(runId: number): Promise<Gate> {
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
    assert.ok(row, 'holdRunRowLock: pg_backend_pid() returned no row')
    await tx`SELECT id FROM ocr_decoder_runs WHERE id = ${runId} FOR UPDATE`
    acquired(row.pid)
    await gate
  })
  const holderPid = await ready

  // A dedicated connection for polling, so a probe can never be pipelined
  // behind one of the blocked queries it is supposed to observe.
  const probe = await pg.reserve()
  const [probeRow] = await probe<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
  assert.ok(probeRow, 'holdRunRowLock: probe pg_backend_pid() returned no row')

  let released = false
  return {
    ownPids: [holderPid, probeRow.pid],
    probe,
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
 * Seed an empty synthetic run for a concurrency trace: `decoder_version`
 * `'unknown'` with an empty `decoders=[]` disclosure, so the final
 * `legacy-mixed` + two-decoder disclosure can only come from the writers.
 */
async function seedConcurrencyRun(matchId: number, tag: string): Promise<number> {
  const { db, ocrDecoderRuns } = await import('@eanhl/db')
  const [run] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: null,
      decoderVersion: 'unknown',
      weightsHash: `${tag}-weights`,
      configHash: `${CONC_TAG}-config`,
      isActive: false,
      notes: `synthetic backfill (${tag}): videos=[none] decoders=[] has_manual=false`,
    })
    .returning({ id: ocrDecoderRuns.id })
  assert.ok(run, `${tag}: concurrency-fixture run insert returned a row`)
  return run.id
}

async function dropConcurrencyRun(runId: number): Promise<void> {
  const { db, ocrDecoderRuns, ocrSegments } = await import('@eanhl/db')
  const { eq } = await import('drizzle-orm')
  await db.delete(ocrSegments).where(eq(ocrSegments.runId, runId))
  await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.id, runId))
}

/**
 * Production writer, verbatim. Both sides of the symmetric trace call the real
 * exported `writeSegmentForBatch`, so the transaction ordering under test is
 * literally the production one — nothing is re-implemented or simplified here,
 * and the test cannot drift from `ingest-ocr.ts`.
 *
 * `segmentKey` is derived internally as `batch-${batchId}` when no video meta
 * is given, so distinct negative `batchId`s give the two writers distinct
 * segment keys (and therefore no unique-index contention of their own).
 */
async function productionWriter(input: {
  matchId: number
  runId: number
  batchId: number
  decoderVersion: string
}): Promise<{ id: number }> {
  const { writeSegmentForBatch } = await import('../ingest-ocr.js')
  return writeSegmentForBatch({
    matchId: input.matchId,
    batchId: input.batchId,
    screen: 'post_game_box_score_shots',
    frameCount: 1,
    results: [],
    videoSha256: null,
    videoSegmentIndex: null,
    videoSegmentStartSec: null,
    videoSegmentEndSec: null,
    uiVersion: `${CONC_TAG}-ui`,
    decoderVersion: input.decoderVersion,
    runId: input.runId,
  })
}

const SYM_TAG = `${CONC_TAG}-symmetric`
const SYM_BATCH_A = -9101
const SYM_BATCH_B = -9102

void test(
  'two cooperating writeSegmentForBatch writers on the same run both commit ' +
    'and the parent ends legacy-mixed',
  { timeout: 120_000 },
  async (t) => {
    if (!process.env.DATABASE_URL) {
      t.skip('DATABASE_URL not set — provenance-refresh concurrency requires DB.')
      return
    }

    const { db, ocrDecoderRuns, ocrSegments, matches } = await import('@eanhl/db')
    const { eq } = await import('drizzle-orm')

    const [anyMatch] = await db.select({ id: matches.id }).from(matches).limit(1)
    assert.ok(anyMatch, 'test DB needs at least one match row')
    const matchId = anyMatch.id

    let runId: number | undefined
    let writerA: ReturnType<typeof track<{ id: number }>> | undefined
    let writerB: ReturnType<typeof track<{ id: number }>> | undefined

    try {
      runId = await seedConcurrencyRun(matchId, SYM_TAG)

      // Gate: hold the run row so both writers are guaranteed to be in flight,
      // and blocked, at the same instant. No Promise.all timing luck.
      const gate = await holdRunRowLock(runId)
      try {
        writerA = track(
          productionWriter({
            matchId,
            runId,
            batchId: SYM_BATCH_A,
            decoderVersion: CONC_DECODER_A,
          }),
        )
        await waitForBlockedBackends(gate.probe, 1, gate.ownPids, [writerA.settled])

        writerB = track(
          productionWriter({
            matchId,
            runId,
            batchId: SYM_BATCH_B,
            decoderVersion: CONC_DECODER_B,
          }),
        )
        await waitForBlockedBackends(gate.probe, 2, gate.ownPids, [
          writerA.settled,
          writerB.settled,
        ])

        // Overlap is real, not accidental sequencing: BOTH writers hold open
        // transactions and are blocked on the run row right now. Neither has
        // committed, so neither can have run to completion before the other
        // started.
        assert.equal(
          writerA.settled(),
          false,
          'writer A settled before the gate opened — the two writers ran sequentially, so this ' +
            'trace proves nothing about concurrent writers',
        )
        assert.equal(
          writerB.settled(),
          false,
          'writer B settled before the gate opened — the two writers ran sequentially, so this ' +
            'trace proves nothing about concurrent writers',
        )
      } finally {
        await gate.release()
      }

      // Released: from here the two writers contend only with each other, under
      // real Postgres locking.
      assert.ok(writerA, 'writer A was started')
      assert.ok(writerB, 'writer B was started')
      const [resA, resB] = await Promise.allSettled([writerA.promise, writerB.promise])
      assertCommitted('writer A', resA)
      assertCommitted('writer B', resB)

      // Both child segments exist, each tagged with its own real decoder.
      const childSegs = await db
        .select({ segmentKey: ocrSegments.segmentKey, decoderVersion: ocrSegments.decoderVersion })
        .from(ocrSegments)
        .where(eq(ocrSegments.runId, runId))
      assert.equal(childSegs.length, 2, 'both writers landed a segment under the run')
      const byKey = Object.fromEntries(childSegs.map((s) => [s.segmentKey, s.decoderVersion]))
      assert.equal(
        byKey[`batch-${String(SYM_BATCH_A)}`],
        CONC_DECODER_A,
        "writer A's segment carries writer A's real decoder",
      )
      assert.equal(
        byKey[`batch-${String(SYM_BATCH_B)}`],
        CONC_DECODER_B,
        "writer B's segment carries writer B's real decoder",
      )

      // The parent accounts for both, whichever writer won the lock queue.
      const [after] = await db
        .select({ decoderVersion: ocrDecoderRuns.decoderVersion, notes: ocrDecoderRuns.notes })
        .from(ocrDecoderRuns)
        .where(eq(ocrDecoderRuns.id, runId))
      assert.ok(after, 'symmetric-fixture run still exists')
      assert.equal(
        after.decoderVersion,
        'legacy-mixed',
        `parent run must account for BOTH concurrent writers' decoders ` +
          `(got decoder_version=${after.decoderVersion})`,
      )
      assert.match(after.notes ?? '', /decoders=\[/, 'notes still disclose a decoder set')
      assert.match(
        after.notes ?? '',
        new RegExp(CONC_DECODER_A.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        'notes disclose decoder A',
      )
      assert.match(
        after.notes ?? '',
        new RegExp(CONC_DECODER_B.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        'notes disclose decoder B',
      )
    } finally {
      // Settle (and mark handled) any writer still in flight after an early
      // throw, so the fixture teardown below can never race a live transaction.
      await Promise.allSettled([writerA?.promise, writerB?.promise])
      if (runId != null) await dropConcurrencyRun(runId)
    }
  },
)

// ─────────────────────────────────────────────────────────────────────────
// Additional coverage: the stale-read half of the invariant.
//
// An interferer inserts a real sibling segment under the same run and holds its
// transaction open without ever updating the parent — so it can never be the
// other side of a circular wait, and the only thing that can block the writer
// is the run-row lock under test. The writer is the real, unmodified
// `writeSegmentForBatch`. Its `SELECT ... FOR UPDATE` conflicts with the FK
// `FOR KEY SHARE` the interferer's uncommitted insert holds, so it cannot
// compute provenance until it can see whatever the interferer commits.
// ─────────────────────────────────────────────────────────────────────────

const ASYM_TAG = `${CONC_TAG}-asymmetric`
const ASYM_BATCH_A = -9201

interface InterfererHold {
  ownPids: number[]
  probe: ReservedSql
  release(): Promise<void>
}

/**
 * Inserts one real `ocr_segments` row referencing `runId` and holds the
 * transaction open until `release()` is called. While held, the insert's
 * foreign-key check keeps a `FOR KEY SHARE` lock on the run row — enough to
 * block a concurrent `SELECT ... FOR UPDATE` on it, but nothing this holder
 * itself could ever deadlock against, since it never escalates that lock.
 */
async function holdInterfererSegment(input: {
  matchId: number
  runId: number
  segmentKey: string
  decoderVersion: string
}): Promise<InterfererHold> {
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
    assert.ok(row, 'holdInterfererSegment: pg_backend_pid() returned no row')
    await tx`
      INSERT INTO ocr_segments
        (match_id, segment_key, state, ui_version, decoder_version, capture_batch_id, run_id)
      VALUES (
        ${input.matchId}, ${input.segmentKey}, 'post_game_box_score_shots', ${`${CONC_TAG}-ui`},
        ${input.decoderVersion}, NULL, ${input.runId}
      )
    `
    acquired(row.pid)
    await gate
  })
  const holderPid = await ready

  const probe = await pg.reserve()
  const [probeRow] = await probe<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`
  assert.ok(probeRow, 'holdInterfererSegment: probe pg_backend_pid() returned no row')

  let released = false
  return {
    ownPids: [holderPid, probeRow.pid],
    probe,
    async release() {
      if (released) return
      released = true
      openGate()
      await held
      probe.release()
    },
  }
}

void test(
  'a concurrent, still-uncommitted sibling segment is never lost from provenance',
  { timeout: 120_000 },
  async (t) => {
    if (!process.env.DATABASE_URL) {
      t.skip('DATABASE_URL not set — provenance-refresh concurrency requires DB.')
      return
    }

    const { db, ocrDecoderRuns, ocrSegments, matches } = await import('@eanhl/db')
    const { eq } = await import('drizzle-orm')

    const [anyMatch] = await db.select({ id: matches.id }).from(matches).limit(1)
    assert.ok(anyMatch, 'test DB needs at least one match row')
    const matchId = anyMatch.id

    let runId: number | undefined
    let writer: ReturnType<typeof track<{ id: number }>> | undefined

    try {
      runId = await seedConcurrencyRun(matchId, ASYM_TAG)

      // The interferer attaches decoder B and holds — its segment is a real,
      // uncommitted child of this run for as long as it's held.
      const interferer = await holdInterfererSegment({
        matchId,
        runId,
        segmentKey: `${ASYM_TAG}-seg-B`,
        decoderVersion: CONC_DECODER_B,
      })

      try {
        // The writer under test attaches decoder A via the real, production
        // `writeSegmentForBatch` transaction.
        writer = track(
          productionWriter({
            matchId,
            runId,
            batchId: ASYM_BATCH_A,
            decoderVersion: CONC_DECODER_A,
          }),
        )
        await waitForBlockedBackends(interferer.probe, 1, interferer.ownPids, [writer.settled])
        assert.equal(
          writer.settled(),
          false,
          'the writer finished without ever contending for the run row — it never saw the ' +
            "interferer's uncommitted sibling segment",
        )
      } finally {
        // Let the interferer's segment commit — whatever the writer does from
        // here plays out against real Postgres locking, not a fixed delay.
        await interferer.release()
      }
      assert.ok(writer, 'the writer was started')
      const [res] = await Promise.allSettled([writer.promise])
      assertCommitted('writer', res)

      const childSegs = await db
        .select({ decoderVersion: ocrSegments.decoderVersion })
        .from(ocrSegments)
        .where(eq(ocrSegments.runId, runId))
      assert.equal(childSegs.length, 2, "run owns both the writer's segment and the interferer's")

      const [after] = await db
        .select({ decoderVersion: ocrDecoderRuns.decoderVersion, notes: ocrDecoderRuns.notes })
        .from(ocrDecoderRuns)
        .where(eq(ocrDecoderRuns.id, runId))
      assert.ok(after, 'concurrency-fixture run still exists')
      assert.equal(
        after.decoderVersion,
        'legacy-mixed',
        `parent run must account for the interferer's segment once it commits, not the stale ` +
          `snapshot the writer read before it existed (got decoder_version=${after.decoderVersion})`,
      )
      assert.match(after.notes ?? '', /decoders=\[/, 'notes still disclose a decoder set')
      assert.match(
        after.notes ?? '',
        new RegExp(CONC_DECODER_A.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        'notes disclose decoder A',
      )
      assert.match(
        after.notes ?? '',
        new RegExp(CONC_DECODER_B.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        'notes disclose decoder B',
      )
    } finally {
      await Promise.allSettled([writer?.promise])
      if (runId != null) await dropConcurrencyRun(runId)
    }
  },
)
