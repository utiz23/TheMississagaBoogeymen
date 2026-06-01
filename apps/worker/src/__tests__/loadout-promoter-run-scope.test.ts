/**
 * Phase-A test: promoteLoadoutFromEvidence honors the `runId` parameter.
 *
 * Two behaviors:
 *   1. When called with `runId` pointing at a NON-active run (a "candidate
 *      run", the reprocess-CLI pattern), the promoter writes ocr_promotions
 *      rows tagged with that runId but does NOT touch player_loadout_snapshots.
 *      Canonical state stays on whatever the active run was.
 *   2. When called with `runId` omitted (legacy/normal path), the promoter
 *      resolves the active run, tags writes with its id, and writes snapshots
 *      as before.
 *
 * Both paths together verify the "promote-validate-activate-rebuild"
 * invariant from the plan: candidate runs accumulate promotions for review;
 * snapshots only change at the activation moment.
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/loadout-promoter-run-scope.test.js
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  db,
  sql,
  matches,
  players,
  ocrCaptureBatches,
  ocrDecoderRuns,
  ocrExtractions,
  ocrFieldEvidence,
  ocrPromotions,
  playerLoadoutSnapshots,
} from '@eanhl/db'
import { and, eq, inArray, like } from 'drizzle-orm'
import { promoteLoadoutFromEvidence } from '../ocr-promoters/loadout-v2.js'

const GAME_TITLE_ID = 1 // NHL 26
const SENTINEL_TAG = 'A1.7-promoter-run-scope'
const HIGH_CONF = '0.95'

let sentinelMatchId: number | null = null

async function cleanup(): Promise<void> {
  if (!process.env['DATABASE_URL']) return
  if (sentinelMatchId !== null) {
    // Order respects FK direction.
    await db.delete(ocrPromotions).where(eq(ocrPromotions.matchId, sentinelMatchId))
    await db
      .delete(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, sentinelMatchId))
    await db.delete(ocrFieldEvidence).where(eq(ocrFieldEvidence.matchId, sentinelMatchId))
    await db.delete(ocrExtractions).where(eq(ocrExtractions.matchId, sentinelMatchId))
    await db.delete(ocrCaptureBatches).where(eq(ocrCaptureBatches.matchId, sentinelMatchId))
    await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.matchId, sentinelMatchId))
    await db.delete(matches).where(eq(matches.id, sentinelMatchId))
    sentinelMatchId = null
  }
  // Stale sentinel cleanup from any prior crashed/aborted runs. Cascade by
  // matching sentinel ea_match_ids → match rows → all linked FKs.
  const staleMatches = await db
    .select({ id: matches.id })
    .from(matches)
    .where(like(matches.eaMatchId, `${SENTINEL_TAG}%`))
  if (staleMatches.length > 0) {
    const ids = staleMatches.map((m) => m.id)
    await db.delete(ocrPromotions).where(inArray(ocrPromotions.matchId, ids))
    await db.delete(playerLoadoutSnapshots).where(inArray(playerLoadoutSnapshots.matchId, ids))
    await db.delete(ocrFieldEvidence).where(inArray(ocrFieldEvidence.matchId, ids))
    await db.delete(ocrExtractions).where(inArray(ocrExtractions.matchId, ids))
    await db.delete(ocrCaptureBatches).where(inArray(ocrCaptureBatches.matchId, ids))
    await db.delete(ocrDecoderRuns).where(inArray(ocrDecoderRuns.matchId, ids))
    await db.delete(matches).where(inArray(matches.id, ids))
  }
}

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanup()
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanup()
  await sql.end({ timeout: 5 })
})

void test('promoter scopes evidence + writes by runId; snapshots skipped for non-active candidate', async () => {
  if (!process.env['DATABASE_URL']) return

  // ── Sentinel match (any unique ea_match_id keeps cleanup precise) ────────
  const [m] = await db
    .insert(matches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      eaMatchId: `${SENTINEL_TAG}-m1`,
      matchType: 'gameType5',
      opponentClubId: '99999',
      opponentName: 'A1.7 Sentinel Opp',
      playedAt: new Date('2026-01-01T00:00:00Z'),
      result: 'WIN',
      scoreFor: 1,
      scoreAgainst: 0,
      shotsFor: 1,
      shotsAgainst: 0,
      hitsFor: 0,
      hitsAgainst: 0,
    })
    .returning({ id: matches.id })
  assert.ok(m)
  const matchId: number = m.id
  sentinelMatchId = matchId

  // ── Need a resolvable gamertag so the loadout promoter can promote past
  //    the resolved-player-id gate. Pick any existing player from the DB. ──
  const existingPlayers = await db.select({ gamertag: players.gamertag }).from(players).limit(1)
  assert.ok(existingPlayers[0], 'DB must have at least one player for this test')
  const resolvedGamertag = existingPlayers[0].gamertag

  // ── Two runs for this match: A (active), B (candidate) ───────────────────
  const [runA] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId: matchId,
      videoSha256: null,
      decoderVersion: `${SENTINEL_TAG}-runA`,
      weightsHash: 'A',
      configHash: 'A',
      isActive: false,
      notes: `${SENTINEL_TAG}-runA`,
    })
    .returning()
  const [runB] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId: matchId,
      videoSha256: null,
      decoderVersion: `${SENTINEL_TAG}-runB`,
      weightsHash: 'B',
      configHash: 'B',
      isActive: false,
      notes: `${SENTINEL_TAG}-runB`,
    })
    .returning()
  assert.ok(runA && runB)
  await db.update(ocrDecoderRuns).set({ isActive: true }).where(eq(ocrDecoderRuns.id, runA.id))

  // ── One batch + extraction per run (for FK + ocrExtractionId derivation) ──
  async function makeBatchAndExtraction(runId: number, label: string): Promise<number> {
    const [b] = await db
      .insert(ocrCaptureBatches)
      .values({
        gameTitleId: GAME_TITLE_ID,
        matchId: matchId,
        sourceDirectory: `/tmp/${SENTINEL_TAG}/${label}`,
        captureKind: 'manual_screenshots',
        notes: `${SENTINEL_TAG}-${label}`,
        runId,
      })
      .returning({ id: ocrCaptureBatches.id })
    if (!b) throw new Error('batch insert failed')
    const [x] = await db
      .insert(ocrExtractions)
      .values({
        batchId: b.id,
        matchId: matchId,
        screenType: 'player_loadout_view',
        sourcePath: `/tmp/${SENTINEL_TAG}/${label}/frame001.png`,
        rawResultJson: {},
        transformStatus: 'success',
        runId,
      })
      .returning({ id: ocrExtractions.id })
    if (!x) throw new Error('extraction insert failed')
    return x.id
  }

  const extractionA = await makeBatchAndExtraction(runA.id, 'runA')
  const extractionB = await makeBatchAndExtraction(runB.id, 'runB')

  // ── Seed evidence in BOTH runs for the same slot ─────────────────────────
  //    runA: a complete, promotable slot (gamertag resolvable + position).
  //    runB: same shape but different content to verify scope isolation.
  async function seed(
    runId: number,
    extractionId: number,
    fieldKey: string,
    value: unknown,
  ): Promise<void> {
    await db.insert(ocrFieldEvidence).values({
      matchId: matchId,
      screenState: 'player_loadout_view',
      subjectSlotKey: 'loadout_slot_A1_7_test',
      fieldKey,
      fieldFamily: 'closed_vocab',
      candidateValue: value,
      candidateRank: 0,
      rawConfidence: HIGH_CONF,
      calibratedConfidence: HIGH_CONF,
      supportFrameIds: [extractionId],
      extractorFamily: 'closed_vocab',
      extractorVersion: `${SENTINEL_TAG}-v1`,
      runId,
    })
  }
  await seed(runA.id, extractionA, 'gamertag', resolvedGamertag)
  await seed(runA.id, extractionA, 'position', 'C')
  await seed(runB.id, extractionB, 'gamertag', resolvedGamertag)
  await seed(runB.id, extractionB, 'position', 'LW')

  // ─── Test 1: promote against candidate (run B) ──────────────────────────
  const candidateResult = await promoteLoadoutFromEvidence({ matchId: matchId, runId: runB.id })

  // Snapshots are skipped for non-active runs — even though promotedSnapshotCount
  // increments in-memory, no row is inserted.
  const snapsAfterCandidate = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, matchId))
  assert.equal(
    snapsAfterCandidate.length,
    0,
    'candidate-run promote does NOT write to player_loadout_snapshots',
  )

  // Promotion rows should be tagged with runB and contain "LW" position
  // (which was the evidence in runB), proving the read was scoped to runB.
  const candidatePromotions = await db
    .select()
    .from(ocrPromotions)
    .where(and(eq(ocrPromotions.matchId, matchId), eq(ocrPromotions.runId, runB.id)))
  assert.ok(
    candidatePromotions.length > 0,
    `expected promotion rows tagged with runB, got ${candidatePromotions.length}`,
  )
  const candidatePositionPromotion = candidatePromotions.find((p) => p.fieldKey === 'position')
  assert.equal(
    candidatePositionPromotion?.winningValue,
    'LW',
    'candidate-run promotion reads evidence scoped to runB (LW, not C)',
  )

  // No promotions should be tagged with runA yet — we only promoted against B.
  const runAPromotions = await db
    .select()
    .from(ocrPromotions)
    .where(and(eq(ocrPromotions.matchId, matchId), eq(ocrPromotions.runId, runA.id)))
  assert.equal(runAPromotions.length, 0, 'no runA promotions written by candidate call')

  void candidateResult // silence unused-var lint

  // ─── Test 2: promote with default args (no runId) — promotes against
  //              active run (A) and writes snapshots ──────────────────────
  const activeResult = await promoteLoadoutFromEvidence({ matchId: matchId })

  // Now the active-run path writes promotion rows tagged with runA.
  const runAPromotionsAfter = await db
    .select()
    .from(ocrPromotions)
    .where(and(eq(ocrPromotions.matchId, matchId), eq(ocrPromotions.runId, runA.id)))
  assert.ok(
    runAPromotionsAfter.length > 0,
    `expected promotion rows tagged with runA after default call, got ${runAPromotionsAfter.length}`,
  )
  const activePositionPromotion = runAPromotionsAfter.find((p) => p.fieldKey === 'position')
  assert.equal(
    activePositionPromotion?.winningValue,
    'C',
    'default call reads evidence scoped to active run (C, not LW)',
  )

  // Snapshots SHOULD have been written this time.
  const snapsAfterActive = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, matchId))
  assert.ok(
    snapsAfterActive.length >= 1,
    `default call should write at least 1 snapshot, got ${snapsAfterActive.length}`,
  )
  assert.equal(activeResult.promotedSnapshotCount, snapsAfterActive.length)

  // Candidate-run promotions should still be intact (scoped delete preserves them).
  const candidatePromotionsAfter = await db
    .select()
    .from(ocrPromotions)
    .where(and(eq(ocrPromotions.matchId, matchId), eq(ocrPromotions.runId, runB.id)))
  assert.ok(
    candidatePromotionsAfter.length > 0,
    'candidate-run promotions survive the active-run promote (scoped delete)',
  )
})
