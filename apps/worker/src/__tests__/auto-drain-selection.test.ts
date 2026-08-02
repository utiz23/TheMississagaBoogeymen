/**
 * Auto-drain selection-policy tests.
 *
 * Two halves, deliberately separated:
 *
 *   1. `decideDrain` — pure, no DB. Pins the criterion itself: gate PASS AND no
 *      fail-severity flags in classes A/B/D/G. The negative cases matter more
 *      than the positive one — this function is the only thing standing between
 *      a HOLD match and publication.
 *   2. The candidate queries — DB-backed. Pin the three filters that decide
 *      WHICH extractions get flipped: screen type, pending+success status, and
 *      the live-run scope. A leak in any of them promotes rows the criterion
 *      never graded.
 *
 * The DB half skips gracefully without DATABASE_URL and runs against the
 * isolated clone via `with-test-db.mjs`.
 */

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { db, sql as dbSql } from '@eanhl/db'
import { sql } from 'drizzle-orm'
import {
  BLOCKING_FLAG_CLASSES,
  DRAINABLE_SCREENS,
  decideDrain,
  matchesWithPendingDrainableExtractions,
  pendingDrainableExtractionIds,
} from '../lib/auto-drain.js'
import type { QualityFlag } from '../lib/quality-inputs.js'
import type { L4Gate } from '../lib/l4-api-truth.js'

const PASS: L4Gate = { decision: 'PASS', reason: 'TOT-row final matches API truth' }
const HOLD: L4Gate = { decision: 'HOLD', reason: 'TOT-row final disagrees with API truth' }
const CONFIRM: L4Gate = { decision: 'OPERATOR_CONFIRM', reason: 'no API truth (api-missed)' }

function flag(classId: QualityFlag['classId'], severity: QualityFlag['severity']): QualityFlag {
  return { classId, severity, message: `${classId}/${severity} test flag` }
}

// ── 1. The criterion ─────────────────────────────────────────────────────────

test('drains on gate PASS with no flags', () => {
  const d = decideDrain(PASS, [])
  assert.equal(d.drain, true)
  assert.equal(d.blockers.length, 0)
})

test('a fail-severity flag in each of A/B/D/G blocks the drain', () => {
  for (const classId of BLOCKING_FLAG_CLASSES) {
    const d = decideDrain(PASS, [flag(classId, 'fail')])
    assert.equal(
      d.drain,
      false,
      `class ${classId} at fail severity must block — it is a validated correctness detector`,
    )
    assert.equal(d.blockers.length, 1)
    assert.match(d.reason, new RegExp(`class ${classId}`))
  }
})

test('warn severity never blocks, in any class', () => {
  // This is the whole point of the class-D downgrade: a warn is a coverage note,
  // not a correctness block, and must let the match publish.
  const warns = BLOCKING_FLAG_CLASSES.map((c) => flag(c, 'warn'))
  const d = decideDrain(PASS, warns)
  assert.equal(d.drain, true, 'warn-severity flags must not withhold a passing match')
  assert.equal(d.blockers.length, 0)
})

test('class C never blocks even at fail severity', () => {
  // Class C was retired at ~94% false-positive: it flags marker proximity,
  // which is presentation, not correctness. If it is ever re-added to the
  // blocking set, that must be a deliberate change, not a silent regression.
  const d = decideDrain(PASS, [flag('C', 'fail')])
  assert.equal(d.drain, true, 'retired class C must not gate the drain')
  assert.equal(d.blockers.length, 0)
})

test('HOLD and OPERATOR_CONFIRM are never drained, however clean the flags', () => {
  for (const gate of [HOLD, CONFIRM]) {
    const d = decideDrain(gate, [])
    assert.equal(d.drain, false, `${gate.decision} must never drain`)
    assert.match(d.reason, new RegExp(gate.decision))
  }
})

test('a blocked match still reports its blockers, so nothing is silently skipped', () => {
  const d = decideDrain(HOLD, [flag('A', 'fail'), flag('B', 'warn'), flag('G', 'fail')])
  assert.equal(d.drain, false)
  assert.deepEqual(
    d.blockers.map((b) => b.classId),
    ['A', 'G'],
    'blockers are reported even when the gate is what actually blocked',
  )
})

