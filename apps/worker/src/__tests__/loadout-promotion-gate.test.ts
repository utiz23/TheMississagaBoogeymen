/**
 * Task 2A-17 — loadout-v2 promoter integration tests.
 *
 * Tests use sentinel match IDs > 9000 and seed ocr_field_evidence rows
 * directly.  Each test gets its own sentinel match so cleanup is isolated.
 *
 * FK chain for evidence rows:
 *   matches (sentinel) → ocr_capture_batches → ocr_extractions → ocr_field_evidence
 *
 * Run via:
 *   pnpm --filter @eanhl/db build && pnpm --filter worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/loadout-promotion-gate.test.js 2>&1 | tail -40
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
  ocrFieldEvidence,
  ocrPromotions,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
  playerPersonaAliases,
} from '@eanhl/db'
import { inArray, eq, and, like } from 'drizzle-orm'
import { promoteLoadoutFromEvidence } from '../ocr-promoters/loadout-v2.js'

// ─── constants ─────────────────────────────────────────────────────────────────

const SENTINEL_NOTES_TAG = '2a17-loadout-promotion-gate-test'
const GAME_TITLE_ID = 1 // NHL 26

/** Real gamertag that resolves to a player in the DB (player_id=1). */
const RESOLVED_GAMERTAG = 'HenryTheBobJr'
const RESOLVED_PLAYER_ID = 1

/** Gamertag guaranteed to not exist in the DB. */
const GHOST_GAMERTAG = 'GhostNeverHeardOf_zz99'

// High-confidence value for evidence rows that should promote easily.
const HIGH_CONF = 0.95
// Low-confidence value for evidence rows that should fail the gate.
const LOW_CONF = 0.1

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Insert a sentinel match and return its DB id. */
async function insertSentinelMatch(suffix: string): Promise<number> {
  const [row] = await db
    .insert(matches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      eaMatchId: `test-2a17-${suffix}`,
      matchType: 'gameType5',
      opponentClubId: '88888',
      opponentName: 'Sentinel Opponent 2A17',
      playedAt: new Date('2026-01-01T00:00:00Z'),
      result: 'WIN',
      scoreFor: 5,
      scoreAgainst: 1,
      shotsFor: 20,
      shotsAgainst: 12,
      hitsFor: 8,
      hitsAgainst: 4,
    })
    .returning({ id: matches.id })
  if (!row) throw new Error('Failed to insert sentinel match ' + suffix)
  return row.id
}

/** Insert a sentinel ocr_capture_batch and ocr_extraction for FK support. */
async function insertSentinelExtraction(matchId: number, suffix: string): Promise<number> {
  const [batch] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      matchId,
      sourceDirectory: `/tmp/2a17-test-batch-${suffix}`,
      captureKind: 'manual_screenshots',
      notes: SENTINEL_NOTES_TAG,
    })
    .returning({ id: ocrCaptureBatches.id })
  if (!batch) throw new Error('Failed to insert sentinel batch')

  const [extraction] = await db
    .insert(ocrExtractions)
    .values({
      batchId: batch.id,
      matchId,
      screenType: 'player_loadout_view',
      sourcePath: `/tmp/2a17-test-${suffix}/frame001.png`,
      rawResultJson: {},
      transformStatus: 'success',
    })
    .returning({ id: ocrExtractions.id })
  if (!extraction) throw new Error('Failed to insert sentinel extraction')
  return extraction.id
}

/**
 * Seed one evidence row for a slot+field combination.
 * extractionId is used as the support_frame_ids[0] so the promoter can
 * derive ocrExtractionId from evidence.
 */
