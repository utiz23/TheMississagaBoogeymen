/**
 * Task 2B-6 — repromote-loadout CLI unit tests
 *
 * Tests the exported core functions without spawning a subprocess:
 *   - test_errors_when_no_loadout_evidence_exists:  getLoadoutEvidenceCount → 0
 *     for a sentinel match with no evidence rows.
 *   - test_dry_run_does_not_write: seed evidence, run runDryRun, verify
 *     canonical counts are unchanged vs. before state.
 *   - test_dry_run_prints_diff: seed evidence + existing canonical rows, run
 *     runDryRun, verify the DiffResult captures the correct added/removed/changed.
 *
 * Sentinel match IDs: 9010, 9011 (not used by any other test suite).
 *
 * Run via:
 *   pnpm --filter @eanhl/db build && pnpm --filter worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/repromote-loadout.test.js 2>&1 | tail -30
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  db,
  sql,
  matches,
  players,
  playerMatchStats,
  opponentPlayerMatchStats,
  ocrCaptureBatches,
  ocrExtractions,
  ocrSegments,
  ocrFieldEvidence,
  ocrPromotions,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
  type NewOcrFieldEvidence,
} from '@eanhl/db'
import { eq, inArray } from 'drizzle-orm'
import {
  getLoadoutEvidenceCount,
  snapshotCanonical,
  runDryRun,
  diffSnapshotArrays,
  type CanonicalSnapshot,
} from '../repromote-loadout-cli.js'

// ─── sentinel constants ────────────────────────────────────────────────────────

/** No-evidence sentinel — used only for the prereq-check test. */
const SENTINEL_NO_EVIDENCE = 9010
/** Evidence sentinel — has seeded evidence; used for dry-run tests. */
const SENTINEL_WITH_EVIDENCE = 9011
const GAME_TITLE_ID = 1

// ─── seed helpers ──────────────────────────────────────────────────────────────

/**
 * Minimal match row needed for getLoadoutEvidenceCount / promoteLoadoutFromEvidence
 * to work against a sentinel match.
 */
async function insertSentinelMatch(matchId: number): Promise<void> {
  await db
    .insert(matches)
    .values({
      id: matchId,
      gameTitleId: GAME_TITLE_ID,
      eaMatchId: `repromote-test-${String(matchId)}`,
      matchType: 'gameType5',
      opponentClubId: '77777',
      opponentName: `Sentinel Opponent (repromote-test ${String(matchId)})`,
      playedAt: new Date('2026-01-01T00:00:00Z'),
      result: 'WIN',
      scoreFor: 0,
      scoreAgainst: 0,
      shotsFor: 0,
      shotsAgainst: 0,
      hitsFor: 0,
      hitsAgainst: 0,
    })
    .onConflictDoNothing()
}

/** Sentinel players for resolveGamertagToPlayer in the WITH_EVIDENCE match. */
const SENTINEL_PLAYERS_9011 = [
  { id: 99101, gamertag: 'DryRunPlayer1' },
  { id: 99102, gamertag: 'DryRunPlayer2' },
]

const SENTINEL_OPP_9011 = [
  {
    id: 991001,
    eaPlayerId: 'dry-opp-1',
    gamertag: 'OppDryRun1',
    position: 'center' as const,
  },
]

async function seedSentinelPlayers9011(): Promise<void> {
  await db
    .insert(players)
    .values(SENTINEL_PLAYERS_9011.map((p) => ({ id: p.id, gamertag: p.gamertag })))
    .onConflictDoNothing()

  // player_match_stats: one BGM skater so getExpectedSlotsForMatch can return a slot
  await db
    .insert(playerMatchStats)
    .values([
      {
        id: 991010,
        matchId: SENTINEL_WITH_EVIDENCE,
        playerId: 99101,
        position: 'center',
        isGoalie: false,
      },
      {
        id: 991011,
        matchId: SENTINEL_WITH_EVIDENCE,
        playerId: 99102,
        position: 'leftWing',
        isGoalie: false,
      },
    ])
    .onConflictDoNothing()

  // opponent_player_match_stats: one OPP skater so OPP gamertag resolves to 'against'
  await db
    .insert(opponentPlayerMatchStats)
    .values([
      {
        id: SENTINEL_OPP_9011[0]!.id,
        matchId: SENTINEL_WITH_EVIDENCE,
        eaPlayerId: SENTINEL_OPP_9011[0]!.eaPlayerId,
        opponentClubId: '77777',
        gamertag: SENTINEL_OPP_9011[0]!.gamertag,
        position: SENTINEL_OPP_9011[0]!.position,
        isGoalie: false,
      },
    ])
    .onConflictDoNothing()
}

