/**
 * Phase F — confidence-weighted consolidation, DB-backed integration tests.
 *
 * The pure vote()/pickAnchor()/fieldConfidence() primitives are unit-tested in
 * lib/consolidate-loadouts.test.ts (no DB). These tests prove the wiring the
 * unit tests can't reach — the exact path `decoder-runs activate` uses:
 *
 *   A. rebuildCanonicalsFromActiveRun writes subject_slot_key onto the snapshot
 *      (the promoter change that makes the evidence join possible at all).
 *   B. consolidateLoadouts weights the cross-slot scalar vote by the run's
 *      ocr_field_evidence confidence — a single confident reading beats a
 *      low-confidence count-majority; passing a run with no evidence degrades
 *      to today's unweighted majority (the graceful-degrade / no-regression
 *      mechanism, proven as an exact differential).
 *   C. the confidence-anchor's X-Factor child rows surface (constraint 2:
 *      children ride the anchor, so anchor choice is their only lever).
 *   D. match 250 (real fixture, run-tagged, rebuilt) consolidates identically
 *      with vs. without weighting — the no-regression exact-diff oracle on real
 *      data. Any diff = hard failure = stop-and-review.
 *
 * All tests no-op without DATABASE_URL, matching the other DB-backed suites.
 *
 * Run via:
 *   pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/consolidate-loadouts-weighted.test.js
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  db,
  sql as rawSql,
  matches,
  players,
  playerMatchStats,
  opponentPlayerMatchStats,
  ocrCaptureBatches,
  ocrDecoderRuns,
  ocrExtractions,
  ocrFieldEvidence,
  ocrPromotions,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
} from '@eanhl/db'
import { and, eq, inArray, like } from 'drizzle-orm'
import { rebuildCanonicalsFromActiveRun } from '../lib/rebuild-canonicals-from-active-run.js'
import { consolidateLoadouts } from '../lib/consolidate-loadouts.js'
import {
  loadFixture,
  SENTINEL_MATCH_IDS,
  type LoadedFixture,
} from './fixtures/loadout-fixture-loader.js'
import {
  seedFixtureDb,
  seedEvidenceRecords,
  cleanupSentinelMatches,
} from './fixtures/seed-fixture-db.js'

const GAME_TITLE_ID = 1 // NHL 26
const SENTINEL_TAG = 'phase-f-weighted'

// ── cleanup ───────────────────────────────────────────────────────────────────

const sentinelMatchIds = new Set<number>()

async function cleanupMatch(matchId: number): Promise<void> {
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
  await db.delete(ocrDecoderRuns).where(eq(ocrDecoderRuns.matchId, matchId))
  await db.delete(playerMatchStats).where(eq(playerMatchStats.matchId, matchId))
  await db.delete(opponentPlayerMatchStats).where(eq(opponentPlayerMatchStats.matchId, matchId))
  await db.delete(matches).where(eq(matches.id, matchId))
}

async function cleanupAllSentinels(): Promise<void> {
  const stale = await db
    .select({ id: matches.id })
    .from(matches)
    .where(like(matches.eaMatchId, `${SENTINEL_TAG}%`))
  for (const m of stale) await cleanupMatch(m.id)
  sentinelMatchIds.clear()
}

// ── 250 fixture roster (borrowed from loadout-canonical-row-fixture.test.ts) ────
// getExpectedSlotsForMatch(9001) + team-side binding need these; without them the
// promoter blocks every slot and the oracle would be vacuous.
const M250_BGM_PLAYERS = [
  { id: 99001, gamertag: 'MrHomiecide' },
  { id: 99002, gamertag: 'Stick Menace' },
  { id: 99003, gamertag: 'silkyjoker85' },
  { id: 99004, gamertag: 'HenryTheBobJr' },
  { id: 99005, gamertag: 'JoeyFlopfish' },
]
const M250_BGM_STATS = [
  { id: 990001, playerId: 99001, position: 'center' as const },
  { id: 990002, playerId: 99002, position: 'leftWing' as const },
  { id: 990003, playerId: 99003, position: 'rightWing' as const },
  { id: 990004, playerId: 99004, position: 'defenseMen' as const },
  { id: 990005, playerId: 99005, position: 'defenseMen' as const },
]
const M250_OPP_STATS = [
  { id: 990006, eaPlayerId: 'fix-9001-opp-c', gamertag: 'XZ4RKY', position: 'center' as const },
  { id: 990007, eaPlayerId: 'fix-9001-opp-lw', gamertag: 'DuhPope', position: 'leftWing' as const },
  {
    id: 990008,
    eaPlayerId: 'fix-9001-opp-rw',
    gamertag: 'RAIDERSG7',
    position: 'rightWing' as const,
  },
  {
    id: 990009,
    eaPlayerId: 'fix-9001-opp-ld',
    gamertag: 'MuttButt',
    position: 'defenseMen' as const,
  },
  {
    id: 990010,
    eaPlayerId: 'fix-9001-opp-rd',
    gamertag: 'shadowassault20',
    position: 'defenseMen' as const,
  },
]

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanupAllSentinels()
  await db.delete(players).where(
    inArray(
      players.id,
      M250_BGM_PLAYERS.map((p) => p.id),
    ),
  )
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  for (const matchId of Array.from(sentinelMatchIds)) {
    try {
      await cleanupMatch(matchId)
    } catch {
      // sweep retries below
    }
  }
  await cleanupAllSentinels()
  await db.delete(players).where(
    inArray(
      players.id,
      M250_BGM_PLAYERS.map((p) => p.id),
    ),
  )
  await rawSql.end({ timeout: 5 })
})

// ── shared fixture helpers ──────────────────────────────────────────────────────

async function createMatch(suffix: string): Promise<number> {
  const [m] = await db
    .insert(matches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      eaMatchId: `${SENTINEL_TAG}-${suffix}`,
      matchType: 'gameType5',
      opponentClubId: '99999',
      opponentName: 'Phase-F Sentinel Opp',
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
  sentinelMatchIds.add(m.id)
  return m.id
}

async function createActiveRun(matchId: number, suffix: string): Promise<number> {
  const [run] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256: null,
      decoderVersion: 'phase-f-v1',
      weightsHash: `wh-${suffix}`,
      configHash: `ch-${suffix}`,
      isActive: true,
      notes: `${SENTINEL_TAG}-${suffix}`,
    })
    .returning({ id: ocrDecoderRuns.id })
  assert.ok(run)
  return run.id
}

async function createExtraction(
  matchId: number,
  runId: number,
  screenType: 'player_loadout_view' | 'pre_game_lobby_state_2',
): Promise<number> {
  const [b] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      matchId,
      sourceDirectory: `/tmp/${SENTINEL_TAG}/${matchId}/${screenType}`,
      captureKind: 'manual_screenshots',
      notes: `${SENTINEL_TAG}-batch`,
      runId,
    })
    .returning({ id: ocrCaptureBatches.id })
  assert.ok(b)
  const [x] = await db
    .insert(ocrExtractions)
    .values({
      batchId: b.id,
      matchId,
      screenType,
      sourcePath: `/tmp/${SENTINEL_TAG}/${matchId}/${screenType}/f.png`,
      rawResultJson: {},
      transformStatus: 'success',
      runId,
    })
    .returning({ id: ocrExtractions.id })
  assert.ok(x)
  return x.id
}

interface SeedSnapOpts {
  matchId: number
  extractionId: number
  slotKey: string
  gamertag: string
  position: string
  teamSide: 'for' | 'against'
  buildClass?: string | null
  playerNumber?: number | null
  playerNamePersona?: string | null
}

async function seedSnap(o: SeedSnapOpts): Promise<number> {
  const [row] = await db
    .insert(playerLoadoutSnapshots)
    .values({
      matchId: o.matchId,
      ocrExtractionId: o.extractionId,
      gameTitleId: GAME_TITLE_ID,
      playerId: null,
      gamertagSnapshot: o.gamertag,
      subjectSlotKey: o.slotKey,
      position: o.position,
      teamSide: o.teamSide,
      buildClass: o.buildClass ?? null,
      playerNumber: o.playerNumber ?? null,
      playerNamePersona: o.playerNamePersona ?? null,
      isCpu: false,
      reviewStatus: 'pending_review',
    })
    .returning({ id: playerLoadoutSnapshots.id })
  assert.ok(row)
  return row.id
}

async function seedEvidence(
  matchId: number,
  runId: number,
  slotKey: string,
  fieldKey: string,
  value: unknown,
  calibrated: string,
  screenState: 'player_loadout_view' | 'pre_game_lobby_state_2' = 'player_loadout_view',
): Promise<void> {
  await db.insert(ocrFieldEvidence).values({
    matchId,
    screenState,
    subjectSlotKey: slotKey,
    fieldKey,
    fieldFamily: 'closed_vocab',
    candidateValue: value as never,
    candidateRank: 0,
    rawConfidence: calibrated,
    calibratedConfidence: calibrated,
    extractorFamily: 'closed_vocab',
    extractorVersion: `${SENTINEL_TAG}-v1`,
    runId,
  })
}

async function reviewedRows(matchId: number) {
  return db
    .select({
      id: playerLoadoutSnapshots.id,
      subjectSlotKey: playerLoadoutSnapshots.subjectSlotKey,
      teamSide: playerLoadoutSnapshots.teamSide,
      position: playerLoadoutSnapshots.position,
      buildClass: playerLoadoutSnapshots.buildClass,
    })
    .from(playerLoadoutSnapshots)
    .where(
      and(
        eq(playerLoadoutSnapshots.matchId, matchId),
        eq(playerLoadoutSnapshots.reviewStatus, 'reviewed'),
      ),
    )
}

// A bogus run id that carries no evidence → readFieldConfidence returns an empty
// map → every vote degrades to weight-1 = the pre-Phase-F unweighted behavior.
const NO_EVIDENCE_RUN = 999_000_001

// ─────────────────────────────────────────────────────────────────────────────
// A. rebuild writes subject_slot_key
// ─────────────────────────────────────────────────────────────────────────────
void test('rebuildCanonicalsFromActiveRun writes subject_slot_key onto the snapshot', async () => {
  if (!process.env['DATABASE_URL']) return

  // Two real players so the loadout gamertag resolves at promote time.
  const existing = await db.select({ gamertag: players.gamertag }).from(players).limit(1)
  assert.ok(existing[0], 'DB must have at least one player for this test')
  const gamertag = existing[0]!.gamertag

  const matchId = await createMatch('rebuild-slotkey')
  const runId = await createActiveRun(matchId, 'rebuild-slotkey')
  const extractionId = await createExtraction(matchId, runId, 'player_loadout_view')
  const slotKey = 'loadout_slot_seg0001_subject01'

  // Minimal promotable loadout slot: the two HARD fields (gamertag + position).
  await seedEvidence(matchId, runId, slotKey, 'gamertag', gamertag, '0.95')
  await seedEvidence(matchId, runId, slotKey, 'position', 'C', '0.95')

  await rebuildCanonicalsFromActiveRun(matchId)

  const snaps = await db
    .select({
      id: playerLoadoutSnapshots.id,
      subjectSlotKey: playerLoadoutSnapshots.subjectSlotKey,
    })
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, matchId))
  assert.equal(snaps.length, 1, `expected 1 rebuilt snapshot, got ${snaps.length}`)
  assert.equal(
    snaps[0]!.subjectSlotKey,
    slotKey,
    'promoter must persist the extractor slot key (Phase F join key)',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// B. weighted vote flips a low-confidence count-majority; no-evidence run reverts
// ─────────────────────────────────────────────────────────────────────────────
void test('weighted consolidation: a confident minority beats a low-confidence majority; unweighted reverts', async () => {
  if (!process.env['DATABASE_URL']) return

  const matchId = await createMatch('weighted-vote')
  const runId = await createActiveRun(matchId, 'weighted-vote')
  const loadoutX = await createExtraction(matchId, runId, 'player_loadout_view')
  const lobbyX = await createExtraction(matchId, runId, 'pre_game_lobby_state_2')

  const slotHi = 'loadout_slot_seg0001_subject01' // reads 'Sniper' confidently
  const slotLo = 'loadout_slot_seg0002_subject01' // reads 'Grinder' weakly
  const slotLobby = 'lobby_for_C' // reads 'Grinder' weakly

  // Evidence: the (for, C) group's build_class is 'Grinder' by COUNT (2 of 3)
  // but 'Sniper' by CONFIDENCE (0.95 vs 0.30 + 0.30 = 0.60).
  await seedEvidence(matchId, runId, slotHi, 'build_class', 'Sniper', '0.95')
  await seedEvidence(matchId, runId, slotLo, 'build_class', 'Grinder', '0.30')
  await seedEvidence(
    matchId,
    runId,
    slotLobby,
    'build_class',
    'Grinder',
    '0.30',
    'pre_game_lobby_state_2',
  )

  // Re-seed the three snapshots fresh (ids change each pass, but the anchor is
  // still the most-recent loadout row and evidence keys are stable strings).
  async function seedGroup(): Promise<void> {
    await db.delete(playerLoadoutSnapshots).where(eq(playerLoadoutSnapshots.matchId, matchId))
    await seedSnap({
      matchId,
      extractionId: loadoutX,
      slotKey: slotHi,
      gamertag: 'WeightedTag',
      position: 'C',
      teamSide: 'for',
      buildClass: 'Sniper',
    })
    await seedSnap({
      matchId,
      extractionId: loadoutX,
      slotKey: slotLo,
      gamertag: 'WeightedTag',
      position: 'C',
      teamSide: 'for',
      buildClass: 'Grinder',
    })
    await seedSnap({
      matchId,
      extractionId: lobbyX,
      slotKey: slotLobby,
      gamertag: 'WeightedTag',
      position: 'C',
      teamSide: 'for',
      buildClass: 'Grinder',
    })
  }

  // Weighted (active run) → the confident 'Sniper' wins the vote.
  await seedGroup()
  await consolidateLoadouts(matchId, { runId })
  let reviewed = await reviewedRows(matchId)
  assert.equal(reviewed.length, 1, 'exactly one (for, C) anchor')
  assert.equal(
    reviewed[0]!.buildClass,
    'Sniper',
    'weighted vote must pick the confident minority reading',
  )

  // Unweighted (a run with no evidence) → degrades to the count-majority.
  await seedGroup()
  await consolidateLoadouts(matchId, { runId: NO_EVIDENCE_RUN })
  reviewed = await reviewedRows(matchId)
  assert.equal(reviewed.length, 1)
  assert.equal(
    reviewed[0]!.buildClass,
    'Grinder',
    'with no confidence the vote reverts to the unweighted majority (no-regression)',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// C. confidence picks the anchor whose X-Factor child rows survive
// ─────────────────────────────────────────────────────────────────────────────
void test('weighted consolidation: the higher anchor-field-confidence slot becomes the reviewed anchor', async () => {
  if (!process.env['DATABASE_URL']) return

  const matchId = await createMatch('anchor-conf')
  const runId = await createActiveRun(matchId, 'anchor-conf')
  const loadoutX = await createExtraction(matchId, runId, 'player_loadout_view')

  const slotStale = 'loadout_slot_seg0009_subject01' // NEWER id, weak X-Factor reads
  const slotStrong = 'loadout_slot_seg0001_subject01' // OLDER id, strong X-Factor reads

  // Anchor-only evidence (loadout-only keys). Strong slot reads its X-Factors far
  // more confidently, so it must win the anchor despite being older (lower id) —
  // recency alone would pick the stale slot.
  await seedEvidence(matchId, runId, slotStale, 'x_factor_name_0', 'Wheels', '0.40')
  await seedEvidence(matchId, runId, slotStrong, 'x_factor_name_0', 'Big Tipper', '0.95')

  // Seed the stale slot LAST so it gets the higher (more-recent) id.
  const strongId = await seedSnap({
    matchId,
    extractionId: loadoutX,
    slotKey: slotStrong,
    gamertag: 'AnchorTag',
    position: 'LW',
    teamSide: 'for',
  })
  const staleId = await seedSnap({
    matchId,
    extractionId: loadoutX,
    slotKey: slotStale,
    gamertag: 'AnchorTag',
    position: 'LW',
    teamSide: 'for',
  })
  assert.ok(staleId > strongId, 'stale slot must be the more-recent snapshot')

  await consolidateLoadouts(matchId, { runId })
  const reviewed = await reviewedRows(matchId)
  assert.equal(reviewed.length, 1, 'exactly one (for, LW) anchor')
  assert.equal(
    reviewed[0]!.id,
    strongId,
    'anchor must be the higher-confidence slot, not the more-recent one',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// D. match 250 no-regression exact-diff oracle (weighted vs unweighted, real data)
// ─────────────────────────────────────────────────────────────────────────────
void test('match 250: weighted consolidation equals unweighted (no-regression exact-diff oracle)', async () => {
  if (!process.env['DATABASE_URL']) return

  const fixture: LoadedFixture = loadFixture('fixture_match250_full_lobby')
  const matchId = SENTINEL_MATCH_IDS['fixture_match250_full_lobby'] // 9001
  sentinelMatchIds.add(matchId)

  // 1. Seed the fixture (match + segments + extractions), the BGM/OPP roster the
  //    promoter needs, and the 610 evidence records.
  const seed = await seedFixtureDb(fixture)
  await db.insert(players).values(M250_BGM_PLAYERS).onConflictDoNothing()
  await db
    .insert(playerMatchStats)
    .values(
      M250_BGM_STATS.map((r) => ({
        id: r.id,
        matchId,
        playerId: r.playerId,
        position: r.position,
        isGoalie: false,
      })),
    )
    .onConflictDoNothing()
  await db
    .insert(opponentPlayerMatchStats)
    .values(
      M250_OPP_STATS.map((r) => ({
        id: r.id,
        matchId,
        eaPlayerId: r.eaPlayerId,
        opponentClubId: '88888',
        gamertag: r.gamertag,
        position: r.position,
        isGoalie: false,
      })),
    )
    .onConflictDoNothing()
  await seedEvidenceRecords(fixture, seed.segmentIds)

  // 2. Tag the evidence with an active run so rebuild's promoter reads it, and
  //    point support_frame_ids at a real extraction (NOT NULL FK on the snapshot).
  const runId = await createActiveRun(matchId, 'm250-oracle')
  const firstExtraction = seed.extractionIds[0]!
  await db
    .update(ocrFieldEvidence)
    .set({ runId, supportFrameIds: [firstExtraction] })
    .where(eq(ocrFieldEvidence.matchId, matchId))

  // Capture the consolidated surface: reviewed snapshots (voted scalar columns)
  // + their X-Factor and attribute child rows, keyed by (teamSide, position) so
  // the comparison is anchor-id-independent.
  async function captureSurface(): Promise<string> {
    const snaps = await db
      .select()
      .from(playerLoadoutSnapshots)
      .where(
        and(
          eq(playerLoadoutSnapshots.matchId, matchId),
          eq(playerLoadoutSnapshots.reviewStatus, 'reviewed'),
        ),
      )
    const rows = []
    for (const s of snaps) {
      const xf = await db
        .select({
          slotIndex: playerLoadoutXFactors.slotIndex,
          name: playerLoadoutXFactors.xFactorName,
          tier: playerLoadoutXFactors.tier,
        })
        .from(playerLoadoutXFactors)
        .where(eq(playerLoadoutXFactors.loadoutSnapshotId, s.id))
      const attrs = await db
        .select({
          key: playerLoadoutAttributes.attributeKey,
          value: playerLoadoutAttributes.value,
          delta: playerLoadoutAttributes.deltaValue,
        })
        .from(playerLoadoutAttributes)
        .where(eq(playerLoadoutAttributes.loadoutSnapshotId, s.id))
      rows.push({
        key: `${s.teamSide}|${s.position}`,
        gamertag: s.gamertagSnapshot,
        buildClass: s.buildClass,
        buildClassCanonical: s.buildClassCanonical,
        persona: s.playerNamePersona,
        number: s.playerNumber,
        height: s.heightText,
        weight: s.weightLbs,
        handedness: s.handedness,
        level: s.playerLevelNumber,
        isCaptain: s.isCaptain,
        subjectSlotKey: s.subjectSlotKey,
        xf: xf.sort((a, b) => a.slotIndex - b.slotIndex),
        attrs: attrs.sort((a, b) => a.key.localeCompare(b.key)),
      })
    }
    rows.sort((a, b) => a.key.localeCompare(b.key))
    return JSON.stringify(rows)
  }

  // 3. Unweighted baseline: rebuild → consolidate with a no-evidence run.
  await rebuildCanonicalsFromActiveRun(matchId)
  await consolidateLoadouts(matchId, { runId: NO_EVIDENCE_RUN })
  const unweighted = await captureSurface()

  // 4. Weighted: rebuild from the SAME baseline → consolidate with the active run.
  await rebuildCanonicalsFromActiveRun(matchId)
  await consolidateLoadouts(matchId, { runId })
  const weighted = await captureSurface()

  // Non-vacuous: the fixture must actually produce reviewed rows with slot keys
  // (so weighting genuinely engaged), else the equality would be trivially true.
  assert.ok(
    JSON.parse(unweighted).length >= 10,
    `expected ≥10 reviewed match-250 rows, got ${JSON.parse(unweighted).length}`,
  )
  assert.ok(
    JSON.parse(weighted).every((r: { subjectSlotKey: string | null }) => r.subjectSlotKey),
    'every reviewed row must carry a subject_slot_key (weighted join key present)',
  )

  // The oracle: weighting must not change a single value on match 250.
  assert.equal(
    weighted,
    unweighted,
    'Phase F weighting changed the consolidated match-250 surface — STOP AND REVIEW (regression, not an understood improvement)',
  )
})

// ─────────────────────────────────────────────────────────────────────────────
// E. identity-consistency filter (Phase G — for_RW bleed)
//    A scroll-transition lobby frame binds a NEIGHBOUR's entire row into the
//    for|RW slot (geometric row-grouping: the LD player HenryTheBobJr / #7 in the
//    RW y-band alongside silkyjoker85's loadout card). The bled lobby evidence
//    OUT-scores the loadout card (0.9807 > 0.9718), so under Phase F's weighted
//    vote it would promote #7 / "Hubert Jenkins" into the slot — the exact
//    run-1954 regression that drops player_number 1.00 → 0.90. The gamertag
//    mismatch gates the bled row out of the vote so number/persona/gamertag all
//    read the real player. Non-vacuous: seeding the higher-confidence contaminant
//    is what makes the weighted vote WANT to flip it — the filter is what stops it.
// ─────────────────────────────────────────────────────────────────────────────
void test('identity filter: a mis-slotted different-player lobby row does not bleed into for|RW', async () => {
  if (!process.env['DATABASE_URL']) return

  const matchId = await createMatch('rw-bleed')
  const runId = await createActiveRun(matchId, 'rw-bleed')
  const loadoutX = await createExtraction(matchId, runId, 'player_loadout_view')
  const lobbyX = await createExtraction(matchId, runId, 'pre_game_lobby_state_2')

  const slotLoadout = 'loadout_slot_seg0003_subject02' // silkyjoker85 — the truth
  const slotLobby = 'lobby_for_RW' // HenryTheBobJr bled in from the LD row

  // The bled lobby reading out-scores the loadout card on number/persona, so
  // WITHOUT the identity filter the weighted vote would promote #7 / Hubert
  // Jenkins. Loadout keys jersey_number/persona_raw; lobby keys
  // player_number/player_name_persona (EVIDENCE_KEY_BY_SOURCE).
  await seedEvidence(matchId, runId, slotLoadout, 'jersey_number', 10, '0.9718')
  await seedEvidence(matchId, runId, slotLoadout, 'persona_raw', 'Silky', '0.9718')
  await seedEvidence(
    matchId,
    runId,
    slotLobby,
    'player_number',
    7,
    '0.9807',
    'pre_game_lobby_state_2',
  )
  await seedEvidence(
    matchId,
    runId,
    slotLobby,
    'player_name_persona',
    'Hubert Jenkins',
    '0.9807',
    'pre_game_lobby_state_2',
  )

  await seedSnap({
    matchId,
    extractionId: loadoutX,
    slotKey: slotLoadout,
    gamertag: 'silkyjoker85',
    position: 'RW',
    teamSide: 'for',
    playerNumber: 10,
    playerNamePersona: 'Silky',
  })
  await seedSnap({
    matchId,
    extractionId: lobbyX,
    slotKey: slotLobby,
    gamertag: 'HenryTheBobJr', // the disagreeing gamertag — the trigger
    position: 'RW',
    teamSide: 'for',
    playerNumber: 7,
    playerNamePersona: 'Hubert Jenkins',
  })

  await consolidateLoadouts(matchId, { runId })

  const reviewed = await db
    .select({
      gamertag: playerLoadoutSnapshots.gamertagSnapshot,
      number: playerLoadoutSnapshots.playerNumber,
      persona: playerLoadoutSnapshots.playerNamePersona,
    })
    .from(playerLoadoutSnapshots)
    .where(
      and(
        eq(playerLoadoutSnapshots.matchId, matchId),
        eq(playerLoadoutSnapshots.reviewStatus, 'reviewed'),
      ),
    )
  assert.equal(reviewed.length, 1, 'exactly one (for, RW) anchor')
  assert.equal(
    reviewed[0]!.gamertag,
    'silkyjoker85',
    'gamertag must be the real player, not the bled HenryTheBobJr',
  )
  assert.equal(
    reviewed[0]!.number,
    10,
    'jersey number must be the loadout truth (#10), not the bled #7',
  )
  // resolvePersona → normalizeSnapshot uppercases the canonical string
  // (e.g. `E.Wanhg` → `E. WAHNG`), so the loadout truth `Silky` canonicalizes to
  // `SILKY`. Had the bled row won it would read `HUBERT JENKINS`; `SILKY` proves
  // the contaminant was gated out of the vote.
  assert.equal(
    reviewed[0]!.persona,
    'SILKY',
    'persona must be the loadout truth (SILKY), not the bled Hubert Jenkins',
  )
})
