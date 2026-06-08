/**
 * Tests for applyIdentityProposals — the WS4 Stage 1 guarded identity-recovery
 * INSERT path. Exercises dedup-hit refresh, ambiguous skip, blank-actor guard,
 * goal/penalty extension writes, pending_review stamping, and idempotency.
 *
 * DB-backed, guarded by DATABASE_URL. Rows are seeded under the pilot match 250
 * using sentinel periods (81-89, disjoint from match-events-dedup-clockless's
 * 91-99) and the `ws4-identity-test-` snapshot prefix; torn down in after().
 *
 * Run via:
 *   pnpm --filter @eanhl/worker test reconcile-identity
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  db,
  matchEvents,
  matchGoalEvents,
  matchPenaltyEvents,
  ocrCaptureBatches,
  ocrDecoderRuns,
  ocrExtractions,
} from '@eanhl/db'
import { eq, inArray, like } from 'drizzle-orm'
import { applyIdentityProposals, type IdentityProposal } from '../reconcile-positions.js'

const TEST_MATCH_ID = 250
const SENTINEL = 'ws4-identity-test-'

let extractionId: number

async function cleanup(): Promise<void> {
  const sentinelEvents = await db
    .select({ id: matchEvents.id })
    .from(matchEvents)
    .where(like(matchEvents.actorGamertagSnapshot, `${SENTINEL}%`))
  const ids = sentinelEvents.map((r) => r.id)
  if (ids.length > 0) {
    await db.delete(matchGoalEvents).where(inArray(matchGoalEvents.eventId, ids))
    await db.delete(matchPenaltyEvents).where(inArray(matchPenaltyEvents.eventId, ids))
  }
  await db.delete(matchEvents).where(like(matchEvents.actorGamertagSnapshot, `${SENTINEL}%`))
  await db.delete(ocrExtractions).where(like(ocrExtractions.sourcePath, `${SENTINEL}%`))
  await db.delete(ocrCaptureBatches).where(like(ocrCaptureBatches.notes, `${SENTINEL}%`))
  await db.delete(ocrDecoderRuns).where(like(ocrDecoderRuns.notes, `${SENTINEL}%`))
}

/** Seed an existing match_events row; returns its id. */
async function seedEvent(opts: {
  period: number
  eventType?: 'shot' | 'hit' | 'goal' | 'penalty' | 'faceoff'
  teamSide?: 'for' | 'against'
  actor: string
  clock?: string | null
  x?: string | null
  positionConfidence?: 'interpolated' | 'extrapolated' | 'manual' | null
  ocrExtractionId?: number | null
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
      actorGamertagSnapshot: `${SENTINEL}${opts.actor}`,
      x: opts.x ?? null,
      y: opts.x == null ? null : '0.00',
      positionConfidence: opts.positionConfidence ?? null,
      ocrExtractionId: opts.ocrExtractionId ?? null,
      source: 'ocr',
    })
    .returning({ id: matchEvents.id })
  assert.ok(row)
  return row.id
}

/** Build an IdentityProposal with sensible sentinel defaults. */
function proposal(opts: {
  period: number
  eventType?: 'shot' | 'hit' | 'goal' | 'penalty' | 'faceoff'
  teamSide?: 'for' | 'against'
  actor: string
  actorPlayerId?: number | null
  targetSnapshot?: string | null
  targetPlayerId?: number | null
  clock?: string | null
  clockConfidence?: number
  x?: number | null
  y?: number | null
  rinkZone?: string | null
}): IdentityProposal {
  return {
    period_number: opts.period,
    period_label: String(opts.period),
    event_type: opts.eventType ?? 'shot',
    team_side: opts.teamSide ?? 'for',
    actor_snapshot: `${SENTINEL}${opts.actor}`,
    actor_player_id: opts.actorPlayerId ?? null,
    target_snapshot: opts.targetSnapshot ?? null,
    target_player_id: opts.targetPlayerId ?? null,
    event_detail: null,
    ocr_extraction_id: extractionId,
    clock: opts.clock ?? null,
    clock_confidence: opts.clockConfidence ?? 0,
    x: opts.x ?? null,
    y: opts.y ?? null,
    rink_zone: opts.rinkZone ?? null,
  }
}

