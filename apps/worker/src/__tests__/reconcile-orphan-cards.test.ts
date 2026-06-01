/**
 * Tests for resolveOrphanCard + deriveTeamSide — the WS4 Stage 2a layer that
 * turns a RAW orphan card (emitted by reconcile_action_tracker.py) into a
 * resolved IdentityProposal (player ids + team_side resolved against the match
 * roster, reusing the live promoter's resolver).
 *
 * DB-backed (resolveOrphanCard resolves against player_loadout_snapshots),
 * guarded by DATABASE_URL. Uses dedicated sentinel matches (eaMatchId prefixed)
 * with a seeded lineup — mirrors resolve-actor-for-match.test.ts.
 *
 * Run via: pnpm --filter @eanhl/worker test reconcile-orphan-cards
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
import { resolveOrphanCard, type RawOrphanCard } from '../reconcile-positions.js'
import { deriveTeamSide } from '../ocr-promoters/resolve-identity.js'

const GAME_TITLE_ID = 1
const SENTINEL_TAG = 'ws4-orphan-test'
const dbForResolver = db as unknown as Parameters<typeof resolveOrphanCard>[3]
const sentinelMatchIds = new Set<number>()

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
  for (const m of stale) await cleanupMatch(m.id)
  sentinelMatchIds.clear()
}

async function createSentinelMatch(suffix: string): Promise<{ matchId: number; extractionId: number }> {
  const [m] = await db
    .insert(matches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      eaMatchId: `${SENTINEL_TAG}-${suffix}`,
      matchType: 'gameType5',
      opponentClubId: '99999',
      opponentName: 'WS4 Orphan Opp',
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
      sourcePath: `/tmp/${SENTINEL_TAG}/${suffix}/f.png`,
      rawResultJson: {},
      transformStatus: 'success',
    })
    .returning({ id: ocrExtractions.id })
  assert.ok(x)
  return { matchId: m.id, extractionId: x.id }
}

async function seedLineup(matchId: number, extractionId: number, playerId: number, gamertag: string) {
  await db.insert(playerLoadoutSnapshots).values({
    matchId,
    ocrExtractionId: extractionId,
    gameTitleId: GAME_TITLE_ID,
    playerId,
    gamertagSnapshot: gamertag,
    position: 'C',
  })
}

async function firstPlayer(): Promise<{ id: number; gamertag: string }> {
  const [p] = await db.select({ id: players.id, gamertag: players.gamertag }).from(players).limit(1)
  assert.ok(p, 'DB must have at least one player')
  return p
}

function card(opts: {
  actor: string
  target?: string | null
  extractionId: number
  eventType?: 'shot' | 'hit' | 'goal' | 'penalty'
  x?: number | null
  y?: number | null
  rinkZone?: string | null
  bindMethod?: string
  clusterColorSide?: 'for' | 'against' | 'unknown' | null
}): RawOrphanCard {
  return {
    period_number: 2,
    period_label: '2',
    event_type: opts.eventType ?? 'shot',
    actor_snapshot: opts.actor,
    target_snapshot: opts.target ?? null,
    event_detail: 'orphan',
    ocr_extraction_id: opts.extractionId,
    x: opts.x ?? null,
    y: opts.y ?? null,
    rink_zone: opts.rinkZone ?? null,
    bind_method: opts.bindMethod ?? 'none',
    cluster_color_side: opts.clusterColorSide ?? null,
  }
}

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanupAllSentinels()
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  for (const id of Array.from(sentinelMatchIds)) {
    try {
      await cleanupMatch(id)
    } catch {
      /* swept below */
    }
  }
  await cleanupAllSentinels()
  await rawSql.end({ timeout: 5 })
})

void test('deriveTeamSide: actor resolved → for; target-only → against; neither → against', () => {
  assert.equal(deriveTeamSide(42, null), 'for')
  assert.equal(deriveTeamSide(null, 42), 'against')
  assert.equal(deriveTeamSide(null, null), 'against')
})

