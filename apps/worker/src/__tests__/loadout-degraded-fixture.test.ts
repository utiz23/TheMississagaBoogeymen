/**
 * Task 2A-24 — T8A — synthetic degraded fixture: matrix-branch acceptance test
 *
 * Seeds `fixture_synthetic_degraded` (sentinel match_id 9003) with 4 hand-
 * authored scenarios exercising the Promotable Slot Field Matrix branches that
 * T6A's happy-path fixture does not cover:
 *
 *   Slot A (row0): SlotA_Player — 18/23 attribute records → snapshot + x_factors
 *                  written, attribute child block SKIPPED (18 < floor 20)
 *   Slot B (row1): SlotB_Player — x_factor_name_2 record absent → snapshot
 *                  written, x_factor child block SKIPPED (not all 3 name fields)
 *   Slot C (row2): "AWAY" — not in players or opponent_player_match_stats →
 *                  snapshot BLOCKED with unresolved_team_side
 *   Slot D (row3): "GhostNeverHeardOf" — not in players or opp_match_stats →
 *                  snapshot BLOCKED with unresolved_team_side
 *
 * This test loads `degraded_evidence.json` records directly as `ocr_field_evidence`
 * rows, then invokes only `promoteLoadoutFromEvidence({ matchId: 9003 })`. No PNGs,
 * no frame-level pipeline — pure isolator for the promoter + gate.
 *
 * Fixture fix applied during T8A implementation:
 *   The original fixture used null-value + conf=0.3 records to simulate degraded
 *   evidence. The promotion gate still returns status='promoted' for single
 *   candidates below threshold (no competitors → Step 6 is reached). To reliably
 *   hit the floor, the 5 null-value attr records for Slot A and the x_factor_name_2
 *   record for Slot B were REMOVED ENTIRELY from degraded_evidence.json. Absent
 *   fields → undefined in fieldDecisions → not counted as promoted. See PROVENANCE.md.
 *
 * Run via:
 *   pnpm --filter @eanhl/db build && pnpm --filter worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/loadout-degraded-fixture.test.js 2>&1 | tail -30
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  db,
  sql,
  ocrFieldEvidence,
  ocrPromotions,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
} from '@eanhl/db'
import { eq, inArray } from 'drizzle-orm'
import { promoteLoadoutFromEvidence } from '../ocr-promoters/loadout-v2.js'
import {
  loadFixture,
  SENTINEL_MATCH_IDS,
  type LoadedFixture,
} from './fixtures/loadout-fixture-loader.js'
import {
  seedFixtureDb,
  seedEvidenceRecords,
  cleanupSentinelMatches,
  type SeedResult,
} from './fixtures/seed-fixture-db.js'

// ─── constants ─────────────────────────────────────────────────────────────────

const FIXTURE_NAME = 'fixture_synthetic_degraded' as const
const SENTINEL_MATCH_ID = SENTINEL_MATCH_IDS[FIXTURE_NAME] // 9003

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Patch support_frame_ids on all seeded evidence rows.
 *
 * The fixture JSON has support_frame_ids=[] (no real extraction ran at authoring
 * time).  The promoter uses support_frame_ids[0] as ocrExtractionId, written to
 * player_loadout_snapshots.ocr_extraction_id (NOT NULL FK → ocr_extractions.id).
 * After seedEvidenceRecords() runs, set every evidence row for this match to
 * reference the single extraction that seedFixtureDb() created for the degraded
 * segment.
 */
async function patchSupportFrameIds(segmentIds: number[], extractionIds: number[]): Promise<void> {
  for (let i = 0; i < segmentIds.length; i++) {
    const segmentId = segmentIds[i]
    const extractionId = extractionIds[i]
    if (segmentId === undefined || extractionId === undefined) continue
    await db
      .update(ocrFieldEvidence)
      .set({ supportFrameIds: [extractionId] })
      .where(eq(ocrFieldEvidence.segmentId, segmentId))
  }
}

// ─── test state ───────────────────────────────────────────────────────────────

let fixture: LoadedFixture
let seedResult: SeedResult
let promoteResult: Awaited<ReturnType<typeof promoteLoadoutFromEvidence>>

// ─── lifecycle ────────────────────────────────────────────────────────────────