/** Rows in a sentinel bucket, used to assert insert/no-insert. */
async function bucketRows(period: number) {
  return db
    .select({
      id: matchEvents.id,
      reviewStatus: matchEvents.reviewStatus,
      clock: matchEvents.clock,
      x: matchEvents.x,
      positionConfidence: matchEvents.positionConfidence,
      source: matchEvents.source,
      ocrExtractionId: matchEvents.ocrExtractionId,
      target: matchEvents.targetGamertagSnapshot,
    })
    .from(matchEvents)
    .where(eq(matchEvents.periodNumber, period))
}

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanup()
  // Seed a real AT extraction so inserts can satisfy the ocr_extraction_id FK.
  const [run] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId: TEST_MATCH_ID,
      decoderVersion: `${SENTINEL}run`,
      weightsHash: `${SENTINEL}run`,
      configHash: `${SENTINEL}run`,
      isActive: false,
      notes: `${SENTINEL}run`,
    })
    .returning({ id: ocrDecoderRuns.id })
  assert.ok(run)
  const [batch] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: 1,
      matchId: TEST_MATCH_ID,
      captureKind: 'manual_screenshots',
      runId: run.id,
      notes: `${SENTINEL}batch`,
    })
    .returning({ id: ocrCaptureBatches.id })
  assert.ok(batch)
  const [ext] = await db
    .insert(ocrExtractions)
    .values({
      batchId: batch.id,
      matchId: TEST_MATCH_ID,
      screenType: 'post_game_action_tracker',
      sourcePath: `${SENTINEL}ext.png`,
      rawResultJson: { events: [] },
      transformStatus: 'success',
      reviewStatus: 'reviewed',
      runId: run.id,
    })
    .returning({ id: ocrExtractions.id })
  assert.ok(ext)
  extractionId = ext.id
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanup()
})

void test('zero-match shot proposal → inserts a pending_review row, no extension', async () => {
  if (!process.env['DATABASE_URL']) return
  const res = await applyIdentityProposals(
    [proposal({ period: 81, actor: 'GHOST' })],
    TEST_MATCH_ID,
  )
  assert.equal(res.inserted, 1)
  assert.equal(res.dedupRefreshed, 0)
  const rows = await bucketRows(81)
  assert.equal(rows.length, 1)
  const row = rows[0]!
  assert.equal(row.reviewStatus, 'pending_review')
  assert.equal(row.clock, null)
  assert.equal(row.x, null)
  assert.equal(row.positionConfidence, null)
  assert.equal(row.source, 'ocr')
  assert.equal(row.ocrExtractionId, extractionId)
  // shot has no extension table
  const goals = await db.select().from(matchGoalEvents).where(eq(matchGoalEvents.eventId, row.id))
  assert.equal(goals.length, 0)
})

void test('zero-match POSITIONED shot proposal → inserts pending_review row with x/y/extrapolated (WS4 Stage 2b)', async () => {
  if (!process.env['DATABASE_URL']) return
  const res = await applyIdentityProposals(
    [proposal({ period: 71, actor: 'POSGHOST', x: 36.5, y: 36.2, rinkZone: 'offensive' })],
    TEST_MATCH_ID,
  )
  assert.equal(res.inserted, 1)
  assert.equal(res.insertedPositioned, 1)
  const rows = await bucketRows(71)
  assert.equal(rows.length, 1)
  const row = rows[0]!
  assert.equal(row.x, '36.50')
  assert.equal(row.positionConfidence, 'extrapolated')
  assert.equal(row.reviewStatus, 'pending_review')
  assert.equal(row.clock, null)
})

void test('two same-identity POSITIONED proposals at distinct positions → two rows (WS4 Stage 2b split)', async () => {
  if (!process.env['DATABASE_URL']) return
  // Finding 1: through the sequential apply loop the second card would, with an
  // identity-only key, see exactly one prior row and dedup-hit. Position-as-
  // identity keeps them distinct so BOTH insert.
  const a = proposal({ period: 76, actor: 'SPLIT', x: 36.5, y: 36.2, rinkZone: 'offensive' })
  const b = proposal({ period: 76, actor: 'SPLIT', x: -40.0, y: -10.0, rinkZone: 'defensive' })
  const res = await applyIdentityProposals([a, b], TEST_MATCH_ID)
  assert.equal(res.inserted, 2)
  assert.equal(res.insertedPositioned, 2)
  const rows = await bucketRows(76)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map((r) => r.x).sort(), ['-40.00', '36.50'])
})

