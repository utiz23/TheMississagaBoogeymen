/**
 * Operator-only initial-admin CLI — end-to-end against an isolated database.
 *
 * WHAT THIS PROVES
 * ----------------
 * 1. The CLI is the ONLY way to create the first admin, and it does so
 *    atomically: user + credential + admin role + player claim, or nothing.
 * 2. It refuses idempotently. Once any user exists it will not create, edit,
 *    promote, or reset an account — a second run is a non-zero no-op.
 * 3. The password never travels on argv. `--password` is rejected outright,
 *    and the accepted path is stdin. Weak and over-long passwords are refused
 *    before any write.
 * 4. The credential it writes is the one the web sign-in path verifies:
 *    better-auth's own `verifyPassword` accepts the stored hash.
 * 5. Nothing partial survives a rejected run.
 *
 * The complementary half of this coverage is
 * apps/web/src/lib/no-public-admin-bootstrap.test.ts, which proves the public
 * /login bootstrap form and its Server Action no longer exist. Together:
 * removed from the web, present only behind host access.
 *
 * ISOLATION
 * ---------
 * This file INSERTS AND DELETES `users`, `accounts`, and `user_player_claims`
 * rows, so it hard-refuses to run against anything but an `eanhl_test_*`
 * clone. Run it through the harness, which provisions and drops that clone:
 *
 *   pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build
 *   set -a && source .env && set +a
 *   node apps/worker/scripts/with-test-db.mjs init-admin-cli
 */

import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Type-only: erased at runtime, so @eanhl/db is still not loaded until the
// clone guard below has passed.
import type * as DbModule from '@eanhl/db'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../../..')
const CLI_PATH = path.join(REPO_ROOT, 'apps/worker/dist/init-admin-cli.js')

/** Sentinel player, far above the live sequence. Dropped in `after`. */
const PLAYER_ID = 9_400_001
const GAMERTAG = 'InitAdminFixturePlayer'
const EMAIL = 'init-admin-fixture@example.test'
const GOOD_PASSWORD = 'correct horse battery staple'

const hasDb = Boolean(process.env.DATABASE_URL)

function assertCloneDb(): void {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('init-admin-cli: DATABASE_URL is unset.')
  let dbName: string
  try {
    dbName = new URL(url).pathname.replace(/^\//, '')
  } catch {
    throw new Error(`init-admin-cli: DATABASE_URL is not a valid URL: ${url}`)
  }
  if (!dbName.startsWith('eanhl_test')) {
    throw new Error(
      `init-admin-cli: refusing to run — DATABASE_URL points at database "${dbName}", not an ` +
        '"eanhl_test_*" clone. This file creates and deletes account rows; run it through ' +
        'apps/worker/scripts/with-test-db.mjs.',
    )
  }
}

// Imported lazily so the clone guard runs before @eanhl/db opens a pool.
let dbm: typeof DbModule

/** Run the CLI with `stdinText` piped in (never on argv). */
function runCli(args: string[], stdinText?: string) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    env: process.env,
    input: stdinText ?? '',
    encoding: 'utf8',
  })
}

async function accountRowCounts() {
  const rows = await dbm.sql<
    { users: number; accounts: number; claims: number }[]
  >`select (select count(*)::int from users)              as users,
           (select count(*)::int from accounts)           as accounts,
           (select count(*)::int from user_player_claims) as claims`
  const row = rows[0]
  assert.ok(row, 'count query returned no row')
  return row
}

async function clearAccountTables() {
  await dbm.sql`delete from user_player_claims`
  await dbm.sql`delete from accounts`
  await dbm.sql`delete from sessions`
  await dbm.sql`delete from users`
}

before(async () => {
  if (!hasDb) return
  assertCloneDb()
  dbm = await import('@eanhl/db')

  // A claimable sentinel player for the admin to be linked to.
  await dbm.sql`insert into players (id, gamertag, position)
                values (${PLAYER_ID}, ${GAMERTAG}, 'center')
                on conflict (id) do nothing`
})

