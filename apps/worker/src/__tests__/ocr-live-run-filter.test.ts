/**
 * Phase-A test: liveRunFilter hides rows from non-active (superseded) runs
 * while preserving legacy NULL-run rows.
 *
 * The migration in 0048_phase_a_decoder_runs.sql added the `run_id` column
 * and the `ocr_decoder_runs` table; this test proves the read-side helper
 * actually filters correctly when multiple runs coexist for one match.
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/ocr-live-run-filter.test.js
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  db,
  sql,
  ocrDecoderRuns,
  ocrFieldEvidence,
  ocrPromotions,
  ocrSegments,
} from '@eanhl/db'
import {
  getFieldEvidenceForLoadoutSlot,
  getFieldEvidenceForLobbySlot,
  getLoadoutPromotionsForMatch,
  getMatchSegments,
  liveRunFilter,
} from '@eanhl/db/queries'
import { and, eq, inArray, like } from 'drizzle-orm'

// Use match 250 (real, well-known) as the FK target; sentinel decoder_version
// + segment_key prefix + target_table prefix make cleanup precise.
const TEST_MATCH_ID = 250
const SENTINEL_DECODER_PREFIX = 'phaseA-live-filter-test-'
const SENTINEL_SEGMENT_PREFIX = 'phaseA-live-filter-seg-'
const SENTINEL_TARGET_TABLE = 'phaseA_live_filter_test'

async function cleanup(): Promise<void> {
  // Order matters because of FKs: evidence → segments → promotions →
  // decoder_runs (test rows). Each delete is narrowly scoped to sentinel data.
  await db
    .delete(ocrFieldEvidence)
    .where(like(ocrFieldEvidence.extractorVersion, `${SENTINEL_DECODER_PREFIX}%`))
  await db
    .delete(ocrSegments)
    .where(like(ocrSegments.decoderVersion, `${SENTINEL_DECODER_PREFIX}%`))
  await db
    .delete(ocrPromotions)
    .where(eq(ocrPromotions.targetTable, SENTINEL_TARGET_TABLE))
  await db
    .delete(ocrDecoderRuns)
    .where(like(ocrDecoderRuns.notes, `${SENTINEL_DECODER_PREFIX}%`))
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

void test('liveRunFilter hides superseded-run rows, keeps active-run + NULL-run rows', async () => {
  if (!process.env['DATABASE_URL']) return

  // ─── Setup: two test runs for match 250, one active, one not ────────────
  // (The real synthetic backfill run for match 250 already exists; these are
  // separate sentinel rows we'll clean up at the end.)
  const [activeRun] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId: TEST_MATCH_ID,
      videoSha256: null,
      decoderVersion: `${SENTINEL_DECODER_PREFIX}active`,
      weightsHash: 'test-active',
      configHash: 'test-active',
      isActive: false, // first INSERT can't be active because the partial-unique
                       // index lets only one match have an active run, and the
                       // backfill row already holds that slot. We test the
                       // filter by directly toggling is_active below.
      notes: `${SENTINEL_DECODER_PREFIX}active-run`,
    })
    .returning()
  assert.ok(activeRun)

  const [supersededRun] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId: TEST_MATCH_ID,
      videoSha256: null,
      decoderVersion: `${SENTINEL_DECODER_PREFIX}superseded`,
      weightsHash: 'test-superseded',
      configHash: 'test-superseded',
      isActive: false,
      notes: `${SENTINEL_DECODER_PREFIX}superseded-run`,
    })
    .returning()
  assert.ok(supersededRun)

  // Find the real backfill run for match 250 so we can deactivate it during
  // the test and reactivate at the end. Without this, our "active" sentinel
  // run can't actually be active under the one-active-per-match constraint.
  const backfillRuns = await db
    .select()
    .from(ocrDecoderRuns)
    .where(and(eq(ocrDecoderRuns.matchId, TEST_MATCH_ID), eq(ocrDecoderRuns.isActive, true)))
  assert.equal(backfillRuns.length, 1, 'exactly one active backfill run pre-test')
  const realBackfillRunId = backfillRuns[0]!.id

  try {
    // Make the sentinel "active" run the active one for this test.
    await db
      .update(ocrDecoderRuns)
      .set({ isActive: false })
      .where(eq(ocrDecoderRuns.id, realBackfillRunId))
    await db.update(ocrDecoderRuns).set({ isActive: true }).where(eq(ocrDecoderRuns.id, activeRun.id))

    // ─── Insert one segment + one evidence row per run + one NULL-run row ────
    const [segActive] = await db
      .insert(ocrSegments)
      .values({
        matchId: TEST_MATCH_ID,
        segmentKey: `${SENTINEL_SEGMENT_PREFIX}active`,
        state: 'player_loadout_view',
        frameCount: 1,
        uiVersion: 'nhl26',
        decoderVersion: `${SENTINEL_DECODER_PREFIX}active`,
        runId: activeRun.id,
      })
      .returning()
    const [segSuperseded] = await db
      .insert(ocrSegments)
      .values({
        matchId: TEST_MATCH_ID,
        segmentKey: `${SENTINEL_SEGMENT_PREFIX}superseded`,
        state: 'player_loadout_view',
        frameCount: 1,
        uiVersion: 'nhl26',
        decoderVersion: `${SENTINEL_DECODER_PREFIX}superseded`,
        runId: supersededRun.id,
      })
      .returning()
    const [segNullRun] = await db
      .insert(ocrSegments)
      .values({
        matchId: TEST_MATCH_ID,
        segmentKey: `${SENTINEL_SEGMENT_PREFIX}nullrun`,
        state: 'player_loadout_view',
        frameCount: 1,
        uiVersion: 'nhl26',
        decoderVersion: `${SENTINEL_DECODER_PREFIX}nullrun`,
        runId: null,
      })
      .returning()
    assert.ok(segActive && segSuperseded && segNullRun)

    // Evidence rows tagged with the same three run states.
    for (const [seg, runId, label] of [
      [segActive, activeRun.id, 'active'],
      [segSuperseded, supersededRun.id, 'superseded'],
      [segNullRun, null, 'nullrun'],
    ] as const) {
      await db.insert(ocrFieldEvidence).values({
        matchId: TEST_MATCH_ID,
        segmentId: seg.id,
        screenState: 'player_loadout_view',
        subjectSlotKey: `phaseA_test_slot_${label}`,
        fieldKey: 'build_class',
        fieldFamily: 'closed_vocab',
        candidateValue: 'Playmaker',
        candidateRank: 0,
        rawConfidence: '0.9000',
        calibratedConfidence: '0.8500',
        extractorFamily: 'closed_vocab',
        extractorVersion: `${SENTINEL_DECODER_PREFIX}${label}`,
        runId: runId,
      })
    }

    // Lobby evidence too — separate slot key so we can verify the lobby
    // helper independently of the loadout helper.
    for (const [seg, runId, label] of [
      [segActive, activeRun.id, 'active'],
      [segSuperseded, supersededRun.id, 'superseded'],
      [segNullRun, null, 'nullrun'],
    ] as const) {
      await db.insert(ocrFieldEvidence).values({
        matchId: TEST_MATCH_ID,
        segmentId: seg.id,
        screenState: 'pre_game_lobby_state_2',
        subjectSlotKey: `phaseA_lobby_slot_${label}`,
        fieldKey: 'gamertag',
        fieldFamily: 'open_text',
        candidateValue: 'TestPlayer',
        candidateRank: 0,
        rawConfidence: '0.9000',
        calibratedConfidence: '0.8500',
        extractorFamily: 'open_text',
        extractorVersion: `${SENTINEL_DECODER_PREFIX}${label}-lobby`,
        runId: runId,
      })
    }

    // Promotions tagged the same way.
    for (const [runId, label] of [
      [activeRun.id, 'active'],
      [supersededRun.id, 'superseded'],
      [null, 'nullrun'],
    ] as const) {
      await db.insert(ocrPromotions).values({
        matchId: TEST_MATCH_ID,
        targetTable: SENTINEL_TARGET_TABLE,
        targetSemanticKey: { match_id: TEST_MATCH_ID, slot: label },
        fieldKey: 'build_class',
        winningValue: 'Playmaker',
        winningConfidence: '0.9000',
        evidenceCount: 1,
        conflictCount: 0,
        promotionStatus: 'promoted',
        runId: runId,
      })
    }

    // ─── Assert: live readers only return active-run + NULL-run rows ────────

    // Loadout evidence reader
    const loadoutRows = await getFieldEvidenceForLoadoutSlot(TEST_MATCH_ID)
    const loadoutSlots = new Set(
      loadoutRows
        .map((r) => r.subjectSlotKey ?? '')
        .filter((s) => s.startsWith('phaseA_test_slot_')),
    )
    assert.ok(loadoutSlots.has('phaseA_test_slot_active'), 'active-run loadout row visible')
    assert.ok(loadoutSlots.has('phaseA_test_slot_nullrun'), 'NULL-run loadout row visible (legacy)')
    assert.ok(
      !loadoutSlots.has('phaseA_test_slot_superseded'),
      'superseded-run loadout row hidden',
    )

    // Lobby evidence reader
    const lobbyRows = await getFieldEvidenceForLobbySlot(TEST_MATCH_ID)
    const lobbySlots = new Set(
      lobbyRows
        .map((r) => r.subjectSlotKey ?? '')
        .filter((s) => s.startsWith('phaseA_lobby_slot_')),
    )
    assert.ok(lobbySlots.has('phaseA_lobby_slot_active'), 'active-run lobby row visible')
    assert.ok(lobbySlots.has('phaseA_lobby_slot_nullrun'), 'NULL-run lobby row visible (legacy)')
    assert.ok(
      !lobbySlots.has('phaseA_lobby_slot_superseded'),
      'superseded-run lobby row hidden',
    )

    // Promotion reader
    const allPromotions = await db
      .select()
      .from(ocrPromotions)
      .where(eq(ocrPromotions.targetTable, SENTINEL_TARGET_TABLE))
    assert.equal(allPromotions.length, 3, 'sanity: 3 sentinel promotions inserted (full history)')

    // We can't use getLoadoutPromotionsForMatch directly since the sentinel
    // targetTable isn't 'player_loadout_snapshots'. Test the filter behavior
    // by running a parallel query that mirrors the helper's WHERE clause.
    const livePromotions = await db
      .select()
      .from(ocrPromotions)
      .where(
        and(
          eq(ocrPromotions.matchId, TEST_MATCH_ID),
          eq(ocrPromotions.targetTable, SENTINEL_TARGET_TABLE),
          liveRunFilter(ocrPromotions.runId),
        ),
      )
    const livePromotionSlots = new Set(
      livePromotions.map((p) => (p.targetSemanticKey as { slot: string }).slot),
    )
    assert.ok(livePromotionSlots.has('active'), 'active-run promotion visible')
    assert.ok(livePromotionSlots.has('nullrun'), 'NULL-run promotion visible (legacy)')
    assert.ok(!livePromotionSlots.has('superseded'), 'superseded-run promotion hidden')

    // Segment reader
    const segments = await getMatchSegments(TEST_MATCH_ID)
    const sentinelSegments = segments.filter((s) =>
      (s.segmentKey ?? '').startsWith(SENTINEL_SEGMENT_PREFIX),
    )
    const segmentKeys = new Set(sentinelSegments.map((s) => s.segmentKey))
    assert.ok(
      segmentKeys.has(`${SENTINEL_SEGMENT_PREFIX}active`),
      'active-run segment visible',
    )
    assert.ok(
      segmentKeys.has(`${SENTINEL_SEGMENT_PREFIX}nullrun`),
      'NULL-run segment visible (legacy)',
    )
    assert.ok(
      !segmentKeys.has(`${SENTINEL_SEGMENT_PREFIX}superseded`),
      'superseded-run segment hidden',
    )

    // ─── Flip activation: the previously-active sentinel run becomes
    //      superseded, the originally-superseded sentinel run becomes active.
    //      Verifies that "is_active" is the only thing the helper consults —
    //      no caching of run identity in the rows themselves. ──────────────
    await db.update(ocrDecoderRuns).set({ isActive: false }).where(eq(ocrDecoderRuns.id, activeRun.id))
    await db
      .update(ocrDecoderRuns)
      .set({ isActive: true })
      .where(eq(ocrDecoderRuns.id, supersededRun.id))

    const loadoutRowsAfterFlip = await getFieldEvidenceForLoadoutSlot(TEST_MATCH_ID)
    const loadoutSlotsAfterFlip = new Set(
      loadoutRowsAfterFlip
        .map((r) => r.subjectSlotKey ?? '')
        .filter((s) => s.startsWith('phaseA_test_slot_')),
    )
    assert.ok(
      !loadoutSlotsAfterFlip.has('phaseA_test_slot_active'),
      'old-active row now hidden after flip',
    )
    assert.ok(
      loadoutSlotsAfterFlip.has('phaseA_test_slot_superseded'),
      'new-active (previously superseded) row now visible',
    )
    assert.ok(
      loadoutSlotsAfterFlip.has('phaseA_test_slot_nullrun'),
      'NULL-run row still visible across flip',
    )
  } finally {
    // Always restore the real backfill run as the canonical active run for
    // match 250 — otherwise subsequent tests see a wrong active run.
    await db
      .update(ocrDecoderRuns)
      .set({ isActive: false })
      .where(
        and(
          eq(ocrDecoderRuns.matchId, TEST_MATCH_ID),
          inArray(ocrDecoderRuns.id, [activeRun.id, supersededRun.id]),
        ),
      )
    await db.update(ocrDecoderRuns).set({ isActive: true }).where(eq(ocrDecoderRuns.id, realBackfillRunId))
  }
})

void test('liveRunFilter on listFieldEvidence: includeAllRuns flag bypasses the filter', async () => {
  if (!process.env['DATABASE_URL']) return
  // This is a smoke test: the default (includeAllRuns=false) hides superseded
  // rows, includeAllRuns=true returns them. The cleanup hook at the end of the
  // previous test already removed sentinel rows, so we re-seed a minimal pair
  // and assert.

  // Reuse the same approach: insert two runs, one is_active, one not.
  // Find current active for match 250 so we can swap.
  const [currentActive] = await db
    .select()
    .from(ocrDecoderRuns)
    .where(and(eq(ocrDecoderRuns.matchId, TEST_MATCH_ID), eq(ocrDecoderRuns.isActive, true)))
  assert.ok(currentActive)

  const [activeRun] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId: TEST_MATCH_ID,
      videoSha256: null,
      decoderVersion: `${SENTINEL_DECODER_PREFIX}flag-active`,
      weightsHash: 'flag-test',
      configHash: 'flag-test',
      isActive: false,
      notes: `${SENTINEL_DECODER_PREFIX}flag-active`,
    })
    .returning()
  const [supersededRun] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId: TEST_MATCH_ID,
      videoSha256: null,
      decoderVersion: `${SENTINEL_DECODER_PREFIX}flag-superseded`,
      weightsHash: 'flag-test',
      configHash: 'flag-test',
      isActive: false,
      notes: `${SENTINEL_DECODER_PREFIX}flag-superseded`,
    })
    .returning()
  assert.ok(activeRun && supersededRun)

  try {
    await db.update(ocrDecoderRuns).set({ isActive: false }).where(eq(ocrDecoderRuns.id, currentActive.id))
    await db.update(ocrDecoderRuns).set({ isActive: true }).where(eq(ocrDecoderRuns.id, activeRun.id))

    const [seg] = await db
      .insert(ocrSegments)
      .values({
        matchId: TEST_MATCH_ID,
        segmentKey: `${SENTINEL_SEGMENT_PREFIX}flag-active`,
        state: 'pre_game_lobby_state_2',
        frameCount: 1,
        uiVersion: 'nhl26',
        decoderVersion: `${SENTINEL_DECODER_PREFIX}flag`,
        runId: activeRun.id,
      })
      .returning()
    assert.ok(seg)

    await db.insert(ocrFieldEvidence).values([
      {
        matchId: TEST_MATCH_ID,
        segmentId: seg.id,
        screenState: 'pre_game_lobby_state_2',
        subjectSlotKey: 'phaseA_flag_active',
        fieldKey: 'gamertag',
        fieldFamily: 'open_text',
        candidateValue: 'A',
        candidateRank: 0,
        extractorFamily: 'open_text',
        extractorVersion: `${SENTINEL_DECODER_PREFIX}flag-active`,
        runId: activeRun.id,
      },
      {
        matchId: TEST_MATCH_ID,
        segmentId: seg.id,
        screenState: 'pre_game_lobby_state_2',
        subjectSlotKey: 'phaseA_flag_superseded',
        fieldKey: 'gamertag',
        fieldFamily: 'open_text',
        candidateValue: 'S',
        candidateRank: 0,
        extractorFamily: 'open_text',
        extractorVersion: `${SENTINEL_DECODER_PREFIX}flag-superseded`,
        runId: supersededRun.id,
      },
    ])

    // Filter via the exported function we want to verify: listFieldEvidence
    // is exported but takes input params. Import it lazily here to keep this
    // test self-contained.
    const { listFieldEvidence } = await import('@eanhl/db/queries')

    const defaultRows = await listFieldEvidence({
      matchId: TEST_MATCH_ID,
      screenState: 'pre_game_lobby_state_2',
      fieldKey: 'gamertag',
    })
    const defaultSlots = new Set(
      defaultRows.map((r) => r.subjectSlotKey ?? '').filter((s) => s.startsWith('phaseA_flag_')),
    )
    assert.ok(defaultSlots.has('phaseA_flag_active'), 'default: active-run visible')
    assert.ok(!defaultSlots.has('phaseA_flag_superseded'), 'default: superseded hidden')

    const allRows = await listFieldEvidence({
      matchId: TEST_MATCH_ID,
      screenState: 'pre_game_lobby_state_2',
      fieldKey: 'gamertag',
      includeAllRuns: true,
    })
    const allSlots = new Set(
      allRows.map((r) => r.subjectSlotKey ?? '').filter((s) => s.startsWith('phaseA_flag_')),
    )
    assert.ok(allSlots.has('phaseA_flag_active'), 'includeAllRuns: active visible')
    assert.ok(allSlots.has('phaseA_flag_superseded'), 'includeAllRuns: superseded visible too')
  } finally {
    await db
      .update(ocrDecoderRuns)
      .set({ isActive: false })
      .where(
        and(
          eq(ocrDecoderRuns.matchId, TEST_MATCH_ID),
          inArray(ocrDecoderRuns.id, [activeRun.id, supersededRun.id]),
        ),
      )
    await db.update(ocrDecoderRuns).set({ isActive: true }).where(eq(ocrDecoderRuns.id, currentActive.id))
  }
})