void test('re-running positioned proposals inserts nothing new (idempotent)', async () => {
  if (!process.env['DATABASE_URL']) return
  const p = proposal({ period: 77, actor: 'IDEM', x: 12.0, y: 8.0, rinkZone: 'neutral' })
  const first = await applyIdentityProposals([p], TEST_MATCH_ID)
  assert.equal(first.inserted, 1)
  const second = await applyIdentityProposals([p], TEST_MATCH_ID)
  assert.equal(second.inserted, 0)
  assert.equal(second.dedupRefreshed, 1)
  assert.equal((await bucketRows(77)).length, 1)
})

void test('zero-match goal proposal → base row + matchGoalEvents row', async () => {
  if (!process.env['DATABASE_URL']) return
  const res = await applyIdentityProposals(
    [proposal({ period: 82, eventType: 'goal', actor: 'SCORER' })],
    TEST_MATCH_ID,
  )
  assert.equal(res.inserted, 1)
  const rows = await bucketRows(82)
  assert.equal(rows.length, 1)
  const goals = await db
    .select({ scorerSnapshot: matchGoalEvents.scorerSnapshot })
    .from(matchGoalEvents)
    .where(eq(matchGoalEvents.eventId, rows[0]!.id))
  assert.equal(goals.length, 1)
  assert.equal(goals[0]!.scorerSnapshot, `${SENTINEL}SCORER`)
})

void test('zero-match penalty proposal → base row + matchPenaltyEvents placeholder', async () => {
  if (!process.env['DATABASE_URL']) return
  const res = await applyIdentityProposals(
    [proposal({ period: 83, eventType: 'penalty', actor: 'GOON' })],
    TEST_MATCH_ID,
  )
  assert.equal(res.inserted, 1)
  const rows = await bucketRows(83)
  const pen = await db
    .select({
      infraction: matchPenaltyEvents.infraction,
      penaltyType: matchPenaltyEvents.penaltyType,
      minutes: matchPenaltyEvents.minutes,
      culpritSnapshot: matchPenaltyEvents.culpritSnapshot,
    })
    .from(matchPenaltyEvents)
    .where(eq(matchPenaltyEvents.eventId, rows[0]!.id))
  assert.equal(pen.length, 1)
  assert.equal(pen[0]!.infraction, '(unknown)')
  assert.equal(pen[0]!.penaltyType, 'Minor')
  assert.equal(pen[0]!.minutes, 2)
  assert.equal(pen[0]!.culpritSnapshot, `${SENTINEL}GOON`)
})

void test('exactly-one existing → dedup hit refreshes, no duplicate', async () => {
  if (!process.env['DATABASE_URL']) return
  const existing = await seedEvent({ period: 84, actor: 'DUPE', ocrExtractionId: null })
  const res = await applyIdentityProposals(
    [proposal({ period: 84, actor: 'DUPE', targetSnapshot: `${SENTINEL}VICTIM` })],
    TEST_MATCH_ID,
  )
  assert.equal(res.inserted, 0)
  assert.equal(res.dedupRefreshed, 1)
  const rows = await bucketRows(84)
  assert.equal(rows.length, 1, 'no duplicate inserted')
  assert.equal(rows[0]!.id, existing)
  assert.equal(rows[0]!.ocrExtractionId, extractionId, 'ocr_extraction_id refreshed')
  assert.equal(rows[0]!.target, `${SENTINEL}VICTIM`, 'target_* backfilled')
})

void test('two candidates → ambiguous, no write', async () => {
  if (!process.env['DATABASE_URL']) return
  await seedEvent({ period: 85, actor: 'WILDE' })
  await seedEvent({ period: 85, actor: 'WILOE' })
  const before = await bucketRows(85)
  const res = await applyIdentityProposals(
    [proposal({ period: 85, actor: 'WILDE' })],
    TEST_MATCH_ID,
  )
  assert.equal(res.ambiguous, 1)
  assert.equal(res.inserted, 0)
  assert.equal(res.dedupRefreshed, 0)
  const afterRows = await bucketRows(85)
  assert.equal(afterRows.length, before.length, 'no insert')
})

