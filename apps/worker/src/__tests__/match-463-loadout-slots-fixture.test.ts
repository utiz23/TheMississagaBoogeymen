/**
 * Task 2A-23 — T2A — match-463 fixture per-slot coverage gate
 *
 * Seeds `fixture_match463_single_slot` (sentinel match_id 9002) with evidence
 * for exactly 1 slot (HenryTheBobJr, 61 records), invokes
 * `promoteLoadoutFromEvidence`, and asserts:
 *   - exactly 1 player_loadout_snapshots row (for HenryTheBobJr)
 *   - ≥9 ocr_promotions rows with promotion_status='blocked_observability'
 *     and blocking_reason LIKE 'not_observable_from_source%' (the 9 absent
 *     expected slots that the promoter could not see evidence for)
 *   - the promoted snapshot's ocr_promotions row has non-empty evidence_ids
 *   - getExpectedSlotsForMatch(9002) returns exactly 10 expected (team_side,
 *     position) pairs (pre-promoter sanity; seeded by seedFixtureDb via
 *     seedMatch463Roster inside seed-fixture-db.ts)
 *
 * Roster is seeded via Drizzle in seedFixtureDb (NOT via expected_roster_seed.sql,
 * which has schema-incompatible columns — see Task 2A-20 note on SQL file mismatches).
 *
 * Supersedes Phase-1 deferred match-463-loadout-segments.test.ts.
 *
 * Run via:
 *   pnpm --filter @eanhl/db build && pnpm --filter worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/match-463-loadout-slots-fixture.test.js 2>&1 | tail -30
 */

import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  db,
  sql,
  players,
  ocrFieldEvidence,
  ocrPromotions,
  playerLoadoutSnapshots,
} from '@eanhl/db'
import { eq, and, inArray } from 'drizzle-orm'
import { getExpectedSlotsForMatch } from '@eanhl/db/queries'
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

// Sentinel player IDs created by seedMatch463Roster (99021–99025).
// Must be deleted after the test to avoid polluting the players table.
const SENTINEL_PLAYER_IDS_463 = [99021, 99022, 99023, 99024, 99025]

// ─── constants ──────────────────────────────────────────────────────────────────

const FIXTURE_NAME = 'fixture_match463_single_slot' as const
const SENTINEL_MATCH_ID = SENTINEL_MATCH_IDS[FIXTURE_NAME] // 9002

// ─── helpers ────────────────────────────────────────────────────────────────────