/** Insert a minimal ocr_capture_batch + ocr_extraction + ocr_segment for the sentinel match. */
async function insertSentinelBatchAndSegment(
  matchId: number,
): Promise<{ batchId: number; extractionId: number; segmentId: number }> {
  const [batchRow] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      matchId,
      sourceDirectory: `/tmp/repromote-test-${String(matchId)}`,
      captureKind: 'manual_screenshots',
      notes: `inserted by repromote-loadout.test.ts for match ${String(matchId)}`,
    })
    .returning({ id: ocrCaptureBatches.id })
  if (!batchRow) throw new Error(`Failed to insert batch for match ${String(matchId)}`)

  const [extRow] = await db
    .insert(ocrExtractions)
    .values({
      matchId,
      batchId: batchRow.id,
      screenType: 'player_loadout_view',
      sourcePath: `/tmp/repromote-test-${String(matchId)}/frame001.png`,
      sourceHash: `repromote-test-hash-${String(matchId)}`,
      rawResultJson: {},
      transformStatus: 'success',
    })
    .returning({ id: ocrExtractions.id })
  if (!extRow) throw new Error(`Failed to insert extraction for match ${String(matchId)}`)

  const [segRow] = await db
    .insert(ocrSegments)
    .values({
      matchId,
      segmentKey: `repromote-test-${String(matchId)}-seg-A`,
      state: 'player_loadout_view',
      frameCount: 10,
      uiVersion: 'nhl26',
      decoderVersion: 'repromote-test-v1',
      captureBatchId: batchRow.id,
    })
    .returning({ id: ocrSegments.id })
  if (!segRow) throw new Error(`Failed to insert segment for match ${String(matchId)}`)

  return { batchId: batchRow.id, extractionId: extRow.id, segmentId: segRow.id }
}

/**
 * Seed minimal ocr_field_evidence for one promotable slot in a sentinel match.
 * Evidence must include gamertag + position (HARD fields) + x_factors (3) so the
 * promoter can produce at least one snapshot row.
 *
 * For the dry-run test we seed two 'for' slots (BGM) and one 'against' slot (OPP).
 */
async function seedMinimalEvidence(
  matchId: number,
  segmentId: number,
  extractionId: number,
): Promise<void> {
  // Build a typed evidence record. All common fields are set here; per-slot
  // overrides are applied in the records array.
  function makeEvidence(
    slotKey: string,
    fieldKey: string,
    candidateValue: unknown,
    family: 'open_text' | 'closed_vocab' = 'closed_vocab',
  ): NewOcrFieldEvidence {
    return {
      matchId,
      segmentId,
      screenState: 'player_loadout_view',
      subjectSlotKey: slotKey,
      fieldKey,
      fieldFamily: family,
      candidateValue,
      candidateRank: 0,
      rawConfidence: '0.9500',
      calibratedConfidence: '0.9200',
      supportFrameIds: [extractionId],
      extractorFamily: family,
      extractorVersion: 'repromote-test-v1',
      observabilityStatus: 'observable',
      normalizationStatus: 'normalized',
    }
  }

  // Slot A: BGM / center (DryRunPlayer1)
  // Slot B: BGM / leftWing (DryRunPlayer2)
  // Slot OPP: OPP / center (OppDryRun1)
  // Each slot needs gamertag + position (HARD fields) + 3 x_factor_name_N
  const evidenceRecords: NewOcrFieldEvidence[] = [
    // ── Slot A ─────────────────────────────────────────────────────────────
    makeEvidence('slotA', 'gamertag', 'DryRunPlayer1', 'open_text'),
    makeEvidence('slotA', 'position', 'center'),
    makeEvidence('slotA', 'x_factor_name_0', 'Wheels'),
    makeEvidence('slotA', 'x_factor_name_1', 'Vision'),
    makeEvidence('slotA', 'x_factor_name_2', 'Elite'),
    // ── Slot B ─────────────────────────────────────────────────────────────
    makeEvidence('slotB', 'gamertag', 'DryRunPlayer2', 'open_text'),
    makeEvidence('slotB', 'position', 'leftWing'),
    makeEvidence('slotB', 'x_factor_name_0', 'Dangles'),
    makeEvidence('slotB', 'x_factor_name_1', 'Snipe'),
    makeEvidence('slotB', 'x_factor_name_2', 'Playmaker'),
    // ── Slot OPP ───────────────────────────────────────────────────────────
    makeEvidence('slotOpp', 'gamertag', 'OppDryRun1', 'open_text'),
    makeEvidence('slotOpp', 'position', 'center'),
    makeEvidence('slotOpp', 'x_factor_name_0', 'Wheels'),
    makeEvidence('slotOpp', 'x_factor_name_1', 'Vision'),
    makeEvidence('slotOpp', 'x_factor_name_2', 'Elite'),
  ]

  await db.insert(ocrFieldEvidence).values(evidenceRecords)
}

