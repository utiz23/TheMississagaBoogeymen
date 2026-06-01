/**
 * Task 2A-13a — getExpectedSlotsForMatch integration tests.
 *
 * Tests the authority chain implemented in
 * packages/db/src/queries/expected-roster.ts:
 *   1. player_match_stats + opponent_player_match_stats (primary authority)
 *   2. [] when neither has rows (no blocking)
 *
 * Sentinel match IDs 9001–9004 are used to avoid colliding with real data.
 * Sentinel rows reference real player IDs (1, 2, 3, 4, 5) and real match
 * FK by inserting temporary match rows with ea_match_id 'test-sentinel-9001'
 * etc., cleaned up in after().
 *
 * Requires DATABASE_URL pointing at the eanhl DB with migrations up to date.
 *
 * Run via:
 *   pnpm --filter @eanhl/db build && \
 *   pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/expected-roster.test.js
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { db, sql, matches, playerMatchStats, opponentPlayerMatchStats } from '@eanhl/db'
import { inArray, eq } from 'drizzle-orm'
import { getExpectedSlotsForMatch, type ExpectedSlot } from '@eanhl/db/queries'

// ── Sentinel identifiers ──────────────────────────────────────────────────────

const SENTINEL_EA_MATCH_IDS = [
  'test-sentinel-9001',
  'test-sentinel-9002',
  'test-sentinel-9003',
  'test-sentinel-9004',
] as const

// We'll store the inserted match row IDs after before() runs.
let sentinelMatchIds: number[] = []

// Real player IDs to use as FK targets in player_match_stats.
// These IDs are guaranteed to exist in the players table (ids 1–5).
const PLAYER_IDS = [1, 2, 3, 4, 5] as const

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Insert a minimal sentinel match row and return its surrogate id. */
async function insertSentinelMatch(eaMatchId: string): Promise<number> {
  const [row] = await db
    .insert(matches)
    .values({
      gameTitleId: 1,
      eaMatchId,
      matchType: 'gameType5',
      opponentClubId: '99999',
      opponentName: 'Sentinel Opponent',
      playedAt: new Date('2020-01-01T00:00:00Z'),
      result: 'WIN',
      scoreFor: 1,
      scoreAgainst: 0,
      shotsFor: 10,
      shotsAgainst: 5,
      hitsFor: 5,
      hitsAgainst: 3,
    })
    .returning({ id: matches.id })
  if (!row) throw new Error(`Failed to insert sentinel match ${eaMatchId}`)
  return row.id
}

/** Clean up all sentinel rows in FK-safe order. */
async function cleanup(): Promise<void> {
  if (sentinelMatchIds.length === 0) return
  await db.delete(playerMatchStats).where(inArray(playerMatchStats.matchId, sentinelMatchIds))
  await db
    .delete(opponentPlayerMatchStats)
    .where(inArray(opponentPlayerMatchStats.matchId, sentinelMatchIds))
  await db.delete(matches).where(inArray(matches.id, sentinelMatchIds))
  sentinelMatchIds = []
}

// ── Test lifecycle ─────────────────────────────────────────────────────────────

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanup() // clear any stale leftover from a previous interrupted run
  sentinelMatchIds = await Promise.all(SENTINEL_EA_MATCH_IDS.map(insertSentinelMatch))
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanup()
  await sql.end({ timeout: 5 })
})

// ── Tests ─────────────────────────────────────────────────────────────────────

void test('test_returns_pairs_when_authoritative_table_populated', async () => {
  if (!process.env['DATABASE_URL']) {
    console.warn('[expected-roster] DATABASE_URL not set; skipping')
    return
  }

  // sentinelMatchIds[0] = 9001-equivalent
  const matchId = sentinelMatchIds[0]!

  // Seed a full 5-player BGM side (C, LW, RW, LD, RD) + 5-player opp side.
  const bgmPositions: Array<{ playerId: number; position: string }> = [
    { playerId: PLAYER_IDS[0], position: 'center' },
    { playerId: PLAYER_IDS[1], position: 'leftWing' },
    { playerId: PLAYER_IDS[2], position: 'rightWing' },
    { playerId: PLAYER_IDS[3], position: 'defenseMen' },
    { playerId: PLAYER_IDS[4], position: 'defenseMen' },
  ]
  await db.insert(playerMatchStats).values(
    bgmPositions.map(({ playerId, position }) => ({
      matchId,
      playerId,
      position,
      isGoalie: false,
      teamSide: 1, // away
    })),
  )
  await db.insert(opponentPlayerMatchStats).values([
    {
      matchId,
      eaPlayerId: 'opp-1',
      opponentClubId: '99999',
      gamertag: 'OppPlayer1',
      position: 'center',
      isGoalie: false,
    },
    {
      matchId,
      eaPlayerId: 'opp-2',
      opponentClubId: '99999',
      gamertag: 'OppPlayer2',
      position: 'leftWing',
      isGoalie: false,
    },
    {
      matchId,
      eaPlayerId: 'opp-3',
      opponentClubId: '99999',
      gamertag: 'OppPlayer3',
      position: 'rightWing',
      isGoalie: false,
    },
    {
      matchId,
      eaPlayerId: 'opp-4',
      opponentClubId: '99999',
      gamertag: 'OppPlayer4',
      position: 'defenseMen',
      isGoalie: false,
    },
    {
      matchId,
      eaPlayerId: 'opp-5',
      opponentClubId: '99999',
      gamertag: 'OppPlayer5',
      position: 'defenseMen',
      isGoalie: false,
    },
  ])

  const slots = await getExpectedSlotsForMatch(matchId)

  assert.equal(slots.length, 10, 'should return 10 pairs (5 BGM + 5 opp)')

  const forSlots = slots.filter((s) => s.teamSide === 'for')
  const againstSlots = slots.filter((s) => s.teamSide === 'against')
  assert.equal(forSlots.length, 5, '5 for-side slots')
  assert.equal(againstSlots.length, 5, '5 against-side slots')

  // Verify all expected positions appear on the for side.
  const forPositions = new Set(forSlots.map((s) => s.position))
  assert.ok(forPositions.has('C'), 'for-side should have C')
  assert.ok(forPositions.has('LW'), 'for-side should have LW')
  assert.ok(forPositions.has('RW'), 'for-side should have RW')
  assert.ok(forPositions.has('LD'), 'for-side should have LD')
  assert.ok(forPositions.has('RD'), 'for-side should have RD')

  // Both defenseMen map to LD + RD (not two LDs).
  const forLd = forSlots.filter((s) => s.position === 'LD')
  const forRd = forSlots.filter((s) => s.position === 'RD')
  assert.equal(forLd.length, 1, 'exactly one LD')
  assert.equal(forRd.length, 1, 'exactly one RD')

  // Same shape for against.
  const againstPositions = new Set(againstSlots.map((s) => s.position))
  assert.ok(againstPositions.has('C'), 'against-side should have C')
  assert.ok(againstPositions.has('LD'), 'against-side should have LD')
  assert.ok(againstPositions.has('RD'), 'against-side should have RD')
})

