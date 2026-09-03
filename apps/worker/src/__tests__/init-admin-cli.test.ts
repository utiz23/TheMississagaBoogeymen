/**
 * `init-admin` is DISABLED and must fail closed.
 *
 * WHAT THIS PROVES
 * ----------------
 * Authentication is deferred until after launch. There is no web bootstrap path
 * (apps/web/src/lib/account-system-disabled.test.ts) and there must be no CLI
 * one either. This file spawns the real compiled command — `dist/init-admin-cli.js`,
 * the exact file `pnpm --filter worker init-admin` runs — and asserts that:
 *
 *   1. It exits non-zero on every invocation, with every argument combination
 *      that used to do something: `--help`, `--list-players`, `--dry-run`, and
 *      a full, valid create.
 *   2. It refuses BEFORE any database work. With DATABASE_URL unset it does not
 *      produce `@eanhl/db`'s import-time "DATABASE_URL is required" failure,
 *      which is positive evidence the database module is never loaded — and it
 *      behaves identically with DATABASE_URL set, so the refusal is not an
 *      accident of a missing environment variable.
 *   3. It refuses BEFORE requesting a password. Nothing is prompted and piped
 *      stdin is never consumed, so a `pass show ... | init-admin` invocation
 *      cannot leak a password into a process that is about to refuse anyway.
 *   4. It writes nothing. Where a test-database clone is available, the account
 *      tables are counted before and after and must be untouched.
 *   5. The dormant implementation is not wired back in: no active worker module
 *      imports it, and it no longer runs itself.
 *
 * WHAT THIS REPLACES
 * ------------------
 * This file previously proved the opposite contract — that the CLI created the
 * one initial admin atomically, idempotently, and with the password read only
 * from stdin. That code is preserved verbatim in
 * ../deferred-auth/init-admin-cli.ts and none of it is reachable; the tests for
 * it would now be asserting behaviour the product deliberately does not have.
 * The database-level refusal in `createInitialAdmin` is untouched and still
 * covered by the query itself; the table, the migration, and the data are all
 * intact.
 *
 * ISOLATION
 * ---------
 * The row-count assertions read (never write) the account tables, and run only
 * against an `eanhl_test_*` clone. Everything else needs no database at all, so
 * this file is runnable standalone:
 *
 *   pnpm --filter @eanhl/worker build
 *   node --test apps/worker/dist/__tests__/init-admin-cli.test.js
 *
 * ...and through the isolation harness, which provisions and drops the clone:
 *
 *   set -a && source .env && set +a
 *   node apps/worker/scripts/with-test-db.mjs init-admin-cli
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Type-only: erased at runtime, so @eanhl/db is still not loaded until the
// clone guard below has passed.
import type * as DbModule from '@eanhl/db'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../../..')
const WORKER_SRC = path.join(REPO_ROOT, 'apps/worker/src')
const CLI_PATH = path.join(REPO_ROOT, 'apps/worker/dist/init-admin-cli.js')
const CLI_SOURCE = path.join(WORKER_SRC, 'init-admin-cli.ts')
const DORMANT_SOURCE = path.join(WORKER_SRC, 'deferred-auth/init-admin-cli.ts')

const PASSWORD_THAT_MUST_NOT_BE_READ = 'correct horse battery staple'

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
        '"eanhl_test_*" clone. Run it through apps/worker/scripts/with-test-db.mjs.',
    )
  }
}

// Imported lazily so the clone guard runs before @eanhl/db opens a pool.
let dbm: typeof DbModule

/**
 * Run the CLI. `stdinText` is piped in to prove it is NOT consumed; `env`
 * overrides let a case run with DATABASE_URL deliberately absent or bogus.
 */
function runCli(
  args: string[],
  opts: { stdin?: string; env?: Record<string, string | undefined> } = {},
) {
  // An override of `undefined` means "unset this for the child", so the env is
  // rebuilt by filtering rather than mutated — `DATABASE_URL: undefined` has to
  // be a genuinely absent variable, not one set to the string "undefined".
  const merged: Record<string, string | undefined> = { ...process.env, ...opts.env }
  const env = Object.fromEntries(
    Object.entries(merged).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    env,
    input: opts.stdin ?? '',
    encoding: 'utf8',
    timeout: 30_000,
  })
}

/** Every invocation that used to do something. */
const INVOCATIONS: { label: string; args: string[] }[] = [
  { label: 'no arguments', args: [] },
  { label: '--help', args: ['--help'] },
  { label: '--list-players', args: ['--list-players'] },
  {
    label: 'a full, valid create',
    args: ['--email', 'operator@example.test', '--name', 'Operator', '--gamertag', 'Utiz23'],
  },
  {
    label: '--dry-run',
    args: [
      '--email',
      'operator@example.test',
      '--name',
      'Operator',
      '--player-id',
      '1',
      '--dry-run',
    ],
  },
]

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

before(async () => {
  if (!hasDb) return
  assertCloneDb()
  dbm = await import('@eanhl/db')
})

after(async () => {
  if (!hasDb) return
  await dbm.sql.end({ timeout: 5 })
})

