/**
 * Regression test for `recomputeClubStats` (apps/worker/src/aggregate.ts).
 *
 * THE DEFECT UNDER TEST
 * ----------------------
 * `recomputeClubStats` runs an aggregate SELECT over `matches` with no GROUP BY.
 * Over zero matching rows, Postgres still returns exactly one row from a
 * GROUP-BY-less aggregate: COUNT(*) = 0 and every SUM(...) = NULL. That row was
 * then INSERTed into `club_game_title_stats`, whose `games_played` / `wins` /
 * `losses` / `otl` / `goals_for` / `goals_against` columns are NOT NULL —
 * producing a NOT NULL constraint violation. `runIngestionCycle` (ingest.ts)
 * catches that exception per game title, so the worker keeps running but never
 * persists club aggregates for that title/mode. The fix adds
 * `HAVING COUNT(*) > 0` so a genuinely empty dimension yields zero rows from the
 * SELECT (matching the row-fabrication-free behavior `recomputePlayerStats`
 * already has via its `GROUP BY player_id`), instead of one row of nulls.
 *
 * WHY THIS LIVES UNDER apps/worker/src/__tests__
 * ------------------------------------------------
 * DB-mutating integration test; must run against the throwaway clone via
 * apps/worker/scripts/with-test-db.mjs, never the live database.
 *
 * Build + run (focused):
 *   pnpm --filter @eanhl/db build
 *   pnpm --filter @eanhl/worker build
 *   set -a && source .env && set +a
 *   node apps/worker/scripts/with-test-db.mjs aggregate-club-stats-empty-set
 */

import test, { after } from 'node:test'
import assert from 'node:assert/strict'

// Close the DB pool so `node --test` can exit (mirror match-association-queries.test.ts).
after(async () => {
  if (process.env.DATABASE_URL) {
    const { sql } = await import('@eanhl/db')
    await sql.end({ timeout: 1 }).catch(() => undefined)
  }
})

void test('recomputeClubStats: game title with zero matches writes no club aggregate rows and does not throw', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL not set — aggregate-club-stats-empty-set integration requires DB.')
    return
  }

  const { db, gameTitles, clubGameTitleStats } = await import('@eanhl/db')
  const { eq } = await import('drizzle-orm')
  const { recomputeAggregates } = await import('../aggregate.js')

  const slug = `test-agg-empty-${Date.now().toString(36)}`
  const [title] = await db
    .insert(gameTitles)
    .values({
      slug,
      name: 'Aggregate Empty-Set Test Title',
      eaPlatform: 'common-gen5',
      eaClubId: '999999',
      apiBaseUrl: 'https://example.invalid',
    })
    .returning({ id: gameTitles.id })
  assert.ok(title, 'game title insert returned a row')

  try {
    await assert.doesNotReject(recomputeAggregates(title.id))

    const rows = await db
      .select()
      .from(clubGameTitleStats)
      .where(eq(clubGameTitleStats.gameTitleId, title.id))
    assert.deepEqual(rows, [], 'no club aggregate rows fabricated for a title with zero matches')
  } finally {
    await db.delete(clubGameTitleStats).where(eq(clubGameTitleStats.gameTitleId, title.id))
    await db.delete(gameTitles).where(eq(gameTitles.id, title.id))
  }
})

