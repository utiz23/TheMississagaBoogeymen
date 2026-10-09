/**
 * Discord member invites — integration (member logins step 1, commit 1).
 *
 * Gated on DATABASE_URL like match-association-queries.test.ts; run through
 * scripts/with-test-db.mjs so it lands on a throwaway clone. Exercises the
 * invite lifecycle the sign-up hook relies on: mint → accept (claim + role +
 * accepted) → reuse refused → second invite for a claimed player refused →
 * re-minting revokes the older pending link. Synthetic rows only, removed in
 * `finally`.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'

const GAMERTAG = 'invite-inttest-player'
const USER_A = 'invite-inttest-user-a'
const USER_B = 'invite-inttest-user-b'

after(async () => {
  if (process.env['DATABASE_URL']) {
    const { sql } = await import('@eanhl/db')
    await sql.end({ timeout: 1 }).catch(() => undefined)
  }
})

void test('invite lifecycle: accept links player + role; reuse and claimed player refused', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — account-invites integration requires DB.')
    return
  }

  const { db, players, users, accountInvites, userPlayerClaims } = await import('@eanhl/db')
  const {
    createAccountInvite,
    getAccountInviteByToken,
    evaluateInvite,
    acceptInviteForNewUser,
    deleteAccountUser,
  } = await import('@eanhl/db/queries')
  const { eq, inArray } = await import('drizzle-orm')

  const cleanup = async () => {
    const stale = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.gamertag, GAMERTAG))
    const ids = stale.map((p) => p.id)
    if (ids.length > 0) {
      await db.delete(accountInvites).where(inArray(accountInvites.claimedPlayerId, ids))
      await db.delete(userPlayerClaims).where(inArray(userPlayerClaims.playerId, ids))
    }
    await db.delete(users).where(inArray(users.id, [USER_A, USER_B]))
    if (ids.length > 0) await db.delete(players).where(inArray(players.id, ids))
  }
  await cleanup()

  try {
    const [player] = await db.insert(players).values({ gamertag: GAMERTAG }).returning()
    assert.ok(player)
    const newUser = (id: string) =>
      db.insert(users).values({ id, name: id, email: `${id}@users.invalid` })
    await newUser(USER_A)
    await newUser(USER_B)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000)

    // Re-minting for the same player revokes the older pending link.
    const first = await createAccountInvite({
      role: 'admin',
      claimedPlayerId: player.id,
      invitedByUserId: null,
      expiresAt,
    })
    const second = await createAccountInvite({
      role: 'admin',
      claimedPlayerId: player.id,
      invitedByUserId: null,
      expiresAt,
    })
    assert.equal(evaluateInvite(await getAccountInviteByToken(first.token)), 'revoked')
    assert.equal(await acceptInviteForNewUser({ token: first.token, userId: USER_A }), 'revoked')

    // Only the hash is stored, never the raw token.
    const stored = await db
      .select()
      .from(accountInvites)
      .where(eq(accountInvites.id, second.invite.id))
    assert.notEqual(stored[0]?.tokenHash, second.token)
    assert.equal(stored[0]?.email, null)

    const open = await getAccountInviteByToken(second.token)
    assert.equal(open?.claimedPlayerGamertag, GAMERTAG)
    assert.equal(evaluateInvite(open), 'ok')

    assert.equal(await acceptInviteForNewUser({ token: second.token, userId: USER_A }), 'ok')
    const [a] = await db.select().from(users).where(eq(users.id, USER_A))
    assert.equal(a?.role, 'admin')
    const claim = await db
      .select()
      .from(userPlayerClaims)
      .where(eq(userPlayerClaims.userId, USER_A))
    assert.equal(claim[0]?.playerId, player.id)
    assert.equal(claim[0]?.assignedByUserId, USER_A, 'operator-CLI invite: self-assigned')

    // The used link can't be reused by anyone else.
    assert.equal(await acceptInviteForNewUser({ token: second.token, userId: USER_B }), 'accepted')

    // A fresh invite for a player someone already owns is refused.
    const third = await createAccountInvite({
      role: 'user',
      claimedPlayerId: player.id,
      invitedByUserId: USER_A,
      expiresAt,
    })
    assert.equal(evaluateInvite(await getAccountInviteByToken(third.token)), 'player_claimed')
    assert.equal(
      await acceptInviteForNewUser({ token: third.token, userId: USER_B }),
      'player_claimed',
    )
    const [b] = await db.select().from(users).where(eq(users.id, USER_B))
    assert.equal(b?.role, 'user', 'a refused accept changes nothing')

    assert.equal(
      await acceptInviteForNewUser({ token: 'no-such-token', userId: USER_B }),
      'not_found',
    )

    // The compensating delete used by the sign-up hook removes a user cleanly.
    await deleteAccountUser(USER_B)
    assert.equal((await db.select().from(users).where(eq(users.id, USER_B))).length, 0)
  } finally {
    await cleanup()
  }
})
