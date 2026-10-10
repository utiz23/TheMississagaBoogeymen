/**
 * Admin tools C1 queries — integration (plan docs/superpowers/plans/2026-10-09-admin-tools.md).
 *
 * Run through scripts/with-test-db.mjs (throwaway clone). Pin/unpin a synthetic
 * player; AI goalies refuse; sign-everyone-out keeps the caller's session.
 * Synthetic rows only, removed in `finally`.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'

const GAMERTAG = 'admin-inttest-player'
const USER = 'admin-inttest-user'

after(async () => {
  if (process.env['DATABASE_URL']) {
    const { sql } = await import('@eanhl/db')
    await sql.end({ timeout: 1 }).catch(() => undefined)
  }
})

void test('pin, unpin, AI goalie refusal, sign everyone else out', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — admin-queries integration requires DB.')
    return
  }
  const { db, players, users, sessions } = await import('@eanhl/db')
  const {
    listPinCandidates,
    listPinnedPlayers,
    setPlayerPinned,
    revokeAllSessionsExcept,
    listTitlesForAdmin,
  } = await import('@eanhl/db/queries')
  const { eq, isNotNull } = await import('drizzle-orm')

  const cleanup = async () => {
    await db.delete(users).where(eq(users.id, USER))
    await db.delete(players).where(eq(players.gamertag, GAMERTAG))
  }
  await cleanup()
  try {
    const [p] = await db.insert(players).values({ gamertag: GAMERTAG }).returning()
    assert.ok(p)

    assert.ok(
      (await listPinCandidates()).some((c) => c.id === p.id),
      'a guest is a candidate',
    )
    assert.equal(await setPlayerPinned(p.id, true), true)
    assert.ok((await listPinnedPlayers()).some((c) => c.id === p.id))
    assert.ok(
      !(await listPinCandidates()).some((c) => c.id === p.id),
      'pinned: no longer a candidate',
    )
    assert.equal(await setPlayerPinned(p.id, false), true)
    assert.ok(!(await listPinnedPlayers()).some((c) => c.id === p.id))

    const [ai] = await db.select().from(players).where(isNotNull(players.aiGoalieSide)).limit(1)
    if (ai) {
      assert.equal(await setPlayerPinned(ai.id, true), false, 'AI goalies refuse')
      assert.ok(!(await listPinCandidates()).some((c) => c.id === ai.id))
    }

    await db.insert(users).values({ id: USER, name: USER, email: `${USER}@users.invalid` })
    const expiresAt = new Date(Date.now() + 3_600_000)
    await db.insert(sessions).values([
      { id: `${USER}-keep`, token: `${USER}-t1`, userId: USER, expiresAt },
      { id: `${USER}-end`, token: `${USER}-t2`, userId: USER, expiresAt },
    ])
    assert.ok((await revokeAllSessionsExcept(`${USER}-keep`)) >= 1)
    const left = await db.select().from(sessions).where(eq(sessions.userId, USER))
    assert.deepEqual(
      left.map((s) => s.id),
      [`${USER}-keep`],
    )

    const titles = await listTitlesForAdmin()
    assert.ok(titles.length > 0 && titles.every((x) => typeof x.matches === 'number'))
  } finally {
    await cleanup()
  }
})
