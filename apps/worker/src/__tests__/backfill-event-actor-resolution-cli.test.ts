/**
 * Commit 2 — backfill-event-actor-resolution CLI.
 *
 * Re-resolves actor_player_id / target_player_id on existing match_events
 * (and the symmetric FKs on match_goal_events / match_penalty_events)
 * using the new match-scoped resolveActorForMatch.
 *
 * Test matrix:
 *   1. wrong-roster-nulled        — actor_player_id=99 (player 99 NOT in
 *                                   lineup) → after backfill, NULL.
 *   2. previously-null-now-bound  — actor_gamertag matches player 42 (in
 *                                   lineup), actor_player_id=NULL → bound.
 *   3. correctly-resolved-unchanged — actor matches, player in lineup,
 *                                   actor_player_id already correct → no-op.
 *   4. idempotent                 — second run reports 0 changes.
 *   5. dry-run-no-writes          — counters reflect deltas, DB unchanged.
 *   6. goal-event-symmetry        — match_goal_events.scorer_player_id=99
 *                                   (wrong roster) → nulled, goal_changes=1.
 *   7. target-symmetry            — match_events.target_player_id=99 (wrong
 *                                   roster) → nulled, target_nulled=1.
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/backfill-event-actor-resolution-cli.test.js
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import {
  db,
  sql as rawSql,
  matches,
  players,
  matchEvents,
  matchGoalEvents,
  matchPenaltyEvents,
  ocrCaptureBatches,
  ocrExtractions,
  playerLoadoutSnapshots,
} from '@eanhl/db'
import { eq, inArray, like } from 'drizzle-orm'

const GAME_TITLE_ID = 1 // NHL 26
const SENTINEL_MATCH_TAG = 'test-sentinel-backfill'
const SENTINEL_PLAYER_TAG = 'test-sentinel-backfill-player'

const REPO_ROOT = path.resolve(process.cwd())
const CLI_PATH = path.resolve(REPO_ROOT, 'apps/worker/dist/backfill-event-actor-resolution-cli.js')

const sentinelMatchIds: Set<number> = new Set()
const sentinelPlayerIds: Set<number> = new Set()

async function cleanupMatch(matchId: number): Promise<void> {
  // Delete from FK-leaf tables first.
  const eventIds = (
    await db
      .select({ id: matchEvents.id })
      .from(matchEvents)
      .where(eq(matchEvents.matchId, matchId))
  ).map((r) => r.id)
  if (eventIds.length > 0) {
    await db.delete(matchGoalEvents).where(inArray(matchGoalEvents.eventId, eventIds))
    await db.delete(matchPenaltyEvents).where(inArray(matchPenaltyEvents.eventId, eventIds))
    await db.delete(matchEvents).where(inArray(matchEvents.id, eventIds))
  }
  await db.delete(playerLoadoutSnapshots).where(eq(playerLoadoutSnapshots.matchId, matchId))
  await db.delete(ocrExtractions).where(eq(ocrExtractions.matchId, matchId))
  await db.delete(ocrCaptureBatches).where(eq(ocrCaptureBatches.matchId, matchId))
  await db.delete(matches).where(eq(matches.id, matchId))
}

async function cleanupAllSentinels(): Promise<void> {
  const stale = await db
    .select({ id: matches.id })
    .from(matches)
    .where(like(matches.eaMatchId, `${SENTINEL_MATCH_TAG}-%`))
  for (const m of stale) {
    await cleanupMatch(m.id)
  }
  sentinelMatchIds.clear()
  // Sweep sentinel players (no FKs to cleanup beyond match_events, which
  // were already removed above).
  const staleP = await db
    .select({ id: players.id })
    .from(players)
    .where(like(players.gamertag, `${SENTINEL_PLAYER_TAG}-%`))
  for (const p of staleP) {
    try {
      await db.delete(players).where(eq(players.id, p.id))
    } catch {
      // FK from some other path — leave it; will retry on next sweep.
    }
  }
  sentinelPlayerIds.clear()
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
      // sweep retries
    }
  }
  for (const playerId of Array.from(sentinelPlayerIds)) {
    try {
      await db.delete(players).where(eq(players.id, playerId))
    } catch {
      // ignore
    }
  }
  await cleanupAllSentinels()
  await rawSql.end({ timeout: 5 })
})

interface SentinelMatch {
  matchId: number
  extractionId: number
}

async function createSentinelMatch(suffix: string): Promise<SentinelMatch> {
  const [m] = await db
    .insert(matches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      eaMatchId: `${SENTINEL_MATCH_TAG}-${suffix}`,
      matchType: 'gameType5',
      opponentClubId: '99999',
      opponentName: 'C2 Sentinel Opp',
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
      sourceDirectory: `/tmp/${SENTINEL_MATCH_TAG}/${suffix}`,
      captureKind: 'manual_screenshots',
      notes: `${SENTINEL_MATCH_TAG}-${suffix}`,
    })
    .returning({ id: ocrCaptureBatches.id })
  assert.ok(b)

  const [x] = await db
    .insert(ocrExtractions)
    .values({
      batchId: b.id,
      matchId: m.id,
      screenType: 'player_loadout_view',
      sourcePath: `/tmp/${SENTINEL_MATCH_TAG}/${suffix}/frame001.png`,
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

interface SeedEventOpts {
  matchId: number
  extractionId: number
  actorPlayerId: number | null
  actorGamertagSnapshot: string | null
  targetPlayerId?: number | null
  targetGamertagSnapshot?: string | null
  eventType?: 'goal' | 'shot' | 'hit' | 'penalty' | 'faceoff'
}

async function seedEvent(opts: SeedEventOpts): Promise<number> {
  const [row] = await db
    .insert(matchEvents)
    .values({
      matchId: opts.matchId,
      periodNumber: 1,
      periodLabel: 'P1',
      clock: '5:00',
      eventType: opts.eventType ?? 'shot',
      teamSide: 'for',
      teamAbbreviation: 'BGM',
      actorPlayerId: opts.actorPlayerId,
      actorGamertagSnapshot: opts.actorGamertagSnapshot,
      targetPlayerId: opts.targetPlayerId ?? null,
      targetGamertagSnapshot: opts.targetGamertagSnapshot ?? null,
      source: 'ocr',
      ocrExtractionId: opts.extractionId,
      reviewStatus: 'pending_review',
    })
    .returning({ id: matchEvents.id })
  assert.ok(row)
  return row.id
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

/**
 * Insert a sentinel player whose gamertag definitely won't appear in any
 * sentinel match's lineup. Used as the "globally-resolvable, not-rostered"
 * actor in the wrong-roster tests.
 */
