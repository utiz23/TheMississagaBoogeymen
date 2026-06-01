/**
 * Tests for reconcile-positions.ts — the live-ingest Action Tracker position
 * reconciliation tail hook.
 *
 * The Python tool is stubbed via the injectable `runTool` arg, so these exercise
 * the TS-owned halves: the run-scoped payload BUILD and the guarded WRITE. The
 * write guard is the load-bearing one — `position_confidence IS DISTINCT FROM
 * 'manual'` must still update NULL-confidence rows (a plain `ne()` would skip
 * them and gut the feature).
 *
 * Real DB, guarded by DATABASE_URL (no-ops without it). Seeds sentinel rows
 * against match 250 and cleans them up; sentinels are marked precisely so real
 * match-250 data is never touched.
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build && \
 *   set -a && source .env && set +a && \
 *   node --test apps/worker/dist/__tests__/reconcile-positions.test.js
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  db,
  sql,
  matches,
  matchEvents,
  ocrCaptureBatches,
  ocrDecoderRuns,
  ocrExtractions,
} from '@eanhl/db'
import { eq, like } from 'drizzle-orm'
import {
  reconcilePositions,
  type ReconcilePayload,
  type ReconcileToolOutput,
} from '../reconcile-positions.js'

const TEST_MATCH_ID = 250
const SENTINEL = 'reconcile-pos-test-'

// Shared seeded scope, populated in before().
let runAId: number
let runBId: number
let runANullExtId: number // an AT extraction under a NULL run
let runAExtId: number // AT extraction under runA
let runBExtId: number // AT extraction under runB

async function cleanup(): Promise<void> {
  // FK order: match_events / extractions → batches → runs. All sentinel-scoped.
  await db.delete(matchEvents).where(like(matchEvents.actorGamertagSnapshot, `${SENTINEL}%`))
  await db.delete(ocrExtractions).where(like(ocrExtractions.sourcePath, `${SENTINEL}%`))
  await db.delete(ocrCaptureBatches).where(like(ocrCaptureBatches.notes, `${SENTINEL}%`))
  await db.delete(ocrDecoderRuns).where(like(ocrDecoderRuns.notes, `${SENTINEL}%`))
}

async function seedRun(tag: string): Promise<number> {
  const [run] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId: TEST_MATCH_ID,
      videoSha256: null,
      decoderVersion: `${SENTINEL}${tag}`,
      weightsHash: `${SENTINEL}${tag}`,
      configHash: `${SENTINEL}${tag}`,
      isActive: false,
      notes: `${SENTINEL}${tag}`,
    })
    .returning({ id: ocrDecoderRuns.id })
  assert.ok(run)
  return run.id
}

async function seedAtExtraction(
  gameTitleId: number,
  runId: number | null,
  tag: string,
): Promise<number> {
  const [batch] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId,
      matchId: TEST_MATCH_ID,
      captureKind: 'manual_screenshots',
      runId,
      notes: `${SENTINEL}${tag}`,
    })
    .returning({ id: ocrCaptureBatches.id })
  assert.ok(batch)

  const [ext] = await db
    .insert(ocrExtractions)
    .values({
      batchId: batch.id,
      matchId: TEST_MATCH_ID,
      screenType: 'post_game_action_tracker',
      sourcePath: `${SENTINEL}${tag}.png`,
      rawResultJson: { events: [], detected_markers: [], selected_event_index: null },
      transformStatus: 'success',
      reviewStatus: 'reviewed',
      runId,
    })
    .returning({ id: ocrExtractions.id })
  assert.ok(ext)
  return ext.id
}

/** Insert a sentinel OCR hit event; returns its id. */
async function seedEvent(opts: {
  tag: string
  x: string | null
  positionConfidence: 'interpolated' | 'extrapolated' | 'manual' | null
}): Promise<number> {
  const [ev] = await db
    .insert(matchEvents)
    .values({
      matchId: TEST_MATCH_ID,
      periodNumber: 2,
      periodLabel: '2',
      clock: '19:43',
      eventType: 'hit',
      teamSide: 'against',
      actorGamertagSnapshot: `${SENTINEL}${opts.tag}`,
      x: opts.x,
      y: opts.x === null ? null : '0.00',
      positionConfidence: opts.positionConfidence,
      source: 'ocr',
    })
    .returning({ id: matchEvents.id })
  assert.ok(ev)
  return ev.id
}

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanup()
  const [m] = await db
    .select({ gameTitleId: matches.gameTitleId })
    .from(matches)
    .where(eq(matches.id, TEST_MATCH_ID))
  assert.ok(m, 'match 250 must exist for this test')
  const gameTitleId = m.gameTitleId

  runAId = await seedRun('runA')
  runBId = await seedRun('runB')
  runAExtId = await seedAtExtraction(gameTitleId, runAId, 'runA-ext')
  runBExtId = await seedAtExtraction(gameTitleId, runBId, 'runB-ext')
  runANullExtId = await seedAtExtraction(gameTitleId, null, 'null-ext')
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanup()
  await sql.end()
})