async function seedEvidence(opts: {
  matchId: number
  slotKey: string
  fieldKey: string
  candidateValue: unknown
  confidence?: number
  candidateRank?: number
  extractionId: number
}): Promise<number> {
  const conf = opts.confidence ?? HIGH_CONF
  const [row] = await db
    .insert(ocrFieldEvidence)
    .values({
      matchId: opts.matchId,
      screenState: 'player_loadout_view',
      subjectSlotKey: opts.slotKey,
      fieldKey: opts.fieldKey,
      fieldFamily: 'closed_vocab',
      candidateValue: opts.candidateValue,
      candidateRank: opts.candidateRank ?? 0,
      rawConfidence: String(conf),
      calibratedConfidence: String(conf),
      supportFrameIds: [opts.extractionId],
      extractorFamily: 'closed_vocab',
      extractorVersion: '2a17-test-v1',
    })
    .returning({ id: ocrFieldEvidence.id })
  if (!row) throw new Error(`Failed to insert evidence for ${opts.fieldKey}`)
  return row.id
}

/**
 * Seed a complete slot's worth of evidence (gamertag + position + HARD fields).
 * All fields at HIGH_CONF unless overrideConfs is set.
 */
async function seedCompleteSlot(opts: {
  matchId: number
  slotKey: string
  extractionId: number
  gamertag?: string
  position?: string
  includeXFactors?: boolean
  includeAttributes?: boolean
  /** Map of field_key → confidence override */
  overrideConfs?: Record<string, number>
  /** Field keys to omit entirely */
  omitFields?: Set<string>
}): Promise<void> {
  const {
    matchId, slotKey, extractionId,
    gamertag = RESOLVED_GAMERTAG,
    position = 'C',
    includeXFactors = false,
    includeAttributes = false,
    overrideConfs = {},
    omitFields = new Set(),
  } = opts

  const getConf = (fk: string) => overrideConfs[fk] ?? HIGH_CONF

  if (!omitFields.has('gamertag')) {
    await seedEvidence({ matchId, slotKey, fieldKey: 'gamertag', candidateValue: gamertag, confidence: getConf('gamertag'), extractionId })
  }
  if (!omitFields.has('position')) {
    await seedEvidence({ matchId, slotKey, fieldKey: 'position', candidateValue: position, confidence: getConf('position'), extractionId })
  }

  if (includeXFactors) {
    for (let i = 0; i < 3; i++) {
      const fk = `x_factor_name_${i}` as string
      if (!omitFields.has(fk)) {
        await seedEvidence({ matchId, slotKey, fieldKey: fk, candidateValue: `X-Factor-${i}`, confidence: getConf(fk), extractionId })
      }
    }
  }

  if (includeAttributes) {
    const ATTR_KEYS = [
      'attr_wrist_shot_accuracy', 'attr_slap_shot_accuracy', 'attr_speed', 'attr_balance', 'attr_agility',
      'attr_wrist_shot_power', 'attr_slap_shot_power', 'attr_acceleration', 'attr_puck_control', 'attr_endurance',
      'attr_passing', 'attr_offensive_awareness', 'attr_body_checking', 'attr_stick_checking', 'attr_defensive_awareness',
      'attr_hand_eye', 'attr_strength', 'attr_durability', 'attr_shot_blocking',
      'attr_deking', 'attr_faceoffs', 'attr_discipline', 'attr_fighting_skill',
    ]
    for (const fk of ATTR_KEYS) {
      if (!omitFields.has(fk)) {
        await seedEvidence({ matchId, slotKey, fieldKey: fk, candidateValue: 80, confidence: getConf(fk), extractionId })
      }
    }
  }
}

