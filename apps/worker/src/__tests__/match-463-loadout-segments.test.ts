/**
 * Phase 1 acceptance gate T2 (DEFERRED): match 463's player_loadout_view
 * segment count.
 *
 * PHASE-1 DEFERRED TEST — superseded by match-463-loadout-slots-fixture.test.ts
 * (Phase 2A-23 / T2A).
 *
 * The original Phase-1 floor "≥7 player_loadout_view segments" was based on a
 * misunderstanding of HMM segmentation (the HMM correctly groups contiguous
 * viewing into one segment). The architecturally correct loadout-coverage gate
 * operates at the per-slot evidence-layer level (Phase 2A-23's fixture-based
 * test), not the Pass-1 segment count.
 *
 * Original plan assumption: the HMM would capture ≥7 segments because the
 * legacy run-length segmenter missed sub-second slot traversals. After Task 14
 * re-ingest, we learned the HMM correctly groups contiguous player_loadout_view
 * viewing into a SINGLE segment regardless of how many slots the operator
 * cycles through — slot-level navigation is a within-state event, not a state
 * change. The actual loadout recording (silkyjoker85's 59s pregame clip)
 * produced 1 contiguous 26-frame loadout segment, which is correct.
 *
 * The "≥7 segments" floor was based on a misunderstanding of HMM segmentation.
 * A correct loadout-coverage gate operates at the Pass-2 slot-count level
 * (Phase 2 territory: the loadout-snapshot evidence layer + promoter), not
 * the Pass-1 segment count.
 *
 * This test remains `test.skip`'d permanently with this framing.
 *
 * Skips when DATABASE_URL is unset or match 463 isn't in the DB.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { sql as postgresSql, db, ocrSegments } from '@eanhl/db'
import { and, eq, sql } from 'drizzle-orm'

const MATCH_ID = 463
const TARGET_FLOOR = 7

after(async () => {
  if (process.env['DATABASE_URL']) {
    await postgresSql.end({ timeout: 1 }).catch(() => undefined)
  }
})

function skipIfNoDb(t: { skip: (msg: string) => void }): boolean {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set; skipping match-463 loadout segment test')
    return true
  }
  return false
}

test.skip(
  'match 463 has ≥' + TARGET_FLOOR + ' player_loadout_view segments under HMM decoder',
  async (t) => {
    // Permanently skipped: see file-level docstring for the framing issue.
    if (skipIfNoDb(t)) return

    // Confirm the match exists; cleanly skip if the calibration DB doesn't
    // have it yet (e.g. on a fresh checkout before Task 14 ingests).
    const matchPresent = await db.execute(sql`SELECT 1 FROM matches WHERE id = ${MATCH_ID} LIMIT 1`)
    const rowCount = Array.isArray(matchPresent)
      ? matchPresent.length
      : ((matchPresent as { rows?: unknown[] }).rows?.length ?? 0)
    if (rowCount === 0) {
      t.skip(`match ${MATCH_ID} not in DB; re-ingest via Task 14 first`)
      return
    }

    const rows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ocrSegments)
      .where(
        and(
          eq(ocrSegments.matchId, MATCH_ID),
          eq(ocrSegments.state, 'player_loadout_view' as const),
          eq(ocrSegments.decoderVersion, 'hmm-viterbi-v1'),
        ),
      )

    const count = rows[0]?.count ?? 0
    assert.ok(
      count >= TARGET_FLOOR,
      `expected ≥${TARGET_FLOOR} loadout segments under HMM decoder for match ${MATCH_ID}, got ${count}`,
    )
  },
)
