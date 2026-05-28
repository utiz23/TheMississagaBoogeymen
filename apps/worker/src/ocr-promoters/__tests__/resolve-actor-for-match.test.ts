/**
 * Commit 1 — Match-scoped actor resolver.
 *
 * Wraps the existing global resolveGamertagToPlayer and filters its
 * output against the match's lineup (player_loadout_snapshots). The
 * test matrix mirrors the four resolver branches:
 *
 *   1. Global hit + player IN this match's lineup       → resolved
 *   2. Global hit + player NOT in lineup (the bug)      → roster_mismatch
 *   3. Global miss                                      → unresolved
 *   4. Lineup empty (zero rows)                         → empty_lineup_passthrough
 *   5. Lineup all-NULL player_id (opp-side only)        → empty_lineup_passthrough
 *   6. Mixed lineup, target IS in lineup                → resolved (different player)
 *   7. Null/empty snapshot                              → unresolved
 *
 * Test fixtures: use the first two real players from the DB so global
 * resolution succeeds via `gamertag_exact`. Sentinel match rows use
 * eaMatchId = `<SENTINEL_TAG>-<suffix>` for safe cleanup.
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/ocr-promoters/__tests__/resolve-actor-for-match.test.js
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  db,
  sql as rawSql,
  matches,
  players,
  ocrCaptureBatches,
  ocrExtractions,
  playerLoadoutSnapshots,
} from '@eanhl/db'
import { eq, like } from 'drizzle-orm'
import { resolveActorForMatch } from '../resolve-identity.js'

const GAME_TITLE_ID = 1 // NHL 26
const SENTINEL_TAG = 'C1-resolve-actor-for-match'

/**
 * Resolver signature is typed against PromoterDb (a transaction). Tests call
 * it with the top-level db handle, which is the same pattern used by
 * ingest-ocr-resolve-cli.ts:210 — cast at the boundary.
 */
const dbForResolver = db as unknown as Parameters<typeof resolveActorForMatch>[3]

// Track sentinel matches so the after() hook can sweep them even on failure.
const sentinelMatchIds: Set<number> = new Set()

async function cleanupMatch(matchId: number): Promise<void> {
  await db.delete(playerLoadoutSnapshots).where(eq(playerLoadoutSnapshots.matchId, matchId))
  await db.delete(ocrExtractions).where(eq(ocrExtractions.matchId, matchId))
  await db.delete(ocrCaptureBatches).where(eq(ocrCaptureBatches.matchId, matchId))
  await db.delete(matches).where(eq(matches.id, matchId))
}

async function cleanupAllSentinels(): Promise<void> {
  const stale = await db
    .select({ id: matches.id })
    .from(matches)
    .where(like(matches.eaMatchId, `${SENTINEL_TAG}%`))
  for (const m of stale) {
    await cleanupMatch(m.id)
  }
  sentinelMatchIds.clear()
}

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanupAllSentinels()
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  for (const matchId of Array.from(sentinelMatchIds)) {
    try {
      await cleanupMatch(matchId)
    } catch {
      // sweep will retry
    }
  }
  await cleanupAllSentinels()
  await rawSql.end()
})

interface SentinelMatch {
  matchId: number
  extractionId: number
}

/** Create a sentinel match plus a single batch + extraction so the FK on
 *  player_loadout_snapshots.ocr_extraction_id is satisfied when we seed
 *  lineup rows. */
async function createSentinelMatch(suffix: string): Promise<SentinelMatch> {
  const [m] = await db
    .insert(matches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      eaMatchId: `${SENTINEL_TAG}-${suffix}`,
      matchType: 'gameType5',
      opponentClubId: '99999',
      opponentName: 'C1 Sentinel Opp',
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

  const [b] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      matchId: m.id,
      sourceDirectory: `/tmp/${SENTINEL_TAG}/${suffix}`,
      captureKind: 'manual_screenshots',
      notes: `${SENTINEL_TAG}-${suffix}`,
    })
    .returning({ id: ocrCaptureBatches.id })
  assert.ok(b)

  const [x] = await db
    .insert(ocrExtractions)
    .values({
      batchId: b.id,
      matchId: m.id,
      screenType: 'player_loadout_view',
      sourcePath: `/tmp/${SENTINEL_TAG}/${suffix}/frame001.png`,
      rawResultJson: {},
      transformStatus: 'success',
    })
    .returning({ id: ocrExtractions.id })
  assert.ok(x)

  return { matchId: m.id, extractionId: x.id }
}