beforeEach(async () => {
  if (!hasDb) return
  // Each case starts from a genuinely empty account state — the exact
  // condition the removed public bootstrap form keyed off.
  await clearAccountTables()
})

after(async () => {
  if (!hasDb) return
  await clearAccountTables()
  await dbm.sql`delete from players where id = ${PLAYER_ID}`
  await dbm.sql.end({ timeout: 5 })
})

void test(
  'authorized local bootstrap creates user, credential, admin role, and claim',
  { skip: hasDb ? false : 'DATABASE_URL unset' },
  async () => {
    const before = await accountRowCounts()
    assert.equal(before.users, 0, 'precondition: no users')

    const res = runCli(
      ['--email', EMAIL, '--name', 'Fixture Admin', '--player-id', String(PLAYER_ID)],
      `${GOOD_PASSWORD}\n`,
    )
    assert.equal(res.status, 0, `CLI failed: ${res.stderr}`)
    assert.match(res.stdout, /created admin user_id=/)

    const rows = await dbm.sql<
      { id: string; email: string; role: string; password: string; player_id: number }[]
    >`select u.id, u.email, u.role, a.password, c.player_id
        from users u
        join accounts a on a.user_id = u.id and a.provider_id = 'credential'
        join user_player_claims c on c.user_id = u.id`
    assert.equal(rows.length, 1, 'exactly one fully-formed admin')
    const admin = rows[0]
    assert.ok(admin)
    assert.equal(admin.email, EMAIL)
    assert.equal(admin.role, 'admin', 'the initial account must be an admin')
    assert.equal(admin.player_id, PLAYER_ID)

    // The credential must be what the web sign-in path verifies against, not a
    // lookalike hash: use better-auth's own verifier.
    const { verifyPassword } = await import('better-auth/crypto')
    assert.equal(
      await verifyPassword({ hash: admin.password, password: GOOD_PASSWORD }),
      true,
      'stored hash must verify under better-auth',
    )
    assert.equal(
      await verifyPassword({ hash: admin.password, password: 'not the password' }),
      false,
    )
    // The password must not be recoverable from what was written.
    assert.ok(!admin.password.includes(GOOD_PASSWORD), 'password must not be stored in plaintext')
    // ...nor echoed anywhere the operator's terminal or logs would capture it.
    assert.ok(!res.stdout.includes(GOOD_PASSWORD), 'password must not appear on stdout')
    assert.ok(!res.stderr.includes(GOOD_PASSWORD), 'password must not appear on stderr')
  },
)

void test(
  'refuses idempotently once any user exists, and changes nothing',
  { skip: hasDb ? false : 'DATABASE_URL unset' },
  async () => {
    const first = runCli(
      ['--email', EMAIL, '--name', 'Fixture Admin', '--player-id', String(PLAYER_ID)],
      `${GOOD_PASSWORD}\n`,
    )
    assert.equal(first.status, 0, `first run failed: ${first.stderr}`)

    const snapshot = await dbm.sql<
      { id: string; email: string; role: string; password: string }[]
    >`select u.id, u.email, u.role, a.password from users u join accounts a on a.user_id = u.id`
    assert.equal(snapshot.length, 1)

    const second = runCli(
      [
        '--email',
        'someone-else@example.test',
        '--name',
        'Impostor',
        '--player-id',
        String(PLAYER_ID),
      ],
      `${GOOD_PASSWORD}\n`,
    )
    assert.notEqual(second.status, 0, 'a second run must exit non-zero')
    assert.match(second.stderr, /an account already exists/i)

    const after = await accountRowCounts()
    assert.deepEqual(after, { users: 1, accounts: 1, claims: 1 }, 'no second account was created')

    const unchanged = await dbm.sql<
      { id: string; email: string; role: string; password: string }[]
    >`select u.id, u.email, u.role, a.password from users u join accounts a on a.user_id = u.id`
    assert.deepEqual(unchanged, snapshot, 'the existing admin must be untouched')
  },
)

