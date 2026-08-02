/**
 * Class-D ("EA reports PIM but we have no penalty rows") severity regression.
 *
 * THE DECISION THIS LOCKS IN (2026-08-01): class D used to be an unconditional
 * `fail`, which conflated two different situations:
 *
 *   1. the post_game_events screen WAS recorded and the penalty parser lost the
 *      rows — a real correctness defect, and still a `fail`; and
 *   2. the screen was never recorded at all, so there was no penalty source to
 *      parse — a coverage gap in the capture, downgraded to `warn`.
 *
 * Case 2 mattered because class D is one of the gates `auto-drain` consults.
 * Failing it withheld the match's entire (correct) action-tracker surface over
 * penalties that no amount of re-processing could ever recover. Measured at the
 * time of the change: 27 matches were shape 2 and 6 were shape 1.
 *
 * The invariant asserted here is the general one, not those golden numbers:
 * severity must be `fail` iff a post_game_events segment exists for the match.
 *
 * The segment probe is deliberately NOT live-run-scoped — see the rationale in
 * `quality-inputs.ts`. This test mirrors that by counting segments across all
 * runs; if the production query ever gains a run filter, the two disagree and
 * this fails.
 *
 * Integration-style: requires DATABASE_URL. Skips gracefully without it, and
 * runs against the isolated clone via `with-test-db.mjs`.
 */

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { db, sql as dbSql } from '@eanhl/db'
import { getMatchById } from '@eanhl/db/queries'
import { sql } from 'drizzle-orm'
import { buildQualityFlags } from '../lib/quality-inputs.js'

interface ClassDShape {
  match_id: number
  ea_pim: number
  ev_segments: number
}

/**
 * Matches that FIRE class D — EA PIM > 0 and zero penalty rows — split by
 * whether the events screen was ever recorded.
 */
async function classDFiringMatches(wantSegments: boolean, limit: number): Promise<ClassDShape[]> {
  const rows = (await db.execute(sql`
    WITH d AS (
      SELECT m.id AS match_id,
             COALESCE(m.penalty_minutes, 0) + COALESCE(m.penalty_minutes_against, 0) AS ea_pim,
             (SELECT COUNT(*) FROM ocr_segments s
               WHERE s.match_id = m.id AND s.state = 'post_game_events') AS ev_segments,
             (SELECT COUNT(*) FROM match_events me
               WHERE me.match_id = m.id AND me.event_type = 'penalty') AS pen_rows
      FROM matches m
      WHERE EXISTS (SELECT 1 FROM ocr_extractions e WHERE e.match_id = m.id)
    )
    SELECT match_id, ea_pim, ev_segments
    FROM d
    WHERE ea_pim > 0
      AND pen_rows = 0
      AND ev_segments ${wantSegments ? sql`> 0` : sql`= 0`}
    ORDER BY match_id
    LIMIT ${limit}
  `)) as unknown as Array<{ match_id: number; ea_pim: string; ev_segments: string }>
  return rows.map((r) => ({
    match_id: Number(r.match_id),
    ea_pim: Number(r.ea_pim),
    ev_segments: Number(r.ev_segments),
  }))
}

function classDFlags(flags: Awaited<ReturnType<typeof buildQualityFlags>>) {
  return flags.filter((f) => f.classId === 'D')
}

test('class D downgrades to warn when the events screen was never recorded', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — class-D severity check requires DB.')
    return
  }

  const candidates = await classDFiringMatches(false, 6)
  assert.ok(
    candidates.length > 0,
    'expected at least one match with EA PIM > 0, no penalty rows, and no post_game_events ' +
      'segment — the recording-gap shape the downgrade exists for',
  )

  for (const c of candidates) {
    const match = await getMatchById(c.match_id)
    assert.ok(match, `match ${String(c.match_id)} should exist`)

    const d = classDFlags(await buildQualityFlags(c.match_id, match))
    assert.equal(
      d.length,
      1,
      `match ${String(c.match_id)}: expected exactly one class-D flag, got ${String(d.length)}`,
    )
    assert.equal(
      d[0]!.severity,
      'warn',
      `match ${String(c.match_id)}: EA reports ${String(c.ea_pim)} PIM and the events screen was ` +
        `never recorded (0 segments), so the missing penalties are a coverage gap, not a parser ` +
        `defect — class D must not block promotion with a 'fail'.`,
    )
    assert.match(
      d[0]!.message,
      /never recorded/,
      `match ${String(c.match_id)}: the warn message must say why it was downgraded`,
    )
  }
})

test('class D stays fail when the events screen WAS recorded', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — class-D severity check requires DB.')
    return
  }

  const candidates = await classDFiringMatches(true, 6)
  assert.ok(
    candidates.length > 0,
    'expected at least one match with EA PIM > 0, no penalty rows, and a post_game_events ' +
      'segment present — the genuine parser-failure shape. Without one, the downgrade is ' +
      'untested against the case it must NOT apply to.',
  )

  for (const c of candidates) {
    const match = await getMatchById(c.match_id)
    assert.ok(match, `match ${String(c.match_id)} should exist`)

    const d = classDFlags(await buildQualityFlags(c.match_id, match))
    assert.equal(
      d.length,
      1,
      `match ${String(c.match_id)}: expected exactly one class-D flag, got ${String(d.length)}`,
    )
    assert.equal(
      d[0]!.severity,
      'fail',
      `match ${String(c.match_id)}: ${String(c.ev_segments)} post_game_events segment(s) were ` +
        `recorded, so the penalties had a source and losing them IS a parser defect. Downgrading ` +
        `this would let a real extraction failure publish.`,
    )
    assert.match(
      d[0]!.message,
      /parser failed/,
      `match ${String(c.match_id)}: the fail message must name the parser failure`,
    )
  }
})

test('class D does not fire when EA reports no PIM', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — class-D severity check requires DB.')
    return
  }

  // Guards the precondition rather than the severity: the downgrade must not
  // have widened the FIRE condition. A match with no EA penalties has nothing
  // to reconcile, so class D must stay silent regardless of segment coverage.
  const rows = (await db.execute(sql`
    SELECT m.id AS match_id
    FROM matches m
    WHERE COALESCE(m.penalty_minutes, 0) + COALESCE(m.penalty_minutes_against, 0) = 0
      AND EXISTS (SELECT 1 FROM ocr_extractions e WHERE e.match_id = m.id)
    ORDER BY m.id
    LIMIT 5
  `)) as unknown as Array<{ match_id: number }>
  assert.ok(rows.length > 0, 'expected at least one OCR-ingested match with zero EA PIM')

  for (const r of rows) {
    const matchId = Number(r.match_id)
    const match = await getMatchById(matchId)
    if (!match) continue
    const d = classDFlags(await buildQualityFlags(matchId, match))
    assert.equal(
      d.length,
      0,
      `match ${String(matchId)}: EA reports no PIM, so class D has nothing to flag`,
    )
  }
})

after(async () => {
  await dbSql.end()
})