void test('recomputeClubStats: 6s-only matches produce correct combined+6s rows, no fabricated 3s row, and stay idempotent on repeat', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL not set — aggregate-club-stats-empty-set integration requires DB.')
    return
  }

  const { db, gameTitles, matches, clubGameTitleStats } = await import('@eanhl/db')
  const { eq, and, isNull } = await import('drizzle-orm')
  const { recomputeAggregates } = await import('../aggregate.js')

  const slug = `test-agg-6s-only-${Date.now().toString(36)}`
  const [title] = await db
    .insert(gameTitles)
    .values({
      slug,
      name: 'Aggregate 6s-Only Test Title',
      eaPlatform: 'common-gen5',
      eaClubId: '999998',
      apiBaseUrl: 'https://example.invalid',
    })
    .returning({ id: gameTitles.id })
  assert.ok(title, 'game title insert returned a row')

  try {
    await db.insert(matches).values([
      {
        gameTitleId: title.id,
        eaMatchId: `${slug}-1`,
        matchType: 'gameType5',
        opponentClubId: 'opp-1',
        opponentName: 'Opponent One',
        playedAt: new Date('2026-01-01T00:00:00Z'),
        result: 'WIN',
        scoreFor: 5,
        scoreAgainst: 2,
        shotsFor: 30,
        shotsAgainst: 25,
        hitsFor: 10,
        hitsAgainst: 6,
        faceoffPct: '55.00',
        gameMode: '6s',
      },
      {
        gameTitleId: title.id,
        eaMatchId: `${slug}-2`,
        matchType: 'gameType5',
        opponentClubId: 'opp-2',
        opponentName: 'Opponent Two',
        playedAt: new Date('2026-01-02T00:00:00Z'),
        result: 'LOSS',
        scoreFor: 1,
        scoreAgainst: 4,
        shotsFor: 20,
        shotsAgainst: 22,
        hitsFor: 8,
        hitsAgainst: 9,
        faceoffPct: '45.00',
        gameMode: '6s',
      },
    ])

    for (const pass of ['first', 'second'] as const) {
      await assert.doesNotReject(
        recomputeAggregates(title.id),
        `recomputeAggregates should not throw on the ${pass} pass`,
      )

      const rows = await db
        .select()
        .from(clubGameTitleStats)
        .where(eq(clubGameTitleStats.gameTitleId, title.id))
      assert.equal(rows.length, 2, `expected exactly a combined row + a 6s row on the ${pass} pass`)

      const threes = await db
        .select()
        .from(clubGameTitleStats)
        .where(
          and(eq(clubGameTitleStats.gameTitleId, title.id), eq(clubGameTitleStats.gameMode, '3s')),
        )
      assert.deepEqual(threes, [], `no fabricated 3s row on the ${pass} pass`)

      const [combined] = await db
        .select()
        .from(clubGameTitleStats)
        .where(
          and(eq(clubGameTitleStats.gameTitleId, title.id), isNull(clubGameTitleStats.gameMode)),
        )
      assert.ok(combined, `combined (NULL game_mode) row exists on the ${pass} pass`)
      assert.equal(combined.gamesPlayed, 2)
      assert.equal(combined.wins, 1)
      assert.equal(combined.losses, 1)
      assert.equal(combined.otl, 0)
      assert.equal(combined.goalsFor, 6)
      assert.equal(combined.goalsAgainst, 6)
      assert.equal(combined.shotsPerGame, '25.00')
      assert.equal(combined.hitsPerGame, '9.00')
      assert.equal(combined.faceoffPct, '50.00')

      const [sixes] = await db
        .select()
        .from(clubGameTitleStats)
        .where(
          and(eq(clubGameTitleStats.gameTitleId, title.id), eq(clubGameTitleStats.gameMode, '6s')),
        )
      assert.ok(sixes, `6s row exists on the ${pass} pass`)
      assert.equal(sixes.gamesPlayed, 2)
      assert.equal(sixes.wins, 1)
      assert.equal(sixes.losses, 1)
      assert.equal(sixes.otl, 0)
      assert.equal(sixes.goalsFor, 6)
      assert.equal(sixes.goalsAgainst, 6)
      assert.equal(sixes.shotsPerGame, '25.00')
      assert.equal(sixes.hitsPerGame, '9.00')
      assert.equal(sixes.faceoffPct, '50.00')
    }
  } finally {
    await db.delete(clubGameTitleStats).where(eq(clubGameTitleStats.gameTitleId, title.id))
    await db.delete(matches).where(eq(matches.gameTitleId, title.id))
    await db.delete(gameTitles).where(eq(gameTitles.id, title.id))
  }
})