void test('test_falls_back_to_player_match_stats_when_lineups_empty', async () => {
  if (!process.env['DATABASE_URL']) return

  // sentinelMatchIds[1] = 9002-equivalent.
  // "Lineups" = no dedicated lineup table, so this test verifies that
  // opponent_player_match_stats rows alone (with no BGM player_match_stats)
  // still yield the opponent side slots.
  const matchId = sentinelMatchIds[1]!

  // Only seed opponent side — BGM side is empty.
  await db.insert(opponentPlayerMatchStats).values([
    {
      matchId,
      eaPlayerId: 'opp-a',
      opponentClubId: '99999',
      gamertag: 'OppA',
      position: 'center',
      isGoalie: false,
    },
    {
      matchId,
      eaPlayerId: 'opp-b',
      opponentClubId: '99999',
      gamertag: 'OppB',
      position: 'leftWing',
      isGoalie: false,
    },
    {
      matchId,
      eaPlayerId: 'opp-c',
      opponentClubId: '99999',
      gamertag: 'OppC',
      position: 'defenseMen',
      isGoalie: false,
    },
  ])

  const slots = await getExpectedSlotsForMatch(matchId)

  assert.ok(slots.length > 0, 'should return slots when only opponent side has data')
  const againstSlots = slots.filter((s) => s.teamSide === 'against')
  assert.equal(againstSlots.length, 3, 'three against-side slots from opp rows')

  const forSlots = slots.filter((s) => s.teamSide === 'for')
  assert.equal(forSlots.length, 0, 'no for-side slots when BGM stats are absent')

  const againstPositions = againstSlots.map((s) => s.position).sort()
  assert.deepEqual(againstPositions, ['C', 'LD', 'LW'], 'correct mapped positions')
})

void test('test_returns_empty_when_no_authority_available', async () => {
  if (!process.env['DATABASE_URL']) return

  // sentinelMatchIds[2] = 9003-equivalent.
  // No player stats seeded for this match at all.
  const matchId = sentinelMatchIds[2]!

  const slots = await getExpectedSlotsForMatch(matchId)

  assert.deepEqual(slots, [], 'should return [] when neither table has rows')
})

void test('test_handles_partial_lineup', async () => {
  if (!process.env['DATABASE_URL']) return

  // sentinelMatchIds[3] = 9004-equivalent.
  // Seed 3 of 5 BGM players and 3 of 5 opp players (simulates mid-game DNFs
  // or partial ingest). Function must return those 6 pairs, not synthesize the
  // missing ones.
  const matchId = sentinelMatchIds[3]!

  await db.insert(playerMatchStats).values([
    { matchId, playerId: PLAYER_IDS[0], position: 'center', isGoalie: false, teamSide: 0 },
    { matchId, playerId: PLAYER_IDS[1], position: 'leftWing', isGoalie: false, teamSide: 0 },
    { matchId, playerId: PLAYER_IDS[2], position: 'defenseMen', isGoalie: false, teamSide: 0 },
  ])
  await db.insert(opponentPlayerMatchStats).values([
    {
      matchId,
      eaPlayerId: 'opp-p1',
      opponentClubId: '99999',
      gamertag: 'Partial1',
      position: 'center',
      isGoalie: false,
    },
    {
      matchId,
      eaPlayerId: 'opp-p2',
      opponentClubId: '99999',
      gamertag: 'Partial2',
      position: 'rightWing',
      isGoalie: false,
    },
    {
      matchId,
      eaPlayerId: 'opp-p3',
      opponentClubId: '99999',
      gamertag: 'Partial3',
      position: 'goalie',
      isGoalie: true,
    },
  ])

  const slots = await getExpectedSlotsForMatch(matchId)

  assert.equal(slots.length, 6, 'returns exactly the 6 seeded slots, no synthesis')

  const forSlots = slots.filter((s) => s.teamSide === 'for')
  assert.equal(forSlots.length, 3, '3 for-side slots')
  const forPositions = forSlots.map((s) => s.position).sort()
  assert.deepEqual(forPositions, ['C', 'LD', 'LW'], 'correct partial for-side positions')

  const againstSlots = slots.filter((s) => s.teamSide === 'against')
  assert.equal(againstSlots.length, 3, '3 against-side slots')
  const againstPositions = againstSlots.map((s) => s.position).sort()
  assert.deepEqual(againstPositions, ['C', 'G', 'RW'], 'correct partial against-side positions')
})
