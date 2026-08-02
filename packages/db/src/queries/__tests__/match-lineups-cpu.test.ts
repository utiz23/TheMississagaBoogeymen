/**
 * Commit 5 of the CPU-goalie lineage fix — read-side regression suite.
 *
 * Four tests, all hitting a real local Postgres:
 *   1. CPU goalie row (is_cpu=true) never surfaces in the lineup result.
 *   2. Same gamertag on BGM + opp does not leak x-factors across sides.
 *   3. Same gamertag on BGM + opp does not leak attributes across sides.
 *   4. getPlayerLoadoutSnapshots excludes is_cpu=true rows.
 *
 * Sentinel match IDs 9101-9104 are scoped per-test. Each test isolates its
 * own match-id namespace; the after() hook deletes only those rows.
 *
 * Build + run:
 *   pnpm --filter @eanhl/db build
 *   set -a && source .env && set +a
 *   node --test packages/db/dist/queries/__tests__/match-lineups-cpu.test.js
 */

import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { inArray, eq } from 'drizzle-orm'
import {
  db,
  sql,
  matches,
  players,
  ocrCaptureBatches,
  ocrExtractions,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
} from '../../index.js'
import { getMatchLineups } from '../match-lineups.js'
import { getPlayerLoadoutSnapshots } from '../player-loadouts.js'

// game_title_id = 1 is NHL 26 (same convention as worker fixture seeder).
const GAME_TITLE_ID = 1

// Per-test sentinel match IDs. Distinct from the worker fixture seeder
// sentinels (9001-9003).
const SENTINEL_MATCH_IDS = [9101, 9102, 9103, 9104] as const

// Sentinel player ID for test 4 (getPlayerLoadoutSnapshots).
const SENTINEL_PLAYER_ID = 99201

// ── cleanup ───────────────────────────────────────────────────────────────────

async function cleanupSentinels(): Promise<void> {
  const matchIds = [...SENTINEL_MATCH_IDS]

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

  // Also catch the player-scoped snapshot rows from test 4 (matchId may be null).
  await db
    .delete(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.playerId, SENTINEL_PLAYER_ID))

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
  await db.delete(players).where(eq(players.id, SENTINEL_PLAYER_ID))
}

// ── seed helpers ──────────────────────────────────────────────────────────────

/** Insert a sentinel matches row. */
async function seedMatch(matchId: number): Promise<void> {
  await db.insert(matches).values({
    id: matchId,
    gameTitleId: GAME_TITLE_ID,
    eaMatchId: `test-sentinel-cpu-lineups-${matchId}`,
    matchType: 'gameType5',
    opponentClubId: '88888',
    opponentName: `cpu-lineups sentinel ${matchId}`,
    playedAt: new Date('2026-05-28T00:00:00Z'),
    result: 'WIN',
    scoreFor: 0,
    scoreAgainst: 0,
    shotsFor: 0,
    shotsAgainst: 0,
    hitsFor: 0,
    hitsAgainst: 0,
  })
}

/**
 * Insert a single OCR batch + extraction (one per match is enough — all
 * snapshots in a test share the same extraction so the raw-result-json /
 * screen-type lookups are trivial).
 */
async function seedBatchAndExtraction(matchId: number): Promise<number> {
  const [batchRow] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      matchId,
      sourceDirectory: `test-sentinel-cpu-lineups-${matchId}-dir`,
      captureKind: 'manual_screenshots',
      notes: `test-sentinel-cpu-lineups-${matchId}`,
    })
    .returning({ id: ocrCaptureBatches.id })
  if (!batchRow) throw new Error(`Failed to insert batch for match ${matchId}`)

  const [extractionRow] = await db
    .insert(ocrExtractions)
    .values({
      batchId: batchRow.id,
      matchId,
      screenType: 'player_loadout_view',
      sourcePath: `test-sentinel-cpu-lineups-${matchId}/seed.png`,
      sourceHash: `test-sentinel-cpu-lineups-${matchId}-hash`,
      rawResultJson: {},
      transformStatus: 'success',
      reviewStatus: 'reviewed',
    })
    .returning({ id: ocrExtractions.id })
  if (!extractionRow) throw new Error(`Failed to insert extraction for match ${matchId}`)

  return extractionRow.id
}

interface SnapshotSeed {
  gamertag: string
  teamSide: 'for' | 'against'
  position: string
  isCpu?: boolean
  /**
   * Optional jersey number. Defaults to a non-null sentinel (99) so the
   * row survives the `isEmptyRow` defensive guard inside getMatchLineups
   * (which drops rows with no build, no jersey, AND no x-factors).
   */
  playerNumber?: number | null
  xFactors?: Array<{
    slotIndex: number
    name: string
    tier: 'Elite' | 'All Star' | 'Specialist' | null
  }>
  attributes?: Array<{ key: string; value: number }>
}

