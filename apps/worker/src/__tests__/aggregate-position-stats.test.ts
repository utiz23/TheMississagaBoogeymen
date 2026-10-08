/**
 * Integration test for `recomputePositionStats` (apps/worker/src/aggregate.ts),
 * which fills player_position_stats (migration 0063) via recomputeAggregates.
 *
 * DB-mutating; must run against the throwaway clone via
 * apps/worker/scripts/with-test-db.mjs, never the live database.
 *
 * Build + run (focused):
 *   pnpm --filter @eanhl/db build
 *   pnpm --filter @eanhl/worker build
 *   set -a && . ~/.config/eanhl/verify.env && set +a
 *   node apps/worker/scripts/with-test-db.mjs aggregate-position-stats
 */

import test, { after } from 'node:test'
import assert from 'node:assert/strict'

after(async () => {
  if (process.env.DATABASE_URL) {
    const { sql } = await import('@eanhl/db')
    await sql.end({ timeout: 1 }).catch(() => undefined)
  }
})

void test('recomputePositionStats: per-position sums, wing = LW + RW, goalies excluded, stale rows removed', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL not set — aggregate-position-stats integration requires DB.')
    return
  }

  const { db, gameTitles, matches, players, playerMatchStats, playerPositionStats } =
    await import('@eanhl/db')
  const { and, eq, inArray, isNull } = await import('drizzle-orm')
  const { recomputeAggregates } = await import('../aggregate.js')

  const slug = `test-agg-pos-${Date.now().toString(36)}`
  const [title] = await db
    .insert(gameTitles)
    .values({
      slug,
      name: 'Aggregate Position Test Title',
      eaPlatform: 'common-gen5',
      eaClubId: '999997',
      apiBaseUrl: 'https://example.invalid',
    })
    .returning({ id: gameTitles.id })
  assert.ok(title)
  const [skater, keeper] = await db
    .insert(players)
    .values([{ gamertag: `${slug}-skater` }, { gamertag: `${slug}-goalie` }])
    .returning({ id: players.id })
  assert.ok(skater && keeper)

  const base = {
    gameTitleId: title.id,
    matchType: 'gameType5' as const,
    opponentClubId: 'opp',
    opponentName: 'Opponent',
    result: 'WIN' as const,
    scoreFor: 3,
    scoreAgainst: 1,
    shotsFor: 20,
    shotsAgainst: 10,
    hitsFor: 5,
    hitsAgainst: 5,
    faceoffPct: '50.00',
  }
  const matchRows = await db
    .insert(matches)
    .values([
      {
        ...base,
        eaMatchId: `${slug}-1`,
        playedAt: new Date('2026-01-01T00:00:00Z'),
        gameMode: '6s' as const,
      },
      {
        ...base,
        eaMatchId: `${slug}-2`,
        playedAt: new Date('2026-01-02T00:00:00Z'),
        gameMode: '6s' as const,
      },
      {
        ...base,
        eaMatchId: `${slug}-3`,
        playedAt: new Date('2026-01-03T00:00:00Z'),
        gameMode: '3s' as const,
      },
      {
        ...base,
        eaMatchId: `${slug}-4`,
        playedAt: new Date('2026-01-04T00:00:00Z'),
        gameMode: '6s' as const,
      },
    ])
    .returning({ id: matches.id })
  const [m1, m2, m3, m4] = matchRows
  assert.ok(m1 && m2 && m3 && m4)
  const matchIds = matchRows.map((m) => m.id)

  try {
    await db.insert(playerMatchStats).values([
      // LW 6s: 3 goals (hat trick), 1 assist, 2 FOW / 1 FOL.
      {
        playerId: skater.id,
        matchId: m1.id,
        position: 'leftWing',
        goals: 3,
        assists: 1,
        faceoffWins: 2,
        faceoffLosses: 1,
      },
      // RW 6s: 1 goal.
      { playerId: skater.id, matchId: m2.id, position: 'rightWing', goals: 1 },
      // LW 3s: 2 assists.
      { playerId: skater.id, matchId: m3.id, position: 'leftWing', assists: 2 },
      // Goalie appearance — never a position row.
      {
        playerId: keeper.id,
        matchId: m1.id,
        position: 'goalie',
        isGoalie: true,
        saves: 9,
        goalsAgainst: 1,
        shotsAgainst: 10,
      },
    ])

    await recomputeAggregates(title.id)

    const rowsFor = async (mode: '6s' | '3s' | null) =>
      db
        .select()
        .from(playerPositionStats)
        .where(
          and(
            eq(playerPositionStats.gameTitleId, title.id),
            mode === null
              ? isNull(playerPositionStats.gameMode)
              : eq(playerPositionStats.gameMode, mode),
          ),
        )
    const pick = (rows: Awaited<ReturnType<typeof rowsFor>>, pos: string) => {
      const row = rows.find((r) => r.position === pos && r.playerId === skater.id)
      if (row === undefined) throw new Error(`no ${pos} row`)
      return row
    }

    const all = await rowsFor(null)
    assert.equal(
      all.some((r) => r.playerId === keeper.id),
      false,
      'goalie has no position rows',
    )
    assert.deepEqual(all.map((r) => r.position).sort(), ['leftWing', 'rightWing', 'wing'])
    const lw = pick(all, 'leftWing')
    assert.equal(lw.gp, 2)
    assert.equal(lw.points, 6)
    assert.equal(lw.hatTricks, 1)
    assert.equal(lw.faceoffPct, '66.67')
    const wing = pick(all, 'wing')
    assert.equal(wing.gp, 3)
    assert.equal(wing.goals, 4)
    assert.equal(wing.points, 7)

    const six = await rowsFor('6s')
    assert.equal(pick(six, 'leftWing').gp, 1)
    assert.equal(pick(six, 'wing').gp, 2)
    const three = await rowsFor('3s')
    assert.deepEqual(three.map((r) => r.position).sort(), ['leftWing', 'wing'])

    // Reprocess moves the 6s LW game to center: the stale 6s RW-only state
    // must not linger and center must appear; recompute stays idempotent.
    await db
      .update(playerMatchStats)
      .set({ position: 'center' })
      .where(and(eq(playerMatchStats.playerId, skater.id), eq(playerMatchStats.matchId, m2.id)))
    await recomputeAggregates(title.id)
    await recomputeAggregates(title.id)
    const sixAfter = await rowsFor('6s')
    assert.deepEqual(sixAfter.map((r) => r.position).sort(), ['center', 'leftWing', 'wing'])
    assert.equal(pick(sixAfter, 'wing').gp, 1)
  } finally {
    await db.delete(playerPositionStats).where(eq(playerPositionStats.gameTitleId, title.id))
    await db.delete(playerMatchStats).where(inArray(playerMatchStats.matchId, matchIds))
    const { playerGameTitleStats, clubGameTitleStats } = await import('@eanhl/db')
    await db.delete(playerGameTitleStats).where(eq(playerGameTitleStats.gameTitleId, title.id))
    await db.delete(clubGameTitleStats).where(eq(clubGameTitleStats.gameTitleId, title.id))
    await db.delete(matches).where(inArray(matches.id, matchIds))
    await db.delete(players).where(inArray(players.id, [skater.id, keeper.id]))
    await db.delete(gameTitles).where(eq(gameTitles.id, title.id))
  }
})
