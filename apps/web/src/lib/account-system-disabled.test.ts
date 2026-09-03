/**
 * STRUCTURAL guard: assertions over source text, not over behaviour.
 *
 * WHAT THIS IS, HONESTLY
 * ----------------------
 * Every assertion in this file greps source files. It proves that certain code
 * is not written anywhere under apps/web/src. It does NOT execute the app, and
 * it cannot tell you what the app does — a rename, a re-export, or a dynamic
 * import would satisfy these checks while reconnecting the account system. Read
 * it as a tripwire that makes an obvious regression noisy, not as proof of
 * safety.
 *
 * The behavioural evidence lives in ../../test/auth-routes-disabled.test.ts,
 * which imports the real route modules, invokes them, and asserts they 404 or
 * refuse without touching a database. That file is the primary regression test.
 * This one covers the parts execution cannot reach.
 *
 * WHAT ONLY SOURCE CAN COVER
 * --------------------------
 * 1. That the dormant implementation in `src/deferred/auth/` is not wired back
 *    into the active route graph. A tombstone that 404s today and a tombstone
 *    that imports Better Auth and then 404s are indistinguishable from their
 *    output, but the second one constructs Better Auth, reads
 *    BETTER_AUTH_SECRET, and opens the account tables on every disabled
 *    request. Only the imports say which one is on disk.
 * 2. That no navigation, page, or metadata surface links into the disabled
 *    routes. Rendering the drawer requires Next's router context, which a plain
 *    `node --test` process does not have.
 * 3. That no initial-admin bootstrap exists to invoke. A Server Action is
 *    reachable by its action id whether or not any form renders it, so its
 *    absence cannot be observed from rendered HTML at all.
 *
 * This file replaces no-public-admin-bootstrap.test.ts, whose narrower contract
 * ("/login must still offer sign-in, and must not offer bootstrap") is no
 * longer the contract: /login offers nothing, because it is a 404.
 *
 * Run: node --test apps/web/src/lib/account-system-disabled.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB_SRC = path.resolve(HERE, '..')
const DEFERRED = path.join(WEB_SRC, 'deferred/auth')
const ACCOUNT_ACTIONS = path.join(WEB_SRC, 'app/account-actions.ts')
const AUTH_API_ROUTE = path.join(WEB_SRC, 'app/api/auth/[...all]/route.ts')
const TOP_NAV = path.join(WEB_SRC, 'components/nav/top-nav.tsx')
const NAV_DRAWER = path.join(WEB_SRC, 'components/nav/nav-drawer.tsx')

/**
 * The two modules that still exist on the disabled surface. The disabled PAGES
 * have no module at all — see the routability test below.
 */
const TOMBSTONES = [AUTH_API_ROUTE, ACCOUNT_ACTIONS]

/**
 * URL prefixes that must not resolve to any App Router module.
 *
 * Deleting the page files, rather than making them 404 themselves, is
 * deliberate and was forced by measurement: this app has a root
 * `src/app/loading.tsx`, so a page renders inside a Suspense boundary whose
 * shell is flushed before the page component runs. A `notFound()` thrown from
 * there cannot change a status that has already been sent, and the built app
 * answered **200** on /login, /account, /me and /admin/accounts.
 * `export const dynamic = 'force-dynamic'` did not change it. With no module,
 * the URL is as absent as any URL the site never had and Next's own 404
 * answers it — proved over HTTP in ../../test/disabled-routes-http.test.ts.
 */
const NON_ROUTABLE = ['login', 'account', 'me', 'admin']

function read(file: string): string {
  return readFileSync(file, 'utf8')
}

function rel(file: string): string {
  return path.relative(WEB_SRC, file)
}

/**
 * A file's source with whole-line comments removed. Every check below is about
 * what the code DOES; the tombstones' own documentation names the very things
 * they are forbidden to do ("must not redirect", "must not construct Better
 * Auth"), and matching those sentences would fail the guard for saying so.
 */
function code(file: string): string {
  return read(file)
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    .join('\n')
}

/**
 * Every SHIPPED .ts/.tsx source file under apps/web/src that is part of the
 * ACTIVE app.
 *
 * Two exclusions, for two different reasons:
 *   - `deferred/**` is the dormant account implementation. It is supposed to
 *     contain Better Auth and the account queries; that is the point of it.
 *     What matters is that nothing outside it reaches in, which is exactly what
 *     the tests below check.
 *   - `*.test.ts(x)` is never served, bundled, or reachable over HTTP.
 *     Including test files would also make these checks self-defeating: this
 *     file names every symbol it forbids.
 */
