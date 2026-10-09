/**
 * `init-admin` — mint the ONE bootstrap admin invite (member logins, step 1).
 *
 * Logins are Discord-only and invite-only, and invites are made by an admin on
 * /admin/accounts — so the first admin needs a way in that the website can't
 * offer. This is it: run on the server, it prints a single-use link bound to
 * the given player with the admin role. Opening it and signing in with Discord
 * creates the account (apps/web/src/lib/auth.ts).
 *
 *   docker compose exec worker node dist/init-admin-cli.js --player-id 2
 *
 * Refuses once any admin exists: an empty-of-admins database is the only state
 * in which a shell on the server is the right authority. Only the token's hash
 * is stored; the link is shown once. Re-running before the link is used just
 * replaces it (createAccountInvite revokes the older pending invite).
 *
 * Bad arguments are refused before the database module is loaded.
 * Covered by ./__tests__/init-admin-cli.test.ts.
 */

import { INIT_ADMIN_USAGE, parseInitAdminArgs } from './init-admin-args.js'

async function main(): Promise<number> {
  const parsed = parseInitAdminArgs(process.argv.slice(2), process.env)
  if (parsed.kind === 'help') {
    console.log(INIT_ADMIN_USAGE)
    return 0
  }
  if (parsed.kind === 'error') {
    console.error(`[init-admin] ${parsed.message}\n\n${INIT_ADMIN_USAGE}`)
    return 2
  }
  const { playerId, hours, baseUrl, dryRun } = parsed.args

  const { db, sql, players, userPlayerClaims } = await import('@eanhl/db')
  const { createAccountInvite, hasAdminUser } = await import('@eanhl/db/queries')
  const { eq } = await import('drizzle-orm')

  try {
    if (await hasAdminUser()) {
      console.error(
        '[init-admin] refusing: an admin already exists. Create invites from /admin/accounts ' +
          'while signed in as that admin.',
      )
      return 1
    }

    const rows = await db
      .select({ gamertag: players.gamertag, claimedBy: userPlayerClaims.userId })
      .from(players)
      .leftJoin(userPlayerClaims, eq(userPlayerClaims.playerId, players.id))
      .where(eq(players.id, playerId))
      .limit(1)
    const player = rows[0]
    if (!player) {
      console.error(`[init-admin] no player with id ${String(playerId)}.`)
      return 1
    }
    if (player.claimedBy !== null) {
      console.error(`[init-admin] ${player.gamertag} is already linked to an account.`)
      return 1
    }

    if (dryRun) {
      console.log(
        `[init-admin] dry run: would create a ${String(hours)}h admin invite for ` +
          `${player.gamertag} (player ${String(playerId)}) at ${baseUrl}. Nothing was written.`,
      )
      return 0
    }

    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000)
    const { token } = await createAccountInvite({
      role: 'admin',
      claimedPlayerId: playerId,
      invitedByUserId: null,
      expiresAt,
    })
    console.log(
      `[init-admin] admin invite for ${player.gamertag} — works once, until ` +
        `${expiresAt.toISOString()}:\n\n  ${baseUrl}/invite/${token}\n\n` +
        'Open it and sign in with Discord. The link is not stored; if you lose it, run this again.',
    )
    return 0
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined)
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error('[init-admin] failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  },
)