void test('positioned manual row → hit refresh, position preserved (never clobbered)', async () => {
  if (!process.env['DATABASE_URL']) return
  const existing = await seedEvent({
    period: 86,
    actor: 'MANUAL',
    x: '30.00',
    positionConfidence: 'manual',
    ocrExtractionId: null,
  })
  const res = await applyIdentityProposals(
    [proposal({ period: 86, actor: 'MANUAL' })],
    TEST_MATCH_ID,
  )
  assert.equal(res.inserted, 0)
  assert.equal(res.dedupRefreshed, 1)
  const rows = await bucketRows(86)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.id, existing)
  assert.equal(rows[0]!.x, '30.00', 'manual position preserved')
  assert.equal(rows[0]!.positionConfidence, 'manual', 'manual confidence preserved')
  assert.equal(rows[0]!.ocrExtractionId, extractionId, 'extraction id still refreshed')
})

void test('blank/whitespace actor → skipped, not inserted', async () => {
  if (!process.env['DATABASE_URL']) return
  const blank: IdentityProposal = { ...proposal({ period: 87, actor: 'X' }), actor_snapshot: '   ' }
  const res = await applyIdentityProposals([blank], TEST_MATCH_ID)
  assert.equal(res.skippedInvalid, 1)
  assert.equal(res.inserted, 0)
  const rows = await bucketRows(87)
  assert.equal(rows.length, 0, 'no row inserted for a blank actor')
})

void test('idempotent: same goal proposal twice → one base + one goal-ext row', async () => {
  if (!process.env['DATABASE_URL']) return
  const p = proposal({ period: 88, eventType: 'goal', actor: 'REPEAT' })
  const first = await applyIdentityProposals([p], TEST_MATCH_ID)
  assert.equal(first.inserted, 1)
  const second = await applyIdentityProposals([p], TEST_MATCH_ID)
  assert.equal(second.inserted, 0, 'second run dedup-refreshes, does not re-insert')
  assert.equal(second.dedupRefreshed, 1)
  const rows = await bucketRows(88)
  assert.equal(rows.length, 1, 'exactly one base row after two runs')
  const goals = await db
    .select()
    .from(matchGoalEvents)
    .where(eq(matchGoalEvents.eventId, rows[0]!.id))
  assert.equal(goals.length, 1, 'exactly one goal-ext row after two runs')
})

// ─── WS4 Stage 3: recovered-clock exact-key dedup ──────────────────────────

void test('confident clock disambiguates: two same-actor rows, exact-key hits the right one (no ambiguous-skip)', async () => {
  if (!process.env['DATABASE_URL']) return
  // Mirrors match 250 P. MAGROYNE p3 shots at 0:33 and 16:53. A clock-null
  // orphan would ambiguous-skip (2 candidates); a recovered 0:33 exact-hits one.
  await seedEvent({ period: 60, actor: 'MAGROYNE', clock: '0:33' })
  await seedEvent({ period: 60, actor: 'MAGROYNE', clock: '16:53' })
  const res = await applyIdentityProposals(
    [proposal({ period: 60, actor: 'MAGROYNE', clock: '0:33', clockConfidence: 0.8 })],
    TEST_MATCH_ID,
  )
  assert.equal(res.ambiguous, 0, 'recovered clock removes the ambiguity')
  assert.equal(res.inserted, 0, 'no duplicate inserted')
  assert.equal(res.dedupRefreshed, 1, 'exact-key hit refreshed the 0:33 row')
})

void test('confident clock, zero exact match → INSERT with the clock written', async () => {
  if (!process.env['DATABASE_URL']) return
  const res = await applyIdentityProposals(
    [proposal({ period: 61, actor: 'GHOSTCLK', clock: '5:00', clockConfidence: 1.0 })],
    TEST_MATCH_ID,
  )
  assert.equal(res.inserted, 1)
  const rows = await bucketRows(61)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.clock, '5:00', 'recovered clock persisted on the new row')
})

void test('confident clock exact-misses but clockless ambiguous → ambiguous-skip (safety unchanged)', async () => {
  if (!process.env['DATABASE_URL']) return
  await seedEvent({ period: 62, actor: 'AMBIG', clock: '1:00' })
  await seedEvent({ period: 62, actor: 'AMBIG', clock: '2:00' })
  const res = await applyIdentityProposals(
    [proposal({ period: 62, actor: 'AMBIG', clock: '7:00', clockConfidence: 0.8 })],
    TEST_MATCH_ID,
  )
  assert.equal(res.inserted, 0)
  assert.equal(res.ambiguous, 1, 'exact miss falls back to the ambiguous clockless bucket')
})

