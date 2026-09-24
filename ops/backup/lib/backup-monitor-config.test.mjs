/**
 * Monitor-export configuration contract (E3J8A).
 *
 * Pure validation: nothing here opens a socket, reads a key file, or contacts
 * any host. The `pingKeyFile` values below are placeholder paths that are never
 * opened by this module or by this suite.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { ConfigError } from './backup-config.mjs'
import {
  CONNECT_TIMEOUT_MS_BOUNDS,
  MONITOR_CONFIG_ERROR_CODES,
  MONITOR_PROVIDERS,
  REQUEST_TIMEOUT_MS_BOUNDS,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
  loadMonitorConfig,
  validateMonitorConfig,
} from './backup-monitor-config.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'monitor-config', warnAfterMs: 10_000, intervalMs: 5_000 })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXAMPLE = path.resolve(HERE, '..', 'eanhl-backup-monitor.example.json')
const SOURCE = path.join(HERE, 'backup-monitor-config.mjs')

const base = () => ({
  watcher: {
    provider: 'healthchecks_io',
    slug: 'eanhl-cloud-backup-freshness',
    pingKeyFile: '/etc/eanhl/healthchecks-ping-key',
  },
  ping: { requestTimeoutMs: 10_000, connectTimeoutMs: 5_000 },
})

function rejects(mutate, code, what = '') {
  const cfg = base()
  mutate(cfg)
  let err = null
  try {
    validateMonitorConfig(cfg)
  } catch (e) {
    err = e
  }
  assert.ok(err instanceof ConfigError, `expected a ConfigError for ${what || code}, got ${err}`)
  assert.equal(err.code, code, `${what || code}: ${err.message}`)
  assert.ok(MONITOR_CONFIG_ERROR_CODES.includes(err.code), `${err.code} is outside the closed set`)
  return err
}

// ═════════════════════════════════════════════════════════════════════════════
// The happy path
// ═════════════════════════════════════════════════════════════════════════════

test('a complete configuration validates and comes back frozen', () => {
  const cfg = validateMonitorConfig(base())
  assert.equal(cfg.watcher.provider, 'healthchecks_io')
  assert.equal(cfg.watcher.slug, 'eanhl-cloud-backup-freshness')
  assert.equal(cfg.watcher.pingKeyFile, '/etc/eanhl/healthchecks-ping-key')
  assert.equal(cfg.ping.requestTimeoutMs, 10_000)
  assert.equal(cfg.ping.connectTimeoutMs, 5_000)
  assert.ok(Object.isFrozen(cfg))
  assert.ok(Object.isFrozen(cfg.watcher))
  assert.ok(Object.isFrozen(cfg.ping))
})

test('the shipped example configuration validates as written', () => {
  // It must be loadable: the schema is exactly closed, so the example carries no
  // "_comment" key (there is deliberately no field an inline secret could
  // occupy). Its commentary lives in docs/operations/backup-monitoring-export.md.
  const parsed = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'))
  const cfg = validateMonitorConfig(parsed, EXAMPLE)
  assert.equal(cfg.watcher.provider, 'healthchecks_io')
  assert.deepEqual(Object.keys(parsed), ['watcher', 'ping'])
  assert.deepEqual(Object.keys(parsed.watcher), ['provider', 'slug', 'pingKeyFile'])
  assert.deepEqual(Object.keys(parsed.ping), ['requestTimeoutMs', 'connectTimeoutMs'])
})

test('the example configuration contains no secret, key, token, URL or host', () => {
  const text = fs.readFileSync(EXAMPLE, 'utf8')
  for (const forbidden of [
    'hc-ping',
    'healthchecks.io',
    'https://',
    'http://',
    'token',
    'secret',
    'ping-key:',
    'pingKey"',
    '@',
  ]) {
    assert.equal(text.includes(forbidden), false, forbidden)
  }
})

test('MONITOR_PROVIDERS is a frozen, closed, one-member enum', () => {
  assert.deepEqual([...MONITOR_PROVIDERS], ['healthchecks_io'])
  assert.ok(Object.isFrozen(MONITOR_PROVIDERS))
})

// ═════════════════════════════════════════════════════════════════════════════
// Required keys, types, and the exactly-closed schema
// ═════════════════════════════════════════════════════════════════════════════

test('a non-object configuration is refused', () => {
  for (const value of [null, undefined, 3, 'x', [], true]) {
    assert.throws(
      () => validateMonitorConfig(value),
      (e) => e instanceof ConfigError,
    )
  }
})

test('every required key is required, at every level', () => {
  rejects((c) => delete c.watcher, 'config_field_type', 'watcher missing')
  rejects((c) => delete c.ping, 'config_field_type', 'ping missing')
  // A MISSING key is not an UNKNOWN key: the closed-key check passes (nothing
  // unexpected is present) and the per-field requirement then fails.
  rejects((c) => delete c.watcher.provider, 'config_field_missing', 'provider missing')
  rejects((c) => delete c.watcher.slug, 'config_field_missing', 'slug missing')
  rejects((c) => delete c.watcher.pingKeyFile, 'config_field_missing', 'pingKeyFile missing')
  rejects((c) => delete c.ping.requestTimeoutMs, 'config_field_missing', 'requestTimeoutMs missing')
  rejects((c) => delete c.ping.connectTimeoutMs, 'config_field_missing', 'connectTimeoutMs missing')
})

test('a required key present but mistyped is refused', () => {
  rejects((c) => (c.watcher = 'x'), 'config_field_type')
  rejects((c) => (c.watcher = []), 'config_field_type')
  rejects((c) => (c.ping = null), 'config_field_type')
  rejects((c) => (c.watcher.provider = 7), 'config_field_missing')
  rejects((c) => (c.watcher.slug = null), 'config_field_missing')
  rejects((c) => (c.watcher.pingKeyFile = 7), 'config_field_missing')
  rejects((c) => (c.ping.requestTimeoutMs = '10000'), 'config_field_missing')
  rejects((c) => (c.ping.connectTimeoutMs = 1.5), 'config_field_missing')
})

test('an unknown key is rejected at every level of the closed schema', () => {
  rejects((c) => (c.extra = 1), 'config_field_unknown', 'top level')
  rejects((c) => (c.watcher.extra = 1), 'config_field_unknown', 'watcher')
  rejects((c) => (c.ping.extra = 1), 'config_field_unknown', 'ping')
})

test('THERE IS NO FIELD AN INLINE SECRET, ORIGIN, HOST, PORT, SCHEME, PATH OR THRESHOLD COULD OCCUPY', () => {
  // The whole reason the schema is exactly closed. A configurable destination
  // would be a configurable place to send a bearer credential, and a
  // configurable threshold would be a silently weakenable approved value.
  const names = [
    'origin',
    'host',
    'hostname',
    'port',
    'scheme',
    'protocol',
    'url',
    'baseUrl',
    'pingUrl',
    'endpoint',
    'requestPath',
    'query',
    'threshold',
    'thresholds',
    'warningAfterSeconds',
    'criticalAfterSeconds',
    'pingKey',
    'key',
    'headers',
    'userAgent',
    'insecure',
    'retries',
    'maxAttempts',
  ]
  for (const name of names) {
    rejects((c) => (c[name] = 'x'), 'config_field_unknown', `top.${name}`)
    rejects((c) => (c.watcher[name] = 'x'), 'config_field_unknown', `watcher.${name}`)
    rejects((c) => (c.ping[name] = 'x'), 'config_field_unknown', `ping.${name}`)
  }
  // `rejectUnauthorized` would also have no field to occupy, but it never even
  // reaches the closed-key check: its name contains "auth", so the inherited
  // key-name rule refuses it first. Either way there is no such field.
  for (const where of [(c) => c, (c) => c.watcher, (c) => c.ping]) {
    rejects((c) => (where(c).rejectUnauthorized = true), 'config_secret_shaped_key')
  }
})

test('the provider selector is closed — no default, no fallback', () => {
  for (const value of ['healthchecks', 'HEALTHCHECKS_IO', 'uptimerobot', 'healthchecks_io_2']) {
    rejects((c) => (c.watcher.provider = value), 'config_field_invalid', value)
  }
  // Surrounding whitespace IS trimmed by the shared string primitive, so a
  // padded selector is the same selector — not a second, sloppier provider.
  assert.equal(
    validateMonitorConfig({
      ...base(),
      watcher: { ...base().watcher, provider: ' healthchecks_io ' },
    }).watcher.provider,
    'healthchecks_io',
  )
})

// ═════════════════════════════════════════════════════════════════════════════
// Slug policy — the documented alphabet, and the LOCAL length bound
// ═════════════════════════════════════════════════════════════════════════════

test('slug: the exact length boundary — 1 and 64 accepted, 0 and 65 rejected', () => {
  assert.equal(SLUG_MAX_LENGTH, 64)
  const one = 'a'
  const sixtyFour = 'a'.repeat(64)
  const sixtyFive = 'a'.repeat(65)
  assert.equal(
    validateMonitorConfig({ ...base(), watcher: { ...base().watcher, slug: one } }).watcher.slug,
    one,
  )
  assert.equal(
    validateMonitorConfig({ ...base(), watcher: { ...base().watcher, slug: sixtyFour } }).watcher
      .slug,
    sixtyFour,
  )
  rejects((c) => (c.watcher.slug = sixtyFive), 'config_field_invalid', '65 characters')
  // An empty slug is refused by the non-empty-string rule before the pattern.
  rejects((c) => (c.watcher.slug = ''), 'config_field_missing', 'empty')
})

test('slug: underscores and hyphens are accepted anywhere, including first and last', () => {
  for (const slug of ['_', '-', '_a', 'a_', '-a', 'a-', '_a_', '-a-', 'a_b-c', '0', '0a_-9']) {
    const cfg = validateMonitorConfig({ ...base(), watcher: { ...base().watcher, slug } })
    assert.equal(cfg.watcher.slug, slug, slug)
  }
})

test('slug: everything outside the documented alphabet is rejected', () => {
  const bad = [
    ['A', 'uppercase'],
    ['aBc', 'mixed case'],
    ['a.b', 'dot'],
    ['..', 'dot-dot'],
    ['a/b', 'separator'],
    ['/a', 'leading separator'],
    ['a%2f', 'percent'],
    ['a+b', 'plus'],
    ['a b', 'space'],
    ['a\tb', 'tab'],
    ['a\nb', 'newline'],
    ['a\0b', 'NUL'],
    ['a#b', 'fragment'],
    ['a?b', 'query'],
    ['a:b', 'colon'],
    ['a@b', 'at'],
    ['á', 'non-ASCII'],
  ]
  for (const [slug, what] of bad) {
    // A value that trims to empty is caught by the non-empty rule first.
    const code = slug.trim() === '' ? 'config_field_missing' : 'config_field_invalid'
    rejects((c) => (c.watcher.slug = slug), code, what)
  }
})

test('slug: the alphabet makes a second path segment and a dot segment impossible', () => {
  for (const slug of ['a', '_', 'a'.repeat(64), 'a_b-c0']) {
    assert.ok(SLUG_PATTERN.test(slug), slug)
    assert.equal(slug.includes('/'), false)
    assert.equal(slug.split('/').length, 1)
    assert.equal(slug === '.' || slug === '..', false)
    assert.equal(encodeURIComponent(slug), slug, 'no percent-encoding is ever needed')
  }
})

test('THERE IS NO VALUE-SHAPE HEURISTIC: a slug that looks exactly like a plausible key is accepted', () => {
  // A "this value looks secret" heuristic would collide with legitimate values —
  // the slug alphabet is a subset of the key alphabet — so the schema is closed
  // instead. This slug matches /^[A-Za-z0-9_-]{16,64}$/ and must still validate.
  const keyish = 'abcdefghijklmnopqrstuvwxyz012345'
  assert.ok(/^[A-Za-z0-9_-]{16,64}$/.test(keyish))
  const cfg = validateMonitorConfig({ ...base(), watcher: { ...base().watcher, slug: keyish } })
  assert.equal(cfg.watcher.slug, keyish)
})

// ═════════════════════════════════════════════════════════════════════════════
// pingKeyFile is a PATH, and only a path
// ═════════════════════════════════════════════════════════════════════════════

test('pingKeyFile must be absolute', () => {
  for (const value of ['etc/eanhl/key', './key', '../key', 'key']) {
    rejects((c) => (c.watcher.pingKeyFile = value), 'config_field_not_absolute', value)
  }
})

test('pingKeyFile must be lexically canonical', () => {
  for (const value of [
    '/etc/eanhl/',
    '/etc//eanhl/key',
    '/etc/eanhl/../key',
    '/etc/./key',
    '/etc/eanhl/key\\x',
    '/etc/eanhl/key\0',
  ]) {
    rejects((c) => (c.watcher.pingKeyFile = value), 'config_field_not_canonical', value)
  }
})

test('pingKeyFile is never read by this module', () => {
  // A path that certainly does not exist still validates: the contents are the
  // reader's business, not the validator's.
  const missing = '/nonexistent-eanhl-monitor-config-test/does/not/exist'
  assert.equal(fs.existsSync(missing), false)
  const cfg = validateMonitorConfig({
    ...base(),
    watcher: { ...base().watcher, pingKeyFile: missing },
  })
  assert.equal(cfg.watcher.pingKeyFile, missing)
})

// ═════════════════════════════════════════════════════════════════════════════
// Timeouts: bounds and ordering
// ═════════════════════════════════════════════════════════════════════════════

test('both timeouts must be positive integers within their bounds', () => {
  assert.deepEqual({ ...REQUEST_TIMEOUT_MS_BOUNDS }, { min: 1_000, max: 60_000 })
  assert.deepEqual({ ...CONNECT_TIMEOUT_MS_BOUNDS }, { min: 1_000, max: 30_000 })

  rejects((c) => (c.ping.requestTimeoutMs = 0), 'config_field_missing', 'zero')
  rejects((c) => (c.ping.requestTimeoutMs = -1), 'config_field_missing', 'negative')
  rejects((c) => (c.ping.requestTimeoutMs = 999), 'config_field_invalid', 'below min')
  rejects((c) => (c.ping.requestTimeoutMs = 60_001), 'config_field_invalid', 'above max')
  rejects((c) => (c.ping.connectTimeoutMs = 999), 'config_field_invalid', 'connect below min')
  rejects(
    (c) => {
      c.ping.requestTimeoutMs = 60_000
      c.ping.connectTimeoutMs = 30_001
    },
    'config_field_invalid',
    'connect above max',
  )

  // Both exact bounds are accepted.
  const lo = validateMonitorConfig({
    ...base(),
    ping: { requestTimeoutMs: 1_001, connectTimeoutMs: 1_000 },
  })
  assert.equal(lo.ping.connectTimeoutMs, 1_000)
  const hi = validateMonitorConfig({
    ...base(),
    ping: { requestTimeoutMs: 60_000, connectTimeoutMs: 30_000 },
  })
  assert.equal(hi.ping.requestTimeoutMs, 60_000)
})

test('connectTimeoutMs must be STRICTLY below requestTimeoutMs', () => {
  rejects(
    (c) => {
      c.ping.requestTimeoutMs = 5_000
      c.ping.connectTimeoutMs = 5_000
    },
    'config_field_invalid',
    'equal',
  )
  rejects(
    (c) => {
      c.ping.requestTimeoutMs = 5_000
      c.ping.connectTimeoutMs = 6_000
    },
    'config_field_invalid',
    'greater',
  )
})

// ═════════════════════════════════════════════════════════════════════════════
// The inherited secret-shaped-key-NAME rule
// ═════════════════════════════════════════════════════════════════════════════

test('a secret-shaped key NAME is rejected, at any depth, before any other check', () => {
  for (const mutate of [
    (c) => (c.token = 'x'),
    (c) => (c.watcher.secret = 'x'),
    (c) => (c.watcher.password = 'x'),
    (c) => (c.ping.passphrase = 'x'),
    (c) => (c.ping.sessionCookie = 'x'),
    (c) => (c.watcher.accountEmail = 'x'),
    (c) => (c.watcher.authUrl = 'x'),
    (c) => (c.recoveryPhrase = 'x'),
    (c) => (c.nested = { deeply: { nested: { authToken: 'x' } } }),
  ]) {
    rejects(mutate, 'config_secret_shaped_key')
  }
})

test('the secret-shaped-key diagnostic is generic, location-free, and never echoes the key or its value', () => {
  const MARKER = 'UNIQUE_MONITOR_MARKER_4b1e9c7a'
  for (const mutate of [
    (c) => (c[`token_${MARKER}`] = MARKER),
    (c) => (c.watcher[`${MARKER}_secret`] = MARKER),
    (c) => (c.nested = { deeply: { [`password_${MARKER}`]: MARKER } }),
  ]) {
    const err = rejects(mutate, 'config_secret_shaped_key')
    assert.equal(err.message.includes(MARKER), false, 'the message must not echo the marker')
    for (const propName of Object.getOwnPropertyNames(err)) {
      const value = err[propName]
      if (typeof value === 'string') {
        assert.equal(value.includes(MARKER), false, `err.${propName} must not echo the marker`)
      }
    }
    // Generic: no location, and no claim that is false about THIS surface.
    assert.equal(
      /watcher|ping|nested|cloud configuration|backend selector/.test(err.message),
      false,
    )
  }
})

test('the seven accepted key names contain no forbidden substring', () => {
  const forbidden = [
    'token',
    'secret',
    'password',
    'passphrase',
    'cookie',
    'recovery',
    'email',
    'account',
    'auth',
    'session',
  ]
  for (const name of [
    'watcher',
    'ping',
    'provider',
    'slug',
    'pingKeyFile',
    'requestTimeoutMs',
    'connectTimeoutMs',
  ]) {
    for (const s of forbidden) {
      assert.equal(name.toLowerCase().includes(s), false, `${name} contains ${s}`)
    }
  }
})

test('a secret-shaped rejection is a key-NAME check, not a value-content check', () => {
  const cfg = base()
  cfg.watcher.pingKeyFile = '/etc/eanhl/token-shaped-path-but-fine'
  const validated = validateMonitorConfig(cfg)
  assert.equal(validated.watcher.pingKeyFile, '/etc/eanhl/token-shaped-path-but-fine')
})

// ═════════════════════════════════════════════════════════════════════════════
// loadMonitorConfig
// ═════════════════════════════════════════════════════════════════════════════

test('loadMonitorConfig reports an unreadable file and an unparseable file distinctly', () => {
  const unreadable = () => {
    const err = new Error('boom')
    err.code = 'ENOENT'
    throw err
  }
  assert.throws(
    () => loadMonitorConfig('/x/monitor.json', unreadable),
    (e) => e instanceof ConfigError && e.code === 'config_unreadable',
  )
  assert.throws(
    () => loadMonitorConfig('/x/monitor.json', () => '{not json'),
    (e) => e instanceof ConfigError && e.code === 'config_unparseable',
  )
  const loaded = loadMonitorConfig('/x/monitor.json', () => JSON.stringify(base()))
  assert.equal(loaded.watcher.slug, 'eanhl-cloud-backup-freshness')
})

test('every ConfigError this module can raise is inside the closed code set', () => {
  assert.ok(Object.isFrozen(MONITOR_CONFIG_ERROR_CODES))
  const seen = new Set()
  const probes = [
    () =>
      loadMonitorConfig('/x', () => {
        throw new Error('x')
      }),
    () => loadMonitorConfig('/x', () => '{'),
    () => validateMonitorConfig({ ...base(), extra: 1 }),
    () => validateMonitorConfig({ ...base(), watcher: 'x' }),
    () => validateMonitorConfig({ ...base(), watcher: { ...base().watcher, slug: 'A' } }),
    () => validateMonitorConfig({ ...base(), watcher: { ...base().watcher, provider: undefined } }),
    () => validateMonitorConfig({ ...base(), watcher: { ...base().watcher, pingKeyFile: 'rel' } }),
    () =>
      validateMonitorConfig({ ...base(), watcher: { ...base().watcher, pingKeyFile: '/a/../b' } }),
    () => validateMonitorConfig({ ...base(), token: 'x' }),
  ]
  for (const probe of probes) {
    try {
      probe()
      assert.fail('expected a rejection')
    } catch (e) {
      assert.ok(e instanceof ConfigError, String(e))
      seen.add(e.code)
    }
  }
  for (const code of seen) assert.ok(MONITOR_CONFIG_ERROR_CODES.includes(code), code)
  assert.equal(seen.size >= 7, true, `only saw ${[...seen].join(', ')}`)
})

// ═════════════════════════════════════════════════════════════════════════════
// Static regressions
// ═════════════════════════════════════════════════════════════════════════════

test('static: the module names no origin, host, port, scheme or URL of any kind', () => {
  const code = fs.readFileSync(SOURCE, 'utf8').replace(/^\s*\*.*$/gm, '')
  for (const forbidden of [
    /hc-ping/,
    /healthchecks\.io/,
    /https:\/\//,
    /http:\/\//,
    /\b443\b/,
    /node:https/,
    /node:http\b/,
    /node:net/,
    /\bfetch\b/,
  ]) {
    assert.equal(forbidden.test(code), false, String(forbidden))
  }
})

test('static: the module reads no environment variable and opens nothing itself', () => {
  const code = fs.readFileSync(SOURCE, 'utf8')
  assert.equal(/process\.env/.test(code), false)
  assert.equal(/openSync|readFileSync|writeFileSync|opendirSync/.test(code), false)
  assert.equal(/process\.exit\(/.test(code), false)
  assert.equal(/process\.on\(/.test(code), false)
})

test('static: the module contains no threshold value and no value-shape pattern', () => {
  const code = fs.readFileSync(SOURCE, 'utf8')
  assert.equal(/WARNING_AFTER_SECONDS|CRITICAL_AFTER_SECONDS/.test(code), false)
  // The key's own shape pattern must not appear here: this module never sees a key.
  assert.equal(/PING_KEY_PATTERN/.test(code), false)
  assert.equal(/A-Za-z0-9_-\]\{16,64\}/.test(code), false)
})

test('static: the shared secret-shaped-key traversal is imported, not re-implemented', () => {
  const code = fs.readFileSync(SOURCE, 'utf8')
  assert.ok(
    /import \{[^}]*assertNoSecretShapedKeys[^}]*\} from '\.\/backup-cloud-config\.mjs'/s.test(code),
  )
  // No second, weaker copy of the forbidden-substring list.
  assert.equal(/FORBIDDEN_KEY_SUBSTRINGS/.test(code), false)
  assert.equal(/'passphrase',/.test(code), false)
})
