/**
 * Commit 3 of 6 — CPU-goalie lineage fix.
 *
 * Verifies that the lobby-v2 promoter correctly threads the `is_cpu`
 * signal from ocr_field_evidence into player_loadout_snapshots:
 *
 *   1. CPU evidence → snapshot row inserted with is_cpu=true,
 *      gamertag_snapshot='CPU' (the synthetic denylist-friendly value).
 *   2. Human evidence → snapshot row inserted with is_cpu=false and the
 *      observed gamertag.
 *   3. CPU rows persist even when the gamertag field did NOT promote
 *      (regression for the relaxed hard-fields gate at lobby-v2:402).
 *   4. resolveGamertagToPlayer is NOT invoked for CPU rows. We verify
 *      this indirectly: seed a real player whose gamertag is literally
 *      'CPU'. If the resolver were called with the synthetic 'CPU'
 *      string the snapshot would bind to that player_id; since the
 *      promoter skips the resolve for is_cpu=true, player_id stays null.
 *
 * Run via:
 *   pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/lobby-v2-cpu.test.js
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  db,
  sql as rawSql,
  matches,
  players,
  ocrCaptureBatches,
  ocrExtractions,
  ocrFieldEvidence,
  ocrPromotions,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
} from '@eanhl/db'
import { eq, inArray, like } from 'drizzle-orm'
import { promoteLobbyFromEvidence } from '../ocr-promoters/lobby-v2.js'

const GAME_TITLE_ID = 1 // NHL 26
const SENTINEL_TAG = 'test-sentinel-cpu'
const HIGH_CONF = '0.95'

// Track sentinel match ids + sentinel-resolver-bait player ids so after()
// can always clean up even when a test fails mid-flight.
const sentinelMatchIds = new Set<number>()
const sentinelPlayerIds = new Set<number>()

async function cleanupMatch(matchId: number): Promise<void> {
  // FK order: child rows first, then snapshot, then evidence/extractions,
  // batches, finally the match.
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
  await db.delete(playerLoadoutSnapshots).where(eq(playerLoadoutSnapshots.matchId, matchId))
  await db.delete(ocrPromotions).where(eq(ocrPromotions.matchId, matchId))
  await db.delete(ocrFieldEvidence).where(eq(ocrFieldEvidence.matchId, matchId))
  await db.delete(ocrExtractions).where(eq(ocrExtractions.matchId, matchId))
  await db.delete(ocrCaptureBatches).where(eq(ocrCaptureBatches.matchId, matchId))
  await db.delete(matches).where(eq(matches.id, matchId))
}

async function cleanupAllSentinels(): Promise<void> {
  const staleMatches = await db
    .select({ id: matches.id })
    .from(matches)
    .where(like(matches.eaMatchId, `${SENTINEL_TAG}-%`))
  for (const m of staleMatches) {
    await cleanupMatch(m.id)
  }
  // Drop any player rows seeded by this suite (the 'CPU' resolver bait).
  const stalePlayers = await db
    .select({ id: players.id })
    .from(players)
    .where(like(players.gamertag, `${SENTINEL_TAG}-%`))
  if (stalePlayers.length > 0) {
    await db.delete(players).where(
      inArray(
        players.id,
        stalePlayers.map((p) => p.id),
      ),
    )
  }
  sentinelMatchIds.clear()
  sentinelPlayerIds.clear()
}

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanupAllSentinels()
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  for (const matchId of Array.from(sentinelMatchIds)) {
    try {
      await cleanupMatch(matchId)
    } catch {
      // sweep below will retry
    }
  }
  if (sentinelPlayerIds.size > 0) {
    await db.delete(players).where(inArray(players.id, Array.from(sentinelPlayerIds)))
  }
  await cleanupAllSentinels()
  await rawSql.end()
})

interface FixtureResult {
  matchId: number
  extractionId: number
}

async function setupSentinelMatch(suffix: string): Promise<FixtureResult> {
  const [m] = await db
    .insert(matches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      eaMatchId: `${SENTINEL_TAG}-${suffix}`,
      matchType: 'gameType5',
      opponentClubId: '99999',
      opponentName: 'CPU-fix sentinel opp',
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

  const [batch] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      matchId,
      sourceDirectory: `/tmp/${SENTINEL_TAG}/${suffix}`,
      captureKind: 'manual_screenshots',
      notes: `${SENTINEL_TAG}-${suffix}`,
    })
    .returning({ id: ocrCaptureBatches.id })
  assert.ok(batch)

  // Lobby promoter requires a 'pre_game_lobby_state_2' extraction so its
  // FK lookup succeeds and the snapshot writes go through.
  const [extraction] = await db
    .insert(ocrExtractions)
    .values({
      batchId: batch.id,
      matchId,
      screenType: 'pre_game_lobby_state_2',
      sourcePath: `/tmp/${SENTINEL_TAG}/${suffix}/lobby_frame.png`,
      rawResultJson: {},
      transformStatus: 'success',
    })
    .returning({ id: ocrExtractions.id })
  assert.ok(extraction)
  return { matchId, extractionId: extraction.id }
}

type FieldFamily = 'open_text' | 'closed_vocab' | 'tabular_numeric' | 'icon' | 'geometry'
type ObservabilityStatus =
  | 'observable'
  | 'low_quality'
  | 'not_observable_from_source'
  | 'obstructed'

async function seedEvidence(args: {
  matchId: number
  extractionId: number
  slotKey: string
  fieldKey: string
  fieldFamily: FieldFamily
  candidateValue: unknown
  rawConfidence?: string
  calibratedConfidence?: string
  observabilityStatus?: ObservabilityStatus
}): Promise<void> {
  await db.insert(ocrFieldEvidence).values({
    matchId: args.matchId,
    screenState: 'pre_game_lobby_state_2',
    subjectSlotKey: args.slotKey,
    fieldKey: args.fieldKey,
    fieldFamily: args.fieldFamily,
    candidateValue: args.candidateValue,
    candidateRank: 0,
    rawConfidence: args.rawConfidence ?? HIGH_CONF,
    calibratedConfidence: args.calibratedConfidence ?? HIGH_CONF,
    supportFrameIds: [args.extractionId],
    extractorFamily: args.fieldFamily,
    extractorVersion: `${SENTINEL_TAG}-v1`,
    observabilityStatus: args.observabilityStatus ?? 'observable',
    normalizationStatus: 'normalized',
  })
}

void test('CPU evidence → snapshot row with is_cpu=true and gamertag_snapshot=CPU', async () => {
  if (!process.env['DATABASE_URL']) return
  const fx = await setupSentinelMatch('0001')

  // CPU slot: position present, is_cpu=true, gamertag candidate is low_quality
  // with empty value (the realistic shape — slot_identity marks it CPU and
  // the OCR sees nothing readable in the gamertag plate).
  await seedEvidence({
    matchId: fx.matchId,
    extractionId: fx.extractionId,
    slotKey: 'lobby_for_G',
    fieldKey: 'position',
    fieldFamily: 'closed_vocab',
    candidateValue: 'G',
  })
  await seedEvidence({
    matchId: fx.matchId,
    extractionId: fx.extractionId,
    slotKey: 'lobby_for_G',
    fieldKey: 'is_cpu',
    fieldFamily: 'icon',
    candidateValue: true,
    rawConfidence: '1.0',
    calibratedConfidence: '1.0',
  })
  // Low-quality gamertag with an empty string — promotes (status='promoted')
  // but the value is the empty string. `promotedString` returns null for any
  // non-string value but '' is a string, so gamertagVal would be ''. Use a
  // null value to model the realistic "couldn't read the plate" case → the
  // gate promotes null, promotedString returns null, the gate-relaxation
  // path is exercised.
  await seedEvidence({
    matchId: fx.matchId,
    extractionId: fx.extractionId,
    slotKey: 'lobby_for_G',
    fieldKey: 'gamertag',
    fieldFamily: 'open_text',
    candidateValue: null,
    rawConfidence: '0.1',
    calibratedConfidence: '0.1',
    observabilityStatus: 'low_quality',
  })

  const result = await promoteLobbyFromEvidence({ matchId: fx.matchId })
  assert.equal(result.promotedSnapshotCount, 1, 'CPU slot should promote one snapshot')
  assert.equal(result.blockedSnapshotCount, 0)

  const snaps = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, fx.matchId))
  assert.equal(snaps.length, 1, 'exactly one snapshot inserted')
  const snap = snaps[0]!
  assert.equal(snap.isCpu, true, 'is_cpu flag persisted')
  assert.equal(snap.gamertagSnapshot, 'CPU', 'synthetic gamertag written')
  assert.equal(snap.position, 'G', 'position carried through')
  assert.equal(snap.teamSide, 'for')
  assert.equal(snap.playerId, null, 'no player binding for CPU row')
})

void test('Human evidence → snapshot row with is_cpu=false and observed gamertag', async () => {
  if (!process.env['DATABASE_URL']) return
  const fx = await setupSentinelMatch('0002')

  await seedEvidence({
    matchId: fx.matchId,
    extractionId: fx.extractionId,
    slotKey: 'lobby_for_C',
    fieldKey: 'position',
    fieldFamily: 'closed_vocab',
    candidateValue: 'C',
  })
  await seedEvidence({
    matchId: fx.matchId,
    extractionId: fx.extractionId,
    slotKey: 'lobby_for_C',
    fieldKey: 'is_cpu',
    fieldFamily: 'icon',
    candidateValue: false,
    rawConfidence: '1.0',
    calibratedConfidence: '1.0',
  })
  await seedEvidence({
    matchId: fx.matchId,
    extractionId: fx.extractionId,
    slotKey: 'lobby_for_C',
    fieldKey: 'gamertag',
    fieldFamily: 'open_text',
    candidateValue: 'somebody',
  })

  const result = await promoteLobbyFromEvidence({ matchId: fx.matchId })
  assert.equal(result.promotedSnapshotCount, 1)
  assert.equal(result.blockedSnapshotCount, 0)

  const snaps = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, fx.matchId))
  assert.equal(snaps.length, 1)
  const snap = snaps[0]!
  assert.equal(snap.isCpu, false, 'human slot has is_cpu=false')
  assert.equal(snap.gamertagSnapshot, 'somebody', 'observed gamertag carried through')
  assert.equal(snap.position, 'C')
})

void test('CPU rows persist even when gamertag evidence did not promote (gate relaxation)', async () => {
  if (!process.env['DATABASE_URL']) return
  const fx = await setupSentinelMatch('0003')

  // Position + is_cpu only — no gamertag evidence at all. Pre-Commit-3 this
  // would block as 'hard_fields_not_promoted' (gamertagVal === null). The
  // relaxed gate must let the CPU snapshot through.
  await seedEvidence({
    matchId: fx.matchId,
    extractionId: fx.extractionId,
    slotKey: 'lobby_for_G',
    fieldKey: 'position',
    fieldFamily: 'closed_vocab',
    candidateValue: 'G',
  })
  await seedEvidence({
    matchId: fx.matchId,
    extractionId: fx.extractionId,
    slotKey: 'lobby_for_G',
    fieldKey: 'is_cpu',
    fieldFamily: 'icon',
    candidateValue: true,
    rawConfidence: '1.0',
    calibratedConfidence: '1.0',
  })

  const result = await promoteLobbyFromEvidence({ matchId: fx.matchId })
  assert.equal(result.promotedSnapshotCount, 1, 'CPU slot promotes despite missing gamertag')
  assert.equal(result.blockedSnapshotCount, 0)

  const snaps = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, fx.matchId))
  assert.equal(snaps.length, 1, 'snapshot inserted even with no gamertag evidence')
  assert.equal(snaps[0]!.isCpu, true)
  assert.equal(snaps[0]!.gamertagSnapshot, 'CPU')
})

void test('resolveGamertagToPlayer is NOT invoked for CPU rows (player_id stays null even when a player named CPU exists)', async () => {
  if (!process.env['DATABASE_URL']) return
  const fx = await setupSentinelMatch('0004')

  // Bait: a real player row whose gamertag is exactly 'CPU'. If the lobby
  // promoter called resolveGamertagToPlayer with the synthetic 'CPU'
  // string (as it would for a real human gamertag), the snapshot's
  // player_id would bind to baitPlayer.id. Commit 3 must skip the resolve
  // for CPU slots → player_id stays null. The players table has no unique
  // constraint on gamertag, so this insert is safe. Track the id for
  // explicit cleanup in after().
  const [baitPlayer] = await db
    .insert(players)
    .values({
      gamertag: 'CPU',
      eaId: null,
    })
    .returning({ id: players.id })
  assert.ok(baitPlayer)
  sentinelPlayerIds.add(baitPlayer.id)

  // Seed CPU slot evidence (same shape as test 1).
  await seedEvidence({
    matchId: fx.matchId,
    extractionId: fx.extractionId,
    slotKey: 'lobby_for_G',
    fieldKey: 'position',
    fieldFamily: 'closed_vocab',
    candidateValue: 'G',
  })
  await seedEvidence({
    matchId: fx.matchId,
    extractionId: fx.extractionId,
    slotKey: 'lobby_for_G',
    fieldKey: 'is_cpu',
    fieldFamily: 'icon',
    candidateValue: true,
    rawConfidence: '1.0',
    calibratedConfidence: '1.0',
  })
  // Seed a promotable gamertag='CPU' so gamertagDecision.status === 'promoted'
  // with winningValue === 'CPU'. Without this, the resolver's inner guard at
  // lobby-v2.ts:292-295 short-circuits regardless of the !isCpu guard at :290,
  // making the regression coverage illusory. With this seed, removing the
  // !isCpu guard would cause resolveGamertagToPlayer to fire, find the bait
  // player above, and bind snap.playerId — which the assertion below catches.
  await seedEvidence({
    matchId: fx.matchId,
    extractionId: fx.extractionId,
    slotKey: 'lobby_for_G',
    fieldKey: 'gamertag',
    fieldFamily: 'open_text',
    candidateValue: 'CPU',
  })

  await promoteLobbyFromEvidence({ matchId: fx.matchId })

  const snaps = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, fx.matchId))
  assert.equal(snaps.length, 1)
  const snap = snaps[0]!
  assert.equal(snap.isCpu, true)
  assert.equal(snap.gamertagSnapshot, 'CPU')
  assert.equal(
    snap.playerId,
    null,
    `player_id must be null for CPU rows (resolve was skipped); got ${String(snap.playerId)} ` +
      `which would mean the resolver bound to bait player id ${String(baitPlayer.id)}`,
  )
})