/**
 * Patch support_frame_ids on all seeded evidence rows to point at the
 * ocr_extractions row created for their segment.
 *
 * The fixture JSON has support_frame_ids=[] (no real extraction run at authoring
 * time). The promoter uses support_frame_ids[0] as ocrExtractionId, which it
 * writes to player_loadout_snapshots.ocr_extraction_id (NOT NULL FK).
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

// ─── test state ─────────────────────────────────────────────────────────────────

let fixture: LoadedFixture
let seedResult: SeedResult

// ─── lifecycle ──────────────────────────────────────────────────────────────────

before(async () => {
  if (!process.env['DATABASE_URL']) return

  // Load fixture from disk (1 segment, 61 evidence records for HenryTheBobJr).
  fixture = loadFixture(FIXTURE_NAME)

  // 1. Seed sentinel match + batches + extractions + segments + match463 roster.
  //    seedFixtureDb handles the match463 roster via seedMatch463Roster (Drizzle,
  //    NOT the schema-mismatched expected_roster_seed.sql).
  seedResult = await seedFixtureDb(fixture)

  // 2. Seed 61 ocr_field_evidence rows from the fixture JSON.
  await seedEvidenceRecords(fixture, seedResult.segmentIds)

  // 3. Patch support_frame_ids so ocr_extraction_id FK on snapshots is satisfied.
  await patchSupportFrameIds(seedResult.segmentIds, seedResult.extractionIds)
})

after(async () => {
  if (!process.env['DATABASE_URL']) return

  // cleanupSentinelMatches removes match rows + all FK-dependent rows (including
  // player_match_stats, opponent_player_match_stats). Then delete the sentinel
  // players that seedMatch463Roster inserted.
  await cleanupSentinelMatches([SENTINEL_MATCH_ID])
  await db.delete(players).where(inArray(players.id, SENTINEL_PLAYER_IDS_463))
  await sql.end({ timeout: 5 })
})

// ─── tests ───────────────────────────────────────────────────────────────────────

describe('T2A — match-463 fixture: 1 promoted slot + 9 blocked_observability', () => {
  // ── Pre-promoter sanity: roster seeded correctly ───────────────────────────

  test('getExpectedSlotsForMatch(9002) returns 10 expected (team_side, position) pairs', async () => {
    if (!process.env['DATABASE_URL']) return

    const pairs = await getExpectedSlotsForMatch(SENTINEL_MATCH_ID, db)
    assert.equal(
      pairs.length,
      10,
      `pre-promoter sanity: expected 10 expected slots for match 9002, got ${pairs.length}. ` +
        `seedFixtureDb must have called seedMatch463Roster correctly.`,
    )

    const forPairs = pairs.filter((p) => p.teamSide === 'for')
    const againstPairs = pairs.filter((p) => p.teamSide === 'against')
    assert.equal(forPairs.length, 5, `expected 5 'for' expected slots, got ${forPairs.length}`)
    assert.equal(
      againstPairs.length,
      5,
      `expected 5 'against' expected slots, got ${againstPairs.length}`,
    )
  })

  // ── Core assertion: exactly 1 snapshot (HenryTheBobJr) promoted ──────────

  test('promoter writes exactly 1 snapshot for HenryTheBobJr', async () => {
    if (!process.env['DATABASE_URL']) return

    await promoteLoadoutFromEvidence({ matchId: SENTINEL_MATCH_ID, db })

    const snapshots = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, SENTINEL_MATCH_ID))

    assert.equal(
      snapshots.length,
      1,
      `expected exactly 1 snapshot for match 9002, got ${snapshots.length}`,
    )
    assert.equal(
      snapshots[0]!.gamertagSnapshot,
      'HenryTheBobJr',
      `expected gamertagSnapshot='HenryTheBobJr', got '${snapshots[0]!.gamertagSnapshot}'`,
    )
  })

  // ── ≥9 blocked_observability rows for absent slots ─────────────────────────

  test('≥9 ocr_promotions rows with blocked_observability for absent expected slots', async () => {
    if (!process.env['DATABASE_URL']) return

    const blockedObs = await db
      .select()
      .from(ocrPromotions)
      .where(
        and(
          eq(ocrPromotions.matchId, SENTINEL_MATCH_ID),
          eq(ocrPromotions.targetTable, 'player_loadout_snapshots'),
          eq(ocrPromotions.promotionStatus, 'blocked_observability'),
        ),
      )

    assert.ok(
      blockedObs.length >= 9,
      `expected ≥9 blocked_observability rows for match 9002, got ${blockedObs.length}`,
    )

    for (const row of blockedObs) {
      assert.ok(
        (row.blockingReason ?? '').startsWith('not_observable_from_source'),
        `expected blockingReason to start with 'not_observable_from_source', got '${row.blockingReason}'`,
      )
    }
  })

  // ── Promoted snapshot promotion row has non-empty evidence_ids ────────────

  test('promoted snapshot ocr_promotions row has non-empty evidence_ids', async () => {
    if (!process.env['DATABASE_URL']) return

    const promotedRows = await db
      .select()
      .from(ocrPromotions)
      .where(
        and(
          eq(ocrPromotions.matchId, SENTINEL_MATCH_ID),
          eq(ocrPromotions.targetTable, 'player_loadout_snapshots'),
          eq(ocrPromotions.promotionStatus, 'promoted'),
        ),
      )
      .then((rows) => rows.filter((r) => r.fieldKey === null))

    assert.equal(
      promotedRows.length,
      1,
      `expected exactly 1 snapshot-level promoted row (fieldKey=null, status=promoted) for match 9002, got ${promotedRows.length}`,
    )

    const evIds = promotedRows[0]!.evidenceIds ?? []
    assert.ok(
      evIds.length > 0,
      `expected non-empty evidence_ids on promoted snapshot row, got ${JSON.stringify(evIds)}`,
    )
  })
})
