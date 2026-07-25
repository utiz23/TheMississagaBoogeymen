/**
 * Multi-reel reel-scoping stamp bug (the latent `ocr_capture_batches.match_id`
 * over-stamp).
 *
 * The bug: `confirmAssociation` stamped `ocr_capture_batches.match_id` by
 * `(video_sha256, run_id)` with NO reel scoping. In a multi-reel video all reels
 * share one `(sha, run_id=NULL)` group, so confirming ONE reel re-stamped EVERY
 * batch of the video — clobbering the other reels' match_id. Under GAP (3)'s
 * run-linkage cascade this shifted to "first-confirm-wins-all": confirm #1
 * stamped all batches to match X and cascaded a run onto them, so confirm #2's
 * `run_id IS NULL` predicate matched nothing and match Y got no batches and no
 * run.
 *
 * The fix (right-scope the stamp — DECISION 1, 2026-07-13): a `run_id IS NULL`
 * confirm no longer stamps pre-existing batches. Deferred dispatch assigns each
 * reel's match_id at batch creation (the association row is the source of truth),
 * and `ensureSyntheticActiveRunForMatch` — which is MATCH-scoped, not
 * sha-scoped — links each match's own batches to its own run. The confirm-time
 * sha-scoped stamp survives only for the `run_id` NON-NULL re-association path,
 * where `(sha, run_id)` already scopes to exactly one match's batches.
 *
 * Gated on DATABASE_URL; runs against the isolated clone via `with-test-db.mjs`.
 * All rows are cleaned up in `finally`.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'

const SHA = 'reelscope-inttest-sha256-0ddba11'
const DIR_A = 'reelscope-inttest-dir-reel0'
const DIR_B = 'reelscope-inttest-dir-reel1'
const RUNSHA = 'reelscope-reassoc-inttest-sha256-c0ffee'
const RUNDIR = 'reelscope-reassoc-inttest-dir'

// Close the DB pool so `node --test` can exit (mirror match-association-queries).
after(async () => {
  if (process.env['DATABASE_URL']) {
    const { sql } = await import('@eanhl/db')
    await sql.end({ timeout: 1 }).catch(() => undefined)
  }
})

void test('multi-reel partial-confirm does not cross-contaminate: each reel keeps its own match_id + gets its own run', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — reel-scope integration requires DB.')
    return
  }

  const { db, ocrCaptureBatches, ocrMatchAssociations, ocrDecoderRuns, ocrSegments, matches } =
    await import('@eanhl/db')
  const { insertAssociationProposal, confirmAssociation } = await import('@eanhl/db/queries')
  const { and, eq, notExists, sql } = await import('drizzle-orm')

  // Two DISTINCT "clean" matches (no run, no batches, no segments) — the whole
  // point of a multi-reel video: its reels map to different matches. Clean so the
  // confirm exercises run CREATION and the per-match active-run assertions are
  // unambiguous.
  const clean = await db
    .select({ id: matches.id, gameTitleId: matches.gameTitleId })
    .from(matches)
    .where(
      and(
        notExists(
          db
            .select({ x: sql`1` })
            .from(ocrDecoderRuns)
            .where(eq(ocrDecoderRuns.matchId, matches.id)),
        ),
        notExists(
          db
            .select({ x: sql`1` })
            .from(ocrCaptureBatches)
            .where(eq(ocrCaptureBatches.matchId, matches.id)),
        ),
        notExists(
          db
            .select({ x: sql`1` })
            .from(ocrSegments)
            .where(eq(ocrSegments.matchId, matches.id)),
        ),
      ),
    )
    .limit(2)
  assert.ok(clean.length >= 2, 'test DB needs two matches with no run and no OCR data')
  const [mX, mY] = clean
  assert.ok(mX && mY)

  // Defensive pre-clean in case a prior run died mid-test (FK order: batches
  // before the runs they reference).
  await db.delete(ocrMatchAssociations).where(eq(ocrMatchAssociations.videoSha256, SHA))
  await db.delete(ocrCaptureBatches).where(eq(ocrCaptureBatches.videoSha256, SHA))
  await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.matchId, mX.id))
  await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.matchId, mY.id))

  try {
    // Two reels' batches, already carrying their correct per-reel match_id (the
    // state deferred dispatch produces: reel 0 → match X, reel 1 → match Y), same
    // video sha, run_id NULL. The pre-fix confirm would clobber batch B to X.
    const [batchA] = await db
      .insert(ocrCaptureBatches)
      .values({
        gameTitleId: mX.gameTitleId,
        captureKind: 'video_frames',
        videoSha256: SHA,
        sourceDirectory: DIR_A,
        matchId: mX.id,
        runId: null,
      })
      .returning({ id: ocrCaptureBatches.id })
    const [batchB] = await db
      .insert(ocrCaptureBatches)
      .values({
        gameTitleId: mY.gameTitleId,
        captureKind: 'video_frames',
        videoSha256: SHA,
        sourceDirectory: DIR_B,
        matchId: mY.id,
        runId: null,
      })
      .returning({ id: ocrCaptureBatches.id })
    assert.ok(batchA && batchB, 'both reel batches inserted')

    // Two associations, both born run_id NULL (the fresh multi-reel convention).
    const a0 = await insertAssociationProposal({
      reelIdentity: `${SHA}:0`,
      videoSha256: SHA,
      runId: null,
      proposedMatchId: mX.id,
      confidence: '0.9000',
      evidence: {},
    })
    const a1 = await insertAssociationProposal({
      reelIdentity: `${SHA}:1`,
      videoSha256: SHA,
      runId: null,
      proposedMatchId: mY.id,
      confidence: '0.8000',
      evidence: {},
    })

    // ── The partial-confirm sequence under test: confirm reel A, then reel B ──
    const r0 = await confirmAssociation(a0.id)
    const r1 = await confirmAssociation(a1.id)

    // A run_id-NULL confirm no longer sha-stamps pre-existing batches.
    assert.deepEqual(r0.stampedBatchIds, [], 'confirm reel 0 stamps no batch (run_id-NULL path)')
    assert.deepEqual(r1.stampedBatchIds, [], 'confirm reel 1 stamps no batch (run_id-NULL path)')

    // Core anti-bug assertion: neither reel's match_id was clobbered.
    const [afterA] = await db
      .select({ matchId: ocrCaptureBatches.matchId, runId: ocrCaptureBatches.runId })
      .from(ocrCaptureBatches)
      .where(eq(ocrCaptureBatches.id, batchA.id))
    const [afterB] = await db
      .select({ matchId: ocrCaptureBatches.matchId, runId: ocrCaptureBatches.runId })
      .from(ocrCaptureBatches)
      .where(eq(ocrCaptureBatches.id, batchB.id))
    assert.equal(afterA?.matchId, mX.id, 'reel 0 batch keeps match X')
    assert.equal(afterB?.matchId, mY.id, 'reel 1 batch keeps match Y (NOT clobbered to X)')

    // GAP (3) interplay: each match got its OWN synthetic active run, and each
    // reel's batch is linked to its own match's run (match-scoped cascade).
    const runsX = await db
      .select({ id: ocrDecoderRuns.id })
      .from(ocrDecoderRuns)
      .where(and(eq(ocrDecoderRuns.matchId, mX.id), eq(ocrDecoderRuns.isActive, true)))
    const runsY = await db
      .select({ id: ocrDecoderRuns.id })
      .from(ocrDecoderRuns)
      .where(and(eq(ocrDecoderRuns.matchId, mY.id), eq(ocrDecoderRuns.isActive, true)))
    assert.equal(runsX.length, 1, 'match X has exactly one active run')
    assert.equal(runsY.length, 1, 'match Y has exactly one active run')
    assert.equal(afterA?.runId, runsX[0]!.id, 'reel 0 batch linked to match X run')
    assert.equal(afterB?.runId, runsY[0]!.id, 'reel 1 batch linked to match Y run')
    assert.notEqual(runsX[0]!.id, runsY[0]!.id, 'the two reels got distinct runs')
  } finally {
    await db.delete(ocrMatchAssociations).where(eq(ocrMatchAssociations.videoSha256, SHA))
    await db.delete(ocrCaptureBatches).where(eq(ocrCaptureBatches.videoSha256, SHA))
    await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.matchId, mX.id))
    await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.matchId, mY.id))
  }
})

void test('re-association of an existing run still stamps that run’s batches (run_id NON-NULL path)', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — reel-scope integration requires DB.')
    return
  }

  const { db, ocrCaptureBatches, ocrMatchAssociations, ocrDecoderRuns, ocrSegments, matches } =
    await import('@eanhl/db')
  const { insertAssociationProposal, confirmAssociation } = await import('@eanhl/db/queries')
  const { and, eq, notExists, sql } = await import('drizzle-orm')

  const clean = await db
    .select({ id: matches.id, gameTitleId: matches.gameTitleId })
    .from(matches)
    .where(
      and(
        notExists(
          db
            .select({ x: sql`1` })
            .from(ocrDecoderRuns)
            .where(eq(ocrDecoderRuns.matchId, matches.id)),
        ),
        notExists(
          db
            .select({ x: sql`1` })
            .from(ocrCaptureBatches)
            .where(eq(ocrCaptureBatches.matchId, matches.id)),
        ),
        notExists(
          db
            .select({ x: sql`1` })
            .from(ocrSegments)
            .where(eq(ocrSegments.matchId, matches.id)),
        ),
      ),
    )
    .limit(1)
  const M = clean[0]
  assert.ok(M, 'test DB needs a clean match')

  await db.delete(ocrMatchAssociations).where(eq(ocrMatchAssociations.videoSha256, RUNSHA))
  await db.delete(ocrCaptureBatches).where(eq(ocrCaptureBatches.videoSha256, RUNSHA))
  await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.matchId, M.id))

  try {
    // An already-dispatched single-match run: run row + its batch (run_id set,
    // match_id not yet stamped). `(sha, run_id)` scopes to exactly this run's
    // batch, so the confirm-time stamp is still safe and useful here.
    const [run] = await db
      .insert(ocrDecoderRuns)
      .values({
        matchId: M.id,
        videoSha256: RUNSHA,
        decoderVersion: 'reelscope-reassoc-decoder',
        weightsHash: 'reelscope-reassoc-weights',
        configHash: 'reelscope-reassoc-config',
        isActive: true,
        notes: 'reelscope reassoc test run',
      })
      .returning({ id: ocrDecoderRuns.id })
    assert.ok(run, 'run inserted')

    const [batch] = await db
      .insert(ocrCaptureBatches)
      .values({
        gameTitleId: M.gameTitleId,
        captureKind: 'video_frames',
        videoSha256: RUNSHA,
        sourceDirectory: RUNDIR,
        matchId: null,
        runId: run.id,
      })
      .returning({ id: ocrCaptureBatches.id })
    assert.ok(batch, 'batch inserted')

    const assoc = await insertAssociationProposal({
      reelIdentity: `${RUNSHA}:0`,
      videoSha256: RUNSHA,
      runId: run.id,
      proposedMatchId: M.id,
      confidence: '0.9500',
      evidence: {},
    })

    const res = await confirmAssociation(assoc.id)
    assert.deepEqual(res.stampedBatchIds, [batch.id], 'run_id-scoped confirm stamps the run batch')

    const [after] = await db
      .select({ matchId: ocrCaptureBatches.matchId })
      .from(ocrCaptureBatches)
      .where(eq(ocrCaptureBatches.id, batch.id))
    assert.equal(after?.matchId, M.id, 'run batch stamped to the confirmed match')
  } finally {
    await db.delete(ocrMatchAssociations).where(eq(ocrMatchAssociations.videoSha256, RUNSHA))
    await db.delete(ocrCaptureBatches).where(eq(ocrCaptureBatches.videoSha256, RUNSHA))
    await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.matchId, M.id))
  }
})