function activeSourceFiles(): string[] {
  return readdirSync(WEB_SRC, { recursive: true })
    .filter((p): p is string => typeof p === 'string' && /\.tsx?$/.test(p))
    .filter((p) => !/\.test\.tsx?$/.test(p))
    .filter((p) => !p.split(path.sep).includes('deferred'))
    .map((p) => path.join(WEB_SRC, p))
}

void test('no App Router module exists for any disabled page route', () => {
  // App Router derives routes from page/route/default files. If none of those
  // exists anywhere under `app/<segment>/`, the segment is not a route.
  const appDir = path.join(WEB_SRC, 'app')
  const routeFiles = readdirSync(appDir, { recursive: true })
    .filter((p): p is string => typeof p === 'string')
    .filter((p) => /(^|[\\/])(page|route|default)\.tsx?$/.test(p))

  for (const segment of NON_ROUTABLE) {
    const offenders = routeFiles.filter((p) => p.split(/[\\/]/)[0] === segment)
    assert.deepEqual(
      offenders,
      [],
      `app/${segment}/ must contain no page or route module — restoring one republishes the account surface`,
    )
  }
  // The guard must not pass because the app dir vanished.
  assert.ok(
    routeFiles.includes(path.join('games', 'page.tsx')) || routeFiles.length > 3,
    'the App Router tree must still contain the public routes',
  )
})

void test('the dormant account implementation is still on disk, not deleted', () => {
  // This guard must not pass by virtue of the deferred work having been thrown
  // away — the account system is deferred, not cancelled.
  assert.ok(existsSync(DEFERRED), 'src/deferred/auth/ must exist')
  const kept = readdirSync(DEFERRED).sort()
  for (const file of [
    'README.md',
    'account-actions.ts',
    'account-page.tsx',
    'admin-accounts-page.tsx',
    'auth-api-route.ts',
    'better-auth.ts',
    'login-page.tsx',
    'me-page.tsx',
  ]) {
    assert.ok(kept.includes(file), `src/deferred/auth/${file} must be preserved`)
  }
  assert.ok(
    read(path.join(DEFERRED, 'better-auth.ts')).includes('betterAuth({'),
    'the dormant Better Auth instance must still be the real implementation',
  )
})

