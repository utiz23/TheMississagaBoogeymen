/**
 * Task 1 — A3 reprocess CLI: rebuildCanonicalsFromActiveRun helper.
 *
 * The helper reads the active ocr_decoder_runs row for a match and
 * re-projects its evidence into player_loadout_snapshots (plus the
 * x-factor / attribute children) by re-invoking the v2 promoters with
 * runId = activeRunId. Because the promoters gate their snapshot
 * writes on `effectiveRunIdForWrites === activeRunId`, re-invoking
 * them with the active run id triggers the canonical writes.
 *
 * Three behaviors covered here:
 *   1. With a v1 (inactive) and a v2 (active) decoder run carrying
 *      distinct gamertag evidence, only the v2 evidence ends up in
 *      player_loadout_snapshots.
 *   2. Calling the helper twice does NOT produce duplicate canonical
 *      rows (idempotency — prior snapshots are deleted before re-
 *      promote).
 *   3. Calling the helper for a match with no active run throws an
 *      error containing "no active run".
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/rebuild-canonicals-from-active-run.test.js
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  db,
  sql as rawSql,
  matches,
  players,
  ocrCaptureBatches,
  ocrDecoderRuns,
  ocrExtractions,
  ocrFieldEvidence,
  ocrPromotions,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
} from '@eanhl/db'
import { eq, inArray, like } from 'drizzle-orm'
import { rebuildCanonicalsFromActiveRun } from '../lib/rebuild-canonicals-from-active-run.js'

const GAME_TITLE_ID = 1 // NHL 26
const SENTINEL_TAG = 'A3-T1-rebuild-canonicals'
const HIGH_CONF = '0.95'

// Track the sentinel match created in each test so the after() hook can
// reliably clean it up even when a test fails mid-run.
const sentinelMatchIds: Set<number> = new Set()

async function cleanupMatch(matchId: number): Promise<void> {
  // Order respects FK direction.
  // Child rows of player_loadout_snapshots first.
  const snapIds = (
    await db
      .select({ id: playerLoadoutSnapshots.id })
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, matchId))
  ).map((r) => r.id)
  if (snapIds.length > 0) {
    await db
      .delete(playerLoadoutXFactors)
      .where(inArray(playerLoadoutXFactors.loadoutSnapshotId, snapIds))
    await db
      .delete(playerLoadoutAttributes)
      .where(inArray(playerLoadoutAttributes.loadoutSnapshotId, snapIds))
  }
  await db
    .delete(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, matchId))
  await db
    .delete(ocrPromotions)
    .where(eq(ocrPromotions.matchId, matchId))
  await db
    .delete(ocrFieldEvidence)
    .where(eq(ocrFieldEvidence.matchId, matchId))
  await db
    .delete(ocrExtractions)
    .where(eq(ocrExtractions.matchId, matchId))
  await db
    .delete(ocrCaptureBatches)
    .where(eq(ocrCaptureBatches.matchId, matchId))
  await db
    .delete(ocrDecoderRuns)
    .where(eq(ocrDecoderRuns.matchId, matchId))
  await db.delete(matches).where(eq(matches.id, matchId))
}

async function cleanupAllSentinels(): Promise<void> {
  const staleMatches = await db
    .select({ id: matches.id })
    .from(matches)
    .where(like(matches.eaMatchId, `${SENTINEL_TAG}%`))
  for (const m of staleMatches) {
    await cleanupMatch(m.id)
  }
  sentinelMatchIds.clear()
}

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanupAllSentinels()
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  // Clean up any matches tracked during this run, then sweep stragglers.
  for (const matchId of Array.from(sentinelMatchIds)) {
    try {
      await cleanupMatch(matchId)
    } catch {
      // ignore — sweep will retry
    }
  }
  await cleanupAllSentinels()
  await rawSql.end()
})

interface SetupFixtureResult {
  matchId: number
  v1RunId: number
  v2RunId: number
  v1ExtractionId: number
  v2ExtractionId: number
  v1Gamertag: string
  v2Gamertag: string
}

/**
 * Create a match with two decoder runs (v1 inactive, v2 active), each
 * carrying a distinct loadout evidence shape. Uses the FIRST two real
 * players from the DB so the gamertag resolves at promote time.
 */
