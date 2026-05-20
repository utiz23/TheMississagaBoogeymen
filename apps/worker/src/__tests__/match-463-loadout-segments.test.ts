/**
 * Phase 1 acceptance gate T2: match 463's player_loadout_view segments.
 *
 * Before Phase 1 the legacy run-length segmenter captured only 2 of ~10
 * loadout slots from the unattended match 463 capture, because brief
 * sub-second slot traversals fell below `min_run_to_open=2 frames @ 1 fps`.
 *
 * The HMM/Viterbi decoder with `player_loadout_view.min_duration=0.5s`
 * (Round 4 §4) recovers those segments. This test locks the post-Phase-1
 * floor so a regression that re-loses them is caught immediately.
 *
 * The test is `test.skip`'d until Task 14 re-ingests match 463 through the
 * HMM path. Task 14 flips this to `test(...)` once the data is in place.
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
    // Guard becomes active when Task 14 removes the `.skip`.
    if (skipIfNoDb(t)) return

    // Confirm the match exists; cleanly skip if the calibration DB doesn't
    // have it yet (e.g. on a fresh checkout before Task 14 ingests).
    const matchPresent = await db.execute(
      sql`SELECT 1 FROM matches WHERE id = ${MATCH_ID} LIMIT 1`,
    )
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