void test('confident clockless-hit backfills clock onto a clock-null row (self-heal)', async () => {
  if (!process.env['DATABASE_URL']) return
  await seedEvent({ period: 63, actor: 'BACKFILL', clock: null })
  const res = await applyIdentityProposals(
    [proposal({ period: 63, actor: 'BACKFILL', clock: '3:30', clockConfidence: 1.0 })],
    TEST_MATCH_ID,
  )
  assert.equal(res.inserted, 0)
  assert.equal(res.dedupRefreshed, 1)
  const rows = await bucketRows(63)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.clock, '3:30', 'clock-null row backfilled with the recovered clock')
})

void test('confident clock never clobbers an existing clock (no-clobber backfill)', async () => {
  if (!process.env['DATABASE_URL']) return
  await seedEvent({ period: 64, actor: 'NOCLOBBER', clock: '4:00' })
  const res = await applyIdentityProposals(
    [proposal({ period: 64, actor: 'NOCLOBBER', clock: '5:00', clockConfidence: 1.0 })],
    TEST_MATCH_ID,
  )
  assert.equal(res.inserted, 0, 'clockless-hit on the existing row, no new insert')
  assert.equal(res.dedupRefreshed, 1)
  const rows = await bucketRows(64)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.clock, '4:00', 'existing clock preserved, not overwritten by 5:00')
})

void test('below-floor clock is never persisted: INSERT lands clock-null', async () => {
  if (!process.env['DATABASE_URL']) return
  const res = await applyIdentityProposals(
    [proposal({ period: 65, actor: 'LOWINS', clock: '9:00', clockConfidence: 0.6 })],
    TEST_MATCH_ID,
  )
  assert.equal(res.inserted, 1)
  const rows = await bucketRows(65)
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.clock, null, 'below-floor clock not written to the column')
})

void test('below-floor clock does not take the exact key and does not backfill on hit', async () => {
  if (!process.env['DATABASE_URL']) return
  await seedEvent({ period: 66, actor: 'LOWHIT', clock: null })
  const res = await applyIdentityProposals(
    [proposal({ period: 66, actor: 'LOWHIT', clock: '9:00', clockConfidence: 0.6 })],
    TEST_MATCH_ID,
  )
  assert.equal(res.dedupRefreshed, 1, 'clockless-hit on the lone null-clock row')
  const rows = await bucketRows(66)
  assert.equal(rows[0]!.clock, null, 'below-floor clock not backfilled')
})

void test('idempotent: confident-clock insert dedup-hits itself on re-run', async () => {
  if (!process.env['DATABASE_URL']) return
  const p = proposal({ period: 67, actor: 'IDEMCLK', clock: '6:30', clockConfidence: 1.0 })
  const first = await applyIdentityProposals([p], TEST_MATCH_ID)
  assert.equal(first.inserted, 1)
  const second = await applyIdentityProposals([p], TEST_MATCH_ID)
  assert.equal(second.inserted, 0, 'exact key finds the self-inserted row')
  assert.equal(second.dedupRefreshed, 1)
  const rows = await bucketRows(67)
  assert.equal(rows.length, 1, 'no duplicate after re-run')
})

void test('exact-key path reuses Strategy 0: positioned same-clock prefix match dedups when fuzzy would miss', async () => {
  if (!process.env['DATABASE_URL']) return
  // A positioned row at 8:00 whose actor is too garbled for Levenshtein-1 but
  // shares the 4-char prefix. Strategy 0 (positioned-vs-junk) must fire on the
  // exact-key path so the recovered orphan dedups to it (review Finding 3).
  await seedEvent({ period: 68, actor: 'STRAT0AAAA', clock: '8:00', x: '10.00' })
  const res = await applyIdentityProposals(
    [proposal({ period: 68, actor: 'STRAT0ZZZZ', clock: '8:00', clockConfidence: 1.0 })],
    TEST_MATCH_ID,
  )
  assert.equal(res.inserted, 0, 'Strategy 0 prefix match dedups, no junk duplicate')
  assert.equal(res.dedupRefreshed, 1)
})
