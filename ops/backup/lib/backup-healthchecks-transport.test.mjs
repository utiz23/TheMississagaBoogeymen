/**
 * The Healthchecks.io ping transport (E3J8A).
 *
 * NOTHING HERE CONTACTS HEALTHCHECKS.IO OR ANY EXTERNAL HOST. Every request goes
 * either to a `node:http` server bound to `127.0.0.1` or to an injected request
 * double. The production `pingHealthchecks` in
 * `backup-healthchecks-transport.mjs` — the one bound to `node:https` and
 * `hc-ping.com` — is deliberately never invoked; the transport is built here from
 * the internal seam with a loopback bridge in place of `https.request`, so the
 * production options object is still the thing under test.
 *
 * A PROCESS-WIDE CONNECT GUARD is installed below: it records every socket
 * connect this file's tests cause and REFUSES any target that is not loopback or
 * a Unix socket. `strace` is not available on this host, so this guard is the
 * external-connect proof, and it is strictly stronger than a syscall trace in
 * one respect — it also prevents the DNS lookup that `net.Socket.connect()` would
 * perform for a non-loopback hostname.
 *
 * Every ping key below is a SYNTHETIC per-test value. No real key exists or is
 * used, and no Healthchecks account, check, ping key or integration is touched.
 */

import assert from 'node:assert/strict'
import { EventEmitter, getEventListeners } from 'node:events'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  EXPECTED_RESPONSE_BODY,
  HEALTHCHECKS_ORIGIN,
  MAX_REQUEST_BODY_BYTES,
  MAX_RESPONSE_BYTES,
  PING_DELIVERY_STATES,
  PING_ENDPOINTS,
  PING_ERROR_CLASSES,
  PING_OUTCOME_CODES,
  assertValidSlug,
  buildPingPath,
  classifyResponse,
  makeHealthchecksTransport,
} from './internal/backup-healthchecks-transport-core.mjs'
import {
  PING_KEY_PATTERN,
  REAL_PING_KEY_DEPS,
  makePingKeyReader,
} from './internal/backup-monitor-ping-key-core.mjs'
import * as production from './backup-healthchecks-transport.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'healthchecks-transport', warnAfterMs: 15_000, intervalMs: 5_000 })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CORE = path.join(HERE, 'internal', 'backup-healthchecks-transport-core.mjs')
const PUBLIC = path.join(HERE, 'backup-healthchecks-transport.mjs')
const T = 30_000

// ═════════════════════════════════════════════════════════════════════════════
// THE LOOPBACK-ONLY CONNECT GUARD — the external-connect proof
// ═════════════════════════════════════════════════════════════════════════════

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '0.0.0.0', ''])
const observedConnects = []
const refusedConnects = []
const realSocketConnect = net.Socket.prototype.connect

net.Socket.prototype.connect = function guardedConnect(...args) {
  const first = args[0]
  const opts =
    first !== null && typeof first === 'object' && !Array.isArray(first)
      ? first
      : { port: first, host: typeof args[1] === 'string' ? args[1] : undefined }
  const unix = typeof opts.path === 'string' && opts.path !== ''
  const host = unix ? `unix:${opts.path}` : String(opts.host ?? '')
  observedConnects.push(host)
  if (!unix && !LOOPBACK_HOSTS.has(host)) {
    refusedConnects.push(host)
    const err = new Error('this suite refuses any non-loopback connect')
    err.code = 'EPERM'
    throw err
  }
  return realSocketConnect.apply(this, args)
}

after(() => {
  net.Socket.prototype.connect = realSocketConnect
})

test(
  'EXTERNAL-CONNECT PROOF: every connect this suite caused was loopback or Unix-only',
  { timeout: T },
  () => {
    // This test is declared first but node:test runs it in order, so it observes
    // the connects made by every test declared above it. The dedicated assertion
    // that runs LAST is at the bottom of this file; this one guards early failures.
    assert.deepEqual(refusedConnects, [], 'a non-loopback connect was attempted')
  },
)

// ═════════════════════════════════════════════════════════════════════════════
// Sandbox, keys, configs
// ═════════════════════════════════════════════════════════════════════════════

const dirs = []
const servers = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise((resolve) => server.close(() => resolve()))
  }
  for (const dir of dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

let markerCounter = 0
/** A fresh SYNTHETIC key, unique per call. Never a real ping key. */
function syntheticKey() {
  markerCounter += 1
  const value = `hcSynthetic${String(markerCounter).padStart(4, '0')}_MARKER-xyz`
  assert.ok(PING_KEY_PATTERN.test(value), value)
  return value
}

/** Write a synthetic key into a 0600 file inside a 0700 sandbox. */
function keyFileWith(key) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-hc-'))
  fs.chmodSync(dir, 0o700)
  dirs.push(dir)
  const file = path.join(dir, 'ping-key')
  fs.writeFileSync(file, key)
  fs.chmodSync(file, 0o600)
  return file
}

function configFor(pingKeyFile, over = {}) {
  return {
    watcher: {
      provider: 'healthchecks_io',
      slug: over.slug ?? 'eanhl-cloud-backup-freshness',
      pingKeyFile,
    },
    ping: {
      requestTimeoutMs: over.requestTimeoutMs ?? 5_000,
      connectTimeoutMs: over.connectTimeoutMs ?? 2_000,
    },
  }
}

const BODY = '{"kind":"eanhl.cloud-freshness-signal"}'

// ═════════════════════════════════════════════════════════════════════════════
// The loopback server, and the bridge that keeps the PRODUCTION options
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A loopback server. `handler(req, res)` decides the reply; every request it
 * receives is recorded so the path actually sent can be asserted.
 */
async function loopback(handler) {
  const seen = []
  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      seen.push({
        url: req.url,
        method: req.method,
        headers: { ...req.headers },
        body: Buffer.concat(chunks).toString('utf8'),
      })
      handler(req, res, Buffer.concat(chunks))
    })
    req.on('error', () => {
      /* client vanished */
    })
  })
  servers.push(server)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port, seen, connects: () => [...observedConnects] }
}

/**
 * The request dependency: it records the options the PRODUCTION code built, then
 * sends that exact path/method/headers to the loopback server. Only the scheme,
 * host and port are redirected — everything the transport constructs is intact.
 */
function bridgeTo(port, recorded) {
  return (options) => {
    recorded.push({ ...options, headers: { ...options.headers } })
    return http.request({
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method,
      agent: false,
      headers: options.headers,
    })
  }
}

function transportFor(port, recorded = [], over = {}) {
  return makeHealthchecksTransport({
    request: bridgeTo(port, recorded),
    readPingKey: makePingKeyReader(REAL_PING_KEY_DEPS).readPingKey,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h),
    ...over,
  })
}

/** A closed port on loopback: connect will be refused. */
async function closedPort() {
  const server = http.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(() => resolve()))
  return port
}

const ok = (req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('OK')
}

