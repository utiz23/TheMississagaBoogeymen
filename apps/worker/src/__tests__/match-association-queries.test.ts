/**
 * Reel→match association queries — integration (Milestone ② Task 2.3).
 *
 * Gated on DATABASE_URL like match-250-benchmark.test.ts. Exercises the review
 * queue end-to-end against throwaway rows keyed on a synthetic video sha:
 * insert → list → confirm (flips status + stamps the capture batch's match_id)
 * → reject. All rows are cleaned up in `finally` regardless of outcome.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'

const SHA = 'assoc-inttest-sha256-deadbeef'
const DIR = 'assoc-inttest-dir'
const SHA2 = 'assoc-reelmap-inttest-sha256-cafef00d'

// Close the DB pool so `node --test` can exit (mirror l4-api-truth.test.ts).
after(async () => {
  if (process.env['DATABASE_URL']) {
    const { sql } = await import('@eanhl/db')
    await sql.end({ timeout: 1 }).catch(() => undefined)
  }
})

void test('association queue: insert → list → confirm stamps batch match_id; reject flips status', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — association-queries integration requires DB.')
    return
  }

  const { db, ocrCaptureBatches, ocrMatchAssociations, ocrDecoderRuns, gameTitles, matches } =
    await import('@eanhl/db')
  const {
    insertAssociationProposal,
    listPendingAssociations,
    confirmAssociation,
    rejectAssociation,
  } = await import('@eanhl/db/queries')
  const { eq } = await import('drizzle-orm')

  // Defensive pre-clean in case a prior run died mid-test. Order matters:
  // batches carry run_id (FK → ocr_decoder_runs), so drop them before the run.
  // confirmAssociation now creates a synthetic decoder run for the confirmed
  // match (GAP 3); it is keyed on this test's unique SHA, so deleting runs by
  // that sha targets only the test's own run, never a real one.
  await db.delete(ocrMatchAssociations).where(eq(ocrMatchAssociations.videoSha256, SHA))
  await db.delete(ocrCaptureBatches).where(eq(ocrCaptureBatches.videoSha256, SHA))
  await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.videoSha256, SHA))

  try {
    const [gt] = await db.select({ id: gameTitles.id }).from(gameTitles).limit(1)
    const [m] = await db.select({ id: matches.id }).from(matches).limit(1)
    assert.ok(gt, 'test DB needs at least one game title')
    assert.ok(m, 'test DB needs at least one match')

    // Capture batch to be stamped: unassociated (match_id null), run_id null.
    const [batch] = await db
      .insert(ocrCaptureBatches)
      .values({
        gameTitleId: gt.id,
        captureKind: 'video_frames',
        videoSha256: SHA,
        sourceDirectory: DIR,
        matchId: null,
        runId: null,
      })
      .returning({ id: ocrCaptureBatches.id })
    assert.ok(batch, 'capture batch insert returned a row')

    // Pending proposal → real match.
    const proposal = await insertAssociationProposal({
      reelIdentity: `${SHA}:0`,
      videoSha256: SHA,
      runId: null,
      proposedMatchId: m.id,
      confidence: '0.9000',
      evidence: { score: { for: 4, against: 2 }, signals: { timestamp: 1 }, runnerUpGap: 0.5 },
    })
    assert.equal(proposal.status, 'pending')
    assert.equal(proposal.decidedAt, null)

    // list returns the pending proposal.
    const pending = await listPendingAssociations()
    assert.ok(
      pending.some((p) => p.id === proposal.id),
      'listPendingAssociations includes the new proposal',
    )

    // confirm flips status + stamps the batch's match_id.
    const res = await confirmAssociation(proposal.id)
    assert.equal(res.association.status, 'confirmed')
    assert.ok(res.association.decidedAt instanceof Date, 'decided_at set on confirm')
    assert.deepEqual(res.stampedBatchIds, [batch.id])

    const [afterBatch] = await db
      .select({ matchId: ocrCaptureBatches.matchId })
      .from(ocrCaptureBatches)
      .where(eq(ocrCaptureBatches.id, batch.id))
    assert.equal(afterBatch?.matchId, m.id, 'capture batch match_id stamped to the confirmed match')

    // A confirmed proposal no longer appears in the pending list.
    const pendingAfter = await listPendingAssociations()
    assert.ok(!pendingAfter.some((p) => p.id === proposal.id), 'confirmed proposal left the queue')

    // Re-confirming a decided proposal throws.
    await assert.rejects(() => confirmAssociation(proposal.id), /not pending/)

    // A second proposal → reject (status flips, no stamp).
    const proposal2 = await insertAssociationProposal({
      reelIdentity: `${SHA}:1`,
      videoSha256: SHA,
      runId: null,
      proposedMatchId: m.id,
      confidence: '0.4000',
      evidence: {},
    })
    const rej = await rejectAssociation(proposal2.id)
    assert.equal(rej.status, 'rejected')
    assert.ok(rej.decidedAt instanceof Date, 'decided_at set on reject')
  } finally {
    await db.delete(ocrMatchAssociations).where(eq(ocrMatchAssociations.videoSha256, SHA))
    await db.delete(ocrCaptureBatches).where(eq(ocrCaptureBatches.videoSha256, SHA))
    // Drop the synthetic run confirmAssociation created (GAP 3); after the batch
    // delete above it owns no rows, so the FK is clear. Keyed on the test's sha.
    await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.videoSha256, SHA))
  }
})

// Milestone ② step (2), A2: the cross-language reel→match delivery channel.
void test('getConfirmedReelMap: confirmed reels only, {reelIndex,matchId}, deterministic order', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — getConfirmedReelMap integration requires DB.')
    return
  }

  const { db, ocrMatchAssociations, ocrDecoderRuns, matches } = await import('@eanhl/db')
  const { insertAssociationProposal, confirmAssociation, getConfirmedReelMap } =
    await import('@eanhl/db/queries')
  const { eq } = await import('drizzle-orm')

  await db.delete(ocrMatchAssociations).where(eq(ocrMatchAssociations.videoSha256, SHA2))
  // These proposals are batch-less (direct path), so confirmAssociation's run
  // guard creates no run — this delete is a defensive no-op keyed on SHA2.
  await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.videoSha256, SHA2))

  try {
    // Two DISTINCT matches — the whole point of a multi-reel video (its reels
    // map to different matches, which is why they can't share one decoder run).
    const ms = await db.select({ id: matches.id }).from(matches).limit(2)
    assert.ok(ms.length >= 2, 'test DB needs at least two matches')
    const [m0, m1] = ms
    assert.ok(m0 && m1)

    // Direct (runId: null) proposals — the fresh multi-reel path, no capture batch.
    const p0 = await insertAssociationProposal({
      reelIdentity: `${SHA2}:0`,
      videoSha256: SHA2,
      runId: null,
      proposedMatchId: m0.id,
      confidence: '0.8000',
      evidence: {},
    })
    const p1 = await insertAssociationProposal({
      reelIdentity: `${SHA2}:1`,
      videoSha256: SHA2,
      runId: null,
      proposedMatchId: m1.id,
      confidence: '0.7000',
      evidence: {},
    })
    // A third reel left pending — must NOT appear in the confirmed map.
    await insertAssociationProposal({
      reelIdentity: `${SHA2}:2`,
      videoSha256: SHA2,
      runId: null,
      proposedMatchId: m0.id,
      confidence: '0.6000',
      evidence: {},
    })

    // Nothing confirmed yet → empty map.
    assert.deepEqual(await getConfirmedReelMap(SHA2), [])

    await confirmAssociation(p0.id)
    await confirmAssociation(p1.id)

    // Confirmed reels only, parsed from `${sha}:${idx}`, ordered by reel_identity.
    assert.deepEqual(await getConfirmedReelMap(SHA2), [
      { reelIndex: 0, matchId: m0.id },
      { reelIndex: 1, matchId: m1.id },
    ])
  } finally {
    await db.delete(ocrMatchAssociations).where(eq(ocrMatchAssociations.videoSha256, SHA2))
    await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.videoSha256, SHA2))
  }
})