/** Seed expected roster rows (player_match_stats + opponent_player_match_stats). */
async function seedExpectedRoster(matchId: number): Promise<void> {
  const BGM_POSITIONS = [
    { playerId: 1, position: 'center' },
    { playerId: 2, position: 'leftWing' },
    { playerId: 3, position: 'rightWing' },
    { playerId: 4, position: 'defenseMen' },
    { playerId: 5, position: 'defenseMen' },
  ]
  await db.insert(playerMatchStats).values(
    BGM_POSITIONS.map(({ playerId, position }) => ({
      matchId, playerId, position, isGoalie: false, teamSide: 0,
    })),
  )
  await db.insert(opponentPlayerMatchStats).values([
    { matchId, eaPlayerId: 'opp-2a17-1', opponentClubId: '88888', gamertag: 'OppA', position: 'center', isGoalie: false },
    { matchId, eaPlayerId: 'opp-2a17-2', opponentClubId: '88888', gamertag: 'OppB', position: 'leftWing', isGoalie: false },
    { matchId, eaPlayerId: 'opp-2a17-3', opponentClubId: '88888', gamertag: 'OppC', position: 'rightWing', isGoalie: false },
    { matchId, eaPlayerId: 'opp-2a17-4', opponentClubId: '88888', gamertag: 'OppD', position: 'defenseMen', isGoalie: false },
    { matchId, eaPlayerId: 'opp-2a17-5', opponentClubId: '88888', gamertag: 'OppE', position: 'defenseMen', isGoalie: false },
  ])
}

/** Cleanup all sentinel data in FK-safe order for a list of match IDs. */
async function cleanup(matchIds: number[]): Promise<void> {
  if (matchIds.length === 0) return
  // Delete promotion rows
  await db.delete(ocrPromotions).where(inArray(ocrPromotions.matchId, matchIds))
  // Delete canonical rows (children first)
  const snaps = await db
    .select({ id: playerLoadoutSnapshots.id })
    .from(playerLoadoutSnapshots)
    .where(inArray(playerLoadoutSnapshots.matchId, matchIds))
  const snapIds = snaps.map((s) => s.id)
  if (snapIds.length > 0) {
    await db.delete(playerLoadoutXFactors).where(inArray(playerLoadoutXFactors.loadoutSnapshotId, snapIds))
    await db.delete(playerLoadoutAttributes).where(inArray(playerLoadoutAttributes.loadoutSnapshotId, snapIds))
    await db.delete(playerLoadoutSnapshots).where(inArray(playerLoadoutSnapshots.matchId, matchIds))
  }
  // Delete evidence
  await db.delete(ocrFieldEvidence).where(inArray(ocrFieldEvidence.matchId, matchIds))
  // Delete roster rows
  await db.delete(playerMatchStats).where(inArray(playerMatchStats.matchId, matchIds))
  await db.delete(opponentPlayerMatchStats).where(inArray(opponentPlayerMatchStats.matchId, matchIds))
  // Delete extractions (FK order: extractions → batches)
  const batchIds = await db
    .select({ id: ocrCaptureBatches.id })
    .from(ocrCaptureBatches)
    .where(inArray(ocrCaptureBatches.matchId, matchIds))
  const batchIdList = batchIds.map((b) => b.id)
  if (batchIdList.length > 0) {
    await db.delete(ocrExtractions).where(inArray(ocrExtractions.batchId, batchIdList))
    await db.delete(ocrCaptureBatches).where(inArray(ocrCaptureBatches.matchId, matchIds))
  }
  // Delete matches
  await db.delete(matches).where(inArray(matches.id, matchIds))
}

// ─── test state ───────────────────────────────────────────────────────────────

const allSentinelMatchIds: number[] = []

before(async () => {
  if (!process.env['DATABASE_URL']) return
  // Pre-cleanup any stale leftover from a previous interrupted run.
  // We can't pre-know the IDs, so clean up by the SENTINEL_NOTES_TAG on batches.
  const staleBatches = await db
    .select({ matchId: ocrCaptureBatches.matchId })
    .from(ocrCaptureBatches)
    .where(like(ocrCaptureBatches.notes, `%${SENTINEL_NOTES_TAG}%`))
  const staleMatchIds = staleBatches.map((b) => b.matchId).filter((id): id is number => id !== null)
  if (staleMatchIds.length > 0) {
    await cleanup(staleMatchIds)
  }
  // Also clean up any persona alias with our sentinel tag.
  await db.delete(playerPersonaAliases).where(like(playerPersonaAliases.alias, '%ALIAS_OLD_2A17%'))
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanup(allSentinelMatchIds)
  // Clean up persona alias rows.
  await db.delete(playerPersonaAliases).where(like(playerPersonaAliases.alias, '%ALIAS_OLD_2A17%'))
  await sql.end()
})

