/**
 * Tests for findExistingMatchEventClockless — the WS4 clock-independent dedup
 * authority used by the orphan-identity recovery (Stage 1) INSERT path.
 *
 * DB-backed (the function queries match_events), guarded by DATABASE_URL.
 * Each test isolates its own bucket under the existing pilot match 250 by using
 * a distinct sentinel period number (91+); rows are tagged with the
 * `ws4-identity-test-` snapshot prefix and torn down in after(). This mirrors
 * reconcile-positions.test.ts (anchor on real match 250, sentinel-scoped) and
 * avoids creating matches/game_titles FK rows.
 *
 * Run via:
 *   pnpm --filter @eanhl/worker test match-events-dedup-clockless
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { db, matchEvents, players } from '@eanhl/db'
import { like } from 'drizzle-orm'
import {
  findExistingMatchEventClockless,
  type ClocklessDedupKey,
} from '../match-events-dedup.js'

const TEST_MATCH_ID = 250
const SENTINEL = 'ws4-identity-test-'

// A real player id, fetched in before(), for the resolved-player-path cases.
let playerId: number

async function cleanup(): Promise<void> {
  await db.delete(matchEvents).where(like(matchEvents.actorGamertagSnapshot, `${SENTINEL}%`))
}

/** Seed one sentinel match_events row; returns its id. */
async function seed(opts: {
  period: number
  eventType?: 'shot' | 'hit' | 'goal' | 'penalty' | 'faceoff'
  teamSide?: 'for' | 'against'
  actor: string
  actorPlayerId?: number | null
  x?: string | null
  clock?: string | null
}): Promise<number> {
  const [row] = await db
    .insert(matchEvents)
    .values({
      matchId: TEST_MATCH_ID,
      periodNumber: opts.period,
      periodLabel: String(opts.period),
      clock: opts.clock ?? null,
      eventType: opts.eventType ?? 'shot',
      teamSide: opts.teamSide ?? 'for',
      actorPlayerId: opts.actorPlayerId ?? null,
      actorGamertagSnapshot: `${SENTINEL}${opts.actor}`,
      x: opts.x ?? null,
      y: opts.x == null ? null : '0.00',
      source: 'ocr',
    })
    .returning({ id: matchEvents.id })
  assert.ok(row)
  return row.id
}

/** Build a clockless key for the given bucket + actor. */
function key(opts: {
  period: number
  eventType?: 'shot' | 'hit' | 'goal' | 'penalty' | 'faceoff'
  teamSide?: 'for' | 'against'
  actor: string
  actorPlayerId?: number | null
}): ClocklessDedupKey {
  return {
    matchId: TEST_MATCH_ID,
    periodNumber: opts.period,
    eventType: opts.eventType ?? 'shot',
    teamSide: opts.teamSide ?? 'for',
    actorPlayerId: opts.actorPlayerId ?? null,
    actorSnapshot: `${SENTINEL}${opts.actor}`,
  }
}

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanup()
  const [p] = await db.select({ id: players.id }).from(players).limit(1)
  assert.ok(p, 'expected at least one player row in the test DB')
  playerId = p.id
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanup()
})

void test('zero bucket matches → insert', async () => {
  if (!process.env['DATABASE_URL']) return
  const res = await findExistingMatchEventClockless(db, key({ period: 91, actor: 'NOBODY' }))
  assert.deepEqual(res, { kind: 'insert' })
})

void test('exactly one fuzzy (Lev1) match → hit with that id', async () => {
  if (!process.env['DATABASE_URL']) return
  const id = await seed({ period: 92, eventType: 'shot', teamSide: 'for', actor: 'WILDE' })
  const res = await findExistingMatchEventClockless(db, key({ period: 92, actor: 'WILOE' }))
  assert.deepEqual(res, { kind: 'hit', id })
})

void test('two Lev1 matches → ambiguous listing both candidateIds', async () => {
  if (!process.env['DATABASE_URL']) return
  const id1 = await seed({ period: 93, actor: 'WILDE' })
  const id2 = await seed({ period: 93, actor: 'WILOE' })
  const res = await findExistingMatchEventClockless(db, key({ period: 93, actor: 'WILDE' }))
  assert.equal(res.kind, 'ambiguous')
  if (res.kind !== 'ambiguous') return
  assert.deepEqual([...res.candidateIds].sort((a, b) => a - b), [id1, id2].sort((a, b) => a - b))
})

void test('resolved-player exact id, single → hit', async () => {
  if (!process.env['DATABASE_URL']) return
  // Distinct actor strings (Lev > 1) so only the player-id path can match.
  const id = await seed({ period: 94, actor: 'ALPHA', actorPlayerId: playerId })
  const res = await findExistingMatchEventClockless(
    db,
    key({ period: 94, actor: 'ZULUZULU', actorPlayerId: playerId }),
  )
  assert.deepEqual(res, { kind: 'hit', id })
})

void test('resolved-player exact id, duplicated → ambiguous', async () => {
  if (!process.env['DATABASE_URL']) return
  const id1 = await seed({ period: 95, actor: 'ALPHA', actorPlayerId: playerId })
  const id2 = await seed({ period: 95, actor: 'BRAVO', actorPlayerId: playerId })
  const res = await findExistingMatchEventClockless(
    db,
    key({ period: 95, actor: 'CHARLIE', actorPlayerId: playerId }),
  )
  assert.equal(res.kind, 'ambiguous')
  if (res.kind !== 'ambiguous') return
  assert.deepEqual([...res.candidateIds].sort((a, b) => a - b), [id1, id2].sort((a, b) => a - b))
})

void test('positioned row in bucket is still a hit (duplicate-safety)', async () => {
  if (!process.env['DATABASE_URL']) return
  const id = await seed({ period: 96, actor: 'POSI', x: '36.50' })
  const res = await findExistingMatchEventClockless(db, key({ period: 96, actor: 'POSI' }))
  assert.deepEqual(res, { kind: 'hit', id })
})

void test('teamSide partitions the bucket (no cross-side merge)', async () => {
  if (!process.env['DATABASE_URL']) return
  await seed({ period: 97, teamSide: 'for', actor: 'SPLIT' })
  const res = await findExistingMatchEventClockless(
    db,
    key({ period: 97, teamSide: 'against', actor: 'SPLIT' }),
  )
  assert.deepEqual(res, { kind: 'insert' })
})

void test('clock is ignored: a clock-bearing bucket row is still found', async () => {
  if (!process.env['DATABASE_URL']) return
  const id = await seed({ period: 98, actor: 'CLOCKD', clock: '12:34' })
  const res = await findExistingMatchEventClockless(db, key({ period: 98, actor: 'CLOCKD' }))
  assert.deepEqual(res, { kind: 'hit', id })
})

void test('empty/whitespace actor, no player id → insert (no match)', async () => {
  if (!process.env['DATABASE_URL']) return
  // findExistingMatchEventClockless reports no match; applyIdentityProposals
  // (File B) is the layer that refuses to insert blank actors.
  await seed({ period: 99, actor: 'REALACTOR' })
  const res = await findExistingMatchEventClockless(db, {
    matchId: TEST_MATCH_ID,
    periodNumber: 99,
    eventType: 'shot',
    teamSide: 'for',
    actorPlayerId: null,
    actorSnapshot: '   ',
  })
  assert.deepEqual(res, { kind: 'insert' })
})