interface SeedSnapshotOpts {
  matchId: number
  extractionId: number
  playerId: number | null
  gamertagSnapshot: string
  position?: string
}

async function seedLineupSnapshot(opts: SeedSnapshotOpts): Promise<void> {
  await db.insert(playerLoadoutSnapshots).values({
    matchId: opts.matchId,
    ocrExtractionId: opts.extractionId,
    gameTitleId: GAME_TITLE_ID,
    playerId: opts.playerId,
    gamertagSnapshot: opts.gamertagSnapshot,
    position: opts.position ?? 'C',
  })
}

async function getTwoRealPlayers(): Promise<
  [{ id: number; gamertag: string }, { id: number; gamertag: string }]
> {
  const rows = await db
    .select({ id: players.id, gamertag: players.gamertag })
    .from(players)
    .limit(2)
  assert.ok(rows[0] && rows[1], 'DB must have at least two players for this test')
  return [rows[0]!, rows[1]!]
}

// ── 1. Global hit + player in lineup ─────────────────────────────────────────
void test('global hit + player in lineup → resolved', async () => {
  if (!process.env['DATABASE_URL']) return
  const [p1] = await getTwoRealPlayers()
  const m = await createSentinelMatch('global-hit-in-lineup')
  await seedLineupSnapshot({
    matchId: m.matchId,
    extractionId: m.extractionId,
    playerId: p1.id,
    gamertagSnapshot: p1.gamertag,
  })

  const result = await resolveActorForMatch(p1.gamertag, m.matchId, GAME_TITLE_ID, dbForResolver)
  assert.equal(result.playerId, p1.id)
  assert.equal(result.via, 'gamertag_exact')
  assert.equal(result.globalPlayerId, p1.id)
})

// ── 2. Global hit + player NOT in lineup (the bug) ──────────────────────────
void test('global hit + player NOT in lineup → roster_mismatch', async () => {
  if (!process.env['DATABASE_URL']) return
  const [p1, p2] = await getTwoRealPlayers()
  const m = await createSentinelMatch('global-hit-not-in-lineup')
  // Lineup contains ONLY p1; we ask the resolver about p2 (a globally
  // valid player, just not in this match).
  await seedLineupSnapshot({
    matchId: m.matchId,
    extractionId: m.extractionId,
    playerId: p1.id,
    gamertagSnapshot: p1.gamertag,
  })

  const result = await resolveActorForMatch(p2.gamertag, m.matchId, GAME_TITLE_ID, dbForResolver)
  assert.equal(result.playerId, null, 'wrong-roster hit should be nulled')
  assert.equal(result.via, 'roster_mismatch')
  assert.equal(
    result.globalPlayerId,
    p2.id,
    'globalPlayerId should preserve the pre-filter resolution for diagnostics',
  )
})

// ── 3. Global resolver returns null ─────────────────────────────────────────
void test('global resolver miss → unresolved (no roster gate applied)', async () => {
  if (!process.env['DATABASE_URL']) return
  const [p1] = await getTwoRealPlayers()
  const m = await createSentinelMatch('global-null')
  await seedLineupSnapshot({
    matchId: m.matchId,
    extractionId: m.extractionId,
    playerId: p1.id,
    gamertagSnapshot: p1.gamertag,
  })

  // String that won't match any gamertag / history / alias / fuzzy.
  const result = await resolveActorForMatch(
    'xyz123-unresolvable-garbage-z9q8',
    m.matchId,
    GAME_TITLE_ID,
    dbForResolver,
  )
  assert.equal(result.playerId, null)
  assert.equal(result.via, 'unresolved')
  assert.equal(result.globalPlayerId, null)
})