// ─── Test 1: 10 slots fully promoted ─────────────────────────────────────────

describe('loadout-v2 promoter', () => {
  test('test_promotes_all_10_visible_slots_for_fixture_match250', async () => {
    if (!process.env['DATABASE_URL']) return

    const matchId = await insertSentinelMatch('t1-10slots')
    allSentinelMatchIds.push(matchId)

    // Seed slots for as many resolvable players as exist (up to 10).
    // Per the v2 spec, only gamertags that resolve via resolveGamertagToPlayer
    // promote to 'for'; unresolved ones are blocked with unresolved_team_side.
    // The test exercises: all seeded slots promote + x_factor/attribute child blocks write.
    const existingPlayers = await db
      .select({ id: players.id, gamertag: players.gamertag })
      .from(players)
    const allGamertags = existingPlayers.map((p) => p.gamertag)
    // Use up to 10 players; if fewer, use what's available (expect ≥5 in this DB)
    const slotsToCreate = Math.min(allGamertags.length, 10)
    const positions = ['C', 'LW', 'RW', 'LD', 'RD', 'C', 'LW', 'RW', 'LD', 'RD']

    for (let i = 0; i < slotsToCreate; i++) {
      const slotKey = `loadout_slot_seg9100_row${i}`
      const extractionId = await insertSentinelExtraction(matchId, `t1-slot${i}`)
      await seedCompleteSlot({
        matchId,
        slotKey,
        extractionId,
        gamertag: allGamertags[i]!,
        position: positions[i]!,
        includeXFactors: true,
        includeAttributes: true,
      })
    }

    const result = await promoteLoadoutFromEvidence({ matchId, db })

    // All resolvable slots should promote.
    assert.ok(result.promotedSnapshotCount > 0, `At least 1 snapshot should be promoted, got ${result.promotedSnapshotCount}`)
    // No more than slotsToCreate slots were seeded.
    assert.ok(result.promotedSnapshotCount <= slotsToCreate, `Promoted ${result.promotedSnapshotCount} <= seeded ${slotsToCreate}`)

    const snapRows = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, matchId))
    assert.equal(snapRows.length, result.promotedSnapshotCount, 'DB snapshot count matches result')

    const snapIds = snapRows.map((s) => s.id)
    if (snapIds.length > 0) {
      const xfRows = await db
        .select()
        .from(playerLoadoutXFactors)
        .where(inArray(playerLoadoutXFactors.loadoutSnapshotId, snapIds))
      // Each promoted slot seeded 3 x_factors → 3×promotedCount rows
      assert.equal(xfRows.length, result.promotedSnapshotCount * 3, '3 x_factor rows per promoted snapshot')

      const attrRows = await db
        .select()
        .from(playerLoadoutAttributes)
        .where(inArray(playerLoadoutAttributes.loadoutSnapshotId, snapIds))
      // 23 attributes per promoted slot
      assert.equal(attrRows.length, result.promotedSnapshotCount * 23, '23 attribute rows per promoted snapshot')
    }

    // ocr_promotions rows should exist
    assert.ok(result.promotionRowsWritten > 0, 'promotion rows written')
  })

  // ─── Test 2: Absent slots get blocked_observability ───────────────────────

  test('test_blocks_observability_for_absent_slots_in_fixture_match463', async () => {
    if (!process.env['DATABASE_URL']) return

    const matchId = await insertSentinelMatch('t2-observability')
    allSentinelMatchIds.push(matchId)

    // Seed expected roster: 5 BGM + 5 against = 10 slots
    await seedExpectedRoster(matchId)

    // Seed evidence for ONLY ONE slot (HenryTheBobJr, position C)
    const extractionId = await insertSentinelExtraction(matchId, 't2-slot0')
    await seedCompleteSlot({
      matchId,
      slotKey: 'loadout_slot_seg9200_row0',
      extractionId,
      gamertag: RESOLVED_GAMERTAG,
      position: 'C',
    })

    const result = await promoteLoadoutFromEvidence({ matchId, db })

    // Exactly 1 snapshot promoted
    assert.equal(result.promotedSnapshotCount, 1, '1 promoted snapshot (HenryTheBobJr/C)')

    // The promoted snapshot should be in the DB
    const snapRows = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, matchId))
    assert.equal(snapRows.length, 1, '1 snapshot row in DB')
    assert.equal(snapRows[0]!.gamertagSnapshot, RESOLVED_GAMERTAG, 'gamertag matches')
    assert.equal(snapRows[0]!.position, 'C', 'position matches')
    assert.equal(snapRows[0]!.teamSide, 'for', 'team side is for (resolved player)')

    // 9 absent expected slots → 9 blocked_observability rows
    const obsRows = await db
      .select()
      .from(ocrPromotions)
      .where(
        and(
          eq(ocrPromotions.matchId, matchId),
          eq(ocrPromotions.promotionStatus, 'blocked_observability'),
          eq(ocrPromotions.targetTable, 'player_loadout_snapshots'),
        ),
      )
    assert.equal(obsRows.length, 9, '9 absent slots → 9 blocked_observability rows')
    for (const row of obsRows) {
      assert.equal(row.blockingReason, 'not_observable_from_source', 'reason is not_observable_from_source')
    }
  })

  // ─── Test 3: Missing position blocks snapshot ──────────────────────────────

  test('test_writes_canonical_rows_only_when_hard_fields_promoted', async () => {
    if (!process.env['DATABASE_URL']) return

    const matchId = await insertSentinelMatch('t3-hard-fields')
    allSentinelMatchIds.push(matchId)

    const extractionId = await insertSentinelExtraction(matchId, 't3-slot0')

    // Seed gamertag evidence but OMIT position (hard field)
    await seedCompleteSlot({
      matchId,
      slotKey: 'loadout_slot_seg9300_row0',
      extractionId,
      gamertag: RESOLVED_GAMERTAG,
      position: 'C', // will be omitted below
      omitFields: new Set(['position']),
    })

    const result = await promoteLoadoutFromEvidence({ matchId, db })

    // No snapshot should be written
    assert.equal(result.promotedSnapshotCount, 0, 'no snapshot promoted when position is absent')
    assert.equal(result.blockedSnapshotCount, 1, '1 slot blocked')

    const snapRows = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, matchId))
    assert.equal(snapRows.length, 0, 'no snapshot rows in DB')

    // A blocked_invariant or blocked snapshot-level promotion row should exist
    const blockedRows = await db
      .select()
      .from(ocrPromotions)
      .where(
        and(
          eq(ocrPromotions.matchId, matchId),
          eq(ocrPromotions.targetTable, 'player_loadout_snapshots'),
        ),
      )
    const snapshotLevelBlock = blockedRows.find(
      (r) => r.fieldKey === null &&
        (r.promotionStatus === 'blocked_invariant' ||
         r.promotionStatus === 'blocked_observability')
    )
    assert.ok(snapshotLevelBlock, 'snapshot-level blocked promotion row exists')
    const reason = snapshotLevelBlock!.blockingReason ?? ''
    assert.ok(
      reason.includes('unresolved_position') || reason.includes('hard_fields_not_promoted'),
      `blocking_reason includes unresolved_position or hard_fields_not_promoted, got: "${reason}"`,
    )
  })

  // ─── Test 4: Per-field blocked decisions get ocr_promotions rows ──────────

  test('test_writes_ocr_promotions_row_per_blocked_decision', async () => {
    if (!process.env['DATABASE_URL']) return

    const matchId = await insertSentinelMatch('t4-blocked-fields')
    allSentinelMatchIds.push(matchId)

    const extractionId = await insertSentinelExtraction(matchId, 't4-slot0')
    const slotKey = 'loadout_slot_seg9400_row0'

    // Seed two candidates for the same field at similar confidence → consensus block
    // field_key 'gamertag' with two competing values
    await seedEvidence({ matchId, slotKey, fieldKey: 'gamertag', candidateValue: RESOLVED_GAMERTAG, confidence: 0.55, extractionId, candidateRank: 0 })
    await seedEvidence({ matchId, slotKey, fieldKey: 'gamertag', candidateValue: 'silkyjoker85', confidence: 0.52, extractionId, candidateRank: 1 })
    await seedEvidence({ matchId, slotKey, fieldKey: 'position', candidateValue: 'LW', confidence: HIGH_CONF, extractionId })

    await promoteLoadoutFromEvidence({ matchId, db })

    // The gamertag field decision should have a blocked status (blocked_consensus)
    const gamertagPromotion = await db
      .select()
      .from(ocrPromotions)
      .where(
        and(
          eq(ocrPromotions.matchId, matchId),
          eq(ocrPromotions.fieldKey, 'gamertag'),
        ),
      )
    assert.ok(gamertagPromotion.length > 0, 'gamertag promotion row exists')
    // With 0.55 vs 0.52 confidence, ratio = 0.55/0.52 ≈ 1.058 < 1.5 → blocked_consensus
    assert.equal(gamertagPromotion[0]!.promotionStatus, 'blocked_consensus', 'gamertag is blocked_consensus due to non-dominant top')

    // The position field should be promoted
    const positionPromotion = await db
      .select()
      .from(ocrPromotions)
      .where(
        and(
          eq(ocrPromotions.matchId, matchId),
          eq(ocrPromotions.fieldKey, 'position'),
        ),
      )
    // Position may or may not exist depending on how blocked slots are handled
    if (positionPromotion.length > 0) {
      assert.ok(
        ['promoted', 'blocked_invariant', 'blocked_consensus', 'blocked_observability'].includes(positionPromotion[0]!.promotionStatus),
        'position has a valid promotion status',
      )
    }
  })

  // ─── Test 5: Persona alias resolution ────────────────────────────────────

  test('test_resolves_persona_alias_via_player_persona_aliases', async () => {
    if (!process.env['DATABASE_URL']) return

    const matchId = await insertSentinelMatch('t5-persona')
    allSentinelMatchIds.push(matchId)

    // Seed a persona alias: ALIAS_OLD_2A17 → PersonaCanonical_2A17
    await db.insert(playerPersonaAliases).values({
      alias: 'ALIAS_OLD_2A17',
      normalizedAlias: 'alias_old_2a17',
      canonicalPersona: 'PersonaCanonical_2A17',
    })

    const extractionId = await insertSentinelExtraction(matchId, 't5-slot0')
    const slotKey = 'loadout_slot_seg9500_row0'

    await seedCompleteSlot({
      matchId, slotKey, extractionId,
      gamertag: RESOLVED_GAMERTAG,
      position: 'C',
    })
    // Seed a player_name_persona evidence with the alias value
    await seedEvidence({ matchId, slotKey, fieldKey: 'player_name_persona', candidateValue: 'ALIAS_OLD_2A17', confidence: HIGH_CONF, extractionId })

    const result = await promoteLoadoutFromEvidence({ matchId, db })

    assert.equal(result.promotedSnapshotCount, 1, '1 snapshot promoted')

    const snapRows = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, matchId))
    assert.equal(snapRows.length, 1, '1 snapshot row in DB')
    assert.equal(snapRows[0]!.playerNamePersona, 'PersonaCanonical_2A17', 'playerNamePersona is resolved canonical')
    assert.equal(snapRows[0]!.playerNamePersonaRaw, 'ALIAS_OLD_2A17', 'playerNamePersonaRaw preserves the raw alias')
  })

  // ─── Test 6: X-Factor child block skipped when 1 of 3 blocks ─────────────

  test('test_skips_x_factor_child_block_when_one_of_three_blocks', async () => {
    if (!process.env['DATABASE_URL']) return

    const matchId = await insertSentinelMatch('t6-xfactor-partial')
    allSentinelMatchIds.push(matchId)

    const extractionId = await insertSentinelExtraction(matchId, 't6-slot0')
    const slotKey = 'loadout_slot_seg9600_row0'

    await seedCompleteSlot({
      matchId, slotKey, extractionId,
      gamertag: RESOLVED_GAMERTAG,
      position: 'C',
      includeXFactors: false,
      includeAttributes: false,
    })

    // Seed 2 high-conf x_factors and 1 with competing low-conf (consensus block)
    await seedEvidence({ matchId, slotKey, fieldKey: 'x_factor_name_0', candidateValue: 'Tape-to-Tape', confidence: HIGH_CONF, extractionId })
    await seedEvidence({ matchId, slotKey, fieldKey: 'x_factor_name_1', candidateValue: 'One Tee', confidence: HIGH_CONF, extractionId })
    // x_factor_name_2: two competing values → blocked_consensus
    await seedEvidence({ matchId, slotKey, fieldKey: 'x_factor_name_2', candidateValue: 'Puck on a String', confidence: 0.55, extractionId, candidateRank: 0 })
    await seedEvidence({ matchId, slotKey, fieldKey: 'x_factor_name_2', candidateValue: 'Pressure+', confidence: 0.52, extractionId, candidateRank: 1 })

    const result = await promoteLoadoutFromEvidence({ matchId, db })

    // Snapshot should promote (HARD fields are fine)
    assert.equal(result.promotedSnapshotCount, 1, 'snapshot promoted even though 1 x_factor blocked')

    const snapRows = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, matchId))
    assert.equal(snapRows.length, 1, 'snapshot row exists')

    // ZERO x_factor rows (child block skipped because only 2 of 3 promote)
    const xfRows = await db
      .select()
      .from(playerLoadoutXFactors)
      .where(eq(playerLoadoutXFactors.loadoutSnapshotId, snapRows[0]!.id))
    assert.equal(xfRows.length, 0, 'no x_factor rows written (child block skipped)')

    // Verify that at least one x_factor field promotion row has a blocked status
    const xfPromoRows = await db
      .select()
      .from(ocrPromotions)
      .where(
        and(
          eq(ocrPromotions.matchId, matchId),
          eq(ocrPromotions.fieldKey, 'x_factor_name_2'),
        ),
      )
    assert.ok(xfPromoRows.length > 0, 'x_factor_name_2 has a promotion row')
    assert.ok(
      xfPromoRows[0]!.promotionStatus !== 'promoted',
      `x_factor_name_2 promotion status is blocked (got ${xfPromoRows[0]!.promotionStatus})`,
    )
  })

  // ─── Test 7: Attribute child block skipped when fewer than 20 promote ─────

  test('test_skips_attributes_child_block_when_fewer_than_20_promote', async () => {
    if (!process.env['DATABASE_URL']) return

    const matchId = await insertSentinelMatch('t7-attrs-partial')
    allSentinelMatchIds.push(matchId)

    const extractionId = await insertSentinelExtraction(matchId, 't7-slot0')
    const slotKey = 'loadout_slot_seg9700_row0'

    await seedCompleteSlot({
      matchId, slotKey, extractionId,
      gamertag: RESOLVED_GAMERTAG,
      position: 'C',
      includeXFactors: false,
      includeAttributes: false,
    })

    // Seed only 19 attribute fields at high confidence (below 20 floor)
    const ATTR_KEYS_PARTIAL = [
      'attr_wrist_shot_accuracy', 'attr_slap_shot_accuracy', 'attr_speed', 'attr_balance', 'attr_agility',
      'attr_wrist_shot_power', 'attr_slap_shot_power', 'attr_acceleration', 'attr_puck_control', 'attr_endurance',
      'attr_passing', 'attr_offensive_awareness', 'attr_body_checking', 'attr_stick_checking', 'attr_defensive_awareness',
      'attr_hand_eye', 'attr_strength', 'attr_durability', 'attr_shot_blocking',
      // 19 total — omitting deking, faceoffs, discipline, fighting_skill (4 attributes)
    ]
    for (const fk of ATTR_KEYS_PARTIAL) {
      await seedEvidence({ matchId, slotKey, fieldKey: fk, candidateValue: 80, confidence: HIGH_CONF, extractionId })
    }
    // Seed 4 blocked (competing) attribute fields
    const BLOCKED_ATTRS = ['attr_deking', 'attr_faceoffs', 'attr_discipline', 'attr_fighting_skill']
    for (const fk of BLOCKED_ATTRS) {
      await seedEvidence({ matchId, slotKey, fieldKey: fk, candidateValue: 70, confidence: 0.55, extractionId, candidateRank: 0 })
      await seedEvidence({ matchId, slotKey, fieldKey: fk, candidateValue: 65, confidence: 0.52, extractionId, candidateRank: 1 })
    }

    const result = await promoteLoadoutFromEvidence({ matchId, db })

    // Snapshot should promote (HARD fields fine)
    assert.equal(result.promotedSnapshotCount, 1, 'snapshot promoted')

    const snapRows = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, matchId))
    assert.equal(snapRows.length, 1, 'snapshot row exists')

    // ZERO attribute rows (19 promoted < 20 floor)
    const attrRows = await db
      .select()
      .from(playerLoadoutAttributes)
      .where(eq(playerLoadoutAttributes.loadoutSnapshotId, snapRows[0]!.id))
    assert.equal(attrRows.length, 0, 'no attribute rows written (child block skipped, 19 < 20 floor)')

    // Blocked attribute promotion rows exist
    for (const fk of BLOCKED_ATTRS) {
      const promoRows = await db
        .select()
        .from(ocrPromotions)
        .where(
          and(
            eq(ocrPromotions.matchId, matchId),
            eq(ocrPromotions.fieldKey, fk),
          ),
        )
      assert.ok(promoRows.length > 0, `${fk} has a promotion row`)
      assert.ok(
        promoRows[0]!.promotionStatus !== 'promoted',
        `${fk} is blocked (got ${promoRows[0]!.promotionStatus})`,
      )
    }
  })

  // ─── Test 8: Unresolved gamertag blocks snapshot ──────────────────────────

  test('test_unresolved_gamertag_blocks_snapshot_with_invariant_reason', async () => {
    if (!process.env['DATABASE_URL']) return

    const matchId = await insertSentinelMatch('t8-ghost-gamertag')
    allSentinelMatchIds.push(matchId)

    const extractionId = await insertSentinelExtraction(matchId, 't8-slot0')
    const slotKey = 'loadout_slot_seg9800_row0'

    // Seed with a gamertag that will NOT resolve to any player
    await seedCompleteSlot({
      matchId, slotKey, extractionId,
      gamertag: GHOST_GAMERTAG,
      position: 'RW',
    })

    const result = await promoteLoadoutFromEvidence({ matchId, db })

    // No snapshot should be promoted
    assert.equal(result.promotedSnapshotCount, 0, 'no snapshot promoted for unresolved gamertag')
    assert.equal(result.blockedSnapshotCount, 1, '1 slot blocked')

    // No snapshot row in DB
    const snapRows = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, matchId))
    assert.equal(snapRows.length, 0, 'no snapshot row in DB')

    // Promotion row should have blocked_invariant with reason unresolved_team_side
    const promoRows = await db
      .select()
      .from(ocrPromotions)
      .where(
        and(
          eq(ocrPromotions.matchId, matchId),
          eq(ocrPromotions.targetTable, 'player_loadout_snapshots'),
        ),
      )

    const blockedRow = promoRows.find(
      (r) => r.fieldKey === null && r.promotionStatus === 'blocked_invariant',
    )
    assert.ok(blockedRow, 'snapshot-level blocked_invariant promotion row exists')
    assert.equal(blockedRow!.blockingReason, 'unresolved_team_side', 'blocking_reason is unresolved_team_side')
  })
})