// ─── cleanup ──────────────────────────────────────────────────────────────────

async function cleanupSentinelMatches(matchIds: number[]): Promise<void> {
  if (matchIds.length === 0) return

  const snapRows = await db
    .select({ id: playerLoadoutSnapshots.id })
    .from(playerLoadoutSnapshots)
    .where(inArray(playerLoadoutSnapshots.matchId, matchIds))
  const snapIds = snapRows.map((s) => s.id)

  if (snapIds.length > 0) {
    await db
      .delete(playerLoadoutXFactors)
      .where(inArray(playerLoadoutXFactors.loadoutSnapshotId, snapIds))
    await db
      .delete(playerLoadoutAttributes)
      .where(inArray(playerLoadoutAttributes.loadoutSnapshotId, snapIds))
    await db.delete(playerLoadoutSnapshots).where(inArray(playerLoadoutSnapshots.matchId, matchIds))
  }

  await db.delete(ocrPromotions).where(inArray(ocrPromotions.matchId, matchIds))

  const segRows = await db
    .select({ id: ocrSegments.id })
    .from(ocrSegments)
    .where(inArray(ocrSegments.matchId, matchIds))
  const segIds = segRows.map((s) => s.id)

  if (segIds.length > 0) {
    await db.delete(ocrFieldEvidence).where(inArray(ocrFieldEvidence.segmentId, segIds))
    await db.delete(ocrSegments).where(inArray(ocrSegments.id, segIds))
  }

  // ocr_extractions FK on ocr_capture_batches
  const extRows = await db
    .select({ id: ocrExtractions.id })
    .from(ocrExtractions)
    .where(inArray(ocrExtractions.matchId, matchIds))
  const extIds = extRows.map((e) => e.id)
  if (extIds.length > 0) {
    await db.delete(ocrExtractions).where(inArray(ocrExtractions.id, extIds))
  }

  const batchRows = await db
    .select({ id: ocrCaptureBatches.id })
    .from(ocrCaptureBatches)
    .where(inArray(ocrCaptureBatches.matchId, matchIds))
  const batchIds = batchRows.map((b) => b.id)
  if (batchIds.length > 0) {
    await db.delete(ocrCaptureBatches).where(inArray(ocrCaptureBatches.id, batchIds))
  }

  // player_match_stats / opponent_player_match_stats
  await db.delete(playerMatchStats).where(inArray(playerMatchStats.matchId, matchIds))
  await db
    .delete(opponentPlayerMatchStats)
    .where(inArray(opponentPlayerMatchStats.matchId, matchIds))

  await db.delete(matches).where(inArray(matches.id, matchIds))

  // sentinel players
  await db.delete(players).where(
    inArray(
      players.id,
      SENTINEL_PLAYERS_9011.map((p) => p.id),
    ),
  )
}

// ─── test state ───────────────────────────────────────────────────────────────

let segmentId9011: number
let extractionId9011: number

// ─── lifecycle ────────────────────────────────────────────────────────────────

before(async () => {
  if (!process.env['DATABASE_URL']) return

  // Cleanup any leftover state from prior runs.
  await cleanupSentinelMatches([SENTINEL_NO_EVIDENCE, SENTINEL_WITH_EVIDENCE])

  // Insert minimal match rows.
  await insertSentinelMatch(SENTINEL_NO_EVIDENCE)
  await insertSentinelMatch(SENTINEL_WITH_EVIDENCE)

  // For SENTINEL_WITH_EVIDENCE: seed players + roster + batch/segment/evidence
  await seedSentinelPlayers9011()
  const { segmentId, extractionId } = await insertSentinelBatchAndSegment(SENTINEL_WITH_EVIDENCE)
  segmentId9011 = segmentId
  extractionId9011 = extractionId
  await seedMinimalEvidence(SENTINEL_WITH_EVIDENCE, segmentId9011, extractionId9011)
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanupSentinelMatches([SENTINEL_NO_EVIDENCE, SENTINEL_WITH_EVIDENCE])
  await sql.end()
})

// ─── tests ────────────────────────────────────────────────────────────────────