async function insertSentinelPlayer(suffix: string): Promise<{
  id: number
  gamertag: string
}> {
  const gamertag = `${SENTINEL_PLAYER_TAG}-${suffix}-${Date.now()}`
  const [row] = await db
    .insert(players)
    .values({
      gamertag,
      isActive: true,
    })
    .returning({ id: players.id, gamertag: players.gamertag })
  assert.ok(row)
  sentinelPlayerIds.add(row.id)
  return row
}

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
}

function runCli(args: string[]): CliResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env },
    encoding: 'utf8',
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function parseLastJson<T>(stdout: string): T {
  const lastLine = stdout
    .trim()
    .split('\n')
    .filter((l) => l.startsWith('{'))
    .pop()
  assert.ok(lastLine, `expected JSON on stdout, got: ${stdout}`)
  return JSON.parse(lastLine) as T
}

interface CounterPayload {
  match_id: number
  actor_changes: number
  actor_nulled: number
  actor_bound: number
  target_changes: number
  target_nulled: number
  target_bound: number
  goal_changes: number
  penalty_changes: number
}

// ── 1. wrong-roster-nulled ───────────────────────────────────────────────
void test('wrong-roster actor_player_id is nulled by backfill', async () => {
  if (!process.env['DATABASE_URL']) return
  const [pInLineup] = await getTwoRealPlayers()
  const ghost = await insertSentinelPlayer('wrong-roster-nulled')
  const m = await createSentinelMatch('wrong-roster-nulled')

  // Lineup has the real player only — ghost is NOT in lineup.
  await seedLineupSnapshot({
    matchId: m.matchId,
    extractionId: m.extractionId,
    playerId: pInLineup.id,
    gamertagSnapshot: pInLineup.gamertag,
  })

  // Event has actorPlayerId set to the ghost (globally resolvable but
  // not in this match's roster) and gamertag_snapshot matching the ghost.
  const eventId = await seedEvent({
    matchId: m.matchId,
    extractionId: m.extractionId,
    actorPlayerId: ghost.id,
    actorGamertagSnapshot: ghost.gamertag,
  })

  const result = runCli(['--match', String(m.matchId)])
  assert.equal(
    result.status,
    0,
    `expected exit 0; stderr: ${result.stderr}; stdout: ${result.stdout}`,
  )
  const payload = parseLastJson<CounterPayload>(result.stdout)
  assert.equal(payload.match_id, m.matchId)
  assert.equal(payload.actor_changes, 1)
  assert.equal(payload.actor_nulled, 1)
  assert.equal(payload.actor_bound, 0)

  // DB should reflect the null.
  const [row] = await db
    .select({ actorPlayerId: matchEvents.actorPlayerId })
    .from(matchEvents)
    .where(eq(matchEvents.id, eventId))
  assert.equal(row?.actorPlayerId, null, 'wrong-roster actor should be nulled')
})

