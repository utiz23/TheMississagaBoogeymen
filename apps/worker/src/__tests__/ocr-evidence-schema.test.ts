/**
 * Phase 0 evidence-layer schema integration test.
 *
 * Validates that the three new tables (`ocr_segments`, `ocr_field_evidence`,
 * `ocr_promotions`) accept the column shapes Phase 2+ promoters will emit:
 *
 *   - Multi-candidate field evidence: two competing values for the same
 *     (screen, field, slot) coexist as separate rows distinguished by
 *     candidate_rank.
 *   - Segment FK + unique-index behaviour: re-inserting a segment with the
 *     same (match_id, segment_key) UPSERTs (no row duplication).
 *   - Promotion-status enum acceptance: 'promoted' + each `blocked_*`
 *     variant land successfully.
 *   - Arrays (support_frame_ids, evidence_ids): bigint[] round-trips.
 *   - JSONB (candidate_value, roi_bbox, target_semantic_key, winning_value):
 *     non-trivial object structures round-trip.
 *
 * All inserts are scoped to a sentinel match_id (-999, never a real match)
 * and cleaned up at end-of-test via `after(...)`.
 *
 * Requires DATABASE_URL pointing at a DB where migration 0045 has run.
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/ocr-evidence-schema.test.js
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { db, sql, ocrSegments, ocrFieldEvidence, ocrPromotions } from '@eanhl/db'
import { and, eq, like } from 'drizzle-orm'

// Use match 250 (existing, well-known) as the FK target; all sentinel rows
// carry a distinctive segment_key / target_table prefix so cleanup is precise.
const TEST_MATCH_ID = 250
const SENTINEL_SEGMENT_KEY = 'phase0-schema-test-seg'
const SENTINEL_KEY_TWO = 'phase0-schema-test-seg-2'
const SENTINEL_TARGET_TABLE_PREFIX = 'phase0_'

async function cleanup(): Promise<void> {
  // Order: promotions → field_evidence → segments (FK direction).
  await db
    .delete(ocrPromotions)
    .where(like(ocrPromotions.targetTable, `${SENTINEL_TARGET_TABLE_PREFIX}%`))
  await db.delete(ocrFieldEvidence).where(like(ocrFieldEvidence.extractorVersion, 'phase0-test-%'))
  await db.delete(ocrSegments).where(like(ocrSegments.decoderVersion, 'phase0-test-%'))
}

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanup()
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanup()
  await sql.end()
})

void test('ocr_segments: insert + upsert on (match_id, segment_key)', async () => {
  if (!process.env['DATABASE_URL']) return

  const [seg] = await db
    .insert(ocrSegments)
    .values({
      matchId: TEST_MATCH_ID,
      segmentKey: SENTINEL_SEGMENT_KEY,
      state: 'player_loadout_view',
      tStartSec: '12.345',
      tEndSec: '42.125',
      frameCount: 30,
      segmentConfidence: '0.9123',
      observabilityStatus: 'observable',
      uiVersion: 'nhl26',
      decoderVersion: 'phase0-test-v1',
      captureBatchId: null,
      notes: 'inserted by ocr-evidence-schema.test.ts',
    })
    .returning()
  assert.ok(seg, 'insert returned a row')
  assert.equal(seg.state, 'player_loadout_view')
  assert.equal(seg.frameCount, 30)
  // numeric columns round-trip as strings under postgres.js — confirm precision
  // not silently truncated.
  assert.equal(seg.tStartSec, '12.345')
  assert.equal(seg.tEndSec, '42.125')

  // Upsert: same (match_id, segment_key) on the unique index → no duplicate row.
  const [upserted] = await db
    .insert(ocrSegments)
    .values({
      matchId: TEST_MATCH_ID,
      segmentKey: SENTINEL_SEGMENT_KEY,
      state: 'post_game_player_summary', // changed state
      frameCount: 60, // changed frame count
      uiVersion: 'nhl26',
      decoderVersion: 'phase0-test-v1',
    })
    .onConflictDoUpdate({
      target: [ocrSegments.matchId, ocrSegments.segmentKey],
      set: {
        state: 'post_game_player_summary',
        frameCount: 60,
      },
    })
    .returning()
  assert.ok(upserted)
  assert.equal(upserted.id, seg.id, 'upsert returned the same row id')
  assert.equal(upserted.state, 'post_game_player_summary')
  assert.equal(upserted.frameCount, 60)

  // Verify exactly one row exists for this segment_key.
  const rows = await db
    .select()
    .from(ocrSegments)
    .where(
      and(eq(ocrSegments.matchId, TEST_MATCH_ID), eq(ocrSegments.segmentKey, SENTINEL_SEGMENT_KEY)),
    )
  assert.equal(rows.length, 1, 'unique index prevents duplicate')
})

void test('ocr_segments: NULL match_id allows multiple rows with the same segment_key', async () => {
  if (!process.env['DATABASE_URL']) return
  // The unique index includes match_id, and Postgres treats NULL as distinct
  // in unique constraints — so two NULL-match-id rows with the same
  // segment_key are *both* inserted (no conflict). This is by-design for
  // manual screenshot batches that aren't yet linked to a match.
  const inserted = []
  for (let i = 0; i < 2; i++) {
    const [r] = await db
      .insert(ocrSegments)
      .values({
        matchId: null,
        segmentKey: 'phase0-null-match-test',
        state: 'unknown_or_transition',
        frameCount: 1,
        uiVersion: 'nhl26',
        decoderVersion: 'phase0-test-v1',
      })
      .returning()
    inserted.push(r)
  }
  assert.equal(inserted.length, 2)
  assert.notEqual(inserted[0]!.id, inserted[1]!.id)
  // Clean up after this isolated test.
  await db.delete(ocrSegments).where(eq(ocrSegments.segmentKey, 'phase0-null-match-test'))
})

void test('ocr_field_evidence: n-best candidates coexist for the same (screen, field, slot)', async () => {
  if (!process.env['DATABASE_URL']) return
  // First, make sure a segment exists for the FK.
  const [seg] = await db
    .insert(ocrSegments)
    .values({
      matchId: TEST_MATCH_ID,
      segmentKey: SENTINEL_KEY_TWO,
      state: 'player_loadout_view',
      frameCount: 5,
      uiVersion: 'nhl26',
      decoderVersion: 'phase0-test-v1',
    })
    .returning()
  assert.ok(seg)

  // Two competing candidates for the same loadout slot's build_class.
  const candidates = [
    {
      candidateValue: 'Playmaker' as string,
      candidateRank: 0,
      rawConfidence: '0.9200' as string,
      calibratedConfidence: '0.8800' as string,
    },
    {
      candidateValue: 'Power Forward' as string,
      candidateRank: 1,
      rawConfidence: '0.6500' as string,
      calibratedConfidence: '0.5400' as string,
    },
  ]
  const rows = await db
    .insert(ocrFieldEvidence)
    .values(
      candidates.map((c) => ({
        matchId: TEST_MATCH_ID,
        segmentId: seg.id,
        screenState: 'player_loadout_view' as const,
        screenInstanceKey: 'loadout_card_view',
        subjectSlotKey: 'loadout_slot_0',
        fieldKey: 'build_class',
        fieldFamily: 'closed_vocab' as const,
        candidateValue: c.candidateValue,
        candidateRank: c.candidateRank,
        rawConfidence: c.rawConfidence,
        calibratedConfidence: c.calibratedConfidence,
        supportFrameIds: [101, 102, 103],
        roiBbox: { x: 0.25, y: 0.4, w: 0.1, h: 0.05 },
        templateVersion: 'nhl26-template-v1',
        extractorFamily: 'closed_vocab' as const,
        extractorVersion: 'phase0-test-v1',
        observabilityStatus: 'observable' as const,
        normalizationStatus: 'normalized' as const,
      })),
    )
    .returning()
  assert.equal(rows.length, 2, 'two candidate rows inserted')
  // Rank ordering survives the round-trip.
  const sorted = [...rows].sort((a, b) => a.candidateRank - b.candidateRank)
  assert.equal(sorted[0]!.candidateValue, 'Playmaker')
  assert.equal(sorted[1]!.candidateValue, 'Power Forward')
  // Array round-trip.
  assert.deepEqual(sorted[0]!.supportFrameIds, [101, 102, 103])
  // JSONB round-trip.
  assert.deepEqual(sorted[0]!.roiBbox, { x: 0.25, y: 0.4, w: 0.1, h: 0.05 })
})

void test('ocr_field_evidence: geometry-extractor columns round-trip', async () => {
  if (!process.env['DATABASE_URL']) return
  const segs = await db
    .select()
    .from(ocrSegments)
    .where(
      and(eq(ocrSegments.matchId, TEST_MATCH_ID), eq(ocrSegments.segmentKey, SENTINEL_KEY_TWO)),
    )
  const segId = segs[0]!.id

  const [evidence] = await db
    .insert(ocrFieldEvidence)
    .values({
      matchId: TEST_MATCH_ID,
      segmentId: segId,
      screenState: 'post_game_action_tracker',
      subjectSlotKey: 'event_42',
      fieldKey: 'shot_location',
      fieldFamily: 'geometry',
      candidateValue: { type: 'shot' },
      candidateRank: 0,
      calibratedConfidence: '0.9500',
      extractorFamily: 'geometry',
      extractorVersion: 'phase0-test-v1',
      xNorm: '0.7234',
      yNorm: '-0.0125',
      shapeOrIconClass: 'shot_chevron',
    })
    .returning()
  assert.ok(evidence)
  assert.equal(evidence.xNorm, '0.7234')
  assert.equal(evidence.yNorm, '-0.0125')
  assert.equal(evidence.shapeOrIconClass, 'shot_chevron')
})

void test('ocr_promotions: every promotion_status enum value is accepted', async () => {
  if (!process.env['DATABASE_URL']) return
  const statuses = [
    'promoted',
    'blocked_observability',
    'blocked_consensus',
    'blocked_invariant',
    'blocked_authority',
  ] as const
  const rows = await db
    .insert(ocrPromotions)
    .values(
      statuses.map((s, i) => ({
        matchId: TEST_MATCH_ID,
        targetTable: `phase0_test_table_${i}`,
        targetSemanticKey: { match_id: TEST_MATCH_ID, slot: i },
        fieldKey: `field_${s}`,
        winningValue: s === 'promoted' ? { value: 'Playmaker' } : null,
        winningConfidence: s === 'promoted' ? '0.9200' : null,
        evidenceCount: 2,
        conflictCount: s === 'promoted' ? 0 : 1,
        evidenceIds: [1, 2],
        promotionStatus: s,
        blockingReason: s === 'promoted' ? null : `test reason for ${s}`,
        authoritySource: s === 'promoted' ? ('ocr_evidence' as const) : null,
      })),
    )
    .returning()
  assert.equal(rows.length, statuses.length)
  // Spot-check the promoted row.
  const promoted = rows.find((r) => r.promotionStatus === 'promoted')!
  assert.ok(promoted)
  assert.deepEqual(promoted.winningValue, { value: 'Playmaker' })
  assert.deepEqual(promoted.evidenceIds, [1, 2])
  assert.equal(promoted.winningConfidence, '0.9200')
  // Spot-check a blocked row.
  const blocked = rows.find((r) => r.promotionStatus === 'blocked_consensus')!
  assert.ok(blocked)
  assert.equal(blocked.blockingReason, 'test reason for blocked_consensus')
  assert.equal(blocked.authoritySource, null)
})

void test('ocr_promotions: unique index on (target_table, target_semantic_key, field_key) prevents dupes', async () => {
  if (!process.env['DATABASE_URL']) return
  // First insert.
  await db.insert(ocrPromotions).values({
    matchId: TEST_MATCH_ID,
    targetTable: 'phase0_unique_test',
    targetSemanticKey: { match_id: TEST_MATCH_ID, slot: 'unique' },
    fieldKey: 'build_class',
    winningValue: 'Playmaker',
    winningConfidence: '0.9000',
    evidenceCount: 1,
    conflictCount: 0,
    evidenceIds: [],
    promotionStatus: 'promoted',
    authoritySource: 'ocr_evidence',
  })

  // Second insert with same (target_table, semantic_key, field_key) should
  // conflict — assert the unique index catches it.
  let conflictThrown = false
  try {
    await db.insert(ocrPromotions).values({
      matchId: TEST_MATCH_ID,
      targetTable: 'phase0_unique_test',
      targetSemanticKey: { match_id: TEST_MATCH_ID, slot: 'unique' },
      fieldKey: 'build_class',
      winningValue: 'Sniper',
      winningConfidence: '0.8000',
      evidenceCount: 1,
      conflictCount: 0,
      evidenceIds: [],
      promotionStatus: 'promoted',
      authoritySource: 'ocr_evidence',
    })
  } catch (err) {
    conflictThrown = true
    const msg = err instanceof Error ? err.message : String(err)
    assert.ok(
      msg.includes('duplicate key') || msg.includes('unique'),
      `expected unique-constraint violation, got: ${msg}`,
    )
  }
  assert.ok(conflictThrown, 'duplicate promotion target should fail unique index')
})

void test('ocr_segments → ocr_field_evidence FK cascade: deleting segment requires no evidence', async () => {
  if (!process.env['DATABASE_URL']) return
  // FK has ON DELETE no action — verify we can't delete a segment that still
  // has evidence pointing at it. This catches accidental FK changes during
  // schema refactors.
  const segs = await db
    .select()
    .from(ocrSegments)
    .where(
      and(eq(ocrSegments.matchId, TEST_MATCH_ID), eq(ocrSegments.segmentKey, SENTINEL_KEY_TWO)),
    )
  const segId = segs[0]!.id

  // Confirm at least one evidence row references the segment (sanity check).
  const evidence = await db
    .select()
    .from(ocrFieldEvidence)
    .where(eq(ocrFieldEvidence.segmentId, segId))
  assert.ok(evidence.length > 0, 'sanity: at least one evidence row references the segment')

  // postgres.js wraps PG errors in a way that drops the SQLSTATE on the
  // surfaced Error.message. Cleaner test: any thrown error here is by
  // definition the FK because no other constraint applies to a plain DELETE.
  let fkBlocked = false
  try {
    await db.delete(ocrSegments).where(eq(ocrSegments.id, segId))
  } catch {
    fkBlocked = true
  }
  assert.ok(fkBlocked, 'FK should prevent deleting a segment that has evidence rows pointing at it')

  // Independent verification: re-query the segment — it must still exist.
  const stillThere = await db.select().from(ocrSegments).where(eq(ocrSegments.id, segId))
  assert.equal(stillThere.length, 1, 'segment row not deleted (FK held)')
})