void test('guard updates NULL-confidence unpositioned row, skips manual + positioned', async () => {
  if (!process.env['DATABASE_URL']) return

  const nullConfId = await seedEvent({ tag: 'apply-null', x: null, positionConfidence: null })
  const manualId = await seedEvent({ tag: 'apply-manual', x: '30.00', positionConfidence: 'manual' })
  const positionedId = await seedEvent({
    tag: 'apply-positioned',
    x: '12.00',
    positionConfidence: 'interpolated',
  })

  // Stub the Python tool: propose positions for all three rows.
  const fakeTool = (_matchId: number, _payload: ReconcilePayload): Promise<ReconcileToolOutput> =>
    Promise.resolve({
      match_id: TEST_MATCH_ID,
      updates: [
        { event_id: nullConfId, x: 10.08, y: -6.81, rink_zone: 'neutral', confidence_label: 'extrapolated', method: 'yellow_salvage' },
        { event_id: manualId, x: 99, y: 99, rink_zone: 'neutral', confidence_label: 'extrapolated', method: 'elimination' },
        { event_id: positionedId, x: 99, y: 99, rink_zone: 'neutral', confidence_label: 'extrapolated', method: 'elimination' },
      ],
    })

  const result = await reconcilePositions(TEST_MATCH_ID, runAId, fakeTool)
  assert.equal(result.proposed, 3)
  assert.equal(result.applied, 1) // only the NULL-confidence row passes the guard

  const rows = await db
    .select({ id: matchEvents.id, x: matchEvents.x, conf: matchEvents.positionConfidence })
    .from(matchEvents)
    .where(like(matchEvents.actorGamertagSnapshot, `${SENTINEL}apply-%`))
  const byId = new Map(rows.map((r) => [r.id, r]))

  // NULL-confidence row: written with the proposed position + extrapolated.
  assert.equal(byId.get(nullConfId)?.x, '10.08')
  assert.equal(byId.get(nullConfId)?.conf, 'extrapolated')
  // Manual row: untouched.
  assert.equal(byId.get(manualId)?.x, '30.00')
  assert.equal(byId.get(manualId)?.conf, 'manual')
  // Positioned (interpolated) row: untouched.
  assert.equal(byId.get(positionedId)?.x, '12.00')
  assert.equal(byId.get(positionedId)?.conf, 'interpolated')
})