// ── 4. Empty lineup passthrough ─────────────────────────────────────────────
void test('empty lineup → passthrough with via=empty_lineup_passthrough', async () => {
  if (!process.env['DATABASE_URL']) return
  const [p1] = await getTwoRealPlayers()
  const m = await createSentinelMatch('empty-lineup')
  // No seed call — zero rows in player_loadout_snapshots for this match.

  const result = await resolveActorForMatch(p1.gamertag, m.matchId, GAME_TITLE_ID, dbForResolver)
  assert.equal(result.playerId, p1.id, 'passthrough should keep global resolver id')
  assert.equal(result.via, 'empty_lineup_passthrough')
  assert.equal(result.globalPlayerId, p1.id)
})

// ── 5. All-NULL-player_id lineup passthrough ───────────────────────────────
void test('lineup with all-NULL player_id rows → passthrough', async () => {
  if (!process.env['DATABASE_URL']) return
  const [p1] = await getTwoRealPlayers()
  const m = await createSentinelMatch('all-null-lineup')
  // Two opp-side snapshots: gamertag captured but no player_id resolved.
  await seedLineupSnapshot({
    matchId: m.matchId,
    extractionId: m.extractionId,
    playerId: null,
    gamertagSnapshot: 'OPP_UNKNOWN_A',
  })
  await seedLineupSnapshot({
    matchId: m.matchId,
    extractionId: m.extractionId,
    playerId: null,
    gamertagSnapshot: 'OPP_UNKNOWN_B',
  })

  const result = await resolveActorForMatch(p1.gamertag, m.matchId, GAME_TITLE_ID, dbForResolver)
  assert.equal(result.playerId, p1.id)
  assert.equal(result.via, 'empty_lineup_passthrough')
  assert.equal(result.globalPlayerId, p1.id)
})

// ── 6. Mixed lineup, target IS in lineup ────────────────────────────────────
void test('mixed lineup, asked-for player IS in lineup → resolved', async () => {
  if (!process.env['DATABASE_URL']) return
  const [p1, p2] = await getTwoRealPlayers()
  const m = await createSentinelMatch('mixed-lineup-target-in')
  await seedLineupSnapshot({
    matchId: m.matchId,
    extractionId: m.extractionId,
    playerId: p1.id,
    gamertagSnapshot: p1.gamertag,
  })
  await seedLineupSnapshot({
    matchId: m.matchId,
    extractionId: m.extractionId,
    playerId: p2.id,
    gamertagSnapshot: p2.gamertag,
    position: 'LW',
  })

  // Ask for p2 — should resolve cleanly because p2 IS in this lineup.
  const result = await resolveActorForMatch(p2.gamertag, m.matchId, GAME_TITLE_ID, dbForResolver)
  assert.equal(result.playerId, p2.id)
  assert.equal(result.via, 'gamertag_exact')
  assert.equal(result.globalPlayerId, p2.id)
})

// ── 7. Null/empty snapshot ─────────────────────────────────────────────────
void test('null/empty snapshot → unresolved (no DB lineup query)', async () => {
  if (!process.env['DATABASE_URL']) return
  const m = await createSentinelMatch('null-empty-snapshot')

  const empty = await resolveActorForMatch('', m.matchId, GAME_TITLE_ID, dbForResolver)
  assert.equal(empty.playerId, null)
  assert.equal(empty.via, 'unresolved')
  assert.equal(empty.globalPlayerId, null)

  const nullSnap = await resolveActorForMatch(null, m.matchId, GAME_TITLE_ID, dbForResolver)
  assert.equal(nullSnap.playerId, null)
  assert.equal(nullSnap.via, 'unresolved')
  assert.equal(nullSnap.globalPlayerId, null)

  const undefinedSnap = await resolveActorForMatch(
    undefined,
    m.matchId,
    GAME_TITLE_ID,
    dbForResolver,
  )
  assert.equal(undefinedSnap.playerId, null)
  assert.equal(undefinedSnap.via, 'unresolved')
  assert.equal(undefinedSnap.globalPlayerId, null)
})