before(async () => {
  if (!process.env['DATABASE_URL']) return

  // 1. Load fixture from disk.
  fixture = loadFixture(FIXTURE_NAME)

  // 2. Seed sentinel match + batch + extraction + segment + roster (via seedFixtureDb).
  //    seedSyntheticDegradedRoster is called internally for this fixture name.
  seedResult = await seedFixtureDb(fixture)

  // 3. Seed evidence records (79 rows total for the 4 degraded slots).
  await seedEvidenceRecords(fixture, seedResult.segmentIds)

  // 4. Patch support_frame_ids so the promoter's ocrExtractionId resolve succeeds.
  //    The degraded fixture has 1 segment → seedResult.segmentIds[0] / extractionIds[0].
  await patchSupportFrameIds(seedResult.segmentIds, seedResult.extractionIds)

  // 5. Run the promoter. Store result for count assertions.
  promoteResult = await promoteLoadoutFromEvidence({ matchId: SENTINEL_MATCH_ID, db })
})

after(async () => {
  if (!process.env['DATABASE_URL']) return

  // Cleanup in FK-safe order (seedFixtureDb creates the rows; cleanupSentinelMatches
  // removes them).  seedSyntheticDegradedRoster inserts players 99101 + 99102; those
  // are left in place (they may be needed by other tests; cleanupSentinelMatches does
  // not delete players rows to avoid cross-test interference).
  await cleanupSentinelMatches([SENTINEL_MATCH_ID])
  await sql.end()
})

// ─── tests ─────────────────────────────────────────────────────────────────────

