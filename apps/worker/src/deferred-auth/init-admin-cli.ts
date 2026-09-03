/**
 * DORMANT — the operator-only initial-admin CLI, kept for the post-launch
 * account feature. It is NOT a command any more.
 *
 * Authentication is disabled before launch: the site has no login, account,
 * invitation, session, or administration surface, so there is nothing for an
 * admin account to administer and no page to sign in on. The `init-admin`
 * package script points at ../init-admin-cli.ts, a shim that refuses before it
 * connects to a database, queries `users`, or asks for a password.
 *
 * TWO THINGS MAKE THIS FILE INERT, and both must be undone deliberately:
 *
 *   1. It does not run itself. `main()` is exported as `runInitAdmin` and is
 *      never called at module scope, so importing or even executing the
 *      compiled `dist/deferred-auth/init-admin-cli.js` creates no account —
 *      it evaluates the module and exits.
 *   2. Nothing imports it. apps/worker/src/__tests__/init-admin-cli.test.ts
 *      fails if any active worker module does.
 *
 * Re-enabling it after launch means moving it back to
 * apps/worker/src/init-admin-cli.ts, restoring the `main().catch(...)` tail,
 * and repointing the `init-admin` script — a reviewed source change, not an
 * environment variable. See apps/web/src/deferred/auth/README.md.
 *
 * ---
 * The original documentation follows, and still describes what this code does
 * if it is ever restored.
 *
 * Create the ONE initial admin account. Operator-only, local, deliberate.
 *
 * WHY THIS IS A CLI AND NOT A PAGE
 * --------------------------------
 * This replaces a public "first visitor becomes the admin" flow on /login.
 * An empty `users` table is not authorization — on a public host it means the
 * first stranger to load the page owns the site. Authorization here is instead
 * possession of shell + database access on the host, which is not something an
 * internet visitor can present.
 *
 * PASSWORD HANDLING
 * -----------------
 * The password is NEVER accepted on argv (visible in `ps`, in shell history,
 * and to other users on the host), in an environment variable, in a URL, or
 * from a file in the repo. It is read from stdin only:
 *   - interactive TTY  -> non-echoing prompt, asked twice and compared;
 *   - non-TTY (a pipe) -> read to EOF, for `pass show ... | pnpm ... init-admin`
 *     and for tests.
 * A `--password` flag is explicitly rejected rather than ignored, so an
 * operator reaching for the obvious wrong thing is told why. The password is
 * never echoed, logged, or included in any success/failure message.
 *
 * The hash is produced by better-auth's own `hashPassword`, so the credential
 * is byte-for-byte what the web sign-in path verifies against. Do not
 * reimplement the scrypt parameters here.
 *
 * ATOMICITY AND IDEMPOTENCE
 * -------------------------
 * `createInitialAdmin` does the whole thing — user row, credential row, admin
 * role, player claim — inside one transaction that takes an exclusive lock on
 * `users` and refuses if ANY user already exists. Re-running this CLI after
 * the first success is a no-op that exits non-zero with a clear message; it
 * never edits, promotes, or resets an existing account. Use an admin invite
 * from /admin/accounts for every account after the first.
 *
 * Usage:
 *   pnpm --filter worker init-admin --email you@example.com --name "Your Name" --gamertag Utiz23
 *   pnpm --filter worker init-admin --email you@example.com --name "Your Name" --player-id 12
 *   pnpm --filter worker init-admin --list-players
 *   pnpm --filter worker init-admin ... --dry-run     # validates, writes nothing
 */

import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { hashPassword } from 'better-auth/crypto'
import { db, sql as dbSql, players } from '@eanhl/db'
import { createInitialAdmin, hasAccountUsers, listClaimablePlayers } from '@eanhl/db/queries'
import { eq } from 'drizzle-orm'

const MIN_PASSWORD_LENGTH = 8
/** Mirrors better-auth's `emailAndPassword.maxPasswordLength` in apps/web/src/lib/auth.ts. */
const MAX_PASSWORD_LENGTH = 128

const CTRL_C = '\u0003'
const BACKSPACE = '\u007f'

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function usage(): void {
  console.log('Usage:')
  console.log(
    '  pnpm --filter worker init-admin --email <address> --name <display name> (--gamertag <tag> | --player-id <id>) [--dry-run]',
  )
  console.log('  pnpm --filter worker init-admin --list-players')
  console.log('')
  console.log('The password is read from stdin, never from arguments:')
  console.log('  - on a terminal you are prompted twice, without echo;')
  console.log('  - piped input is read to EOF, e.g.  pass show site/admin | pnpm ... init-admin')
}

/**
 * Read the password from a terminal without echoing it, twice, requiring the
 * two entries to match. Raw mode rather than a masked readline, so not even the
 * length is revealed on screen.
 */
function promptHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const input = process.stdin
    process.stderr.write(prompt)

    const chars: string[] = []
    const wasRaw = input.isRaw
    input.setRawMode(true)
    input.resume()
    input.setEncoding('utf8')

    const finish = (err: Error | null, value: string) => {
      input.setRawMode(wasRaw)
      input.pause()
      input.removeListener('data', onData)
      process.stderr.write('\n')
      if (err) reject(err)
      else resolve(value)
    }

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish(null, chars.join(''))
          return
        }
        if (ch === CTRL_C) {
          finish(new Error('Aborted.'), '')
          return
        }
        if (ch === BACKSPACE || ch === '\b') {
          chars.pop()
          continue
        }
        chars.push(ch)
      }
    }

    input.on('data', onData)
  })
}