// ── 2. previously-null-now-bound ─────────────────────────────────────────
void test('previously-null actor binds to player when alias now in lineup', async () => {
  if (!process.env['DATABASE_URL']) return
  const [pInLineup] = await getTwoRealPlayers()
  const m = await createSentinelMatch('null-now-bound')

  await seedLineupSnapshot({
    matchId: m.matchId,
    extractionId: m.extractionId,
    playerId: pInLineup.id,
    gamertagSnapshot: pInLineup.gamertag,
  })

  // Event with NULL actor_player_id but snapshot that matches the rostered player.
  const eventId = await seedEvent({
    matchId: m.matchId,
    extractionId: m.extractionId,
    actorPlayerId: null,
    actorGamertagSnapshot: pInLineup.gamertag,
  })

  const result = runCli(['--match', String(m.matchId)])
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  const payload = parseLastJson<CounterPayload>(result.stdout)
  assert.equal(payload.actor_changes, 1)
  assert.equal(payload.actor_nulled, 0)
  assert.equal(payload.actor_bound, 1)

  const [row] = await db
    .select({ actorPlayerId: matchEvents.actorPlayerId })
    .from(matchEvents)
    .where(eq(matchEvents.id, eventId))
  assert.equal(row?.actorPlayerId, pInLineup.id, 'actor should bind to in-lineup player')
})

// ── 3. correctly-resolved-unchanged ──────────────────────────────────────
void test('correctly-resolved actor is unchanged (0 changes)', async () => {
  if (!process.env['DATABASE_URL']) return
  const [pInLineup] = await getTwoRealPlayers()
  const m = await createSentinelMatch('correct-unchanged')

  await seedLineupSnapshot({
    matchId: m.matchId,
    extractionId: m.extractionId,
    playerId: pInLineup.id,
    gamertagSnapshot: pInLineup.gamertag,
  })

  const eventId = await seedEvent({
    matchId: m.matchId,
    extractionId: m.extractionId,
    actorPlayerId: pInLineup.id,
    actorGamertagSnapshot: pInLineup.gamertag,
  })

  const result = runCli(['--match', String(m.matchId)])
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  const payload = parseLastJson<CounterPayload>(result.stdout)
  assert.equal(payload.actor_changes, 0)
  assert.equal(payload.actor_nulled, 0)
  assert.equal(payload.actor_bound, 0)
  assert.equal(payload.target_changes, 0)

  const [row] = await db
    .select({ actorPlayerId: matchEvents.actorPlayerId })
    .from(matchEvents)
    .where(eq(matchEvents.id, eventId))
  assert.equal(row?.actorPlayerId, pInLineup.id, 'actor should remain unchanged')
})

// ── 4. idempotent ────────────────────────────────────────────────────────
void test('second run is a no-op (idempotent)', async () => {
  if (!process.env['DATABASE_URL']) return
  const [pInLineup] = await getTwoRealPlayers()
  const ghost = await insertSentinelPlayer('idempotent')
  const m = await createSentinelMatch('idempotent')

  await seedLineupSnapshot({
    matchId: m.matchId,
    extractionId: m.extractionId,
    playerId: pInLineup.id,
    gamertagSnapshot: pInLineup.gamertag,
  })

  // Wrong-roster event — first run should null it.
  await seedEvent({
    matchId: m.matchId,
    extractionId: m.extractionId,
    actorPlayerId: ghost.id,
    actorGamertagSnapshot: ghost.gamertag,
  })

  const first = runCli(['--match', String(m.matchId)])
  assert.equal(first.status, 0)
  const p1 = parseLastJson<CounterPayload>(first.stdout)
  assert.equal(p1.actor_changes, 1, 'first run should null the wrong-roster actor')

  const second = runCli(['--match', String(m.matchId)])
  assert.equal(second.status, 0)
  const p2 = parseLastJson<CounterPayload>(second.stdout)
  assert.equal(p2.actor_changes, 0, 'second run should be a no-op')
  assert.equal(p2.actor_nulled, 0)
  assert.equal(p2.actor_bound, 0)
  assert.equal(p2.target_changes, 0)
  assert.equal(p2.goal_changes, 0)
  assert.equal(p2.penalty_changes, 0)
})

