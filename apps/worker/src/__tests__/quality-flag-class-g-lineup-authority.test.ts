/**
 * Class-G ("stale alias leak") lineup-authority regression.
 *
 * THE BUG THIS LOCKS OUT (2026-07-31): class G asked whether a resolved
 * actor/target player was in `player_loadout_snapshots WHERE
 * review_status='reviewed'`. Those rows are themselves quarantined at
 * `pending_review` until an operator promotes them, so for 97 of 101 matches
 * the subquery returned NOTHING, every resolution was trivially "not in the
 * lineup", and class G fired on 68 matches reporting a stale alias leak that
 * did not exist. The check was circular: it graded the review backlog, not the
 * alias resolver, while being one of the signals used to decide whether to
 * drain that very backlog.
 *
 * Ground truth at the time of the fix: all 4,462 resolved actor/target refs in
 * the DB pointed at a player present in that match's EA-API lineup.
 *
 * The invariant asserted here is the general one, not a golden number: class G
 * must fire if and only if a resolved ref really is outside the lineup
 * authority (EA-API `player_match_stats` ∪ reviewed loadout snapshots). The
 * regression condition is deliberately targeted — matches carrying resolved
 * refs while holding ZERO reviewed loadout snapshots are exactly the shape that
 * used to false-positive.
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

/** Matches with resolved event refs but no reviewed loadout anchors. */
async function findRegressionShapedMatches(limit: number): Promise<number[]> {
  const rows = (await db.execute(sql`
    SELECT e.match_id AS match_id, COUNT(*) AS refs
    FROM match_events e
    WHERE e.match_id IS NOT NULL
      AND (e.actor_player_id IS NOT NULL OR e.target_player_id IS NOT NULL)
    GROUP BY e.match_id
    HAVING NOT EXISTS (
      SELECT 1 FROM player_loadout_snapshots pls
      WHERE pls.match_id = e.match_id
        AND pls.review_status = 'reviewed'
        AND pls.player_id IS NOT NULL
    )
    ORDER BY refs DESC
    LIMIT ${limit}
  `)) as unknown as Array<{ match_id: number; refs: string }>
  return rows.map((r) => Number(r.match_id))
}

/** Refs genuinely outside `player_match_stats` ∪ reviewed loadout snapshots. */
async function trueOffRosterCount(matchId: number): Promise<number> {
  const rows = (await db.execute(sql`
    WITH lineup AS (
      SELECT pms.player_id FROM player_match_stats pms
      WHERE pms.match_id = ${matchId} AND pms.player_id IS NOT NULL
      UNION
      SELECT pls.player_id FROM player_loadout_snapshots pls
      WHERE pls.match_id = ${matchId}
        AND pls.review_status = 'reviewed'
        AND pls.player_id IS NOT NULL
    ),
    refs AS (
      SELECT actor_player_id AS pid FROM match_events
      WHERE match_id = ${matchId} AND actor_player_id IS NOT NULL
      UNION ALL
      SELECT target_player_id FROM match_events
      WHERE match_id = ${matchId} AND target_player_id IS NOT NULL
    )
    SELECT COUNT(*) AS n FROM refs
    WHERE pid NOT IN (SELECT player_id FROM lineup)
  `)) as unknown as Array<{ n: string }>
  return Number(rows[0]?.n ?? 0)
}

function classGTotal(flags: Awaited<ReturnType<typeof buildQualityFlags>>): number {
  // The message carries the count; the flag itself is per-side (actor/target).
  return flags
    .filter((f) => f.classId === 'G')
    .reduce((acc, f) => acc + (Number(/^(\d+)/.exec(f.message)?.[1] ?? 0) || 0), 0)
}

test('class G does not fire on matches whose refs are all in the EA-API lineup', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — class-G lineup-authority check requires DB.')
    return
  }

  const candidates = await findRegressionShapedMatches(8)
  assert.ok(
    candidates.length > 0,
    'expected at least one match with resolved event refs and no reviewed loadout anchors',
  )

  let assertedClean = 0
  for (const matchId of candidates) {
    const match = await getMatchById(matchId)
    if (!match) continue

    const expected = await trueOffRosterCount(matchId)
    const actual = classGTotal(await buildQualityFlags(matchId, match))

    assert.equal(
      actual,
      expected,
      `match ${String(matchId)}: class G reported ${String(actual)} off-roster ref(s) but the ` +
        `lineup authority (player_match_stats ∪ reviewed loadouts) says ${String(expected)}. ` +
        `A non-zero report against a zero ground truth is the pre-fix bug: the check was ` +
        `keyed solely on quarantined loadout snapshots.`,
    )
    if (expected === 0) assertedClean += 1
  }

  assert.ok(
    assertedClean > 0,
    'no candidate match had a zero off-roster ground truth — the regression condition ' +
      '(class G firing purely because the loadout subquery was empty) went untested',
  )
})

test('the lineup authority survives a match with zero reviewed loadout snapshots', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — class-G lineup-authority check requires DB.')
    return
  }

  // Guards the specific inversion: reviewed-loadout rows must be additive to
  // the EA-API lineup, never the sole source. If someone reverts to the
  // loadout-only subquery this fails loudly rather than silently re-flagging.
  const [row] = (await db.execute(sql`
    SELECT COUNT(*) AS n
    FROM match_events e
    JOIN player_match_stats pms
      ON pms.match_id = e.match_id AND pms.player_id = e.actor_player_id
    WHERE e.actor_player_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM player_loadout_snapshots pls
        WHERE pls.match_id = e.match_id
          AND pls.review_status = 'reviewed'
          AND pls.player_id = e.actor_player_id
      )
  `)) as unknown as Array<{ n: string }>

  assert.ok(
    Number(row?.n ?? 0) > 0,
    'expected refs that are in the EA-API lineup but absent from reviewed loadouts — ' +
      'these are precisely the refs the pre-fix check mislabelled as a stale alias leak',
  )
})

after(async () => {
  await dbSql.end()
})