async function promptPasswordTwice(): Promise<string> {
  const first = await promptHidden('Password: ')
  const second = await promptHidden('Confirm password: ')
  if (first !== second) throw new Error('Passwords did not match.')
  return first
}

/** Read piped stdin to EOF. A single trailing newline is stripped; nothing else is. */
async function readPipedPassword(): Promise<string> {
  const rl = createInterface({ input: process.stdin })
  const lines: string[] = []
  for await (const line of rl) lines.push(line)
  rl.close()
  return lines.join('\n')
}

function readPassword(): Promise<string> {
  return process.stdin.isTTY ? promptPasswordTwice() : readPipedPassword()
}

async function resolvePlayerId(args: {
  gamertag: string | undefined
  playerIdFlag: string | undefined
}): Promise<number> {
  if (args.playerIdFlag !== undefined) {
    const playerId = Number.parseInt(args.playerIdFlag, 10)
    if (!Number.isFinite(playerId) || playerId <= 0) {
      throw new Error(`invalid --player-id "${args.playerIdFlag}"`)
    }
    const rows = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.id, playerId))
      .limit(1)
    if (!rows[0]) throw new Error(`no player with id ${String(playerId)}`)
    return playerId
  }

  if (args.gamertag !== undefined && args.gamertag !== '') {
    const rows = await db
      .select({ id: players.id })
      .from(players)
      .where(eq(players.gamertag, args.gamertag))
      .limit(1)
    const row = rows[0]
    if (!row) {
      throw new Error(
        `no player with gamertag "${args.gamertag}" — run --list-players, or create the player ` +
          'with `pnpm --filter worker create-player`',
      )
    }
    return row.id
  }

  throw new Error('one of --gamertag or --player-id is required')
}

async function main(): Promise<void> {
  if (hasFlag('help')) {
    usage()
    return
  }

  if (hasFlag('list-players')) {
    for (const row of await listClaimablePlayers()) {
      const claimed = row.isClaimed ? '  (claimed)' : ''
      console.log(`${String(row.id).padStart(5)}  ${row.gamertag}${claimed}`)
    }
    return
  }

  // Refuse the insecure invocation loudly rather than silently ignoring it.
  if (hasFlag('password')) {
    console.error(
      '[init-admin] refusing --password: a password on argv is visible in `ps`, in shell ' +
        'history, and to every other user on this host. The password is read from stdin only.',
    )
    usage()
    process.exitCode = 1
    return
  }

  const email = getFlag('email')?.trim().toLowerCase()
  const name = getFlag('name')?.trim()
  const dryRun = hasFlag('dry-run')

  if (!email || !name) {
    console.error('[init-admin] --email and --name are required')
    usage()
    process.exitCode = 1
    return
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`[init-admin] "${email}" is not a valid email address`)
    process.exitCode = 1
    return
  }

  // Checked before prompting so the operator is not made to type a password
  // that is about to be discarded. This is a courtesy check only — the real,
  // race-free refusal lives inside createInitialAdmin's locked transaction.
  if (await hasAccountUsers()) {
    console.error(
      '[init-admin] refusing: an account already exists in this database. The initial admin ' +
        'is created once. Add further accounts with an admin invite from /admin/accounts.',
    )
    process.exitCode = 1
    return
  }

  let playerId: number
  try {
    playerId = await resolvePlayerId({
      gamertag: getFlag('gamertag')?.trim(),
      playerIdFlag: getFlag('player-id'),
    })
  } catch (err) {
    console.error(`[init-admin] ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
    return
  }

  let password: string
  try {
    password = await readPassword()
  } catch (err) {
    console.error(`[init-admin] ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
    return
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `[init-admin] password must be at least ${String(MIN_PASSWORD_LENGTH)} characters`,
    )
    process.exitCode = 1
    return
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    console.error(`[init-admin] password must be at most ${String(MAX_PASSWORD_LENGTH)} characters`)
    process.exitCode = 1
    return
  }

  if (dryRun) {
    console.log(
      `[init-admin] dry-run: would create admin email=${email} name="${name}" player_id=${String(playerId)}`,
    )
    return
  }

  const userId = randomUUID()
  const accountId = randomUUID()
  const passwordHash = await hashPassword(password)

  try {
    await createInitialAdmin({ userId, accountId, email, name, passwordHash, playerId })
  } catch (err) {
    console.error(`[init-admin] failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
    return
  }

  console.log(
    `[init-admin] created admin user_id=${userId} email=${email} player_id=${String(playerId)}`,
  )
  console.log('[init-admin] sign in at /login, then issue invites from /admin/accounts.')
}

/**
 * The entry point, EXPORTED RATHER THAN CALLED. Restoring this module as a
 * command means restoring the `main().catch(...).finally(...)` tail that used
 * to sit here; until then, running this file does nothing.
 */
export async function runInitAdmin(): Promise<void> {
  try {
    await main()
  } catch (err: unknown) {
    console.error('[init-admin] Fatal error:', err)
    process.exitCode = 1
  } finally {
    void dbSql.end()
  }
}