void test('proposal with unexpected confidence_label is skipped, not applied (no batch rollback)', async () => {
  if (!process.env['DATABASE_URL']) return

  // Two NULL-conf gap rows: one valid proposal, one with a bogus confidence
  // label that the CHECK constraint would reject. The bad one must be skipped
  // so the good one still applies (no whole-transaction rollback).
  const goodId = await seedEvent({ tag: 'cast-good', x: null, positionConfidence: null })
  const badId = await seedEvent({ tag: 'cast-bad', x: null, positionConfidence: null })

  const fakeTool = (_matchId: number, _payload: ReconcilePayload): Promise<ReconcileToolOutput> =>
    Promise.resolve({
      match_id: TEST_MATCH_ID,
      updates: [
        { event_id: goodId, x: 1.5, y: 2.5, rink_zone: 'neutral', confidence_label: 'extrapolated', method: 'elimination' },
        { event_id: badId, x: 3.5, y: 4.5, rink_zone: 'neutral', confidence_label: 'bogus', method: 'elimination' },
      ],
    })

  const result = await reconcilePositions(TEST_MATCH_ID, runAId, fakeTool)
  assert.equal(result.proposed, 2)
  assert.equal(result.applied, 1) // good applied; bad skipped (not a rollback)

  const rows = await db
    .select({ id: matchEvents.id, x: matchEvents.x, conf: matchEvents.positionConfidence })
    .from(matchEvents)
    .where(like(matchEvents.actorGamertagSnapshot, `${SENTINEL}cast-%`))
  const byId = new Map(rows.map((r) => [r.id, r]))
  assert.equal(byId.get(goodId)?.x, '1.50')
  assert.equal(byId.get(goodId)?.conf, 'extrapolated')
  // Bad row untouched (skipped before the UPDATE).
  assert.equal(byId.get(badId)?.x, null)
  assert.equal(byId.get(badId)?.conf, null)
})

void test('payload AT-extraction read is scoped to the provided runId', async () => {
  if (!process.env['DATABASE_URL']) return

  let captured: ReconcilePayload | null = null
  const capture = (_matchId: number, payload: ReconcilePayload): Promise<ReconcileToolOutput> => {
    captured = payload
    return Promise.resolve({ match_id: TEST_MATCH_ID, updates: [] })
  }

  await reconcilePositions(TEST_MATCH_ID, runAId, capture)
  assert.ok(captured, 'tool should have been called (runA has an AT extraction)')
  const ids = (captured as ReconcilePayload).extractions.map((e) => e.id)
  assert.ok(ids.includes(runAExtId), 'runA extraction present')
  assert.ok(!ids.includes(runBExtId), 'runB extraction excluded under runA scope')
})

void test('NULL runId falls back to liveRunFilter (includes NULL-run rows)', async () => {
  if (!process.env['DATABASE_URL']) return

  let captured: ReconcilePayload | null = null
  const capture = (_matchId: number, payload: ReconcilePayload): Promise<ReconcileToolOutput> => {
    captured = payload
    return Promise.resolve({ match_id: TEST_MATCH_ID, updates: [] })
  }

  await reconcilePositions(TEST_MATCH_ID, null, capture)
  assert.ok(captured, 'tool should have been called')
  const ids = (captured as ReconcilePayload).extractions.map((e) => e.id)
  assert.ok(ids.includes(runANullExtId), 'NULL-run extraction present under the fallback rule')
})

void test('tool failure propagates (caller owns the swallow)', async () => {
  if (!process.env['DATABASE_URL']) return

  const failing = (): Promise<ReconcileToolOutput> =>
    Promise.reject(new Error('reconcile tool boom'))

  await assert.rejects(
    () => reconcilePositions(TEST_MATCH_ID, runAId, failing),
    /reconcile tool boom/,
  )
})

void test('no AT extractions for the run → no-op, tool not called', async () => {
  if (!process.env['DATABASE_URL']) return

  // runB has an AT extraction, but a fresh run with none should early-return.
  const emptyRunId = await seedRun('empty-run')
  let called = false
  const tool = (): Promise<ReconcileToolOutput> => {
    called = true
    return Promise.resolve({ match_id: TEST_MATCH_ID, updates: [] })
  }

  const result = await reconcilePositions(TEST_MATCH_ID, emptyRunId, tool)
  assert.equal(called, false, 'tool should not be spawned when there is no AT evidence')
  assert.deepEqual(result, { proposed: 0, applied: 0 })
})
