/**
 * `init-admin` — the bootstrap admin invite (member logins step 1).
 *
 * Spawns the real compiled command (`dist/init-admin-cli.js`, what
 * `docker compose exec worker node dist/init-admin-cli.js` runs) and checks:
 *
 *   1. Bad arguments are refused BEFORE the database module loads (with
 *      DATABASE_URL unset there is no "DATABASE_URL is required" failure).
 *   2. Against a clone: it prints one invite link, stores only the token's
 *      hash, binds the admin role and the player, and has no inviter.
 *   3. --dry-run writes nothing.
 *   4. It refuses once an admin exists.
 *
 * Database cases run only against an `eanhl_test_*` clone:
 *
 *   pnpm --filter @eanhl/worker build
 *   set -a && . ~/.config/eanhl/verify.env && set +a
 *   node apps/worker/scripts/with-test-db.mjs init-admin-cli
 */

import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseInitAdminArgs } from '../init-admin-args.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../../..')
const CLI_PATH = path.join(REPO_ROOT, 'apps/worker/dist/init-admin-cli.js')

const GAMERTAG = 'init-admin-inttest-player'
const ADMIN_ID = 'init-admin-inttest-admin'

function runCli(args: string[], env: Record<string, string | undefined> = {}) {
  const merged: Record<string, string | undefined> = { ...process.env, ...env }
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    env: Object.fromEntries(
      Object.entries(merged).filter((e): e is [string, string] => e[1] !== undefined),
    ),
    encoding: 'utf8',
    timeout: 30_000,
  })
}

void test('argument parsing', () => {
  const env = { APP_BASE_URL: 'https://boogeymen.app' }
  assert.deepEqual(parseInitAdminArgs(['--player-id', '2'], env), {
    kind: 'ok',
    args: { playerId: 2, hours: 24, baseUrl: 'https://boogeymen.app', dryRun: false },
  })
  assert.equal(parseInitAdminArgs(['--help'], env).kind, 'help')
  assert.equal(parseInitAdminArgs([], env).kind, 'error')
  assert.equal(parseInitAdminArgs(['--player-id', '0'], env).kind, 'error')
  assert.equal(parseInitAdminArgs(['--player-id', '2', '--hours', '200'], env).kind, 'error')
  assert.equal(parseInitAdminArgs(['--player-id', '2'], {}).kind, 'error', 'needs a site URL')
  assert.equal(
    parseInitAdminArgs(['--player-id', '2', '--base-url', 'http://boogeymen.app'], {}).kind,
    'error',
    'https outside localhost',
  )
  const local = parseInitAdminArgs(['--player-id', '2', '--base-url', 'http://localhost:3000/'], {})
  assert.equal(local.kind === 'ok' ? local.args.baseUrl : null, 'http://localhost:3000')
  assert.equal(parseInitAdminArgs(['--player-id', '2', '--password', 'x'], env).kind, 'error')
})

void test('bad arguments are refused before the database is loaded', () => {
  for (const args of [[], ['--player-id', 'abc'], ['--nope']]) {
    const r = runCli(args, { DATABASE_URL: undefined, APP_BASE_URL: 'https://boogeymen.app' })
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`)
    assert.doesNotMatch(r.stderr, /DATABASE_URL/)
  }
  const help = runCli(['--help'], { DATABASE_URL: undefined })
  assert.equal(help.status, 0)
  assert.match(help.stdout, /--player-id/)
})

const dbUrl = process.env['DATABASE_URL']
const onClone = Boolean(dbUrl) && new URL(dbUrl ?? 'x:/').pathname.slice(1).startsWith('eanhl_test')

after(async () => {
  if (onClone) {
    const { sql } = await import('@eanhl/db')
    await sql.end({ timeout: 1 }).catch(() => undefined)
  }
})

void test(
  'mints one admin invite, dry-run writes nothing, refuses once an admin exists',
  { skip: onClone ? false : 'needs an eanhl_test_* clone (run through with-test-db.mjs)' },
  async () => {
    const { db, players, users, accountInvites, userPlayerClaims } = await import('@eanhl/db')
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
      await db.delete(users).where(eq(users.id, ADMIN_ID))
      if (ids.length > 0) await db.delete(players).where(inArray(players.id, ids))
    }
    await cleanup()
    // The clone is a copy of eanhl_test; a real admin there would make every
    // case below refuse. The verification seed has none.
    const admins = await db.select().from(users).where(eq(users.role, 'admin'))
    assert.equal(admins.length, 0, 'the clone must start with no admin')

    try {
      const [player] = await db.insert(players).values({ gamertag: GAMERTAG }).returning()
      assert.ok(player)
      const args = ['--player-id', String(player.id), '--base-url', 'https://example.test']
      const invitesFor = () =>
        db.select().from(accountInvites).where(eq(accountInvites.claimedPlayerId, player.id))

      const dry = runCli([...args, '--dry-run'])
      assert.equal(dry.status, 0, dry.stderr)
      assert.match(dry.stdout, /dry run/)
      assert.equal((await invitesFor()).length, 0, '--dry-run wrote an invite')

      const real = runCli([...args, '--hours', '2'])
      assert.equal(real.status, 0, real.stderr)
      const link = /https:\/\/example\.test\/invite\/([A-Za-z0-9_-]+)/.exec(real.stdout)
      assert.ok(link, `no invite link printed: ${real.stdout}`)
      const token = link[1]!
      const stored = await invitesFor()
      assert.equal(stored.length, 1)
      assert.equal(stored[0]!.tokenHash, createHash('sha256').update(token).digest('hex'))
      assert.equal(stored[0]!.role, 'admin')
      assert.equal(stored[0]!.invitedByUserId, null)
      assert.equal(stored[0]!.email, null)
      const hoursLeft = (stored[0]!.expiresAt.getTime() - Date.now()) / 3_600_000
      assert.ok(hoursLeft > 1.9 && hoursLeft <= 2, `expiry ${String(hoursLeft)}h`)

      await db.insert(users).values({
        id: ADMIN_ID,
        name: ADMIN_ID,
        email: `${ADMIN_ID}@users.invalid`,
        role: 'admin',
      })
      const refused = runCli(args)
      assert.equal(refused.status, 1)
      assert.match(refused.stderr, /an admin already exists/)
      assert.equal((await invitesFor()).length, 1, 'a refused run wrote an invite')
    } finally {
      await cleanup()
    }
  },
)