function assertSanitized(result, key) {
  assert.ok(Object.isFrozen(result))
  assert.deepEqual(Object.keys(result).sort(), [
    'attempts',
    'delivery',
    'endpoint',
    'errorClass',
    'outcome',
    'redacted',
    'requestStarted',
    'requestWritten',
    'responseStatus',
    'slug',
  ])
  assert.ok(PING_DELIVERY_STATES.includes(result.delivery), result.delivery)
  assert.ok(PING_OUTCOME_CODES.includes(result.outcome), result.outcome)
  assert.ok(
    result.errorClass === null || PING_ERROR_CLASSES.includes(result.errorClass),
    String(result.errorClass),
  )
  assert.ok(result.redacted.includes('<ping-key>'), result.redacted)
  if (key !== undefined) {
    assert.equal(JSON.stringify(result).includes(key), false, 'the key leaked into the result')
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// assertValidSlug
// ═════════════════════════════════════════════════════════════════════════════

test('assertValidSlug accepts the documented alphabet and refuses everything else', () => {
  for (const slug of ['a', '_', '-', 'a'.repeat(64), 'a_b-c0', '0']) {
    assert.equal(assertValidSlug(slug), slug)
  }
  for (const slug of [
    '',
    'A',
    'a.b',
    'a/b',
    'a%b',
    'a+b',
    'a b',
    'a\0b',
    'a'.repeat(65),
    7,
    null,
  ]) {
    assert.throws(() => assertValidSlug(slug), /lowercase ASCII/, String(slug))
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// §4.1 — behavioural path assertions over EVERY constructed path
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The §4.1 rules, asserted over a path however it was obtained — from
 * `buildPingPath()` directly, or from the `req.url` the loopback server saw.
 */
function assertPathRules(pathname, slug, endpoint) {
  const url = new URL(HEALTHCHECKS_ORIGIN + pathname)
  assert.equal(url.search, '', 'no query string of any kind')
  assert.equal(url.searchParams.size, 0, 'no search parameters')
  assert.equal(url.hash, '', 'no fragment')
  assert.equal(url.pathname, pathname, 'no encoding or normalization occurred')
  // No `create` and no `rid`, in any position or casing.
  assert.equal(/create/i.test(pathname), false)
  assert.equal(/\brid\b/i.test(pathname), false)
  assert.equal(pathname.includes('?'), false)
  assert.equal(pathname.includes('&'), false)
  assert.equal(pathname.includes('='), false)

  const segments = pathname.split('/').slice(1)
  // Never 1 segment, so a UUID endpoint (/<uuid>) is structurally impossible.
  assert.ok(segments.length === 2 || segments.length === 3, `segments: ${segments.length}`)
  assert.equal(segments[1], slug)
  if (segments.length === 3) {
    // The only third segment that exists is `fail`: /start, /log and an
    // exit-code endpoint (/<slug>/<n>) are all excluded.
    assert.equal(segments[2], 'fail')
    assert.equal(endpoint, 'fail')
  } else {
    assert.equal(endpoint, 'success')
  }
  assert.equal(/\/start(\/|$)/.test(pathname), false)
  assert.equal(/\/log(\/|$)/.test(pathname), false)
}

test('buildPingPath: every constructed path satisfies the §4.1 rules', () => {
  for (const slug of ['a', '_', '-', 'eanhl-cloud-backup-freshness', 'a'.repeat(64)]) {
    for (const endpoint of PING_ENDPOINTS) {
      const key = syntheticKey()
      const built = buildPingPath({ pingKey: key, slug, endpoint })
      assert.ok(Object.isFrozen(built))
      assertPathRules(built.path, slug, endpoint)
      assert.equal(built.path.split('/')[1], key, 'the key is the FIRST segment')
      assert.equal(
        built.redacted,
        `${HEALTHCHECKS_ORIGIN}/<ping-key>/${slug}${endpoint === 'fail' ? '/fail' : ''}`,
      )
      assert.equal(built.redacted.includes(key), false, 'the redaction leaked the key')
    }
  }
})

test('buildPingPath refuses a bad key, slug or endpoint, and never echoes the key', () => {
  const key = syntheticKey()
  assert.throws(
    () => buildPingPath({ pingKey: 'short', slug: 'a', endpoint: 'success' }),
    (e) => {
      assert.equal(e.message.includes('short'), false)
      return /accepted shape/.test(e.message)
    },
  )
  for (const bad of ['', 'a'.repeat(65), 'has/slash', 'has.dot', 'has space', null, 7]) {
    assert.throws(
      () => buildPingPath({ pingKey: bad, slug: 'a', endpoint: 'success' }),
      Error,
      String(bad),
    )
  }
  assert.throws(() => buildPingPath({ pingKey: key, slug: 'A', endpoint: 'success' }), /lowercase/)
  for (const endpoint of ['start', 'log', 'Success', '', null, 0, 'fail/']) {
    assert.throws(
      () => buildPingPath({ pingKey: key, slug: 'a', endpoint }),
      /"success" or "fail"/,
      String(endpoint),
    )
  }
  assert.throws(() => buildPingPath(), Error)
})

test(
  'the §4.1 rules hold for the path the LOOPBACK SERVER actually receives',
  { timeout: T },
  async () => {
    for (const endpoint of PING_ENDPOINTS) {
      const key = syntheticKey()
      const file = keyFileWith(key)
      const server = await loopback(ok)
      const recorded = []
      const transport = transportFor(server.port, recorded)
      const slug = 'eanhl-cloud-backup-freshness'
      const result = await transport.pingHealthchecks({
        monitorConfig: configFor(file, { slug }),
        endpoint,
        body: BODY,
      })
      assert.equal(result.outcome, 'accepted', JSON.stringify(result))
      assert.equal(server.seen.length, 1)
      assertPathRules(server.seen[0].url, slug, endpoint)
      assertPathRules(recorded[0].path, slug, endpoint)
      // POSITIVE assertion: the key really is used, so the negative leak
      // assertions elsewhere are not passing vacuously.
      assert.ok(server.seen[0].url.includes(key), 'the key must appear in the request path')
      assert.ok(recorded[0].path.includes(key))
      assertSanitized(result, key)
    }
  },
)

// ═════════════════════════════════════════════════════════════════════════════
// §4.2 — request construction
// ═════════════════════════════════════════════════════════════════════════════

test(
  'the request is POST, with exact content-length, a fixed UA, and no other header',
  { timeout: T },
  async () => {
    const key = syntheticKey()
    const file = keyFileWith(key)
    const server = await loopback(ok)
    const recorded = []
    const body = `${BODY}  with a multi-byte character: é`
    const result = await transportFor(server.port, recorded).pingHealthchecks({
      monitorConfig: configFor(file),
      endpoint: 'success',
      body,
    })
    assert.equal(result.outcome, 'accepted')

    const opts = recorded[0]
    assert.equal(opts.protocol, 'https:')
    assert.equal(opts.hostname, 'hc-ping.com')
    assert.equal(opts.port, 443)
    assert.equal(opts.method, 'POST')
    assert.equal(opts.agent, false, 'agent:false, so no socket outlives the invocation')
    assert.deepEqual(Object.keys(opts.headers).sort(), [
      'accept',
      'connection',
      'content-length',
      'content-type',
      'user-agent',
    ])
    assert.equal(opts.headers['content-type'], 'application/json; charset=utf-8')
    assert.equal(opts.headers['user-agent'], 'eanhl-backup-monitor-export/1')
    assert.equal(opts.headers.accept, 'text/plain')
    assert.equal(opts.headers.connection, 'close')
    // EXACT byte length, not character length, and never chunked.
    assert.equal(opts.headers['content-length'], String(Buffer.byteLength(body, 'utf8')))
    assert.notEqual(Buffer.byteLength(body, 'utf8'), body.length)

    const got = server.seen[0]
    assert.equal(got.method, 'POST')
    assert.equal(got.body, body)
    assert.equal(got.headers['content-length'], String(Buffer.byteLength(body, 'utf8')))
    assert.equal(got.headers['transfer-encoding'], undefined, 'chunked transfer is never used')
    assert.equal(got.headers.cookie, undefined)
    assert.equal(got.headers.authorization, undefined)
    // The user-agent names no host, version or environment data.
    assert.equal(got.headers['user-agent'], 'eanhl-backup-monitor-export/1')
    assert.equal(got.headers['user-agent'].includes(os.hostname()), false)
  },
)

test('`POST` is used for BOTH endpoints', { timeout: T }, async () => {
  for (const endpoint of PING_ENDPOINTS) {
    const file = keyFileWith(syntheticKey())
    const server = await loopback(ok)
    await transportFor(server.port).pingHealthchecks({
      monitorConfig: configFor(file),
      endpoint,
      body: BODY,
    })
    assert.equal(server.seen[0].method, 'POST', endpoint)
  }
})

test(
  'a body over the ceiling is a LOCAL REFUSAL, never truncated and sent',
  { timeout: T },
  async () => {
    const file = keyFileWith(syntheticKey())
    const server = await loopback(ok)
    const recorded = []
    const result = await transportFor(server.port, recorded).pingHealthchecks({
      monitorConfig: configFor(file),
      endpoint: 'fail',
      body: 'a'.repeat(MAX_REQUEST_BODY_BYTES + 1),
    })
    assert.equal(result.delivery, 'not_sent')
    assert.equal(result.outcome, 'local_refused')
    assert.equal(result.attempts, 0)
    assert.equal(result.requestStarted, false)
    assert.deepEqual(recorded, [], 'no request may be constructed')
    assert.equal(server.seen.length, 0, 'nothing may reach the peer')
    // The exact ceiling is accepted.
    const atCeiling = await transportFor(server.port).pingHealthchecks({
      monitorConfig: configFor(keyFileWith(syntheticKey())),
      endpoint: 'fail',
      body: 'a'.repeat(MAX_REQUEST_BODY_BYTES),
    })
    assert.equal(atCeiling.attempts, 1)
  },
)

// ═════════════════════════════════════════════════════════════════════════════
// §4.3 / §4.4 — the request-start boundary and the delivery table
// ═════════════════════════════════════════════════════════════════════════════

test(
  'EVERY local refusal before request start reports not_sent, and nothing else does',
  { timeout: T },
  async () => {
    const server = await loopback(ok)
    const recorded = []
    const transport = transportFor(server.port, recorded)
    const good = keyFileWith(syntheticKey())
    const cases = [
      ['no arguments', undefined],
      ['null arguments', null],
      [
        'a malformed monitor config',
        { monitorConfig: { watcher: {} }, endpoint: 'fail', body: BODY },
      ],
      ['an unknown endpoint', { monitorConfig: configFor(good), endpoint: 'start', body: BODY }],
      ['a missing endpoint', { monitorConfig: configFor(good), body: BODY }],
      ['a non-string body', { monitorConfig: configFor(good), endpoint: 'fail', body: { a: 1 } }],
      ['an empty body', { monitorConfig: configFor(good), endpoint: 'fail', body: '' }],
      [
        'an unreadable key file',
        {
          monitorConfig: configFor(path.join(os.tmpdir(), 'eanhl-absent-key-file'), {}),
          endpoint: 'fail',
          body: BODY,
        },
      ],
    ]
    for (const [what, args] of cases) {
      const result = await transport.pingHealthchecks(args)
      assert.equal(result.delivery, 'not_sent', what)
      assert.equal(result.outcome, 'local_refused', what)
      assert.equal(result.attempts, 0, what)
      assert.equal(result.requestStarted, false, what)
      assert.equal(result.requestWritten, false, what)
      assert.equal(result.responseStatus, null, what)
      assertSanitized(result)
    }
    assert.deepEqual(recorded, [], 'no local refusal may construct a request')
    assert.equal(server.seen.length, 0)
  },
)

test(
  'a key file with the wrong mode is a local refusal that reveals nothing',
  { timeout: T },
  async () => {
    const key = syntheticKey()
    const file = keyFileWith(key)
    fs.chmodSync(file, 0o644)
    const server = await loopback(ok)
    const result = await transportFor(server.port).pingHealthchecks({
      monitorConfig: configFor(file),
      endpoint: 'fail',
      body: BODY,
    })
    assert.equal(result.delivery, 'not_sent')
    assertSanitized(result, key)
    assert.equal(JSON.stringify(result).includes(file), false, 'the key-file path leaked')
  },
)

test('CONNECT REFUSED is indeterminate, NEVER not_sent', { timeout: T }, async () => {
  const key = syntheticKey()
  const file = keyFileWith(key)
  const port = await closedPort()
  const recorded = []
  const result = await transportFor(port, recorded).pingHealthchecks({
    monitorConfig: configFor(file),
    endpoint: 'fail',
    body: BODY,
  })
  assert.equal(result.delivery, 'indeterminate')
  assert.equal(result.outcome, 'transport_error')
  assert.equal(result.errorClass, 'connect')
  assert.equal(result.attempts, 1)
  assert.equal(result.requestStarted, true)
  assert.equal(result.responseStatus, null)
  assert.equal(recorded.length, 1, 'exactly one request was constructed')
  assertSanitized(result, key)
})

test('a DNS failure is indeterminate, NEVER not_sent', { timeout: T }, async () => {
  // Driven by a request double: resolving a real external name is forbidden here,
  // and the connect guard would refuse it anyway.
  const key = syntheticKey()
  const file = keyFileWith(key)
  const result = await makeHealthchecksTransport({
    request: () => {
      const req = fakeRequest()
      setImmediate(() => {
        const err = new Error('getaddrinfo ENOTFOUND')
        err.code = 'ENOTFOUND'
        req.emit('error', err)
      })
      return req
    },
    readPingKey: makePingKeyReader(REAL_PING_KEY_DEPS).readPingKey,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h),
  }).pingHealthchecks({ monitorConfig: configFor(file), endpoint: 'fail', body: BODY })
  assert.equal(result.delivery, 'indeterminate')
  assert.equal(result.errorClass, 'dns')
  assert.equal(result.attempts, 1)
  assertSanitized(result, key)
})

test(
  'A SYNCHRONOUS THROW FROM request() IS INDETERMINATE, never not_sent',
  { timeout: T },
  async () => {
    const key = syntheticKey()
    const file = keyFileWith(key)
    const result = await makeHealthchecksTransport({
      request: () => {
        throw new Error('synchronous failure inside request()')
      },
      readPingKey: makePingKeyReader(REAL_PING_KEY_DEPS).readPingKey,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h),
    }).pingHealthchecks({ monitorConfig: configFor(file), endpoint: 'fail', body: BODY })
    assert.equal(result.delivery, 'indeterminate')
    assert.equal(result.outcome, 'transport_error')
    assert.equal(result.errorClass, 'other')
    assert.equal(result.requestStarted, true, 'the boundary is the CALL, not its return')
    assert.equal(result.attempts, 1)
    assertSanitized(result, key)
  },
)

test(
  'A SYNCHRONOUS THROW FROM req.end() IS INDETERMINATE, never not_sent',
  { timeout: T },
  async () => {
    const key = syntheticKey()
    const file = keyFileWith(key)
    const result = await makeHealthchecksTransport({
      request: () => {
        const req = fakeRequest()
        req.end = () => {
          throw new Error('synchronous failure inside end()')
        }
        return req
      },
      readPingKey: makePingKeyReader(REAL_PING_KEY_DEPS).readPingKey,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h),
    }).pingHealthchecks({ monitorConfig: configFor(file), endpoint: 'fail', body: BODY })
    assert.equal(result.delivery, 'indeterminate')
    assert.equal(result.outcome, 'transport_error')
    assert.equal(result.errorClass, 'other')
    assert.equal(result.requestWritten, false)
    assert.equal(result.attempts, 1)
    assertSanitized(result, key)
  },
)

// ═════════════════════════════════════════════════════════════════════════════
// classifyResponse — the pure matrix
// ═════════════════════════════════════════════════════════════════════════════

test('classifyResponse: only status 200 with the exact bytes OK is accepted', () => {
  assert.equal(EXPECTED_RESPONSE_BODY, 'OK')
  assert.equal(Buffer.byteLength(EXPECTED_RESPONSE_BODY, 'utf8'), 2)
  assert.equal(classifyResponse({ status: 200, body: 'OK' }), 'accepted')
  for (const body of ['ok', 'Ok', 'oK', 'OK\n', 'OK ', ' OK', '', 'OKAY', 'O', 'OK\r\n', '"OK"']) {
    assert.equal(classifyResponse({ status: 200, body }), 'body_unexpected', JSON.stringify(body))
  }
})

test('classifyResponse: every other status is refused, and a 3xx is never followed', () => {
  for (const status of [201, 202, 204, 400, 401, 403, 404, 405, 429, 500, 502, 503]) {
    assert.equal(classifyResponse({ status, body: 'OK' }), 'status_unexpected', String(status))
  }
  for (const status of [301, 302, 303, 307, 308]) {
    assert.equal(classifyResponse({ status, body: 'OK' }), 'redirect_refused', String(status))
  }
  for (const status of [null, undefined, 'x', 99, 600, 1.5, Number.NaN]) {
    assert.equal(classifyResponse({ status, body: 'OK' }), 'status_unexpected', String(status))
  }
  assert.equal(classifyResponse(), 'status_unexpected')
})

test('classifyResponse: body state beats body content, and status beats body state', () => {
  assert.equal(classifyResponse({ status: 200, bodyState: 'oversized' }), 'body_oversized')
  assert.equal(classifyResponse({ status: 200, bodyState: 'truncated' }), 'body_truncated')
  // A 429 is a 429 even if its error page was long: saying so is more useful.
  assert.equal(classifyResponse({ status: 429, bodyState: 'oversized' }), 'status_unexpected')
  // A redirect is refused before the body is considered at all.
  assert.equal(classifyResponse({ status: 302, bodyState: 'oversized' }), 'redirect_refused')
})

// ═════════════════════════════════════════════════════════════════════════════
// The loopback response matrix
// ═════════════════════════════════════════════════════════════════════════════

async function ping(handler, over = {}, bodyOver) {
  const key = syntheticKey()
  const file = keyFileWith(key)
  const server = await loopback(handler)
  const recorded = []
  const result = await transportFor(server.port, recorded).pingHealthchecks({
    monitorConfig: configFor(file, over),
    endpoint: 'fail',
    body: bodyOver ?? BODY,
  })
  return { result, server, recorded, key }
}

test('200 with the exact body OK is accepted and delivered', { timeout: T }, async () => {
  const { result, key } = await ping(ok)
  assert.equal(result.delivery, 'delivered')
  assert.equal(result.outcome, 'accepted')
  assert.equal(result.responseStatus, 200)
  assert.equal(result.errorClass, null)
  assert.equal(result.requestWritten, true)
  assert.equal(result.attempts, 1)
  assertSanitized(result, key)
})

test('200 with any other body is DELIVERED but not accepted', { timeout: T }, async () => {
  for (const body of ['ok', 'OK\n', 'OK ', '']) {
    const { result } = await ping((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(body)
    })
    assert.equal(result.delivery, 'delivered', JSON.stringify(body))
    assert.equal(result.outcome, 'body_unexpected', JSON.stringify(body))
    assert.equal(result.responseStatus, 200)
  }
})

test('every non-200 status is DELIVERED but not accepted', { timeout: T }, async () => {
  for (const status of [201, 400, 403, 404, 429, 500, 503]) {
    const { result } = await ping((req, res) => {
      res.writeHead(status, { 'content-type': 'text/plain' })
      res.end('OK')
    })
    assert.equal(result.delivery, 'delivered', String(status))
    assert.equal(result.outcome, 'status_unexpected', String(status))
    assert.equal(result.responseStatus, status)
  }
})

test('A REDIRECT IS NOT FOLLOWED: one request, Location never read', { timeout: T }, async () => {
  for (const status of [301, 302, 307]) {
    const { result, server, recorded } = await ping((req, res) => {
      res.writeHead(status, { location: 'https://example.invalid/elsewhere' })
      res.end('go')
    })
    assert.equal(result.delivery, 'delivered', String(status))
    assert.equal(result.outcome, 'redirect_refused', String(status))
    assert.equal(result.responseStatus, status)
    assert.equal(recorded.length, 1, 'exactly one request, ever')
    assert.equal(server.seen.length, 1)
  }
})

test(
  'a body past the 64-byte ceiling is DELIVERED and body_oversized',
  { timeout: T },
  async () => {
    assert.equal(MAX_RESPONSE_BYTES, 64)
    // Exactly at the ceiling: read, and refused only on content.
    const at = await ping((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('a'.repeat(MAX_RESPONSE_BYTES))
    })
    assert.equal(at.result.outcome, 'body_unexpected')
    // One byte past it: the ceiling fires.
    const over = await ping((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('a'.repeat(MAX_RESPONSE_BYTES + 1))
    })
    assert.equal(over.result.delivery, 'delivered')
    assert.equal(over.result.outcome, 'body_oversized')
    // Far past it: still bounded, still delivered.
    const far = await ping((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('a'.repeat(200_000))
    })
    assert.equal(far.result.outcome, 'body_oversized')
  },
)

test(
  'a body that ends before content-length is satisfied is DELIVERED and body_truncated',
  { timeout: T },
  async () => {
    const { result } = await ping((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '10' })
      res.write('OK')
      // Let the head and the partial body flush first; destroying in the same tick
      // would test "reset before the head", which has its own test below.
      setTimeout(() => res.socket.destroy(), 20)
    })
    assert.equal(result.delivery, 'delivered')
    assert.equal(result.outcome, 'body_truncated')
    assert.equal(result.responseStatus, 200)
  },
)