async function setupFixtureMatch(eaMatchSuffix: string): Promise<SetupFixtureResult> {
  // Two existing players → two distinct resolvable gamertags.
  const existingPlayers = await db
    .select({ gamertag: players.gamertag })
    .from(players)
    .limit(2)
  assert.ok(
    existingPlayers[0] && existingPlayers[1],
    'DB must have at least two players for this test',
  )
  const v1Gamertag = existingPlayers[0]!.gamertag
  const v2Gamertag = existingPlayers[1]!.gamertag

  const [m] = await db
    .insert(matches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      eaMatchId: `${SENTINEL_TAG}-${eaMatchSuffix}`,
      matchType: 'gameType5',
      opponentClubId: '99999',
      opponentName: 'A3-T1 Sentinel Opp',
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
  sentinelMatchIds.add(matchId)

  // Two runs. v1 inactive (a synthetic-backfill style row); v2 active.
  const [runV1] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: null,
      decoderVersion: 'hmm-viterbi-v1',
      weightsHash: `wh-v1-${eaMatchSuffix}`,
      configHash: `ch-v1-${eaMatchSuffix}`,
      isActive: false,
      notes: `${SENTINEL_TAG}-runV1`,
    })
    .returning()
  const [runV2] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: null,
      decoderVersion: 'hmm-viterbi-v2',
      weightsHash: `wh-v2-${eaMatchSuffix}`,
      configHash: `ch-v2-${eaMatchSuffix}`,
      isActive: true,
      notes: `${SENTINEL_TAG}-runV2`,
    })
    .returning()
  assert.ok(runV1 && runV2)

  // One batch + one player_loadout_view extraction per run (FK target +
  // promoter snapshot.ocrExtractionId derivation source).
  async function makeBatchAndExtraction(runId: number, label: string): Promise<number> {
    const [b] = await db
      .insert(ocrCaptureBatches)
      .values({
        gameTitleId: GAME_TITLE_ID,
        matchId,
        sourceDirectory: `/tmp/${SENTINEL_TAG}/${eaMatchSuffix}/${label}`,
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
        matchId,
        screenType: 'player_loadout_view',
        sourcePath: `/tmp/${SENTINEL_TAG}/${eaMatchSuffix}/${label}/frame001.png`,
        rawResultJson: {},
        transformStatus: 'success',
        runId,
      })
      .returning({ id: ocrExtractions.id })
    if (!x) throw new Error('extraction insert failed')
    return x.id
  }

  const v1ExtractionId = await makeBatchAndExtraction(runV1.id, 'runV1')
  const v2ExtractionId = await makeBatchAndExtraction(runV2.id, 'runV2')

  // Seed evidence in BOTH runs for the same slot. Distinct gamertags so
  // the canonical snapshot can be unambiguously traced to its run.
  async function seed(
    runId: number,
    extractionId: number,
    fieldKey: string,
    value: unknown,
  ): Promise<void> {
    await db.insert(ocrFieldEvidence).values({
      matchId,
      screenState: 'player_loadout_view',
      subjectSlotKey: 'loadout_slot_A3_T1_test',
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
  await seed(runV1.id, v1ExtractionId, 'gamertag', v1Gamertag)
  await seed(runV1.id, v1ExtractionId, 'position', 'C')
  await seed(runV2.id, v2ExtractionId, 'gamertag', v2Gamertag)
  await seed(runV2.id, v2ExtractionId, 'position', 'LW')

  return {
    matchId,
    v1RunId: runV1.id,
    v2RunId: runV2.id,
    v1ExtractionId,
    v2ExtractionId,
    v1Gamertag,
    v2Gamertag,
  }
}

void test('rebuildCanonicalsFromActiveRun writes loadout snapshots from the active run only', async () => {
  if (!process.env['DATABASE_URL']) return

  const fx = await setupFixtureMatch('writes-from-active')

  const result = await rebuildCanonicalsFromActiveRun(fx.matchId)

  const snaps = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, fx.matchId))
  assert.equal(snaps.length, 1, `expected exactly 1 canonical snapshot, got ${snaps.length}`)
  assert.equal(
    snaps[0]!.gamertagSnapshot,
    fx.v2Gamertag,
    'canonical snapshot should carry the v2 evidence gamertag, not the v1 one',
  )
  assert.equal(
    snaps[0]!.position,
    'LW',
    'canonical snapshot should carry the v2 evidence position (LW), not the v1 one (C)',
  )
  assert.equal(result.loadoutSnapshotsWritten, 1)
})

void test('rebuildCanonicalsFromActiveRun is idempotent — calling twice produces no duplicates', async () => {
  if (!process.env['DATABASE_URL']) return

  const fx = await setupFixtureMatch('idempotent')

  await rebuildCanonicalsFromActiveRun(fx.matchId)
  await rebuildCanonicalsFromActiveRun(fx.matchId)

  const snaps = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, fx.matchId))
  assert.equal(
    snaps.length,
    1,
    `expected exactly 1 snapshot after two rebuilds, got ${snaps.length} (duplicates leaked)`,
  )
  assert.equal(snaps[0]!.gamertagSnapshot, fx.v2Gamertag)
})

void test('rebuildCanonicalsFromActiveRun throws when the match has no active run', async () => {
  if (!process.env['DATABASE_URL']) return

  // Setup a match WITHOUT any decoder run rows.
  const [m] = await db
    .insert(matches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      eaMatchId: `${SENTINEL_TAG}-no-active-run`,
      matchType: 'gameType5',
      opponentClubId: '99999',
      opponentName: 'A3-T1 Sentinel Opp',
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
  sentinelMatchIds.add(matchId)

  // Insert an inactive run only — no active run for this match.
  await db.insert(ocrDecoderRuns).values({
    matchId,
    videoSha256: null,
    decoderVersion: 'hmm-viterbi-v2',
    weightsHash: `wh-noactive`,
    configHash: `ch-noactive`,
    isActive: false,
    notes: `${SENTINEL_TAG}-inactive-only`,
  })

  await assert.rejects(
    () => rebuildCanonicalsFromActiveRun(matchId),
    /no active run/i,
    'should throw an error containing "no active run"',
  )

  // Sanity: no canonical rows were written.
  const snaps = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, matchId))
  assert.equal(snaps.length, 0)

  // Also test the case with literally no decoder runs.
  const [m2] = await db
    .insert(matches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      eaMatchId: `${SENTINEL_TAG}-no-runs-at-all`,
      matchType: 'gameType5',
      opponentClubId: '99999',
      opponentName: 'A3-T1 Sentinel Opp',
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
  assert.ok(m2)
  sentinelMatchIds.add(m2.id)
  await assert.rejects(
    () => rebuildCanonicalsFromActiveRun(m2.id),
    /no active run/i,
    'should also throw "no active run" when the match has zero decoder runs',
  )
})
