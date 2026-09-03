/**
 * END-TO-END test: start the BUILT web app and read the HTTP status the server
 * actually sends for every disabled route.
 *
 * WHY THIS EXISTS SEPARATELY
 * --------------------------
 * Every other test in this repo about the disabled account system reasons about
 * modules: what they import, what they throw, what they return. None of that is
 * the same statement as "a client asking for /login gets a 404", and this
 * project has already been bitten by the difference. Tombstone pages that
 * called `notFound()` looked correct in every module-level test and served
 * **200** from the real server: the app has a root `src/app/loading.tsx`, so
 * pages render inside a Suspense boundary whose shell is flushed before the
 * page component runs, and a status cannot be changed after the headers are
 * sent. `export const dynamic = 'force-dynamic'` did not change that. The fix
 * was to delete the page modules outright, so the URLs are as absent as any URL
 * this site never had — and only a request over a socket could tell the
 * difference between the two.
 *
 * WHAT IT DOES
 * ------------
 * Starts `next start` on a loopback-only port, asks for each disabled path, and
 * asserts the status code. It talks to no external service; the only thing it
 * needs beyond the build is whatever `/` already needs to render, and `/` is
 * used ONLY as a control ("the server is serving this app"), never as an
 * assertion about data.
 *
 * REQUIRES A BUILD. It skips — loudly, not silently — when `.next/BUILD_ID` is
 * absent, because a stale or missing build would otherwise let it pass while
 * proving nothing:
 *
 *   pnpm --filter web build && pnpm --filter web test:http-404
 *
 * Override the port with DISABLED_ROUTES_TEST_PORT if 34571 is taken.
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(HERE, '..')
const NEXT_BIN = path.join(WEB_ROOT, 'node_modules/next/dist/bin/next')
const BUILD_ID = path.join(WEB_ROOT, '.next/BUILD_ID')

const PORT = Number(process.env.DISABLED_ROUTES_TEST_PORT ?? '34571')
const BASE = `http://127.0.0.1:${String(PORT)}`

const isBuilt = existsSync(BUILD_ID)
const skip = isBuilt
  ? false
  : 'no production build — run `pnpm --filter web build` first (this test cannot prove anything without one)'

let server: ChildProcess | null = null

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/`, { method: 'HEAD' })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`the built app did not start on ${BASE} within 60s`)
}

async function status(method: string, urlPath: string): Promise<number> {
  const response = await fetch(`${BASE}${urlPath}`, { method, redirect: 'manual' })
  return response.status
}

before(async () => {
  if (!isBuilt) return
  server = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(PORT), '-H', '127.0.0.1'], {
    cwd: WEB_ROOT,
    stdio: 'ignore',
  })
  await waitForServer()
})

after(() => {
  server?.kill('SIGTERM')
  server = null
})

void test('control: the server really is serving this app', { skip }, async () => {
  // Without this, a 404 everywhere — including from a server that failed to
  // start or is serving nothing — would read as a pass.
  const home = await status('GET', '/')
  assert.notEqual(
    home,
    404,
    `/ must not 404; the disabled-route 404s below mean nothing if it does`,
  )
  assert.ok(home < 500, `/ returned ${String(home)} — the app is not healthy enough to judge`)
})

void test('every disabled page route is an ordinary 404', { skip }, async () => {
  for (const urlPath of [
    '/login',
    // The invite-acceptance entry point. An invite URL must be as dead as a
    // bare /login, or a circulated invite link would still open a flow.
    '/login?token=test',
    '/login?token=test&error=invalid',
    '/account',
    '/me',
    '/admin/accounts',
    // Descendants, named and unnamed.
    '/admin',
    '/admin/anything-else',
    '/account/settings',
    '/login/callback',
  ]) {
    assert.equal(await status('GET', urlPath), 404, `GET ${urlPath} must be 404`)
  }
})

void test('a POST to a disabled page route is a 404 too', { skip }, async () => {
  // The pages are gone, so there is no Server Action target behind them either.
  for (const urlPath of ['/login', '/account', '/admin/accounts']) {
    assert.equal(await status('POST', urlPath), 404, `POST ${urlPath} must be 404`)
  }
})

void test('the Better Auth endpoints are 404 on every method', { skip }, async () => {
  const paths = [
    '/api/auth/session',
    '/api/auth/sign-in/email',
    '/api/auth/sign-up/email',
    '/api/auth/sign-out',
    '/api/auth/callback/credential',
    '/api/auth',
  ]
  for (const urlPath of paths) {
    for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
      assert.equal(await status(method, urlPath), 404, `${method} ${urlPath} must be 404`)
    }
  }
})

void test('a real sign-in attempt is refused with a 404, not an auth error', { skip }, async () => {
  // A credential POST shaped exactly like Better Auth's own. A 400/401 here
  // would mean the endpoint exists and is judging the credentials.
  const response = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'someone@example.test', password: 'password123' }),
  })
  assert.equal(response.status, 404, 'sign-in must not exist at all')
  const body = await response.text()
  assert.ok(!/session|token|user/i.test(body), `the refusal must leak no auth payload: ${body}`)
})

void test('the served home page offers no login or account CTA', { skip }, async () => {
  const html = await (await fetch(`${BASE}/`)).text()
  const links = [...html.matchAll(/href="(\/(?:login|account|me|admin)[^"]*)"/g)].map((m) => m[1])
  assert.deepEqual(links, [], 'the served markup must contain no link into a disabled route')
  assert.ok(!/>\s*(Login|Sign In|Sign Out)\s*</i.test(html), 'no auth CTA may be rendered')
})