test(
  'a reset BEFORE the head is indeterminate; a reset AFTER it is delivered',
  { timeout: T },
  async () => {
    const before = await ping((req, res) => {
      res.socket.destroy()
    })
    assert.equal(before.result.delivery, 'indeterminate')
    assert.equal(before.result.outcome, 'transport_error')
    assert.equal(before.result.responseStatus, null)

    const after = await ping((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '64' })
      res.write('OK')
      setTimeout(() => res.socket.destroy(), 10)
    })
    assert.equal(after.result.delivery, 'delivered')
    assert.equal(after.result.outcome, 'body_truncated')
    assert.equal(after.result.responseStatus, 200)
  },
)

test(
  'a body slower than the request deadline is DELIVERED and body_truncated',
  { timeout: T },
  async () => {
    const { result } = await ping(
      (req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '64' })
        res.write('O')
        // never ends
      },
      { requestTimeoutMs: 1_100, connectTimeoutMs: 1_000 },
    )
    assert.equal(result.delivery, 'delivered')
    assert.equal(result.outcome, 'body_truncated')
    assert.equal(result.errorClass, 'timeout')
  },
)

test(
  'a head that never arrives before the request deadline is indeterminate + timeout',
  { timeout: T },
  async () => {
    const { result } = await ping(
      () => {
        /* never replies */
      },
      { requestTimeoutMs: 1_100, connectTimeoutMs: 1_000 },
    )
    assert.equal(result.delivery, 'indeterminate')
    assert.equal(result.outcome, 'transport_error')
    assert.equal(result.errorClass, 'timeout')
    assert.equal(result.responseStatus, null)
  },
)