for (const { label, args } of INVOCATIONS) {
  void test(`refuses ${label}, with DATABASE_URL unset`, () => {
    const res = runCli(args, {
      stdin: `${PASSWORD_THAT_MUST_NOT_BE_READ}\n`,
      env: { DATABASE_URL: undefined },
    })

    assert.equal(res.error, undefined, `the CLI must not fail to spawn: ${String(res.error)}`)
    assert.notEqual(res.status, 0, 'init-admin must exit non-zero')
    assert.match(res.stderr, /refusing: the account system is disabled before launch/)

    // Fails closed BEFORE the database module: @eanhl/db throws at import time
    // when DATABASE_URL is unset, and that error is conspicuously absent.
    assert.ok(
      !res.stderr.includes('DATABASE_URL'),
      `a DATABASE_URL failure means @eanhl/db was loaded on this path: ${res.stderr}`,
    )
    assert.ok(
      !/ERR_MODULE_NOT_FOUND|Cannot find package/.test(res.stderr),
      `the refusal must be deliberate, not an import crash: ${res.stderr}`,
    )

    // ...and BEFORE any password is requested or consumed.
    assert.ok(!/password/i.test(res.stderr), `no password may be prompted for: ${res.stderr}`)
    assert.ok(!/password/i.test(res.stdout), `no password may be prompted for: ${res.stdout}`)
    assert.ok(
      !res.stderr.includes(PASSWORD_THAT_MUST_NOT_BE_READ) &&
        !res.stdout.includes(PASSWORD_THAT_MUST_NOT_BE_READ),
      'piped stdin must never be echoed',
    )
  })
}

void test('refuses identically with DATABASE_URL set — the refusal is not a missing env var', () => {
  // A pointed-at-nothing URL: if the CLI ever reached a connection it would
  // hang or report a connection error instead of refusing instantly.
  const res = runCli(
    ['--email', 'operator@example.test', '--name', 'Operator', '--gamertag', 'X'],
    {
      stdin: `${PASSWORD_THAT_MUST_NOT_BE_READ}\n`,
      env: { DATABASE_URL: 'postgresql://disabled:unused@127.0.0.1:1/disabled' },
    },
  )

  assert.notEqual(res.status, 0)
  assert.match(res.stderr, /refusing: the account system is disabled before launch/)
  assert.ok(
    !/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|connection refused|failed to connect/i.test(res.stderr),
    `no connection may be attempted: ${res.stderr}`,
  )
})

void test('there is no argument or environment variable that re-enables it', () => {
  // The whole point of a source-level disable: nothing an operator can type on
  // the host turns the command back on.
  for (const attempt of [
    { args: ['--force'], env: {} },
    { args: ['--enable'], env: {} },
    { args: [], env: { ENABLE_AUTH: '1', AUTH_ENABLED: 'true', BETTER_AUTH_ENABLED: '1' } },
  ]) {
    const res = runCli(attempt.args, { env: attempt.env })
    assert.notEqual(
      res.status,
      0,
      `init-admin ran with ${JSON.stringify(attempt)} — it must always refuse`,
    )
    assert.match(res.stderr, /disabled before launch/)
  }
})

void test('the compiled command loads no module at all', () => {
  // The strongest available statement about "fails closed BEFORE connecting":
  // there is nothing on this path to connect with.
  const compiled = readFileSync(CLI_PATH, 'utf8')
  assert.ok(
    !/^\s*import\s/m.test(compiled) && !/\brequire\(/.test(compiled),
    'dist/init-admin-cli.js must import nothing — no db client, no better-auth, no readline',
  )
  // Comments are stripped: the shim's own documentation names the modules it
  // is forbidden to load, and matching those sentences would fail it for
  // explaining itself.
  const source = readFileSync(CLI_SOURCE, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    .join('\n')
  assert.ok(!/^\s*import\b/m.test(source), 'src/init-admin-cli.ts must import nothing')
  for (const forbidden of ['@eanhl/db', 'better-auth', 'node:readline', 'hashPassword']) {
    assert.ok(!source.includes(forbidden), `src/init-admin-cli.ts must not reference ${forbidden}`)
  }
})

void test('the dormant implementation is preserved but does not run itself', () => {
  // Deferred, not deleted: the post-launch account feature starts from this
  // code rather than from scratch.
  const src = readFileSync(DORMANT_SOURCE, 'utf8')
  assert.ok(src.includes('createInitialAdmin('), 'the real implementation must be preserved')
  assert.ok(
    src.includes('export async function runInitAdmin('),
    'the entry point must be exported rather than invoked',
  )
  const code = src
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    .join('\n')
  assert.ok(
    !/^main\(\)/m.test(code),
    'the dormant module must not call main() at module scope — executing it must create nothing',
  )
})

void test('no active worker module imports the dormant implementation', () => {
  const offenders = readdirSync(WORKER_SRC, { recursive: true })
    .filter((p): p is string => typeof p === 'string' && p.endsWith('.ts'))
    .filter((p) => !p.split(path.sep).includes('deferred-auth'))
    .filter((p) => !p.includes('__tests__'))
    .filter((p) =>
      /from\s+['"][^'"]*deferred-auth/.test(readFileSync(path.join(WORKER_SRC, p), 'utf8')),
    )
  assert.deepEqual(
    offenders,
    [],
    'deferred-auth/ is dormant — no active worker module may import from it',
  )
})

void test('the init-admin package script points at the refusing shim', () => {
  const pkg = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'apps/worker/package.json'), 'utf8'),
  ) as { scripts: Record<string, string> }
  assert.equal(
    pkg.scripts['init-admin'],
    'node dist/init-admin-cli.js',
    'pnpm --filter worker init-admin must run the shim, not the dormant implementation',
  )
  const dormantScripts = Object.entries(pkg.scripts).filter(([, cmd]) =>
    cmd.includes('deferred-auth'),
  )
  assert.deepEqual(dormantScripts, [], 'no package script may run anything under deferred-auth/')
})

void test(
  'a refused run writes nothing to the account tables',
  { skip: hasDb ? false : 'DATABASE_URL unset' },
  async () => {
    const before = await accountRowCounts()

    for (const { args } of INVOCATIONS) {
      const res = runCli(args, { stdin: `${PASSWORD_THAT_MUST_NOT_BE_READ}\n` })
      assert.notEqual(res.status, 0)
    }

    assert.deepEqual(await accountRowCounts(), before, 'the account tables must be untouched')
  },
)
