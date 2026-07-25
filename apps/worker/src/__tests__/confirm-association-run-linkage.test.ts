/**
 * GAP (3): confirmAssociation must leave the decoder-run ledger consistent.
 *
 * The bug: confirmAssociation never ensured a synthetic active ocr_decoder_run
 * nor cascaded run_id onto the match-linked rows. Result: association-flow
 * matches ended up with run-less batches/segments and ZERO active runs —
 * violating the invariants migration 0048_phase_a_decoder_runs.sql established.
 *
 * This test pins the fixed behaviour against a throwaway fixture (a "clean"
 * real match that has no run and no OCR data yet) so it exercises the CREATE
 * path (not the reuse path). Its batch already carries match_id (the state
 * deferred dispatch produces) because the reel-scoping fix means a run_id-NULL
 * confirm no longer STAMPS match_id — but it must STILL ensure the run and
 * cascade run_id onto that match's batches/segments (match-scoped, GAP 3). Gated
 * on DATABASE_URL; runs against the isolated clone via `with-test-db.mjs`. All
 * rows are cleaned up in `finally`.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'

const SHA = 'runlink-inttest-sha256-feedface'
const DIR = 'runlink-inttest-dir'
const SEGKEY = `${SHA}:seg0`
const DECODER = 'runlink-inttest-decoder-v1'

// Close the DB pool so `node --test` can exit (mirror match-association-queries).
after(async () => {
  if (process.env['DATABASE_URL']) {
    const { sql } = await import('@eanhl/db')
    await sql.end({ timeout: 1 }).catch(() => undefined)
  }
})

void test('confirmAssociation ensures a synthetic active run and cascades run_id to match’s batch + segment', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — run-linkage integration requires DB.')
    return
  }

  const { db, ocrCaptureBatches, ocrMatchAssociations, ocrSegments, ocrDecoderRuns, matches } =
    await import('@eanhl/db')
  const { insertAssociationProposal, confirmAssociation } = await import('@eanhl/db/queries')
  const { and, eq, notExists, sql } = await import('drizzle-orm')

  // A "clean" match: no decoder run, no capture batches, no segments — so the
  // confirm exercises run CREATION (not the reuse-existing-active-run path).
  const clean = await db
    .select({ id: matches.id })
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
  const M = clean[0]?.id
  assert.ok(M != null, 'test DB needs a match with no run and no OCR data')

  // Defensive pre-clean in case a prior run died mid-test.
  await db.delete(ocrMatchAssociations).where(eq(ocrMatchAssociations.videoSha256, SHA))
  await db.delete(ocrCaptureBatches).where(eq(ocrCaptureBatches.videoSha256, SHA))

  try {
    const [match] = await db
      .select({ gameTitleId: matches.gameTitleId })
      .from(matches)
      .where(eq(matches.id, M))
      .limit(1)
    assert.ok(match, 'match row loads')

    // Batch already carrying match_id (the dispatch-assigned state), run_id null.
    // The run_id-NULL confirm no longer STAMPS match_id (reel-scoping fix); GAP 3
    // must still find this match's batch by match_id and cascade run_id onto it.
    const [batch] = await db
      .insert(ocrCaptureBatches)
      .values({
        gameTitleId: match.gameTitleId,
        captureKind: 'video_frames',
        videoSha256: SHA,
        sourceDirectory: DIR,
        matchId: M,
        runId: null,
      })
      .returning({ id: ocrCaptureBatches.id })
    assert.ok(batch, 'capture batch insert returned a row')

    // A match-linked segment with run_id null — the cascade must reach it too.
    await db.insert(ocrSegments).values({
      matchId: M,
      segmentKey: SEGKEY,
      state: 'post_game_box_score_goals',
      uiVersion: 'runlink-inttest-ui',
      decoderVersion: DECODER,
      captureBatchId: null,
      runId: null,
    })

    const proposal = await insertAssociationProposal({
      reelIdentity: `${SHA}:0`,
      videoSha256: SHA,
      runId: null,
      proposedMatchId: M,
      confidence: '0.9000',
      evidence: {},
    })

    // ── The behaviour under test ──────────────────────────────────────────
    const res = await confirmAssociation(proposal.id)
    assert.equal(res.association.status, 'confirmed')
    // Reel-scoping fix: the run_id-NULL fresh path stamps NO batch. Run linkage
    // below is what GAP 3 guarantees, decoupled from the (removed) stamp.
    assert.deepEqual(res.stampedBatchIds, [], 'run_id-NULL confirm stamps no batch')

    // 1. Exactly one active synthetic run now exists for the match.
    const activeRuns = await db
      .select()
      .from(ocrDecoderRuns)
      .where(and(eq(ocrDecoderRuns.matchId, M), eq(ocrDecoderRuns.isActive, true)))
    assert.equal(activeRuns.length, 1, 'exactly one active run created for the confirmed match')
    const run = activeRuns[0]!

    // 2. Provenance mirrors 0048: single-source video → that sha; single
    //    decoder across segments → that decoder; notes disclose videos/decoders.
    assert.equal(run.videoSha256, SHA, 'single-source video sha recorded')
    assert.equal(run.decoderVersion, DECODER, 'single distinct segment decoder recorded')
    assert.match(run.notes ?? '', /videos=\[/, 'notes disclose videos=[…]')
    assert.match(run.notes ?? '', /decoders=\[/, 'notes disclose decoders=[…]')

    // 3. run_id cascaded onto the stamped batch AND the match-linked segment.
    const [afterBatch] = await db
      .select({ runId: ocrCaptureBatches.runId })
      .from(ocrCaptureBatches)
      .where(eq(ocrCaptureBatches.id, batch.id))
    assert.equal(afterBatch?.runId, run.id, 'batch run_id cascaded to the new run')

    const [afterSeg] = await db
      .select({ runId: ocrSegments.runId })
      .from(ocrSegments)
      .where(and(eq(ocrSegments.matchId, M), eq(ocrSegments.segmentKey, SEGKEY)))
    assert.equal(afterSeg?.runId, run.id, 'segment run_id cascaded to the new run')
  } finally {
    // FK order: rows referencing the run (batch, segment) before the run.
    await db.delete(ocrMatchAssociations).where(eq(ocrMatchAssociations.videoSha256, SHA))
    await db.delete(ocrCaptureBatches).where(eq(ocrCaptureBatches.videoSha256, SHA))
    if (M != null) {
      await db
        .delete(ocrSegments)
        .where(and(eq(ocrSegments.matchId, M), eq(ocrSegments.segmentKey, SEGKEY)))
      await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.matchId, M))
    }
  }
})