test(
  'A POST-SETTLEMENT socket error does not become an uncaughtException',
  { timeout: T },
  async () => {
    // Settlement destroys the request, and a destroyed ClientRequest emits a
    // further "socket hang up". With every listener removed that would throw and
    // take the process down AFTER a ping had already been decided, so one
    // permanent no-op absorber stays subscribed. Two settled-then-destroyed
    // invocations in a row, and a turn of the loop for the late event to land in.
    const uncaught = []
    const onUncaught = (err) => uncaught.push(err)
    process.on('uncaughtException', onUncaught)
    try {
      for (const handler of [
        () => {
          /* never replies: the request deadline settles it */
        },
        (req, res) => {
          res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '64' })
          res.write('OK') // never ends
        },
      ]) {
        const { result } = await ping(handler, { requestTimeoutMs: 1_100, connectTimeoutMs: 1_000 })
        assert.ok(['indeterminate', 'delivered'].includes(result.delivery))
        await new Promise((r) => setTimeout(r, 120))
      }
    } finally {
      process.removeListener('uncaughtException', onUncaught)
    }
    assert.deepEqual(
      uncaught.map((e) => e.message),
      [],
      'a late socket error escaped as an uncaught exception',
    )
  },
)

// ═════════════════════════════════════════════════════════════════════════════
// §7.2 — event-order races, driven from an injected request double
// ═════════════════════════════════════════════════════════════════════════════

/**
 * A minimal ClientRequest stand-in.
 *
 * It keeps ONE permanent `'error'` sink, for the same reason a real
 * `ClientRequest` is never listenerless: a bare `EventEmitter` THROWS on an
 * `'error'` with no listener, so a deliberately-late emission would surface as
 * an uncaught exception in the driver rather than as the thing under test. The
 * sink also makes unsubscription directly observable — after settlement the
 * transport's own listeners are gone and only the sink remains.
 */
function fakeRequest() {
  const req = new EventEmitter()
  req.destroyed = false
  req.lateErrors = []
  req.on('error', (err) => {
    req.lateErrors.push(err)
  })
  req.end = () => {
    setImmediate(() => req.emit('finish'))
  }
  req.destroyCount = 0
  req.destroy = () => {
    req.destroyCount += 1
    req.destroyed = true
  }
  return req
}

/** A minimal IncomingMessage stand-in. */
function fakeResponse(statusCode, headers = {}) {
  const res = new EventEmitter()
  res.statusCode = statusCode
  res.headers = headers
  return res
}

function doubleTransport(drive, over = {}) {
  const calls = []
  const requests = []
  const transport = makeHealthchecksTransport({
    request: (options) => {
      calls.push(options)
      const req = fakeRequest()
      requests.push(req)
      setImmediate(() => drive(req))
      return req
    },
    readPingKey: makePingKeyReader(REAL_PING_KEY_DEPS).readPingKey,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h),
    ...over,
  })
  return { transport, calls, requests }
}

async function race(drive, over = {}, depsOver = {}) {
  const key = syntheticKey()
  const file = keyFileWith(key)
  const { transport, calls, requests } = doubleTransport(drive, depsOver)
  const controller = new AbortController()
  const result = await transport.pingHealthchecks({
    monitorConfig: configFor(file, over),
    endpoint: 'fail',
    body: BODY,
    signal: controller.signal,
  })
  return { result, calls, requests, key, controller }
}

/**
 * After settlement, the only `'error'` listeners left are the two permanent
 * absorbers — the double's own, and the transport's, which exists so a
 * post-`destroy()` `'error'` cannot become an `uncaughtException`. Every
 * listener the transport installed to CLASSIFY an event is gone.
 */
function assertUnsubscribed(req) {
  assert.equal(req.listenerCount('error'), 2, 'only the two permanent absorbers may remain')
  for (const event of ['response', 'close', 'timeout', 'socket', 'finish']) {
    assert.equal(req.listenerCount(event), 0, `${event} listener was not removed`)
  }
  assert.equal(req.destroyed, true, 'the request must be destroyed')
  assert.equal(req.destroyCount, 1, 'the request must be destroyed EXACTLY once')
}

test(
  'RACE: a head and a complete body, then a late error — the late event changes nothing',
  { timeout: T },
  async () => {
    const { result, calls, requests } = await race((req) => {
      const res = fakeResponse(200, { 'content-length': '2' })
      req.emit('response', res)
      res.emit('data', Buffer.from('OK'))
      res.emit('end')
      // Everything below arrives AFTER settlement.
      req.emit('error', Object.assign(new Error('late'), { code: 'ECONNRESET' }))
      req.emit('error', Object.assign(new Error('later'), { code: 'EPIPE' }))
      req.emit('close')
      req.emit('timeout')
      req.emit('response', fakeResponse(500))
    })
    assert.equal(result.outcome, 'accepted')
    assert.equal(result.delivery, 'delivered')
    assert.equal(result.errorClass, null)
    assert.equal(calls.length, 1)
    // Every late event really was delivered to the emitter, and every one of the
    // transport's own listeners really had been removed.
    assertUnsubscribed(requests[0])
    assert.equal(requests[0].lateErrors.length, 2)
  },
)

test('RACE: a head, then an immediate reset mid-body', { timeout: T }, async () => {
  const { result } = await race((req) => {
    const res = fakeResponse(200, { 'content-length': '10' })
    req.emit('response', res)
    res.emit('data', Buffer.from('OK'))
    res.emit('aborted')
  })
  assert.equal(result.delivery, 'delivered')
  assert.equal(result.outcome, 'body_truncated')
})

test('RACE: close arriving BEFORE response', { timeout: T }, async () => {
  const { result } = await race((req) => {
    req.emit('close')
    req.emit('response', fakeResponse(200, { 'content-length': '2' }))
  })
  assert.equal(result.delivery, 'indeterminate')
  assert.equal(result.outcome, 'transport_error')
  assert.equal(result.errorClass, 'other')
  assert.equal(result.responseStatus, null, 'the late head must not be recorded')
})

test(
  'RACE: the request deadline firing concurrently with the final body chunk',
  { timeout: T },
  async () => {
    // The timer is invoked synchronously, in the same tick as the last chunk. Only
    // one of the two may settle, and the result must be internally coherent.
    let fire = null
    const { result } = await race(
      (req) => {
        const res = fakeResponse(200, { 'content-length': '2' })
        req.emit('response', res)
        res.emit('data', Buffer.from('OK'))
        if (fire !== null) fire()
        res.emit('end')
        if (fire !== null) fire()
      },
      {},
      {
        setTimer: (fn) => {
          if (fire === null) fire = fn
          return 0
        },
        clearTimer: () => {},
      },
    )
    assert.equal(result.delivery, 'delivered')
    assert.ok(['body_truncated', 'accepted'].includes(result.outcome), result.outcome)
    assert.equal(result.responseStatus, 200)
  },
)

test('RACE: abort between socket and secureConnect', { timeout: T }, async () => {
  const key = syntheticKey()
  const file = keyFileWith(key)
  const controller = new AbortController()
  const { transport, calls } = doubleTransport((req) => {
    const socket = new EventEmitter()
    req.emit('socket', socket)
    // secureConnect never arrives; the operator cancels instead.
    controller.abort()
  })
  const result = await transport.pingHealthchecks({
    monitorConfig: configFor(file),
    endpoint: 'fail',
    body: BODY,
    signal: controller.signal,
  })
  assert.equal(result.delivery, 'indeterminate')
  assert.equal(result.outcome, 'transport_error')
  assert.equal(result.errorClass, 'cancelled')
  assert.equal(result.attempts, 1, 'the request HAD started')
  assert.equal(calls.length, 1)
  assertSanitized(result, key)
})

test('RACE: abort arriving AFTER settlement changes nothing', { timeout: T }, async () => {
  const key = syntheticKey()
  const file = keyFileWith(key)
  const controller = new AbortController()
  const { transport } = doubleTransport((req) => {
    const res = fakeResponse(200, { 'content-length': '2' })
    req.emit('response', res)
    res.emit('data', Buffer.from('OK'))
    res.emit('end')
  })
  const result = await transport.pingHealthchecks({
    monitorConfig: configFor(file),
    endpoint: 'fail',
    body: BODY,
    signal: controller.signal,
  })
  assert.equal(result.outcome, 'accepted')
  controller.abort() // after the fact
  assert.equal(result.outcome, 'accepted', 'a frozen result cannot change')
  assert.equal(result.errorClass, null)
})