describe('repromote-loadout CLI behavior', () => {
  // ── T1: prereq check returns 0 for a match with no evidence ──────────────
  test('test_errors_when_no_loadout_evidence_exists', async () => {
    if (!process.env['DATABASE_URL']) return

    const count = await getLoadoutEvidenceCount(SENTINEL_NO_EVIDENCE)
    assert.equal(
      count,
      0,
      `expected 0 loadout evidence rows for match ${String(SENTINEL_NO_EVIDENCE)}, got ${String(count)}`,
    )
  })

  // ── T2: dry-run does not write canonical rows ─────────────────────────────
  test('test_dry_run_does_not_write', async () => {
    if (!process.env['DATABASE_URL']) return

    // Confirm evidence exists for the sentinel match
    const evCount = await getLoadoutEvidenceCount(SENTINEL_WITH_EVIDENCE)
    assert.ok(evCount > 0, 'evidence must exist before dry-run test')

    // Capture before state
    const before = await snapshotCanonical(SENTINEL_WITH_EVIDENCE)
    const beforeSnapshotCount = before.snapshots.length

    // Run dry-run
    const diff = await runDryRun(SENTINEL_WITH_EVIDENCE)

    // Capture after state — must be identical to before
    const after = await snapshotCanonical(SENTINEL_WITH_EVIDENCE)

    assert.equal(
      after.snapshots.length,
      beforeSnapshotCount,
      `dry-run must not persist canonical rows: before=${String(beforeSnapshotCount)}, after=${String(after.snapshots.length)}`,
    )

    // Dry-run should propose at least 1 snapshot (from the seeded evidence)
    assert.ok(
      diff.proposedSnapshots.length > 0,
      `dry-run should propose at least 1 snapshot, got ${String(diff.proposedSnapshots.length)}`,
    )
  })

  // ── T3: dry-run captures a diff when no prior canonical rows exist ────────
  test('test_dry_run_prints_diff', async () => {
    if (!process.env['DATABASE_URL']) return

    // No canonical rows for SENTINEL_WITH_EVIDENCE yet (dry-run never writes).
    const before = await snapshotCanonical(SENTINEL_WITH_EVIDENCE)
    assert.equal(
      before.snapshots.length,
      0,
      `expected 0 canonical rows before dry-run diff test, got ${String(before.snapshots.length)}`,
    )

    // Run dry-run against the seeded evidence (3 slots: slotA + slotB BGM, slotOpp OPP)
    const diff = await runDryRun(SENTINEL_WITH_EVIDENCE)

    // Proposed snapshots should include the 3 slots (2 BGM + 1 OPP)
    // All 3 slots have HARD fields (gamertag, position) and x_factors (3/3),
    // so they should promote.
    assert.ok(
      diff.proposedSnapshots.length > 0,
      `expected proposed snapshots, got ${String(diff.proposedSnapshots.length)}`,
    )

    // diff.added should list all proposed snapshots (before was empty)
    assert.equal(
      diff.added.length,
      diff.proposedSnapshots.length,
      `all proposed snapshots should appear as 'added' when before is empty`,
    )

    // diff.removed should be empty (nothing to remove from empty before state)
    assert.equal(diff.removed.length, 0, 'no removals expected when before state is empty')

    // diff.changed should be empty
    assert.equal(diff.changed.length, 0, 'no changes expected when before state is empty')
  })

  // ── T4: diffSnapshotArrays unit test (pure function, no DB) ──────────────
  test('diffSnapshotArrays detects added/removed/changed correctly', () => {
    const snap = (
      teamSide: string,
      position: string,
      gamertag: string,
      extra?: Partial<CanonicalSnapshot>,
    ): CanonicalSnapshot => ({
      id: 1,
      matchId: 9010,
      teamSide,
      position,
      gamertagSnapshot: gamertag,
      buildClass: null,
      playerNumber: null,
      isCaptain: null,
      ...extra,
    })

    const before: CanonicalSnapshot[] = [
      snap('for', 'center', 'PlayerA'),
      snap('for', 'leftWing', 'PlayerB'),
    ]

    const after: CanonicalSnapshot[] = [
      snap('for', 'center', 'PlayerA_RENAMED'),
      snap('for', 'rightWing', 'PlayerC'),
    ]

    const result = diffSnapshotArrays(before, after)

    // 'for|rightWing' is new
    assert.equal(result.added.length, 1, 'expected 1 added')
    assert.equal(result.added[0]!.position, 'rightWing', 'added should be rightWing')

    // 'for|leftWing' was removed
    assert.equal(result.removed.length, 1, 'expected 1 removed')
    assert.equal(result.removed[0]!.position, 'leftWing', 'removed should be leftWing')

    // 'for|center' changed gamertagSnapshot
    assert.equal(result.changed.length, 1, 'expected 1 changed')
    assert.equal(result.changed[0]!.key, 'for|center', 'changed key should be for|center')
    assert.ok(
      result.changed[0]!.diffFields.some((f) => f.includes('gamertagSnapshot')),
      `expected gamertagSnapshot in diffFields, got: ${JSON.stringify(result.changed[0]!.diffFields)}`,
    )
  })
})