void test('resolveOrphanCard: rostered actor → actor_player_id set, team_side=for', async () => {
  if (!process.env['DATABASE_URL']) return
  const p = await firstPlayer()
  const m = await createSentinelMatch('actor-for')
  await seedLineup(m.matchId, m.extractionId, p.id, p.gamertag)

  const proposal = await resolveOrphanCard(
    card({ actor: p.gamertag, extractionId: m.extractionId }),
    m.matchId,
    GAME_TITLE_ID,
    dbForResolver,
  )
  assert.equal(proposal.actor_player_id, p.id)
  assert.equal(proposal.team_side, 'for')
  assert.equal(proposal.event_type, 'shot')
  assert.equal(proposal.actor_snapshot, p.gamertag)
})

void test('resolveOrphanCard: unresolved actor → null id, team_side=against', async () => {
  if (!process.env['DATABASE_URL']) return
  const p = await firstPlayer()
  const m = await createSentinelMatch('actor-unresolved')
  await seedLineup(m.matchId, m.extractionId, p.id, p.gamertag)

  const proposal = await resolveOrphanCard(
    card({ actor: 'xyz-unresolvable-garbage-z9q8', extractionId: m.extractionId }),
    m.matchId,
    GAME_TITLE_ID,
    dbForResolver,
  )
  assert.equal(proposal.actor_player_id, null)
  assert.equal(proposal.team_side, 'against')
})

void test('resolveOrphanCard: positioned card carries x/y/rink_zone through to the proposal', async () => {
  if (!process.env['DATABASE_URL']) return
  const p = await firstPlayer()
  const m = await createSentinelMatch('positioned')
  await seedLineup(m.matchId, m.extractionId, p.id, p.gamertag)

  const proposal = await resolveOrphanCard(
    card({ actor: p.gamertag, extractionId: m.extractionId, x: 36.5, y: 36.2, rinkZone: 'offensive', bindMethod: 'co_occurrence' }),
    m.matchId,
    GAME_TITLE_ID,
    dbForResolver,
  )
  assert.equal(proposal.x, 36.5)
  assert.equal(proposal.y, 36.2)
  assert.equal(proposal.rink_zone, 'offensive')
  assert.equal(proposal.team_side, 'for')
})

void test('resolveOrphanCard: cluster_color_side disagreeing with roster does NOT flip team_side', async () => {
  if (!process.env['DATABASE_URL']) return
  const p = await firstPlayer()
  const m = await createSentinelMatch('color-disagree')
  await seedLineup(m.matchId, m.extractionId, p.id, p.gamertag)

  // Rostered actor → roster says 'for'. Cluster color claims 'against'. Roster
  // is authoritative; team_side stays 'for', the position is kept.
  const proposal = await resolveOrphanCard(
    card({ actor: p.gamertag, extractionId: m.extractionId, x: 10.0, y: -6.0, rinkZone: 'neutral', clusterColorSide: 'against' }),
    m.matchId,
    GAME_TITLE_ID,
    dbForResolver,
  )
  assert.equal(proposal.team_side, 'for')
  assert.equal(proposal.x, 10.0)
})

void test('resolveOrphanCard: actor unresolved + target rostered → against, target_player_id set', async () => {
  if (!process.env['DATABASE_URL']) return
  const p = await firstPlayer()
  const m = await createSentinelMatch('target-against')
  await seedLineup(m.matchId, m.extractionId, p.id, p.gamertag)

  const proposal = await resolveOrphanCard(
    card({ actor: 'xyz-garbage-z9q8', target: p.gamertag, extractionId: m.extractionId, eventType: 'hit' }),
    m.matchId,
    GAME_TITLE_ID,
    dbForResolver,
  )
  assert.equal(proposal.actor_player_id, null)
  assert.equal(proposal.target_player_id, p.id)
  assert.equal(proposal.team_side, 'against')
})