/** The abort listeners currently attached to a real `AbortSignal`. */
const abortListeners = (signal) => getEventListeners(signal, 'abort').length

/** A successful exchange: a 200 head and the exact body `OK`. */
const acceptingDrive = (req) => {
  const res = fakeResponse(200, { 'content-length': '2' })
  req.emit('response', res)
  res.emit('data', Buffer.from('OK'))
  res.emit('end')
}

test(
  'LIFETIME: the abort listener is installed while in flight and removed on settlement',
  { timeout: T },
  async () => {
    const key = syntheticKey()
    const file = keyFileWith(key)
    const controller = new AbortController()
    let inFlight = null
    const { transport, requests } = doubleTransport((req) => {
      // Observed from INSIDE the exchange, so the test proves there was a
      // listener to remove rather than passing vacuously.
      inFlight = abortListeners(controller.signal)
      acceptingDrive(req)
    })
    assert.equal(abortListeners(controller.signal), 0)
    const result = await transport.pingHealthchecks({
      monitorConfig: configFor(file),
      endpoint: 'success',
      body: BODY,
      signal: controller.signal,
    })
    assert.equal(inFlight, 1, 'exactly one abort listener while the request is in flight')
    assert.equal(result.outcome, 'accepted')
    assert.equal(abortListeners(controller.signal), 0, 'no listener may outlive settlement')

    // An abort after settlement reaches no listener and changes nothing.
    controller.abort()
    await new Promise((r) => setImmediate(r))
    assert.equal(result.outcome, 'accepted', 'a settled result cannot change')
    assert.equal(result.delivery, 'delivered')
    assert.equal(result.errorClass, null)
    assert.equal(requests[0].destroyCount, 1, 'settlement must not run twice')
  },
)

test(
  'LIFETIME: no abort listener remains after timeout, transport error, cancellation, or a local failure',
  { timeout: T },
  async () => {
    const key = syntheticKey()
    const file = keyFileWith(key)
    const cases = [
      {
        what: 'request deadline',
        drive: () => {},
        depsOver: (timers) => ({
          setTimer: (fn) => {
            timers.push(fn)
            setImmediate(fn)
            return 0
          },
          clearTimer: () => {},
        }),
        expect: { delivery: 'indeterminate', errorClass: 'timeout' },
      },
      {
        what: 'transport error',
        drive: (req) => req.emit('error', Object.assign(new Error('x'), { code: 'ECONNRESET' })),
        expect: { delivery: 'indeterminate', outcome: 'transport_error' },
      },
      {
        what: 'cancellation',
        drive: (req, controller) => controller.abort(),
        expect: { delivery: 'indeterminate', errorClass: 'cancelled' },
      },
      {
        what: 'request() throws synchronously (settles before the listener exists)',
        request: () => {
          throw new Error('boom')
        },
        expect: { delivery: 'indeterminate', errorClass: 'other' },
      },
      {
        what: 'end() throws synchronously (settles after the listener exists)',
        request: () => {
          const req = fakeRequest()
          req.end = () => {
            throw new Error('boom')
          }
          return req
        },
        expect: { delivery: 'indeterminate', errorClass: 'other' },
      },
    ]
    for (const c of cases) {
      const controller = new AbortController()
      const timers = []
      const depsOver = { ...(c.depsOver ? c.depsOver(timers) : {}) }
      if (c.request) depsOver.request = c.request
      const { transport } = doubleTransport((req) => c.drive(req, controller), depsOver)
      const result = await transport.pingHealthchecks({
        monitorConfig: configFor(file),
        endpoint: 'fail',
        body: BODY,
        signal: controller.signal,
      })
      for (const [field, value] of Object.entries(c.expect)) {
        assert.equal(result[field], value, `${c.what}: ${field}`)
      }
      assert.equal(result.attempts, 1, `${c.what}: the request had started`)
      assert.equal(abortListeners(controller.signal), 0, `${c.what}: a listener remained`)
    }

    // A local refusal before the request never installs one at all.
    const controller = new AbortController()
    const { transport } = doubleTransport(() => {})
    const refused = await transport.pingHealthchecks({
      monitorConfig: configFor(file),
      endpoint: 'fail',
      body: '',
      signal: controller.signal,
    })
    assert.equal(refused.delivery, 'not_sent')
    assert.equal(abortListeners(controller.signal), 0)
  },
)

test(
  'ONE-SHOT: an end() that settles synchronously and THEN throws does not settle twice',
  { timeout: T },
  async () => {
    // With the abort listener now removed on settlement, the `req.end()` catch
    // is the one remaining caller of `settle()` that can run AFTER a
    // settlement without a guard of its own: a synchronous `'error'` inside
    // `end()` settles, and the throw that follows reaches the catch.
    const key = syntheticKey()
    const file = keyFileWith(key)
    const controller = new AbortController()
    let req = null
    const { transport } = doubleTransport(() => {}, {
      request: () => {
        req = fakeRequest()
        req.end = () => {
          req.emit('error', Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))
          throw new Error('and then a throw')
        }
        return req
      },
    })
    const result = await transport.pingHealthchecks({
      monitorConfig: configFor(file),
      endpoint: 'fail',
      body: BODY,
      signal: controller.signal,
    })
    assert.equal(result.delivery, 'indeterminate')
    assert.equal(result.errorClass, 'connect', 'the FIRST settlement stands')
    assert.equal(req.destroyCount, 1, 'settle() must not run its body twice')
    assert.equal(abortListeners(controller.signal), 0)
  },
)

test(
  'LIFETIME: repeated invocations on ONE long-lived, never-aborted signal do not accumulate listeners',
  { timeout: T },
  async () => {
    const key = syntheticKey()
    const file = keyFileWith(key)
    const controller = new AbortController()
    const counts = []
    for (let i = 0; i < 25; i++) {
      const { transport } = doubleTransport(acceptingDrive)
      const result = await transport.pingHealthchecks({
        monitorConfig: configFor(file),
        endpoint: 'success',
        body: BODY,
        signal: controller.signal,
      })
      assert.equal(result.outcome, 'accepted')
      counts.push(abortListeners(controller.signal))
    }
    assert.deepEqual(counts, Array(25).fill(0), 'the listener count must stay at zero')
    assert.equal(controller.signal.aborted, false, 'the signal was never aborted')
  },
)

test(
  'RACE: an abort BEFORE the request is a local refusal, not an attempt',
  { timeout: T },
  async () => {
    const key = syntheticKey()
    const file = keyFileWith(key)
    const controller = new AbortController()
    controller.abort()
    const { transport, calls } = doubleTransport(() => {})
    const result = await transport.pingHealthchecks({
      monitorConfig: configFor(file),
      endpoint: 'fail',
      body: BODY,
      signal: controller.signal,
    })
    assert.equal(result.delivery, 'not_sent')
    assert.equal(result.outcome, 'local_refused')
    assert.equal(result.errorClass, 'cancelled')
    assert.equal(result.attempts, 0)
    assert.equal(result.requestStarted, false)
    assert.deepEqual(calls, [], 'no request may be constructed')
  },
)

test(
  'RACE: when the socket event never fires, the REQUEST deadline still covers the invocation',
  { timeout: T },
  async () => {
    const { result } = await race(
      () => {
        /* no socket, no response, no error — a hung request */
      },
      { requestTimeoutMs: 1_100, connectTimeoutMs: 1_000 },
    )
    assert.equal(result.delivery, 'indeterminate')
    assert.equal(result.errorClass, 'timeout')
  },
)

test(
  'RACE: the connect deadline fires when the socket never completes its handshake',
  { timeout: T },
  async () => {
    const { result } = await race(
      (req) => {
        req.emit('socket', new EventEmitter()) // secureConnect never arrives
      },
      { requestTimeoutMs: 20_000, connectTimeoutMs: 1_000 },
    )
    assert.equal(result.delivery, 'indeterminate')
    assert.equal(result.errorClass, 'timeout')
    assert.equal(result.responseStatus, null)
  },
)

test('RACE: a secureConnect disarms the connect deadline', { timeout: T }, async () => {
  const { result } = await race(
    (req) => {
      const socket = new EventEmitter()
      req.emit('socket', socket)
      socket.emit('secureConnect')
      setTimeout(() => {
        const res = fakeResponse(200, { 'content-length': '2' })
        req.emit('response', res)
        res.emit('data', Buffer.from('OK'))
        res.emit('end')
      }, 1_300)
    },
    // The reply arrives after the CONNECT deadline would have expired, but the
    // handshake disarmed it, so only the request deadline remains.
    { requestTimeoutMs: 20_000, connectTimeoutMs: 1_000 },
  )
  assert.equal(result.outcome, 'accepted')
})

test('RACE: a second error after settlement cannot change the result', { timeout: T }, async () => {
  const { result, requests } = await race((req) => {
    req.emit('error', Object.assign(new Error('first'), { code: 'ECONNRESET' }))
    req.emit('error', Object.assign(new Error('second'), { code: 'ENOTFOUND' }))
  })
  assert.equal(result.delivery, 'indeterminate')
  assert.equal(result.errorClass, 'reset', 'the FIRST error classified it')
  assertUnsubscribed(requests[0])
  assert.equal(requests[0].lateErrors.length, 2, 'both errors reached the emitter')
})

