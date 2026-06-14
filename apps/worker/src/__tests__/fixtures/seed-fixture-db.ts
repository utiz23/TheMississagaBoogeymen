/**
 * Task 2A-20: DB seeder for loadout OCR acceptance tests.
 *
 * Provides:
 *   - seedFixtureDb(fixture)        — truncates sentinel namespace, inserts
 *                                     minimal matches/batches/extractions/segments
 *                                     scaffolding, optionally seeds the match463
 *                                     roster via Drizzle.
 *   - seedEvidenceRecords(fixture)  — inserts ocr_field_evidence rows from fixture
 *                                     expectedEvidence into the seeded segment IDs.
 *
 * Sentinel match IDs: 9001 (match250), 9002 (match463), 9003 (synthetic_degraded).
 * All cleanup is scoped to those IDs; production rows are never touched.
 *
 * NOTE: expected_roster_seed.sql and expected_canonical.sql use schema columns
 * (match_id_ea, label) that differ from the live DB (ea_match_id, name). The
 * seeder uses Drizzle ORM directly rather than executing those SQL files as
 * raw statements.  Tests that need the canonical SQL for assertion should read
 * the file and parse it; they should NOT execute it against the live DB.
 */

import {
  db as defaultDb,
  sql,
  matches,
  players,
  ocrCaptureBatches,
  ocrExtractions,
  ocrSegments,
  ocrFieldEvidence,
  ocrPromotions,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
  playerMatchStats,
  opponentPlayerMatchStats,
  type NewOcrFieldEvidence,
} from '@eanhl/db'
import { inArray, eq } from 'drizzle-orm'
import type { LoadedFixture, LoadoutEvidenceRecord } from './loadout-fixture-loader.js'

// game_title_id = 1 is NHL 26 (confirmed in game_titles table).
const GAME_TITLE_ID = 1

// ── types ─────────────────────────────────────────────────────────────────────

type Db = typeof defaultDb

export interface SeedResult {
  matchId: number
  /** ocr_segments.id per fixture segment, in fixture.segments order. */
  segmentIds: number[]
  /** ocr_capture_batches.id per fixture segment, in fixture.segments order. */
  batchIds: number[]
  /** ocr_extractions.id per fixture segment, in fixture.segments order. */
  extractionIds: number[]
}

// ── live-DB guard ───────────────────────────────────────────────────────────

/**
 * Refuse to seed/clean anything unless DATABASE_URL points at a throwaway
 * `eanhl_test_*` clone (provisioned by apps/worker/scripts/with-test-db.mjs).
 *
 * Tier 1 Item 0 (2026-06-14) root-caused a live-DB contamination to this seeder:
 * it inserts sentinel `players` rows whose gamertags collide with REAL club
 * members (e.g. id 99021 'HenryTheBobJr'), and at least one run executed against
 * the live `eanhl` database (DATABASE_URL=live), leaving the sentinel behind to
 * accrete real data across 23 matches. This guard makes that impossible: the
 * suite's only supported entry point is with-test-db.mjs, which always runs
 * against an `eanhl_test_*` clone, and clones are dropped after each run. (A
 * follow-up could additionally rename the colliding gamertags, but that requires
 * coordinated fixture-evidence changes; this guard is the definitive fix.)
 */
