/**
 * END-TO-END test: start the BUILT web app and check, over real HTTP, what the
 * member-login surface answers and what is still absent.
 *
 * Member logins are on (Discord only, invite-only; plan
 * docs/superpowers/plans/2026-10-09-member-logins-step-1.md). This replaces the
 * pre-launch "every auth route is a 404" test and keeps its two lasting jobs:
 * routes the site never offers are real 404s (module-level tests once said
 * "404" while the server sent 200), and the browser-hardening headers from
 * next.config.ts reach pages, unknown paths and the auth API alike.
 *
 * The server is started with throwaway auth settings (a test secret, dummy
 * Discord credentials, BETTER_AUTH_URL = this loopback origin). Nothing here
 * talks to Discord: the tests stop before any redirect is followed.
 *
 * REQUIRES A BUILD. It skips — loudly, not silently — when `.next/BUILD_ID` is
 * absent, because a stale or missing build would otherwise let it pass while
 * proving nothing:
 *
 *   pnpm --filter web build && pnpm --filter web test:http-auth
 *
 * Override the port with AUTH_HTTP_TEST_PORT if 34571 is taken.
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

const PORT = Number(process.env.AUTH_HTTP_TEST_PORT ?? '34571')
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
    env: {
      ...process.env,
      BETTER_AUTH_SECRET: 'auth-http-test-secret-not-used-anywhere-else',
      BETTER_AUTH_URL: BASE,
      DISCORD_CLIENT_ID: 'auth-http-test-client',
      DISCORD_CLIENT_SECRET: 'auth-http-test-secret',
    },
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

void test('routes the site never offers are ordinary 404s', { skip }, async () => {
  for (const urlPath of [
    '/me',
    '/admin/anything-else',
    '/account/settings',
    '/login/callback',
    // Design-preview scratch pages, removed for launch (launch plan item 3).
    '/preview/carousel',
  ]) {
    assert.equal(await status('GET', urlPath), 404, `GET ${urlPath} must be 404`)
  }
})

void test('the sign-in page renders a Discord button and no password field', { skip }, async () => {
  const response = await fetch(`${BASE}/login`, { redirect: 'manual' })
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.match(html, /Sign in with Discord/)
  assert.doesNotMatch(html, /type="password"/i)
  assert.doesNotMatch(html, /type="email"/i)
})

void test('a login error code is shown from the dictionary, never echoed', { skip }, async () => {
  const html = await (await fetch(`${BASE}/login?error=%3Cmarquee%3Epwned`)).text()
  // The raw query value does travel in Next's escaped page data (\u003c…),
  // but it must never reach the markup as a tag or as displayed text.
  assert.doesNotMatch(html, /<marquee/i)
  assert.doesNotMatch(html, /role="alert"[^>]*>[^<]*pwned/)
  assert.match(html, /role="alert"[^>]*>Sign-in didn’t work/)
})

void test('member and admin pages send a signed-out visitor to sign in', { skip }, async () => {
  for (const urlPath of [
    '/account',
    '/admin',
    '/admin/accounts',
    '/admin/titles',
    '/admin/cards',
  ]) {
    const response = await fetch(`${BASE}${urlPath}`, { redirect: 'manual' })
    assert.ok(
      [303, 307, 308].includes(response.status),
      `${urlPath}: got ${String(response.status)}`,
    )
    assert.match(response.headers.get('location') ?? '', /\/login$/, urlPath)
  }
})

void test('an unknown invite link renders a refusal, not an error', { skip }, async () => {
  const response = await fetch(`${BASE}/invite/not-a-real-token`)
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.match(html, /Invite not usable/)
  assert.doesNotMatch(html, /Join with Discord/)
})

void test('an unknown game or player is a real 404, not a soft 200', { skip }, async () => {
  // These pages exist and call notFound() themselves. With no route
  // loading.tsx streaming a shell first, that call can still set the status.
  // The numeric ids are far past any real row yet inside players.id's int4; the
  // non-numeric ones take the pages' parseInt guard instead of the DB lookup.
  for (const urlPath of [
    '/games/999999999',
    '/roster/999999999',
    '/games/not-a-number',
    '/roster/not-a-number',
  ]) {
    assert.equal(await status('GET', urlPath), 404, `GET ${urlPath} must be 404`)
  }
})

void test('a signed-out session read is empty, not an error', { skip }, async () => {
  const response = await fetch(`${BASE}/api/auth/get-session`)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), 'null')
})

void test('password sign-in and sign-up do not exist', { skip }, async () => {
  // Shaped exactly like Better Auth's own request. Anything but 404 would mean
  // the endpoint exists and is judging the credentials.
  for (const urlPath of ['/api/auth/sign-in/email', '/api/auth/sign-up/email']) {
    const response = await fetch(`${BASE}${urlPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: JSON.stringify({ email: 'someone@example.test', password: 'password123', name: 'x' }),
    })
    assert.equal(response.status, 404, `${urlPath} must not exist`)
    const body = await response.text()
    assert.ok(!/session|token/i.test(body), `${urlPath} leaked an auth payload: ${body}`)
  }
})

void test('account self-service endpoints are closed', { skip }, async () => {
  for (const urlPath of [
    '/api/auth/update-user',
    '/api/auth/delete-user',
    '/api/auth/request-password-reset',
    '/api/auth/link-social',
  ]) {
    const response = await fetch(`${BASE}${urlPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE },
      body: '{}',
    })
    assert.equal(response.status, 404, `${urlPath} must be 404`)
  }
})

void test('Discord sign-in starts with the identify scope only', { skip }, async () => {
  const response = await fetch(`${BASE}/api/auth/sign-in/social`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: BASE },
    body: JSON.stringify({ provider: 'discord', callbackURL: '/account' }),
  })
  assert.equal(response.status, 200)
  const { url } = (await response.json()) as { url: string }
  const authorize = new URL(url)
  assert.equal(authorize.hostname, 'discord.com')
  assert.equal(authorize.searchParams.get('scope'), 'identify')
  assert.equal(authorize.searchParams.get('redirect_uri'), `${BASE}/api/auth/callback/discord`)
})

void test(
  'the served home page offers a LOG IN control, not a password form',
  { skip },
  async () => {
    const html = await (await fetch(`${BASE}/`)).text()
    assert.match(html, /href="\/login"/)
    assert.doesNotMatch(html, /type="password"/i)
  },
)

void test('every response carries the browser-hardening headers', { skip }, async () => {
  // Set in next.config.ts. Checked on a page, an unknown path and the auth
  // API, because a header rule that only reached rendered pages would leave
  // the 404s and route handlers unprotected.
  const expected: Record<string, string> = {
    'x-robots-tag': 'noindex, nofollow',
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'content-security-policy': "frame-ancestors 'none'",
    'referrer-policy': 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  }
  for (const urlPath of ['/', '/no-such-page', '/login', '/api/auth/get-session']) {
    const response = await fetch(`${BASE}${urlPath}`, { redirect: 'manual' })
    for (const [name, value] of Object.entries(expected)) {
      assert.equal(response.headers.get(name), value, `${urlPath}: ${name}`)
    }
    assert.equal(response.headers.get('x-powered-by'), null, `${urlPath}: x-powered-by`)
  }
})