test(
  'ONE-SHOT: exactly one request is constructed on every path, and there is no retry',
  { timeout: T },
  async () => {
    const drives = [
      (req) => req.emit('error', Object.assign(new Error('x'), { code: 'ECONNRESET' })),
      (req) => req.emit('close'),
      (req) => {
        const res = fakeResponse(500)
        req.emit('response', res)
        res.emit('end')
      },
      (req) => {
        const res = fakeResponse(302, { location: 'https://example.invalid/' })
        req.emit('response', res)
        res.emit('end')
      },
      (req) => {
        const res = fakeResponse(200, { 'content-length': '2' })
        req.emit('response', res)
        res.emit('data', Buffer.from('OK'))
        res.emit('end')
      },
    ]
    for (const drive of drives) {
      const { calls } = await race(drive)
      assert.equal(calls.length, 1, 'exactly one request per invocation')
    }
    const core = fs.readFileSync(CORE, 'utf8')
    assert.equal(core.match(/deps\.request\(/g).length, 1, 'exactly one call site')
    assert.equal(
      /\bretry|\bbackoff|\battempt\s*\+\+|for \(let attempt/i.test(core.replace(/^\s*\*.*$/gm, '')),
      false,
    )
  },
)

test('errorClass is a hint only: it never changes delivery', { timeout: T }, async () => {
  const codes = [
    ['ENOTFOUND', 'dns'],
    ['EAI_AGAIN', 'dns'],
    ['ECONNREFUSED', 'connect'],
    ['EHOSTUNREACH', 'connect'],
    ['ENETUNREACH', 'connect'],
    ['ERR_TLS_CERT_ALTNAME_INVALID', 'tls'],
    ['ERR_SSL_WRONG_VERSION_NUMBER', 'tls'],
    ['CERT_HAS_EXPIRED', 'tls'],
    ['DEPTH_ZERO_SELF_SIGNED_CERT', 'tls'],
    ['ECONNRESET', 'reset'],
    ['EPIPE', 'write'],
    ['ETIMEDOUT', 'timeout'],
    ['ABORT_ERR', 'cancelled'],
    ['SOMETHING_NEW', 'other'],
    [undefined, 'other'],
  ]
  for (const [code, expected] of codes) {
    const { result } = await race((req) => {
      req.emit('error', Object.assign(new Error('x'), code === undefined ? {} : { code }))
    })
    assert.equal(result.errorClass, expected, String(code))
    // Whatever the hint says, nothing was established about delivery.
    assert.equal(result.delivery, 'indeterminate', String(code))
    assert.equal(result.outcome, 'transport_error', String(code))
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// Leak tests — runtime unique markers
// ═════════════════════════════════════════════════════════════════════════════

/** Deep-walk everything, including error properties, looking for `marker`. */
function assertNoMarker(marker, ...haystacks) {
  const seen = new Set()
  const walk = (value, where) => {
    if (value === null || value === undefined) return
    if (typeof value === 'string') {
      assert.equal(value.includes(marker), false, `the marker leaked into ${where}`)
      return
    }
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return
    if (typeof value === 'symbol' || typeof value === 'function') {
      assert.equal(String(value).includes(marker), false, `the marker leaked into ${where}`)
      return
    }
    if (seen.has(value)) return
    seen.add(value)
    if (value instanceof Error) {
      for (const prop of ['message', 'stack', 'cause', 'code']) {
        walk(value[prop], `${where}.${prop}`)
      }
    }
    if (Buffer.isBuffer(value)) {
      walk(value.toString('utf8'), `${where}<buffer>`)
      return
    }
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${where}[${i}]`))
      return
    }
    for (const prop of Object.getOwnPropertyNames(value)) {
      walk(prop, `${where} key`)
      let v
      try {
        v = value[prop]
      } catch {
        continue
      }
      walk(v, `${where}.${prop}`)
    }
    try {
      walk(JSON.stringify(value), `${where}<json>`)
    } catch {
      /* cyclic or unserializable; the walk above already covered it */
    }
  }
  for (const [i, h] of haystacks.entries()) walk(h, `haystack#${i}`)
}

test(
  'LEAK: a unique runtime marker reaches the request path and NOTHING else',
  { timeout: T },
  async () => {
    const marker = `hcLeak${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}A`
    assert.ok(PING_KEY_PATTERN.test(marker), marker)
    const file = keyFileWith(marker)
    const server = await loopback(ok)
    const recorded = []
    const result = await transportFor(server.port, recorded).pingHealthchecks({
      monitorConfig: configFor(file),
      endpoint: 'success',
      body: BODY,
    })
    // POSITIVE: the key genuinely IS used.
    assert.ok(server.seen[0].url.includes(marker), 'the marker must appear in the request path')
    // NEGATIVE: it appears nowhere a caller or an operator can see.
    assertNoMarker(marker, result, result.redacted, JSON.stringify(result))
    assertNoMarker(marker, server.seen[0].body, server.seen[0].headers)
    assertNoMarker(marker, process.argv, process.env.EANHL_TEST_STATE_DIR ?? '')
  },
)

test('LEAK: the marker never escapes along ANY failure path', { timeout: T }, async () => {
  const cases = [
    ['wrong mode', (file) => fs.chmodSync(file, 0o644)],
    ['oversized', (file) => fs.writeFileSync(file, 'a'.repeat(1_000)) || fs.chmodSync(file, 0o600)],
    ['bad shape', (file) => fs.writeFileSync(file, 'short') || fs.chmodSync(file, 0o600)],
    ['removed', (file) => fs.rmSync(file)],
  ]
  for (const [what, damage] of cases) {
    const marker = `hcFail${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}B`
    const file = keyFileWith(marker)
    damage(file)
    const server = await loopback(ok)
    const recorded = []
    const result = await transportFor(server.port, recorded).pingHealthchecks({
      monitorConfig: configFor(file),
      endpoint: 'fail',
      body: BODY,
    })
    assert.equal(result.delivery, 'not_sent', what)
    assertNoMarker(marker, result, recorded, server.seen)
  }
})

test(
  'LEAK: a thrown value from anywhere in the transport never carries the marker',
  { timeout: T },
  async () => {
    const marker = `hcThrow${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}C`
    const file = keyFileWith(marker)
    const thrown = []
    const transport = makeHealthchecksTransport({
      request: (options) => {
        // A hostile double: it throws whatever it was handed straight back.
        const err = new Error(`double refused ${options.path}`)
        thrown.push(err)
        throw err
      },
      readPingKey: makePingKeyReader(REAL_PING_KEY_DEPS).readPingKey,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h),
    })
    const result = await transport.pingHealthchecks({
      monitorConfig: configFor(file),
      endpoint: 'fail',
      body: BODY,
    })
    // The double's own error DOES carry the path — it built the message itself —
    // but nothing the transport RETURNS may.
    assert.ok(thrown[0].message.includes(marker), 'the double really did see the key')
    assertNoMarker(marker, result, JSON.stringify(result))
    assert.equal(result.delivery, 'indeterminate')
  },
)

// ═════════════════════════════════════════════════════════════════════════════
// The public surface
// ═════════════════════════════════════════════════════════════════════════════

test('the public wrapper re-exports NEITHER the key reader NOR buildPingPath', () => {
  const names = Object.keys(production)
  assert.deepEqual(names.sort(), [
    'EXPECTED_RESPONSE_BODY',
    'HEALTHCHECKS_ORIGIN',
    'MAX_REQUEST_BODY_BYTES',
    'MAX_RESPONSE_BYTES',
    'PING_DELIVERY_STATES',
    'PING_ENDPOINTS',
    'PING_ERROR_CLASSES',
    'PING_OUTCOME_CODES',
    'assertValidSlug',
    'classifyResponse',
    'pingHealthchecks',
  ])
  for (const forbidden of [
    'buildPingPath',
    'makePingKeyReader',
    'readPingKey',
    'REAL_PING_KEY_DEPS',
    'PING_KEY_PATTERN',
    'REAL_TRANSPORT_DEPS',
    'makeHealthchecksTransport',
  ]) {
    assert.equal(names.includes(forbidden), false, forbidden)
  }
})

test('the constants the public surface exposes are the module constants, frozen', () => {
  assert.equal(production.HEALTHCHECKS_ORIGIN, 'https://hc-ping.com')
  assert.equal(production.EXPECTED_RESPONSE_BODY, 'OK')
  assert.equal(production.MAX_RESPONSE_BYTES, 64)
  assert.equal(production.MAX_REQUEST_BODY_BYTES, 16 * 1024)
  for (const name of [
    'PING_ENDPOINTS',
    'PING_OUTCOME_CODES',
    'PING_DELIVERY_STATES',
    'PING_ERROR_CLASSES',
  ]) {
    assert.ok(Object.isFrozen(production[name]), name)
  }
})

test('makeHealthchecksTransport refuses an incomplete dependency set', () => {
  assert.throws(() => makeHealthchecksTransport(null), TypeError)
  assert.throws(() => makeHealthchecksTransport({}), TypeError)
  for (const name of ['request', 'readPingKey', 'setTimer', 'clearTimer']) {
    const deps = {
      request: () => fakeRequest(),
      readPingKey: () => ({ state: 'failed', code: 'key_file_unreadable' }),
      setTimer: () => 0,
      clearTimer: () => {},
    }
    delete deps[name]
    assert.throws(() => makeHealthchecksTransport(deps), TypeError, name)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// THE CALL-ARGUMENT AND SIGNAL BOUNDARY
//
// Reproduced defect: a plain object whose `addEventListener` getter throws was
// treated as a candidate signal, its getter ran, and the promise REJECTED with
// the caller's marker. The public wrapper also destructured `args`, running the
// caller's accessors and Proxy traps before any boundary.
//
// Every production-wrapper case below carries a monitor config that could never
// validate, so even a regressed boundary cannot read a key file or reach the
// network through `hc-ping.com`.
// ═════════════════════════════════════════════════════════════════════════════

const BOUNDARY_MARKER = 'hostile-signal-marker-7Qx'

/**
 * A transport over real key reading whose every side effect is COUNTED. With
 * valid arguments it reads the key, arms a timer and issues one request (the
 * positive control below), so a zero count on a refusal is not vacuous.
 */
function countingTransport(file) {
  const counts = { readPingKey: 0, setTimer: 0, request: 0 }
  const calls = []
  const realRead = makePingKeyReader(REAL_PING_KEY_DEPS).readPingKey
  const transport = makeHealthchecksTransport({
    request: (options) => {
      counts.request += 1
      calls.push({ ...options, headers: { ...options.headers } })
      const req = fakeRequest()
      setImmediate(() => acceptingDrive(req))
      return req
    },
    readPingKey: (p) => {
      counts.readPingKey += 1
      return realRead(p)
    },
    setTimer: (fn, ms) => {
      counts.setTimer += 1
      return setTimeout(fn, ms)
    },
    clearTimer: (h) => clearTimeout(h),
  })
  return { transport, counts, calls, validArgs: () => validPingArgs(file) }
}

const validPingArgs = (file) => ({ monitorConfig: configFor(file), endpoint: 'fail', body: BODY })

/** Record every stdout/stderr write made while `fn` runs, passing each through. */
async function captureStreams(fn) {
  const chunks = []
  const realOut = process.stdout.write
  const realErr = process.stderr.write
  process.stdout.write = function (chunk, ...rest) {
    chunks.push(String(chunk))
    return realOut.call(this, chunk, ...rest)
  }
  process.stderr.write = function (chunk, ...rest) {
    chunks.push(String(chunk))
    return realErr.call(this, chunk, ...rest)
  }
  try {
    return { value: await fn(), chunks }
  } finally {
    process.stdout.write = realOut
    process.stderr.write = realErr
  }
}

/** Settle `promise`, capturing a rejection rather than throwing it. */
async function settleOf(promise) {
  try {
    return { resolved: await promise, rejected: undefined }
  } catch (err) {
    return { resolved: undefined, rejected: err }
  }
}

function assertNoBoundaryMarker(...haystacks) {
  for (const h of haystacks) {
    const text =
      h instanceof Error
        ? `${h.message}\n${h.stack}\n${String(h.cause)}`
        : typeof h === 'string'
          ? h
          : JSON.stringify(h)
    assert.equal(String(text).includes(BOUNDARY_MARKER), false, 'the caller marker leaked')
  }
}

/** The frozen, sanitized pre-start refusal: nothing read, armed or sent. */
function assertBoundaryRefusal(outcome, what, counts) {
  assert.equal(outcome.rejected, undefined, `${what}: the promise must not reject`)
  const result = outcome.resolved
  assertSanitized(result)
  assert.equal(result.delivery, 'not_sent', what)
  assert.equal(result.outcome, 'local_refused', what)
  assert.equal(result.errorClass, 'other', what)
  assert.equal(result.attempts, 0, what)
  assert.equal(result.requestStarted, false, what)
  assert.equal(result.requestWritten, false, what)
  assert.equal(result.responseStatus, null, what)
  assert.equal(result.slug, null, `${what}: no config was validated`)
  if (counts !== undefined) {
    assert.deepEqual(counts, { readPingKey: 0, setTimer: 0, request: 0 }, `${what}: side effect`)
  }
}

/** A handler that is itself a Proxy records every trap LOOKUP, defined or not. */
function trapRecorder(trapped) {
  return new Proxy(
    {},
    {
      get(_t, name) {
        trapped.push(String(name))
        return undefined
      },
    },
  )
}

test(
  'BOUNDARY (positive control): valid arguments read the key, arm a timer and issue ONE request',
  { timeout: T },
  async () => {
    const file = keyFileWith(syntheticKey())
    for (const shape of ['ordinary', 'null-prototype', 'with undefined signal']) {
      const { transport, counts, calls, validArgs } = countingTransport(file)
      let args = validArgs()
      if (shape === 'null-prototype') args = Object.assign(Object.create(null), args)
      if (shape === 'with undefined signal') args.signal = undefined
      const result = await transport.pingHealthchecks(args)
      assert.equal(result.outcome, 'accepted', shape)
      assert.equal(counts.readPingKey, 1, shape)
      assert.ok(counts.setTimer >= 1, shape)
      assert.equal(counts.request, 1, `${shape}: exactly one request, no retry`)
      assert.equal(calls.length, 1, shape)
    }
  },
)

test(
  'BOUNDARY: a trap-recording or revoked top-level Proxy is refused with ZERO traps observed',
  { timeout: T },
  async () => {
    const file = keyFileWith(syntheticKey())
    const { transport, counts, validArgs } = countingTransport(file)
    const trapped = []
    const live = new Proxy(validArgs(), trapRecorder(trapped))
    assertBoundaryRefusal(await settleOf(transport.pingHealthchecks(live)), 'live proxy', counts)
    const { proxy: revoked, revoke } = Proxy.revocable(validArgs(), {})
    revoke()
    assertBoundaryRefusal(await settleOf(transport.pingHealthchecks(revoked)), 'revoked', counts)

    // The production wrapper, too: it must forward the Proxy unread.
    const prodTrapped = []
    const prod = new Proxy(
      { monitorConfig: null, endpoint: 'fail', body: BODY },
      trapRecorder(prodTrapped),
    )
    assertBoundaryRefusal(await settleOf(production.pingHealthchecks(prod)), 'production proxy')
    const { proxy: prodRevoked, revoke: prodRevoke } = Proxy.revocable({}, {})
    prodRevoke()
    assertBoundaryRefusal(await settleOf(production.pingHealthchecks(prodRevoked)), 'prod revoked')
    assert.deepEqual(trapped, [], 'a core Proxy trap fired')
    assert.deepEqual(prodTrapped, [], 'a production-wrapper Proxy trap fired')
  },
)

test(
  'BOUNDARY: throwing and stateful getters on EVERY argument are invoked zero times',
  { timeout: T },
  async () => {
    const file = keyFileWith(syntheticKey())
    for (const key of ['monitorConfig', 'endpoint', 'body', 'signal']) {
      for (const kind of ['throwing', 'stateful']) {
        for (const via of ['core', 'production']) {
          const what = `${via} ${kind} getter on ${key}`
          const { transport, counts, validArgs } = countingTransport(file)
          const base =
            via === 'core' ? validArgs() : { monitorConfig: null, endpoint: 'fail', body: BODY }
          const good = key === 'signal' ? new AbortController().signal : base[key]
          delete base[key]
          let reads = 0
          Object.defineProperty(base, key, {
            enumerable: true,
            configurable: true,
            get() {
              reads += 1
              if (kind === 'throwing') throw new Error(BOUNDARY_MARKER)
              return reads === 1 ? good : BOUNDARY_MARKER
            },
          })
          const ping = via === 'core' ? transport.pingHealthchecks : production.pingHealthchecks
          const { value: outcome, chunks } = await captureStreams(() => settleOf(ping(base)))
          assertBoundaryRefusal(outcome, what, via === 'core' ? counts : undefined)
          assert.equal(reads, 0, `${what}: the accessor ran`)
          assertNoBoundaryMarker(outcome.resolved, chunks.join(''), process.argv.join(' '))
        }
      }
    }
  },
)

test(
  'BOUNDARY: anything but a plain flat object of exactly the documented keys is refused',
  { timeout: T },
  async () => {
    const file = keyFileWith(syntheticKey())
    class Args {
      constructor(v) {
        Object.assign(this, v)
      }
    }
    const cases = [
      ['undefined', () => undefined],
      ['null', () => null],
      ['a string', () => BOUNDARY_MARKER],
      ['an array', (v) => [v.monitorConfig, v.endpoint, v.body]],
      ['a class instance', (v) => new Args(v)],
      ['a foreign prototype', (v) => Object.assign(Object.create({ inherited: 1 }), v)],
      ['a symbol key', (v) => ({ ...v, [Symbol(BOUNDARY_MARKER)]: 1 })],
      ['an extra key', (v) => ({ ...v, deps: { request: () => null } })],
      ['a missing required key', (v) => ({ endpoint: v.endpoint, body: v.body })],
      [
        'a non-enumerable key',
        (v) => Object.defineProperty({ ...v }, 'body', { value: v.body, enumerable: false }),
      ],
      ['signal: null', (v) => ({ ...v, signal: null })],
    ]
    for (const [what, make] of cases) {
      const { transport, counts, validArgs } = countingTransport(file)
      const outcome = await settleOf(transport.pingHealthchecks(make(validArgs())))
      assertBoundaryRefusal(outcome, what, counts)
      assertNoBoundaryMarker(outcome.resolved)
    }
  },
)

test(
  'BOUNDARY: the reproduced hostile fake signal, and every non-genuine signal, is refused before any side effect',
  { timeout: T },
  async () => {
    const file = keyFileWith(syntheticKey())
    const reads = []
    const hostile = (name) => ({
      get [name]() {
        reads.push(name)
        throw new Error(BOUNDARY_MARKER)
      },
    })
    const planted = (name) => {
      const s = new AbortController().signal
      Object.defineProperty(s, name, {
        get() {
          reads.push(`planted ${name}`)
          throw new Error(BOUNDARY_MARKER)
        },
      })
      return s
    }
    const trapped = []
    const { proxy: revokedSignal, revoke } = Proxy.revocable(new AbortController().signal, {})
    revoke()
    // Node's brand slot is an OWN symbol-keyed data property of every real
    // signal, so a caller CAN find it. An unbranded object carrying an accessor
    // under that very symbol would be invoked by the native brand check itself
    // unless accessors are refused first.
    const kAborted = Object.getOwnPropertySymbols(new AbortController().signal).find(
      (s) => s.description === 'kAborted',
    )
    assert.ok(kAborted !== undefined, 'the brand slot must be discoverable for this case')
    const brandForgery = Object.defineProperty(Object.create(AbortSignal.prototype), kAborted, {
      get() {
        reads.push('forged kAborted')
        throw new Error(BOUNDARY_MARKER)
      },
    })
    // A Proxy one level up the prototype chain: an inherited lookup — by
    // `instanceof`, or by the brand check's slot read — would reach its traps.
    const chainTrapped = []
    const proxiedChain = Object.create(new Proxy(AbortSignal.prototype, trapRecorder(chainTrapped)))
    const cases = [
      ['hostile addEventListener getter (the reproduction)', hostile('addEventListener')],
      ['hostile aborted getter', hostile('aborted')],
      ['hostile removeEventListener getter', hostile('removeEventListener')],
      [
        'duck-typed fake with data members',
        { aborted: false, addEventListener() {}, removeEventListener() {} },
      ],
      ['unbranded Object.create(AbortSignal.prototype)', Object.create(AbortSignal.prototype)],
      [
        'unbranded prototype with its own accessor',
        Object.defineProperty(Object.create(AbortSignal.prototype), 'aborted', {
          get() {
            reads.push('unbranded aborted')
            throw new Error(BOUNDARY_MARKER)
          },
        }),
      ],
      ['a genuine signal carrying a planted aborted accessor', planted('aborted')],
      [
        'a genuine signal carrying a planted addEventListener accessor',
        planted('addEventListener'),
      ],
      [
        'a trap-recording Proxy of a genuine signal',
        new Proxy(new AbortController().signal, trapRecorder(trapped)),
      ],
      ['a revoked Proxy of a signal', revokedSignal],
      ['an accessor forged under the kAborted brand slot', brandForgery],
      ['a Proxy in the prototype chain', proxiedChain],
      ['an EventTarget that is not a signal', new EventTarget()],
      ['a function', () => {}],
      ['a string', BOUNDARY_MARKER],
    ]
    for (const [what, signal] of cases) {
      for (const via of ['core', 'production']) {
        const { transport, counts, validArgs } = countingTransport(file)
        const args =
          via === 'core'
            ? { ...validArgs(), signal }
            : { monitorConfig: null, endpoint: 'fail', body: BODY, signal }
        const ping = via === 'core' ? transport.pingHealthchecks : production.pingHealthchecks
        const { value: outcome, chunks } = await captureStreams(() => settleOf(ping(args)))
        assertBoundaryRefusal(outcome, `${via}: ${what}`, via === 'core' ? counts : undefined)
        assertNoBoundaryMarker(outcome.resolved, outcome.rejected ?? '', chunks.join(''))
      }
    }
    assert.deepEqual(reads, [], 'a hostile signal member was read')
    assert.deepEqual(trapped, [], 'a signal Proxy trap fired')
    assert.deepEqual(chainTrapped, [], 'a prototype-chain Proxy trap fired')
  },
)

test(
  'BOUNDARY: a genuine signal is read through the intrinsics, never through its own members',
  { timeout: T },
  async () => {
    const file = keyFileWith(syntheticKey())
    // An own DATA override is not an accessor, so the signal is accepted — but
    // the overrides must never be the thing that is called.
    const controller = new AbortController()
    const overridden = []
    for (const name of ['addEventListener', 'removeEventListener']) {
      Object.defineProperty(controller.signal, name, {
        value: () => overridden.push(name),
        configurable: true,
        writable: true,
      })
    }
    let inFlight = null
    const { transport } = doubleTransport((req) => {
      inFlight = abortListeners(controller.signal)
      acceptingDrive(req)
    })
    const result = await transport.pingHealthchecks({
      ...validPingArgs(file),
      signal: controller.signal,
    })
    assert.equal(result.outcome, 'accepted')
    assert.equal(inFlight, 1, 'the listener was installed through EventTarget.prototype')
    assert.equal(abortListeners(controller.signal), 0, 'and removed through it on settlement')
    assert.deepEqual(overridden, [], 'an own override was called')
  },
)

test(
  'BOUNDARY: real un-aborted, already-aborted, timeout and composite signals keep their behaviour',
  { timeout: T },
  async () => {
    const file = keyFileWith(syntheticKey())

    // Un-aborted: one request, accepted, no listener retained.
    const live = new AbortController()
    const a = countingTransport(file)
    const accepted = await a.transport.pingHealthchecks({ ...a.validArgs(), signal: live.signal })
    assert.equal(accepted.outcome, 'accepted')
    assert.equal(a.counts.request, 1)
    assert.equal(abortListeners(live.signal), 0)

    // Already aborted: the cancellation local refusal, before the key read.
    const dead = new AbortController()
    dead.abort(new Error(BOUNDARY_MARKER))
    const b = countingTransport(file)
    const cancelled = await b.transport.pingHealthchecks({ ...b.validArgs(), signal: dead.signal })
    assert.equal(cancelled.delivery, 'not_sent')
    assert.equal(cancelled.errorClass, 'cancelled')
    assert.deepEqual(b.counts, { readPingKey: 0, setTimer: 0, request: 0 })
    assert.equal(abortListeners(dead.signal), 0)
    assertNoBoundaryMarker(cancelled)

    // AbortSignal.timeout() and AbortSignal.any() are genuine signals too.
    for (const signal of [AbortSignal.timeout(60_000), AbortSignal.any([live.signal])]) {
      const c = countingTransport(file)
      const r = await c.transport.pingHealthchecks({ ...c.validArgs(), signal })
      assert.equal(r.outcome, 'accepted')
      assert.equal(c.counts.request, 1)
      assert.equal(abortListeners(signal), 0)
    }
  },
)

// ═════════════════════════════════════════════════════════════════════════════
// Static regressions (SUPPLEMENTARY to the behavioural assertions above)
// ═════════════════════════════════════════════════════════════════════════════

const codeOf = (file) =>
  fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    .join('\n')

test('static: the origin, host and port are module constants, never configuration', () => {
  const code = codeOf(CORE)
  assert.ok(code.includes("export const HEALTHCHECKS_ORIGIN = 'https://hc-ping.com'"))
  assert.ok(code.includes("const HEALTHCHECKS_HOSTNAME = 'hc-ping.com'"))
  assert.ok(code.includes('const HEALTHCHECKS_PORT = 443'))
  // No config key may supply any of them.
  assert.equal(/cfg\.[a-zA-Z.]*(origin|host|port|scheme|protocol)/i.test(code), false)
  assert.equal(/config\.[a-zA-Z.]*(origin|host|port|scheme|protocol)/i.test(code), false)
})

test('static: the request is built from an explicit options object, never a URL round-trip', () => {
  const code = codeOf(CORE)
  assert.equal(/new URL\(/.test(code), false)
  assert.equal(/url\.format|URLSearchParams/.test(code), false)
  assert.ok(code.includes("protocol: 'https:'"))
})

test('static (supplementary): no create, rid, start or log fragment appears in the source', () => {
  // Supplementary ONLY. The load-bearing evidence is the behavioural path
  // assertions above, run over every constructed path and over the URL the
  // loopback server actually received. A raw "?" scan is deliberately NOT used:
  // it matches every ternary, optional chain and nullish coalescing in the file.
  const code = codeOf(CORE)
  for (const fragment of [
    '?create=',
    'create=1',
    'rid=',
    "'/start'",
    "'/log'",
    '/start/',
    '/log/',
  ]) {
    assert.equal(code.includes(fragment), false, fragment)
  }
})

test('static: the real dependency set uses node:https only', () => {
  const code = codeOf(CORE)
  assert.ok(code.includes("import https from 'node:https'"))
  assert.equal(/node:http'/.test(code), false)
  assert.equal(/node:net/.test(code), false)
  assert.equal(/\bfetch\(/.test(code), false)
  assert.ok(code.includes('https.request(options)'))
})

test('static: neither transport module reads an environment variable or owns a signal', () => {
  for (const file of [CORE, PUBLIC]) {
    const code = codeOf(file)
    assert.equal(/process\.env/.test(code), false, path.basename(file))
    assert.equal(/process\.on\(/.test(code), false, path.basename(file))
    assert.equal(/process\.exit\(/.test(code), false, path.basename(file))
    assert.equal(/new AbortController/.test(code), false, path.basename(file))
    assert.equal(/console\./.test(code), false, path.basename(file))
  }
})

test('static: only the transport core imports the ping-key core', () => {
  const opsRoot = path.resolve(HERE, '..', '..')
  const IMPORTS =
    /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"][^'"]*backup-monitor-ping-key-core\.mjs['"]/
  const offenders = []
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full)
        continue
      }
      if (!entry.name.endsWith('.mjs')) continue
      if (entry.name.endsWith('.test.mjs')) continue // tests may import the seam
      if (full === CORE) continue
      if (IMPORTS.test(fs.readFileSync(full, 'utf8'))) offenders.push(full)
    }
  }
  walk(opsRoot)
  assert.deepEqual(offenders, [])
})

test(
  'EXTERNAL-CONNECT PROOF (final): no test in this file connected anywhere but loopback',
  { timeout: T },
  () => {
    assert.deepEqual(refusedConnects, [], 'a non-loopback connect was attempted')
    assert.ok(observedConnects.length > 0, 'the guard must actually have observed connects')
    for (const host of observedConnects) {
      assert.ok(
        host.startsWith('unix:') || LOOPBACK_HOSTS.has(host),
        `non-loopback connect target: ${host}`,
      )
    }
  },
)