function assertCloneDb(): void {
  const url = process.env['DATABASE_URL']
  if (!url) {
    throw new Error('seed-fixture-db: DATABASE_URL is unset — cannot verify this is a test clone.')
  }
  let dbName: string
  try {
    dbName = new URL(url).pathname.replace(/^\//, '')
  } catch {
    throw new Error(`seed-fixture-db: DATABASE_URL is not a valid URL: ${url}`)
  }
  if (!dbName.startsWith('eanhl_test')) {
    throw new Error(
      `seed-fixture-db: refusing to run — DATABASE_URL points at database "${dbName}", not an ` +
        `"eanhl_test_*" clone. The worker integration suite must run via ` +
        `apps/worker/scripts/with-test-db.mjs (which provisions a throwaway clone). This guard ` +
        `prevents test sentinels (e.g. the 'HenryTheBobJr' collision) from polluting the live DB.`,
    )
  }
}

// ── cleanup helper ────────────────────────────────────────────────────────────

/**
 * Delete ALL rows for the given sentinel match IDs in FK-safe order.
 * Safe to call with an empty list (no-op).
 *
 * Universal chokepoint: `seedFixtureDb` calls this first, so the clone guard
 * here protects every seed path too.
 */
export async function cleanupSentinelMatches(
  matchIds: number[],
  db: Db = defaultDb,
): Promise<void> {
  assertCloneDb()
  if (matchIds.length === 0) return

  // FK order: deepest children first.
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
  await db.delete(ocrFieldEvidence).where(inArray(ocrFieldEvidence.matchId, matchIds))
  await db.delete(playerMatchStats).where(inArray(playerMatchStats.matchId, matchIds))
  await db
    .delete(opponentPlayerMatchStats)
    .where(inArray(opponentPlayerMatchStats.matchId, matchIds))

  // ocr_segments before batches/extractions (field evidence already deleted above).
  await db.delete(ocrSegments).where(inArray(ocrSegments.matchId, matchIds))

  // extractions → batches (extractions FK → batches)
  const batchRows = await db
    .select({ id: ocrCaptureBatches.id })
    .from(ocrCaptureBatches)
    .where(inArray(ocrCaptureBatches.matchId, matchIds))
  const batchIds = batchRows.map((b) => b.id)
  if (batchIds.length > 0) {
    await db.delete(ocrExtractions).where(inArray(ocrExtractions.batchId, batchIds))
    await db.delete(ocrCaptureBatches).where(inArray(ocrCaptureBatches.matchId, matchIds))
  }

  await db.delete(matches).where(inArray(matches.id, matchIds))
}

// ── match463 roster seed ──────────────────────────────────────────────────────

/**
 * Seeds the minimal roster rows for fixture_match463_single_slot.
 *
 * 5 BGM skaters + 5 opp skaters so getExpectedSlotsForMatch(9002) returns
 * exactly 10 expected slots.
 *
 * player_match_stats has a unique index on (player_id, match_id), so each BGM
 * row MUST use a distinct player_id.  We insert 5 sentinel players at IDs
 * 99021–99025 (one per position) before inserting the match stats rows.
 * HenryTheBobJr is sentinel 99021 (the LD slot — id=990041, lowest, maps to LD
 * by toExpectedSlots id-ASC ordering).  The other 4 players are position-only
 * sentinels with placeholder gamertags.
 */
async function seedMatch463Roster(matchId: number, db: Db): Promise<void> {
  // Insert 5 distinct sentinel players for the BGM side.
  // onConflictDoNothing: safe to call multiple times.
  await db
    .insert(players)
    .values([
      { id: 99021, gamertag: 'HenryTheBobJr' },
      { id: 99022, gamertag: 'fix-9002-bgm-d2' },
      { id: 99023, gamertag: 'fix-9002-bgm-c' },
      { id: 99024, gamertag: 'fix-9002-bgm-lw' },
      { id: 99025, gamertag: 'fix-9002-bgm-rw' },
    ])
    .onConflictDoNothing()

  // BGM side — 5 skaters, each with a distinct player_id.
  // Sentinel IDs 99021–99025 map to the 5 positions.
  // 990041 < 990042 so toExpectedSlots assigns LD=990041, RD=990042.
  await db
    .insert(playerMatchStats)
    .values([
      { id: 990041, matchId, playerId: 99021, position: 'defenseMen', isGoalie: false },
      { id: 990042, matchId, playerId: 99022, position: 'defenseMen', isGoalie: false },
      { id: 990043, matchId, playerId: 99023, position: 'center', isGoalie: false },
      { id: 990044, matchId, playerId: 99024, position: 'leftWing', isGoalie: false },
      { id: 990045, matchId, playerId: 99025, position: 'rightWing', isGoalie: false },
    ])
    .onConflictDoNothing()

  // Opp side — 5 skaters.
  await db
    .insert(opponentPlayerMatchStats)
    .values([
      {
        id: 990046,
        matchId,
        eaPlayerId: 'fix-opp-c',
        opponentClubId: '88888',
        gamertag: 'opp_c',
        position: 'center',
        isGoalie: false,
      },
      {
        id: 990047,
        matchId,
        eaPlayerId: 'fix-opp-lw',
        opponentClubId: '88888',
        gamertag: 'opp_lw',
        position: 'leftWing',
        isGoalie: false,
      },
      {
        id: 990048,
        matchId,
        eaPlayerId: 'fix-opp-rw',
        opponentClubId: '88888',
        gamertag: 'opp_rw',
        position: 'rightWing',
        isGoalie: false,
      },
      {
        id: 990049,
        matchId,
        eaPlayerId: 'fix-opp-ld',
        opponentClubId: '88888',
        gamertag: 'opp_ld',
        position: 'defenseMen',
        isGoalie: false,
      },
      {
        id: 990050,
        matchId,
        eaPlayerId: 'fix-opp-rd',
        opponentClubId: '88888',
        gamertag: 'opp_rd',
        position: 'defenseMen',
        isGoalie: false,
      },
    ])
    .onConflictDoNothing()
}

/**
 * Seeds the minimal roster rows for fixture_synthetic_degraded.
 *
 * Uses two sentinel players (SlotA_Player id=99101, SlotB_Player id=99102).
 * Those players are inserted if absent.
 */
async function seedSyntheticDegradedRoster(matchId: number, db: Db): Promise<void> {
  // Ensure sentinel players exist (upsert by id).
  await db
    .insert(players)
    .values([
      { id: 99101, gamertag: 'SlotA_Player' },
      { id: 99102, gamertag: 'SlotB_Player' },
    ])
    .onConflictDoNothing()

  // 4 BGM skaters only (no opp for this sentinel).
  await db
    .insert(playerMatchStats)
    .values([
      { id: 990101, matchId, playerId: 99101, position: 'center', isGoalie: false },
      { id: 990102, matchId, playerId: 99102, position: 'leftWing', isGoalie: false },
      { id: 990103, matchId, playerId: 99101, position: 'rightWing', isGoalie: false },
      { id: 990104, matchId, playerId: 99101, position: 'defenseMen', isGoalie: false },
    ])
    .onConflictDoNothing()
}

// ── main seeder ───────────────────────────────────────────────────────────────

/**
 * Truncates the sentinel match namespace, then inserts:
 *   - One `matches` row with id = fixture.sentinelMatchId
 *   - Per fixture segment: one `ocr_capture_batches` row + one `ocr_extractions`
 *     row + one `ocr_segments` row
 *   - Roster rows for match463 and synthetic_degraded (via Drizzle, not raw SQL)
 *
 * Idempotent: calling twice on the same fixture cleans prior rows first.
 *
 * @param fixture  Loaded fixture from loadFixture().
 * @param options  Optional override for db instance (useful in tests with
 *                 a local PG connection or transaction).
 */
export async function seedFixtureDb(
  fixture: LoadedFixture,
  options: { db?: Db } = {},
): Promise<SeedResult> {
  const db = options.db ?? defaultDb
  const matchId = fixture.sentinelMatchId

  // 1. Truncate sentinel namespace — idempotent cleanup.
  await cleanupSentinelMatches([matchId], db)

  // 2. Insert minimal matches row.
  await db.insert(matches).values({
    id: matchId,
    gameTitleId: GAME_TITLE_ID,
    eaMatchId: `fixture-match-${matchId}`,
    matchType: 'gameType5',
    opponentClubId: '88888',
    opponentName: `Sentinel Opponent (fixture ${matchId})`,
    playedAt: new Date('2026-01-01T00:00:00Z'),
    result: 'WIN',
    scoreFor: 0,
    scoreAgainst: 0,
    shotsFor: 0,
    shotsAgainst: 0,
    hitsFor: 0,
    hitsAgainst: 0,
  })

  // 3. Per fixture segment: insert capture batch + extraction + ocr_segments.
  const batchIds: number[] = []
  const extractionIds: number[] = []
  const segmentIds: number[] = []

  for (const seg of fixture.segments) {
    // Batch
    const [batchRow] = await db
      .insert(ocrCaptureBatches)
      .values({
        gameTitleId: GAME_TITLE_ID,
        matchId,
        sourceDirectory: seg.dir,
        captureKind: 'manual_screenshots',
        notes: `fixture-seeder-2a20:${fixture.name}:${seg.segmentKey}`,
      })
      .returning({ id: ocrCaptureBatches.id })
    if (!batchRow) throw new Error(`Failed to insert batch for segment ${seg.segmentKey}`)
    batchIds.push(batchRow.id)

    // Extraction
    const [extractionRow] = await db
      .insert(ocrExtractions)
      .values({
        batchId: batchRow.id,
        matchId,
        screenType: 'player_loadout_view',
        sourcePath: `${seg.dir}/fixture-placeholder.png`,
        sourceHash: `fixture-hash-${matchId}-${seg.segmentKey}`,
        rawResultJson: {},
        transformStatus: 'success',
        reviewStatus: 'reviewed',
      })
      .returning({ id: ocrExtractions.id })
    if (!extractionRow) throw new Error(`Failed to insert extraction for segment ${seg.segmentKey}`)
    extractionIds.push(extractionRow.id)

    // ocr_segments
    const [segmentRow] = await db
      .insert(ocrSegments)
      .values({
        matchId,
        captureBatchId: batchRow.id,
        segmentKey: seg.segmentKey,
        state: 'player_loadout_view',
        frameCount: 5,
        observabilityStatus: 'observable',
        uiVersion: 'nhl26',
        decoderVersion: 'fixture-v1',
        notes: `fixture-seeder-2a20:${fixture.name}`,
      })
      .returning({ id: ocrSegments.id })
    if (!segmentRow) throw new Error(`Failed to insert segment ${seg.segmentKey}`)
    segmentIds.push(segmentRow.id)
  }

  // 4. Seed roster rows for fixtures that need them.
  //    match250 has no expected_roster_seed (acceptance test supplies its own).
  //    match463 and synthetic_degraded seed their own roster so that
  //    getExpectedSlotsForMatch() returns the correct expected slots.
  if (fixture.name === 'fixture_match463_single_slot') {
    await seedMatch463Roster(matchId, db)
  } else if (fixture.name === 'fixture_synthetic_degraded') {
    await seedSyntheticDegradedRoster(matchId, db)
  }

  return { matchId, segmentIds, batchIds, extractionIds }
}

// ── evidence seeder ───────────────────────────────────────────────────────────

/**
 * Inserts ocr_field_evidence rows for every segment in the fixture.
 *
 * Assumes seedFixtureDb() has already run (segment rows must exist).
 * Does NOT delete prior evidence — call cleanupSentinelMatches() first if
 * idempotency is needed.
 *
 * @param fixture     Loaded fixture.
 * @param segmentIds  Ordered list of ocr_segments.id values (from SeedResult).
 * @param options     Optional db override.
 * @returns Total number of rows inserted across all segments.
 */
export async function seedEvidenceRecords(
  fixture: LoadedFixture,
  segmentIds: number[],
  options: { db?: Db } = {},
): Promise<{ insertedCount: number }> {
  const db = options.db ?? defaultDb
  let insertedCount = 0

  for (let i = 0; i < fixture.segments.length; i++) {
    const seg = fixture.segments[i]
    const segmentId = segmentIds[i]
    if (!seg || segmentId === undefined) {
      throw new Error(`Segment index ${i} out of bounds`)
    }
    if (seg.expectedEvidence.length === 0) continue

    const rows: NewOcrFieldEvidence[] = seg.expectedEvidence.map(
      (rec: LoadoutEvidenceRecord): NewOcrFieldEvidence => ({
        matchId: fixture.sentinelMatchId,
        segmentId,
        screenState: rec.screen_state as NewOcrFieldEvidence['screenState'],
        screenInstanceKey: rec.screen_instance_key ?? null,
        subjectSlotKey: rec.subject_slot_key ?? null,
        fieldKey: rec.field_key,
        fieldFamily: rec.field_family as NewOcrFieldEvidence['fieldFamily'],
        candidateValue: rec.candidate_value as NewOcrFieldEvidence['candidateValue'],
        candidateRank: rec.candidate_rank,
        rawConfidence: rec.raw_confidence.toString(),
        calibratedConfidence: rec.calibrated_confidence.toString(),
        supportFrameIds: rec.support_frame_ids,
        roiBbox: (rec.roi_bbox ?? null) as NewOcrFieldEvidence['roiBbox'],
        templateVersion: rec.template_version ?? null,
        extractorFamily: rec.extractor_family as NewOcrFieldEvidence['extractorFamily'],
        extractorVersion: rec.extractor_version,
        observabilityStatus: rec.observability_status as NewOcrFieldEvidence['observabilityStatus'],
        normalizationStatus: rec.normalization_status as NewOcrFieldEvidence['normalizationStatus'],
        rowKey: rec.row_key ?? null,
        columnKey: rec.column_key ?? null,
        xNorm: rec.x_norm != null ? rec.x_norm.toString() : null,
        yNorm: rec.y_norm != null ? rec.y_norm.toString() : null,
        shapeOrIconClass: rec.shape_or_icon_class ?? null,
      }),
    )

    await db.insert(ocrFieldEvidence).values(rows)
    insertedCount += rows.length
  }

  return { insertedCount }
}

// ── sql export (read-only) ────────────────────────────────────────────────────

/**
 * Re-export sql for callers that need to close the connection pool
 * (e.g. node:test after() hooks).
 */
export { sql }