// ── 5. dry-run-no-writes ─────────────────────────────────────────────────
void test('--dry-run reports counters but does not write', async () => {
  if (!process.env['DATABASE_URL']) return
  const [pInLineup] = await getTwoRealPlayers()
  const ghost = await insertSentinelPlayer('dry-run')
  const m = await createSentinelMatch('dry-run')

  await seedLineupSnapshot({
    matchId: m.matchId,
    extractionId: m.extractionId,
    playerId: pInLineup.id,
    gamertagSnapshot: pInLineup.gamertag,
  })

  const eventId = await seedEvent({
    matchId: m.matchId,
    extractionId: m.extractionId,
    actorPlayerId: ghost.id,
    actorGamertagSnapshot: ghost.gamertag,
  })

  const result = runCli(['--match', String(m.matchId), '--dry-run'])
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  const payload = parseLastJson<CounterPayload>(result.stdout)
  assert.equal(payload.actor_nulled, 1, 'dry-run should still count the would-null')

  // DB should NOT have been written.
  const [row] = await db
    .select({ actorPlayerId: matchEvents.actorPlayerId })
    .from(matchEvents)
    .where(eq(matchEvents.id, eventId))
  assert.equal(row?.actorPlayerId, ghost.id, 'dry-run must not write — actor_player_id still ghost')
})

// ── 6. goal-event-symmetry ───────────────────────────────────────────────
void test('match_goal_events scorer_player_id symmetric backfill', async () => {
  if (!process.env['DATABASE_URL']) return
  const [pInLineup] = await getTwoRealPlayers()
  const ghost = await insertSentinelPlayer('goal-symmetry')
  const m = await createSentinelMatch('goal-symmetry')

  await seedLineupSnapshot({
    matchId: m.matchId,
    extractionId: m.extractionId,
    playerId: pInLineup.id,
    gamertagSnapshot: pInLineup.gamertag,
  })

  // Parent match_event: also wrong-roster (actor = ghost).
  const eventId = await seedEvent({
    matchId: m.matchId,
    extractionId: m.extractionId,
    actorPlayerId: ghost.id,
    actorGamertagSnapshot: ghost.gamertag,
    eventType: 'goal',
  })
  // Goal extension row with the same wrong-roster scorer.
  await db.insert(matchGoalEvents).values({
    eventId,
    scorerPlayerId: ghost.id,
    scorerSnapshot: ghost.gamertag,
  })

  const result = runCli(['--match', String(m.matchId)])
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  const payload = parseLastJson<CounterPayload>(result.stdout)
  assert.equal(payload.goal_changes, 1, 'goal_changes should report 1')

  const [row] = await db
    .select({ scorerPlayerId: matchGoalEvents.scorerPlayerId })
    .from(matchGoalEvents)
    .where(eq(matchGoalEvents.eventId, eventId))
  assert.equal(
    row?.scorerPlayerId,
    null,
    'wrong-roster scorer should be nulled on match_goal_events',
  )
})

// ── 7. target-symmetry ───────────────────────────────────────────────────
void test('match_events target_player_id symmetric backfill', async () => {
  if (!process.env['DATABASE_URL']) return
  const [pInLineup] = await getTwoRealPlayers()
  const ghost = await insertSentinelPlayer('target-symmetry')
  const m = await createSentinelMatch('target-symmetry')

  await seedLineupSnapshot({
    matchId: m.matchId,
    extractionId: m.extractionId,
    playerId: pInLineup.id,
    gamertagSnapshot: pInLineup.gamertag,
  })

  // Actor is correct (in-lineup). Target is wrong-roster.
  const eventId = await seedEvent({
    matchId: m.matchId,
    extractionId: m.extractionId,
    actorPlayerId: pInLineup.id,
    actorGamertagSnapshot: pInLineup.gamertag,
    targetPlayerId: ghost.id,
    targetGamertagSnapshot: ghost.gamertag,
    eventType: 'hit',
  })

  const result = runCli(['--match', String(m.matchId)])
  assert.equal(result.status, 0, `stderr: ${result.stderr}`)
  const payload = parseLastJson<CounterPayload>(result.stdout)
  assert.equal(payload.actor_changes, 0, 'actor (in-lineup) should be unchanged')
  assert.equal(payload.target_changes, 1)
  assert.equal(payload.target_nulled, 1)
  assert.equal(payload.target_bound, 0)

  const [row] = await db
    .select({ targetPlayerId: matchEvents.targetPlayerId })
    .from(matchEvents)
    .where(eq(matchEvents.id, eventId))
  assert.equal(row?.targetPlayerId, null, 'wrong-roster target should be nulled')
})