void test('the dormant implementation registers no Server Actions', () => {
  // `'use server'` is what mints stable, POST-able action ids. A dormant module
  // that carries it is reachable by action id even though nothing imports it.
  const src = read(path.join(DEFERRED, 'account-actions.ts'))
  assert.ok(
    !/^\s*['"]use server['"]/m.test(src),
    "src/deferred/auth/account-actions.ts must not carry 'use server' — a dormant module must mint no action ids",
  )
})

void test('nothing in the active app imports the dormant account implementation', () => {
  const offenders = activeSourceFiles().filter((file) => {
    const src = read(file)
    return (
      /from\s+['"][^'"]*deferred\/auth/.test(src) || /import\(['"][^'"]*deferred\/auth/.test(src)
    )
  })
  assert.deepEqual(
    offenders.map(rel),
    [],
    'src/deferred/auth/ is dormant — no shipped, non-test file outside it may import from it',
  )
})

void test('nothing in the active app imports Better Auth', () => {
  // The sharp end of "a disabled request must not initialise Better Auth merely
  // to return 404": constructing it reads BETTER_AUTH_SECRET and wires the
  // Drizzle adapter to the account tables.
  const offenders = activeSourceFiles().filter((file) =>
    /from\s+['"](better-auth|@better-auth\/)/.test(read(file)),
  )
  assert.deepEqual(
    offenders.map(rel),
    [],
    'no shipped file in the active app may import better-auth — authentication is disabled before launch',
  )
})

void test('the tombstones import no auth or account implementation at all', () => {
  const forbidden = [
    'better-auth',
    'deferred/auth',
    '@eanhl/db',
    'hasAccountUsers',
    'getAccountInviteByToken',
    'requireUser',
    'requireAdmin',
    'getCurrentUser',
  ]
  for (const file of TOMBSTONES) {
    const src = read(file)
    const imports = src
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line))
      .join('\n')
    for (const needle of forbidden) {
      assert.ok(
        !imports.includes(needle),
        `${rel(file)} must not import ${needle} — a disabled route must not load the account system to refuse`,
      )
    }
  }
})

void test('the tombstones read no request input that could reopen a flow', () => {
  for (const file of TOMBSTONES) {
    const src = code(file)
    assert.ok(!src.includes('searchParams'), `${rel(file)} must not read search params`)
    assert.ok(!src.includes('formData.get'), `${rel(file)} must not read form fields`)
    assert.ok(!src.includes('redirect('), `${rel(file)} must not redirect a caller anywhere`)
  }
})

void test('no initial-admin bootstrap exists anywhere in the active app', () => {
  const offenders = activeSourceFiles().filter((file) => {
    const src = read(file)
    return (
      src.includes('createInitialAdmin') ||
      src.includes('createBootstrapAdmin') ||
      src.includes('bootstrapAdmin')
    )
  })
  assert.deepEqual(
    offenders.map(rel),
    [],
    'initial-admin creation is not web-reachable — an empty users table is not authorization',
  )
})

void test('the account actions are refusal stubs, not implementations', () => {
  const src = read(ACCOUNT_ACTIONS)
  assert.ok(
    /^\s*['"]use server['"]/m.test(src),
    "account-actions.ts must keep 'use server' so the refusing stubs occupy the action ids",
  )
  assert.ok(
    !/^\s*import\b/m.test(src),
    'account-actions.ts must import nothing — there must be no implementation on this path to reach',
  )
  assert.ok(src.includes('disabled before launch'), 'the refusal message must say why')
  for (const name of [
    'signInWithPassword',
    'signOutCurrentUser',
    'acceptInvite',
    'createInvite',
    'revokeInvite',
    'setUserDisabled',
    'assignClaim',
  ]) {
    assert.ok(
      src.includes(`export async function ${name}(`),
      `${name} must still be exported, so a POST to its action id lands on a refusal`,
    )
  }
})

void test('authentication is disabled without any environment switch', () => {
  // An env var that re-enables auth is the accident this exists to prevent: it
  // would republish the whole account surface on a deployment host with no
  // review. Re-enabling must be a source change.
  const authEnv = /process\.env\.(BETTER_AUTH_[A-Z_]+|AUTH_[A-Z_]+|[A-Z_]*ENABLE[A-Z_]*AUTH[A-Z_]*)/
  for (const file of TOMBSTONES) {
    const src = code(file)
    assert.ok(!src.includes('process.env'), `${rel(file)} must not branch on the environment`)
    assert.ok(!authEnv.test(src), `${rel(file)} must not read an auth environment variable`)
  }
  const offenders = activeSourceFiles().filter((file) => authEnv.test(code(file)))
  assert.deepEqual(
    offenders.map(rel),
    [],
    'no shipped file in the active app may read an auth environment variable',
  )
})

void test('neither navigation variant offers a login or account CTA', () => {
  // Both renderings of the nav, checked the same way. The drawer cannot be
  // rendered in a plain node:test process (it needs Next's router context), so
  // this is source-level for both rather than behavioural for one.
  for (const file of [TOP_NAV, NAV_DRAWER]) {
    const src = read(file)
    const hrefs = [...src.matchAll(/href=(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/g)].map(
      (m) => m[1] ?? m[2] ?? m[3] ?? '',
    )
    for (const href of hrefs) {
      assert.ok(
        !/^["'`]?\/(login|account|me|admin)\b/.test(href),
        `${rel(file)} links to ${href} — a disabled route`,
      )
    }
    // The CTA label, independently of where it pointed.
    const markup = code(file)
    for (const label of ['Login', 'Log In', 'Sign In', 'Sign Out', 'Sign up', 'My Account']) {
      assert.ok(
        !markup.includes(`>${label}<`) && !markup.includes(`${label}\n`),
        `${rel(file)} still renders a "${label}" control`,
      )
    }
  }
})

void test('no active page advertises a disabled route in a link or metadata', () => {
  const offenders: string[] = []
  for (const file of activeSourceFiles()) {
    if (TOMBSTONES.includes(file)) continue
    // Comments are allowed to name the routes; markup and metadata are not.
    const src = code(file)
    if (/href=["'`]\/(login|account|me|admin)\b/.test(src)) offenders.push(rel(file))
    if (/redirect\(\s*["'`]\/(login|account|me|admin)\b/.test(src)) offenders.push(rel(file))
  }
  assert.deepEqual(
    [...new Set(offenders)],
    [],
    'nothing in the active app may link or redirect into a disabled route',
  )
})