async function insertSnapshot(
  matchId: number,
  extractionId: number,
  seed: SnapshotSeed,
): Promise<number> {
  const [row] = await db
    .insert(playerLoadoutSnapshots)
    .values({
      gamertagSnapshot: seed.gamertag,
      teamSide: seed.teamSide,
      position: seed.position,
      playerNumber: seed.playerNumber !== undefined ? seed.playerNumber : 99,
      gameTitleId: GAME_TITLE_ID,
      matchId,
      ocrExtractionId: extractionId,
      reviewStatus: 'reviewed',
      isCpu: seed.isCpu ?? false,
    })
    .returning({ id: playerLoadoutSnapshots.id })
  if (!row) throw new Error(`Failed to insert snapshot for gamertag ${seed.gamertag}`)

  if (seed.xFactors && seed.xFactors.length > 0) {
    await db.insert(playerLoadoutXFactors).values(
      seed.xFactors.map((xf) => ({
        loadoutSnapshotId: row.id,
        slotIndex: xf.slotIndex,
        xFactorName: xf.name,
        xFactorNameCanonical: xf.name,
        tier: xf.tier,
      })),
    )
  }

  if (seed.attributes && seed.attributes.length > 0) {
    await db.insert(playerLoadoutAttributes).values(
      seed.attributes.map((a) => ({
        loadoutSnapshotId: row.id,
        attributeKey: a.key,
        value: a.value,
      })),
    )
  }

  return row.id
}

// ── lifecycle ─────────────────────────────────────────────────────────────────

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanupSentinels()
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanupSentinels()
  await sql.end({ timeout: 5 })
})

// ── tests ─────────────────────────────────────────────────────────────────────

void test('cpu-goalie-no-row: 11 humans + 1 CPU goalie yields no G row in either side', async () => {
  if (!process.env['DATABASE_URL']) {
    return
  }

  const matchId = 9101
  await seedMatch(matchId)
  const extractionId = await seedBatchAndExtraction(matchId)

  // 5 BGM skaters + 5 opp skaters + 1 BGM real goalie + 1 opp CPU placeholder.
  const humanSeeds: SnapshotSeed[] = [
    { gamertag: 'bgm_center', teamSide: 'for', position: 'C' },
    { gamertag: 'bgm_lw', teamSide: 'for', position: 'LW' },
    { gamertag: 'bgm_rw', teamSide: 'for', position: 'RW' },
    { gamertag: 'bgm_ld', teamSide: 'for', position: 'LD' },
    { gamertag: 'bgm_rd', teamSide: 'for', position: 'RD' },
    { gamertag: 'bgm_goalie', teamSide: 'for', position: 'G' },
    { gamertag: 'opp_center', teamSide: 'against', position: 'C' },
    { gamertag: 'opp_lw', teamSide: 'against', position: 'LW' },
    { gamertag: 'opp_rw', teamSide: 'against', position: 'RW' },
    { gamertag: 'opp_ld', teamSide: 'against', position: 'LD' },
    { gamertag: 'opp_rd', teamSide: 'against', position: 'RD' },
  ]
  for (const seed of humanSeeds) {
    await insertSnapshot(matchId, extractionId, seed)
  }

  // CPU goalie placeholder on the opponent side.
  await insertSnapshot(matchId, extractionId, {
    gamertag: 'opp_cpu_goalie',
    teamSide: 'against',
    position: 'G',
    isCpu: true,
  })

  const lineups = await getMatchLineups(matchId)

  const bgmGoalies = lineups.bgm.filter((r) => r.position === 'G')
  const oppGoalies = lineups.opponent.filter((r) => r.position === 'G')

  // BGM goalie is a real human — it should still surface.
  assert.equal(bgmGoalies.length, 1, `expected 1 BGM goalie row, got ${bgmGoalies.length}`)
  assert.equal(bgmGoalies[0]!.gamertagSnapshot, 'bgm_goalie')

  // The CPU placeholder on the opp side must NOT surface.
  assert.equal(
    oppGoalies.length,
    0,
    `expected 0 opp goalie rows (CPU placeholder filtered), got ${oppGoalies.length}`,
  )
})