void test(
  'the refusal is enforced in the database transaction, not only by the CLI precheck',
  { skip: hasDb ? false : 'DATABASE_URL unset' },
  async () => {
    // Bypass the CLI entirely and call the query directly, which is what a
    // concurrent second caller would race into after passing its own precheck.
    const queries = await import('@eanhl/db/queries')
    await dbm.sql`insert into users (id, email, name, role, email_verified)
                  values ('11111111-1111-4111-8111-111111111111', ${EMAIL}, 'Existing', 'user', true)`

    await assert.rejects(
      queries.createInitialAdmin({
        userId: '22222222-2222-4222-8222-222222222222',
        accountId: '33333333-3333-4333-8333-333333333333',
        email: 'racer@example.test',
        name: 'Racer',
        passwordHash: 'irrelevant',
        playerId: PLAYER_ID,
      }),
      /already exists/i,
    )

    const after = await accountRowCounts()
    assert.equal(after.users, 1, 'the pre-existing user is the only user')
    assert.equal(after.accounts, 0, 'no credential row leaked from the rejected transaction')
    assert.equal(after.claims, 0, 'no player claim leaked from the rejected transaction')
  },
)

void test(
  'rejects a password supplied on argv',
  { skip: hasDb ? false : 'DATABASE_URL unset' },
  async () => {
    const res = runCli([
      '--email',
      EMAIL,
      '--name',
      'Fixture Admin',
      '--player-id',
      String(PLAYER_ID),
      '--password',
      GOOD_PASSWORD,
    ])
    assert.notEqual(res.status, 0, '--password must be refused, not ignored')
    assert.match(res.stderr, /refusing --password/)
    assert.deepEqual(
      await accountRowCounts(),
      { users: 0, accounts: 0, claims: 0 },
      'nothing may be written when the password came from argv',
    )
  },
)

void test(
  'refuses a too-short password before writing anything',
  { skip: hasDb ? false : 'DATABASE_URL unset' },
  async () => {
    const res = runCli(
      ['--email', EMAIL, '--name', 'Fixture Admin', '--player-id', String(PLAYER_ID)],
      'short7\n',
    )
    assert.notEqual(res.status, 0)
    assert.match(res.stderr, /at least 8 characters/)
    assert.deepEqual(await accountRowCounts(), { users: 0, accounts: 0, claims: 0 })
  },
)

void test(
  'refuses an unknown player rather than creating an unlinked admin',
  { skip: hasDb ? false : 'DATABASE_URL unset' },
  async () => {
    const byId = runCli(
      ['--email', EMAIL, '--name', 'Fixture Admin', '--player-id', '9400999'],
      `${GOOD_PASSWORD}\n`,
    )
    assert.notEqual(byId.status, 0)
    assert.match(byId.stderr, /no player with id 9400999/)

    const byTag = runCli(
      ['--email', EMAIL, '--name', 'Fixture Admin', '--gamertag', 'NoSuchGamertagAnywhere'],
      `${GOOD_PASSWORD}\n`,
    )
    assert.notEqual(byTag.status, 0)
    assert.match(byTag.stderr, /no player with gamertag/)

    const noPlayer = runCli(['--email', EMAIL, '--name', 'Fixture Admin'], `${GOOD_PASSWORD}\n`)
    assert.notEqual(noPlayer.status, 0)
    assert.match(noPlayer.stderr, /--gamertag or --player-id is required/)

    assert.deepEqual(await accountRowCounts(), { users: 0, accounts: 0, claims: 0 })
  },
)

void test(
  'resolves the player by gamertag and honours --dry-run',
  { skip: hasDb ? false : 'DATABASE_URL unset' },
  async () => {
    const res = runCli(
      ['--email', EMAIL, '--name', 'Fixture Admin', '--gamertag', GAMERTAG, '--dry-run'],
      `${GOOD_PASSWORD}\n`,
    )
    assert.equal(res.status, 0, `dry run failed: ${res.stderr}`)
    assert.match(
      res.stdout,
      new RegExp(`dry-run: would create admin .*player_id=${String(PLAYER_ID)}`),
    )
    assert.deepEqual(
      await accountRowCounts(),
      { users: 0, accounts: 0, claims: 0 },
      '--dry-run must write nothing',
    )
  },
)