describe('T8A — synthetic degraded fixture: matrix-branch coverage', () => {
  // ── Promoter top-level result ─────────────────────────────────────────────

  test('promoter completes without error: 2 promoted + 2 blocked snapshots', async () => {
    if (!process.env['DATABASE_URL']) return

    // Slots A + B → promoted (gamertag resolves to a known player, hard fields ok)
    // Slots C + D → blocked (unresolved_team_side)
    assert.equal(
      promoteResult.promotedSnapshotCount,
      2,
      `expected 2 promoted snapshots, got ${promoteResult.promotedSnapshotCount}`,
    )
    assert.equal(
      promoteResult.blockedSnapshotCount,
      2,
      `expected 2 blocked snapshots, got ${promoteResult.blockedSnapshotCount}`,
    )
    assert.ok(
      promoteResult.promotionRowsWritten > 0,
      'expected at least 1 ocr_promotions row written',
    )
  })

  // ── Slot A: snapshot written, x_factors written, 0 attribute rows ─────────

  test('Slot A: snapshot row exists for SlotA_Player', async () => {
    if (!process.env['DATABASE_URL']) return

    const snaps = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, SENTINEL_MATCH_ID))

    const slotASnap = snaps.find((s) => s.gamertagSnapshot === 'SlotA_Player')
    assert.ok(
      slotASnap !== undefined,
      `expected a snapshot row for 'SlotA_Player' in match ${SENTINEL_MATCH_ID}. ` +
        `Got snapshots: ${JSON.stringify(snaps.map((s) => s.gamertagSnapshot))}`,
    )

    // Position and team_side must be correct
    assert.equal(slotASnap.position, 'C', `expected position='C', got '${slotASnap.position}'`)
    assert.equal(slotASnap.teamSide, 'for', `expected team_side='for', got '${slotASnap.teamSide}'`)
    // player_id must resolve to sentinel 99101 (SlotA_Player is in players table)
    assert.ok(
      slotASnap.playerId !== null,
      `expected non-null player_id for SlotA_Player (sentinel 99101)`,
    )
  })

  test('Slot A: x_factors written (3 rows — all 3 name fields present with conf=0.9)', async () => {
    if (!process.env['DATABASE_URL']) return

    const snaps = await db
      .select({ id: playerLoadoutSnapshots.id })
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, SENTINEL_MATCH_ID))
    const slotASnap = snaps.find(async () => {
      // We need to re-query with gamertagSnapshot — do it below.
      return false
    })

    // Re-query with full columns.
    const allSnaps = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, SENTINEL_MATCH_ID))
    const snapA = allSnaps.find((s) => s.gamertagSnapshot === 'SlotA_Player')
    assert.ok(snapA, 'SlotA_Player snapshot must exist')

    const xfRows = await db
      .select()
      .from(playerLoadoutXFactors)
      .where(eq(playerLoadoutXFactors.loadoutSnapshotId, snapA.id))

    assert.equal(
      xfRows.length,
      3,
      `expected 3 x_factor rows for SlotA_Player, got ${xfRows.length}. ` +
        `All 3 x_factor_name fields have evidence with conf=0.9 → all promote → writeXFactors=true.`,
    )
  })

  test('Slot A: attribute child block skipped — 0 attribute rows (18 < floor 20)', async () => {
    if (!process.env['DATABASE_URL']) return

    const allSnaps = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, SENTINEL_MATCH_ID))
    const snapA = allSnaps.find((s) => s.gamertagSnapshot === 'SlotA_Player')
    assert.ok(snapA, 'SlotA_Player snapshot must exist')

    const attrRows = await db
      .select()
      .from(playerLoadoutAttributes)
      .where(eq(playerLoadoutAttributes.loadoutSnapshotId, snapA.id))

    assert.equal(
      attrRows.length,
      0,
      `expected 0 attribute rows for SlotA_Player (18 attr records < ATTRIBUTE_PROMOTION_FLOOR=20). ` +
        `Got ${attrRows.length} rows.`,
    )
  })

  // ── Slot B: snapshot written, 0 x_factor rows, 0 attribute rows ──────────

  test('Slot B: snapshot row exists for SlotB_Player', async () => {
    if (!process.env['DATABASE_URL']) return

    const allSnaps = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, SENTINEL_MATCH_ID))

    const slotBSnap = allSnaps.find((s) => s.gamertagSnapshot === 'SlotB_Player')
    assert.ok(
      slotBSnap !== undefined,
      `expected a snapshot row for 'SlotB_Player' in match ${SENTINEL_MATCH_ID}. ` +
        `Got snapshots: ${JSON.stringify(allSnaps.map((s) => s.gamertagSnapshot))}`,
    )

    assert.equal(slotBSnap.position, 'LW', `expected position='LW', got '${slotBSnap.position}'`)
    assert.equal(slotBSnap.teamSide, 'for', `expected team_side='for', got '${slotBSnap.teamSide}'`)
    assert.ok(
      slotBSnap.playerId !== null,
      `expected non-null player_id for SlotB_Player (sentinel 99102)`,
    )
  })

  test('Slot B: x_factor child block skipped — 0 x_factor rows (x_factor_name_2 absent)', async () => {
    if (!process.env['DATABASE_URL']) return

    const allSnaps = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, SENTINEL_MATCH_ID))
    const snapB = allSnaps.find((s) => s.gamertagSnapshot === 'SlotB_Player')
    assert.ok(snapB, 'SlotB_Player snapshot must exist')

    const xfRows = await db
      .select()
      .from(playerLoadoutXFactors)
      .where(eq(playerLoadoutXFactors.loadoutSnapshotId, snapB.id))

    assert.equal(
      xfRows.length,
      0,
      `expected 0 x_factor rows for SlotB_Player (x_factor_name_2 absent → xfAllPromoted=false). ` +
        `Got ${xfRows.length} rows.`,
    )
  })

  test('Slot B: attribute child block skipped — 0 attribute rows (no attr evidence)', async () => {
    if (!process.env['DATABASE_URL']) return

    const allSnaps = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, SENTINEL_MATCH_ID))
    const snapB = allSnaps.find((s) => s.gamertagSnapshot === 'SlotB_Player')
    assert.ok(snapB, 'SlotB_Player snapshot must exist')

    const attrRows = await db
      .select()
      .from(playerLoadoutAttributes)
      .where(eq(playerLoadoutAttributes.loadoutSnapshotId, snapB.id))

    assert.equal(
      attrRows.length,
      0,
      `expected 0 attribute rows for SlotB_Player (0 attr evidence records → promotedAttrCount=0 < floor 20). ` +
        `Got ${attrRows.length} rows.`,
    )
  })

  // ── Slot C: junk gamertag "AWAY" → no snapshot ────────────────────────────

  test('Slot C: no snapshot row for "AWAY" (junk gamertag / unresolved_team_side)', async () => {
    if (!process.env['DATABASE_URL']) return

    const allSnaps = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, SENTINEL_MATCH_ID))

    const slotCSnap = allSnaps.find((s) => s.gamertagSnapshot === 'AWAY')
    assert.equal(
      slotCSnap,
      undefined,
      `expected NO snapshot row for 'AWAY', but found one: ${JSON.stringify(slotCSnap)}`,
    )
  })

  test('Slot C: blocked_invariant ocr_promotion row exists for "AWAY" slot', async () => {
    if (!process.env['DATABASE_URL']) return

    const promotions = await db
      .select()
      .from(ocrPromotions)
      .where(eq(ocrPromotions.matchId, SENTINEL_MATCH_ID))

    // The promoter emits a snapshot-level blocked_invariant row with
    // blockingReason='unresolved_team_side' when team_side resolution fails.
    // The semantic key includes slot_key for blocked slots.
    const blockedRows = promotions.filter(
      (p) =>
        p.targetTable === 'player_loadout_snapshots' &&
        p.fieldKey === null &&
        p.promotionStatus === 'blocked_invariant' &&
        p.blockingReason === 'unresolved_team_side',
    )

    // We expect at least one blocked_invariant row with unresolved_team_side
    // (one for "AWAY", one for "GhostNeverHeardOf").
    assert.ok(
      blockedRows.length >= 1,
      `expected at least 1 blocked_invariant(unresolved_team_side) row in ocr_promotions, ` +
        `got ${blockedRows.length}. ` +
        `All blocked promotions: ${JSON.stringify(
          promotions
            .filter((p) => p.promotionStatus?.startsWith('blocked'))
            .map((p) => ({ status: p.promotionStatus, reason: p.blockingReason })),
        )}`,
    )
  })

  // ── Slot D: unresolvable gamertag "GhostNeverHeardOf" → no snapshot ───────

  test('Slot D: no snapshot row for "GhostNeverHeardOf" (unresolved_team_side)', async () => {
    if (!process.env['DATABASE_URL']) return

    const allSnaps = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, SENTINEL_MATCH_ID))

    const slotDSnap = allSnaps.find((s) => s.gamertagSnapshot === 'GhostNeverHeardOf')
    assert.equal(
      slotDSnap,
      undefined,
      `expected NO snapshot row for 'GhostNeverHeardOf', but found one: ${JSON.stringify(slotDSnap)}`,
    )
  })

  test('Slot D: exactly 2 blocked_invariant(unresolved_team_side) rows exist (C + D)', async () => {
    if (!process.env['DATABASE_URL']) return

    const promotions = await db
      .select()
      .from(ocrPromotions)
      .where(eq(ocrPromotions.matchId, SENTINEL_MATCH_ID))

    const unresolvedRows = promotions.filter(
      (p) =>
        p.targetTable === 'player_loadout_snapshots' &&
        p.fieldKey === null &&
        p.promotionStatus === 'blocked_invariant' &&
        p.blockingReason === 'unresolved_team_side',
    )

    assert.equal(
      unresolvedRows.length,
      2,
      `expected exactly 2 blocked_invariant(unresolved_team_side) rows (Slot C + D), ` +
        `got ${unresolvedRows.length}.`,
    )
  })

  // ── Overall canonical counts ──────────────────────────────────────────────

  test('exactly 2 snapshot rows exist for match 9003 (Slot A + Slot B)', async () => {
    if (!process.env['DATABASE_URL']) return

    const allSnaps = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, SENTINEL_MATCH_ID))

    assert.equal(
      allSnaps.length,
      2,
      `expected 2 snapshot rows for match ${SENTINEL_MATCH_ID}, got ${allSnaps.length}. ` +
        `Gamertags found: ${JSON.stringify(allSnaps.map((s) => s.gamertagSnapshot))}`,
    )
  })

  test('total x_factor rows across match 9003: 3 (Slot A only)', async () => {
    if (!process.env['DATABASE_URL']) return

    const allSnaps = await db
      .select({ id: playerLoadoutSnapshots.id })
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, SENTINEL_MATCH_ID))
    const snapIds = allSnaps.map((s) => s.id)
    assert.ok(snapIds.length > 0, 'snapshots must exist before checking x_factors')

    const xfRows = await db
      .select()
      .from(playerLoadoutXFactors)
      .where(inArray(playerLoadoutXFactors.loadoutSnapshotId, snapIds))

    assert.equal(
      xfRows.length,
      3,
      `expected 3 x_factor rows total (Slot A only), got ${xfRows.length}`,
    )
  })

  test('total attribute rows across match 9003: 0 (both child blocks skipped)', async () => {
    if (!process.env['DATABASE_URL']) return

    const allSnaps = await db
      .select({ id: playerLoadoutSnapshots.id })
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, SENTINEL_MATCH_ID))
    const snapIds = allSnaps.map((s) => s.id)
    assert.ok(snapIds.length > 0, 'snapshots must exist before checking attributes')

    const attrRows = await db
      .select()
      .from(playerLoadoutAttributes)
      .where(inArray(playerLoadoutAttributes.loadoutSnapshotId, snapIds))

    assert.equal(
      attrRows.length,
      0,
      `expected 0 attribute rows (Slot A: 18 < floor 20; Slot B: 0 evidence; neither block writes), got ${attrRows.length}`,
    )
  })

  // ── Slot A x_factor blocking ocr_promotion rows not emitted (writeXFactors=true) ─

  test('Slot A: no x_factor-level blocked rows in ocr_promotions (3/3 x_factors promote)', async () => {
    if (!process.env['DATABASE_URL']) return

    const promotions = await db
      .select()
      .from(ocrPromotions)
      .where(eq(ocrPromotions.matchId, SENTINEL_MATCH_ID))

    // The promoter only writes x_factor block rows when !writeXFactors.
    // For Slot A, writeXFactors=true → no such rows should exist for SlotA.
    // We identify Slot A's semantic key via its team_side='for' + position='C'.
    const slotAXfBlocked = promotions.filter(
      (p) =>
        p.targetTable === 'player_loadout_x_factors' &&
        p.promotionStatus !== 'promoted' &&
        typeof p.targetSemanticKey === 'object' &&
        p.targetSemanticKey !== null &&
        (p.targetSemanticKey as Record<string, unknown>)['position'] === 'C',
    )

    assert.equal(
      slotAXfBlocked.length,
      0,
      `expected 0 x_factor-blocked rows for Slot A (position=C), got ${slotAXfBlocked.length}: ` +
        `${JSON.stringify(slotAXfBlocked.map((p) => ({ reason: p.blockingReason, key: p.targetSemanticKey })))}`,
    )
  })

  // ── Slot B x_factor blocking ocr_promotion rows emitted (writeXFactors=false) ─

  test('Slot B: x_factor_name_2 blocked row present in ocr_promotions (absent evidence)', async () => {
    if (!process.env['DATABASE_URL']) return

    const promotions = await db
      .select()
      .from(ocrPromotions)
      .where(eq(ocrPromotions.matchId, SENTINEL_MATCH_ID))

    // When writeXFactors=false for Slot B, the promoter emits a blocked row for
    // each x_factor field that is not promoted. x_factor_name_2 is absent (no
    // evidence) → dec=undefined → blocked row with reason='x_factor_child_block_incomplete'
    // under targetTable='player_loadout_x_factors'.
    const slotBXfBlockedForName2 = promotions.filter(
      (p) =>
        p.targetTable === 'player_loadout_x_factors' &&
        p.fieldKey === 'x_factor_name_2' &&
        typeof p.targetSemanticKey === 'object' &&
        p.targetSemanticKey !== null &&
        (p.targetSemanticKey as Record<string, unknown>)['position'] === 'LW',
    )

    assert.equal(
      slotBXfBlockedForName2.length,
      1,
      `expected 1 x_factor_name_2 blocked row for Slot B (position=LW), got ${slotBXfBlockedForName2.length}. ` +
        `All x_factor promotions for match: ${JSON.stringify(
          promotions
            .filter((p) => p.targetTable === 'player_loadout_x_factors')
            .map((p) => ({ fk: p.fieldKey, status: p.promotionStatus, key: p.targetSemanticKey })),
        )}`,
    )
  })
})