// ── 2. The candidate queries ─────────────────────────────────────────────────

test('pendingDrainableExtractionIds returns only pending, successful, live-run rows of the drainable screens', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — candidate-query check requires DB.')
    return
  }

  const matchIds = await matchesWithPendingDrainableExtractions()
  assert.ok(matchIds.length > 0, 'expected at least one match with drainable pending extractions')

  // Cross-check the ORM query against an independent raw-SQL statement of the
  // same four predicates for a sample of matches.
  for (const matchId of matchIds.slice(0, 8)) {
    const ids = await pendingDrainableExtractionIds(matchId)
    const rows = (await db.execute(sql`
      SELECT e.id
      FROM ocr_extractions e
      LEFT JOIN ocr_decoder_runs r ON r.id = e.run_id
      WHERE e.match_id = ${matchId}
        AND e.screen_type IN ('post_game_events', 'post_game_action_tracker')
        AND e.review_status = 'pending_review'
        AND e.transform_status = 'success'
        AND (e.run_id IS NULL OR r.is_active = true)
      ORDER BY e.id
    `)) as unknown as Array<{ id: number }>
    assert.deepEqual(
      ids,
      rows.map((r) => Number(r.id)),
      `match ${String(matchId)}: the drainable id set must match the four predicates exactly`,
    )
  }
})

test('extractions from a superseded run are never selected', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — live-run scope check requires DB.')
    return
  }

  // The load-bearing case: a match holding pending drainable extractions under
  // BOTH an active and a superseded run. Flipping the superseded ones would
  // publish a decode that lost its run-off, alongside the winner.
  const rows = (await db.execute(sql`
    SELECT e.match_id AS match_id, COUNT(*) AS superseded
    FROM ocr_extractions e
    JOIN ocr_decoder_runs r ON r.id = e.run_id
    WHERE r.is_active = false
      AND e.screen_type IN ('post_game_events', 'post_game_action_tracker')
      AND e.review_status = 'pending_review'
      AND e.transform_status = 'success'
      AND e.match_id IS NOT NULL
    GROUP BY e.match_id
    ORDER BY superseded DESC
    LIMIT 5
  `)) as unknown as Array<{ match_id: number; superseded: string }>

  assert.ok(
    rows.length > 0,
    'expected at least one match with pending drainable extractions on a superseded run — ' +
      'without one, the live-run filter goes untested',
  )

  for (const r of rows) {
    const matchId = Number(r.match_id)
    const ids = await pendingDrainableExtractionIds(matchId)
    if (ids.length === 0) continue

    const leaked = (await db.execute(sql`
      SELECT COUNT(*) AS n
      FROM ocr_extractions e
      JOIN ocr_decoder_runs run ON run.id = e.run_id
      WHERE e.id IN ${sql.raw(`(${ids.join(',')})`)}
        AND run.is_active = false
    `)) as unknown as Array<{ n: string }>
    assert.equal(
      Number(leaked[0]?.n ?? 0),
      0,
      `match ${String(matchId)}: ${String(r.superseded)} superseded-run extraction(s) exist and ` +
        `none may be selected for promotion`,
    )
  }
})

test('no non-drainable screen can enter the candidate set', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — screen-filter check requires DB.')
    return
  }

  const matchIds = await matchesWithPendingDrainableExtractions()
  const sample = matchIds.slice(0, 8)
  assert.ok(sample.length > 0, 'expected candidate matches to sample')

  for (const matchId of sample) {
    const ids = await pendingDrainableExtractionIds(matchId)
    if (ids.length === 0) continue
    const rows = (await db.execute(sql`
      SELECT DISTINCT e.screen_type AS screen_type
      FROM ocr_extractions e
      WHERE e.id IN ${sql.raw(`(${ids.join(',')})`)}
    `)) as unknown as Array<{ screen_type: string }>
    for (const row of rows) {
      assert.ok(
        (DRAINABLE_SCREENS as readonly string[]).includes(row.screen_type),
        `match ${String(matchId)}: screen "${row.screen_type}" is not drainable — box-score, ` +
          `loadout and faceoff-map extractions are out of scope for this CLI`,
      )
    }
  }
})

after(async () => {
  await dbSql.end()
})