void test('cross-team-xf-isolation: same gamertag on both sides does not leak x-factors', async () => {
  if (!process.env['DATABASE_URL']) {
    return
  }

  const matchId = 9102
  await seedMatch(matchId)
  const extractionId = await seedBatchAndExtraction(matchId)

  // BGM C with three BGM-only x-factors.
  await insertSnapshot(matchId, extractionId, {
    gamertag: 'XZ4RKY',
    teamSide: 'for',
    position: 'C',
    xFactors: [
      { slotIndex: 0, name: 'Tape_to_Tape', tier: 'Elite' },
      { slotIndex: 1, name: 'BGM_XF_2', tier: 'All Star' },
      { slotIndex: 2, name: 'BGM_XF_3', tier: 'Specialist' },
    ],
  })

  // Opp C with the same gamertag but three DISTINCT x-factors.
  await insertSnapshot(matchId, extractionId, {
    gamertag: 'XZ4RKY',
    teamSide: 'against',
    position: 'C',
    xFactors: [
      { slotIndex: 0, name: 'OppDistinctXF1', tier: 'Elite' },
      { slotIndex: 1, name: 'OppDistinctXF2', tier: 'All Star' },
      { slotIndex: 2, name: 'OppDistinctXF3', tier: 'Specialist' },
    ],
  })

  const lineups = await getMatchLineups(matchId)

  const bgmC = lineups.bgm.find((r) => r.position === 'C')
  const oppC = lineups.opponent.find((r) => r.position === 'C')

  assert.ok(bgmC, 'expected BGM C row to exist')
  assert.ok(oppC, 'expected opp C row to exist')

  const bgmNames = bgmC!.xFactors.map((x) => x.canonicalName).sort()
  const oppNames = oppC!.xFactors.map((x) => x.canonicalName).sort()

  assert.deepEqual(
    bgmNames,
    ['BGM_XF_2', 'BGM_XF_3', 'Tape_to_Tape'],
    `expected BGM C to carry only the BGM x-factors, got ${JSON.stringify(bgmNames)}`,
  )
  assert.deepEqual(
    oppNames,
    ['OppDistinctXF1', 'OppDistinctXF2', 'OppDistinctXF3'],
    `expected opp C to carry only the opp x-factors, got ${JSON.stringify(oppNames)}`,
  )

  // Belt-and-suspenders: assert no opp name leaked into BGM and vice versa.
  for (const name of bgmNames) {
    assert.ok(
      !oppNames.includes(name),
      `BGM x-factor '${name}' must not appear in opp x-factor list`,
    )
  }
})

void test('cross-team-attrs-isolation: same gamertag on both sides does not leak attributes', async () => {
  if (!process.env['DATABASE_URL']) {
    return
  }

  const matchId = 9103
  await seedMatch(matchId)
  const extractionId = await seedBatchAndExtraction(matchId)

  await insertSnapshot(matchId, extractionId, {
    gamertag: 'XZ4RKY',
    teamSide: 'for',
    position: 'C',
    attributes: [
      { key: 'speed', value: 90 },
      { key: 'passing', value: 88 },
    ],
  })

  await insertSnapshot(matchId, extractionId, {
    gamertag: 'XZ4RKY',
    teamSide: 'against',
    position: 'C',
    attributes: [
      { key: 'speed', value: 70 },
      { key: 'passing', value: 65 },
    ],
  })

  const lineups = await getMatchLineups(matchId)

  const bgmC = lineups.bgm.find((r) => r.position === 'C')
  const oppC = lineups.opponent.find((r) => r.position === 'C')

  assert.ok(bgmC, 'expected BGM C row to exist')
  assert.ok(oppC, 'expected opp C row to exist')

  assert.deepEqual(
    bgmC!.attributes,
    { speed: { value: 90, delta: null }, passing: { value: 88, delta: null } },
    `expected BGM attributes {speed:90, passing:88}, got ${JSON.stringify(bgmC!.attributes)}`,
  )
  assert.deepEqual(
    oppC!.attributes,
    { speed: { value: 70, delta: null }, passing: { value: 65, delta: null } },
    `expected opp attributes {speed:70, passing:65}, got ${JSON.stringify(oppC!.attributes)}`,
  )
})

void test('getPlayerLoadoutSnapshots excludes is_cpu=true rows', async () => {
  if (!process.env['DATABASE_URL']) {
    return
  }

  const matchId = 9104
  await seedMatch(matchId)
  const extractionId = await seedBatchAndExtraction(matchId)

  // Insert a sentinel player so we can scope the query to it.
  await db
    .insert(players)
    .values({ id: SENTINEL_PLAYER_ID, gamertag: 'test-cpu-lineup-player' })
    .onConflictDoNothing()

  // Human snapshot for this player.
  const [humanRow] = await db
    .insert(playerLoadoutSnapshots)
    .values({
      gamertagSnapshot: 'test-cpu-lineup-player',
      teamSide: 'for',
      position: 'C',
      gameTitleId: GAME_TITLE_ID,
      matchId,
      playerId: SENTINEL_PLAYER_ID,
      ocrExtractionId: extractionId,
      reviewStatus: 'reviewed',
      isCpu: false,
    })
    .returning({ id: playerLoadoutSnapshots.id })
  assert.ok(humanRow, 'expected human snapshot insert')

  // Contrived CPU snapshot pinned to the same playerId — should never happen
  // in production (lobby-v2 promoter sets playerId=null on CPU rows) but the
  // explicit filter must defend against it.
  await db.insert(playerLoadoutSnapshots).values({
    gamertagSnapshot: 'CPU_placeholder',
    teamSide: 'for',
    position: 'G',
    gameTitleId: GAME_TITLE_ID,
    matchId,
    playerId: SENTINEL_PLAYER_ID,
    ocrExtractionId: extractionId,
    reviewStatus: 'reviewed',
    isCpu: true,
  })

  const result = await getPlayerLoadoutSnapshots(SENTINEL_PLAYER_ID)

  assert.equal(
    result.length,
    1,
    `expected exactly 1 human snapshot, got ${result.length} (CPU row not filtered?)`,
  )
  assert.equal(result[0]!.id, humanRow!.id, 'expected the human snapshot to be the surviving row')
  assert.equal(result[0]!.isCpu, false)
})
