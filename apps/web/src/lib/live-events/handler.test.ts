import test from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, signLiveEvent } from './auth.ts'
import {
  MAX_BODY_BYTES,
  cameThroughPublicTunnel,
  handleLiveEventRequest,
  type LiveEventsDeps,
  type StoredEvent,
} from './handler.ts'
import { RateLimiter } from './rate-limit.ts'

// Throwaway secrets made per run: no real secret is in this file.
const TOKEN = randomBytes(24).toString('hex')
const KEY = randomBytes(32).toString('hex')
const NOW = Date.parse('2026-11-14T03:20:45Z')
const URL_TS = 'http://100.98.29.119:3100/api/internal/live-events'

const EVENT = {
  v: 1,
  id: 'obs-2026-11-14T03:20:41Z-period_end',
  type: 'period_end',
  source: 'obs',
  at: '2026-11-14T03:20:41Z',
  game_title: 'nhl27',
  period: 3,
  clock_left_ds: 0,
  score: { bgm: 5, opp: 4 },
}

/** A fake store with the table's rule: one row per id. */
function memoryStore() {
  const rows = new Map<string, StoredEvent>()
  return {
    rows,
    store: (e: StoredEvent) => {
      if (rows.has(e.id)) return Promise.resolve({ inserted: false })
      rows.set(e.id, e)
      return Promise.resolve({ inserted: true })
    },
  }
}

function setup(over: Partial<LiveEventsDeps> = {}) {
  const mem = memoryStore()
  const lines: string[] = []
  const deps: LiveEventsDeps = {
    token: TOKEN,
    hmacKey: KEY,
    limiter: new RateLimiter(60, () => NOW),
    store: mem.store,
    now: () => NOW,
    log: (l) => lines.push(l),
    ...over,
  }
  return { deps, mem, lines }
}

function signedRequest(
  body: string,
  opts: {
    token?: string | null
    ts?: number
    sig?: string | null
    headers?: Record<string, string>
    url?: string
  } = {},
) {
  const ts = opts.ts ?? Math.floor(NOW / 1000)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    [TIMESTAMP_HEADER]: String(ts),
    ...opts.headers,
  }
  const token = opts.token === undefined ? TOKEN : opts.token
  if (token !== null) headers['authorization'] = `Bearer ${token}`
  const sig = opts.sig === undefined ? `sha256=${signLiveEvent(body, ts, KEY)}` : opts.sig
  if (sig !== null) headers[SIGNATURE_HEADER] = sig
  return new Request(opts.url ?? URL_TS, { method: 'POST', headers, body })
}

const send = (deps: LiveEventsDeps, req: Request) => handleLiveEventRequest(req, deps)

void test('a signed v1 event is stored and answered 202', async () => {
  const { deps, mem } = setup()
  const res = await send(deps, signedRequest(JSON.stringify(EVENT)))
  assert.equal(res.status, 202)
  assert.deepEqual(await res.json(), { ok: true, id: EVENT.id, duplicate: false })
  const row = mem.rows.get(EVENT.id)!
  assert.equal(row.type, 'period_end')
  assert.equal(row.source, 'obs')
  assert.equal(row.at.toISOString(), '2026-11-14T03:20:41.000Z')
  assert.deepEqual(row.payload, EVENT)
})

void test('auth: a missing or wrong token is 401 and stores nothing', async () => {
  for (const token of [null, 'x'.repeat(48), `${TOKEN}x`, '']) {
    const { deps, mem } = setup()
    const res = await send(deps, signedRequest(JSON.stringify(EVENT), { token }))
    assert.equal(res.status, 401, String(token))
    assert.equal(mem.rows.size, 0)
  }
  const { deps } = setup()
  const basic = signedRequest(JSON.stringify(EVENT), {
    token: null,
    headers: { authorization: `Basic ${TOKEN}` },
  })
  assert.equal((await send(deps, basic)).status, 401)
})

void test('auth: a bad, missing or other-body HMAC is 401', async () => {
  const body = JSON.stringify(EVENT)
  const ts = Math.floor(NOW / 1000)
  const cases = [
    null,
    'sha256=' + '0'.repeat(64),
    signLiveEvent(body, ts, KEY), // no sha256= prefix
    `sha256=${signLiveEvent(body, ts, 'another-key-'.padEnd(40, 'k'))}`,
    `sha256=${signLiveEvent(body + ' ', ts, KEY)}`, // signed a different body
    `sha256=${signLiveEvent(body, ts - 1, KEY)}`, // signed another timestamp
  ]
  for (const sig of cases) {
    const { deps, mem } = setup()
    const res = await send(deps, signedRequest(body, { sig }))
    assert.equal(res.status, 401, String(sig))
    assert.equal(mem.rows.size, 0)
  }
})

void test('auth: a timestamp outside the 2-minute window is 401 (an old capture cannot be replayed)', async () => {
  const body = JSON.stringify(EVENT)
  const nowS = Math.floor(NOW / 1000)
  for (const ts of [nowS - 121, nowS + 121, nowS - 3600]) {
    const { deps } = setup()
    const res = await send(deps, signedRequest(body, { ts }))
    assert.equal(res.status, 401, String(ts))
  }
  for (const ts of [nowS - 120, nowS + 120]) {
    const { deps } = setup()
    assert.equal((await send(deps, signedRequest(body, { ts }))).status, 202, String(ts))
  }
  // A captured request replayed after the window: refused.
  const { deps } = setup()
  const later = { ...deps, now: () => NOW + 121_000 }
  assert.equal((await send(later, signedRequest(body))).status, 401)
  // Missing or malformed timestamp header.
  const noTs = new Request(URL_TS, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      [SIGNATURE_HEADER]: `sha256=${signLiveEvent(body, nowS, KEY)}`,
    },
    body,
  })
  assert.equal((await send(setup().deps, noTs)).status, 401)
  const { deps: d2 } = setup()
  const bad = signedRequest(body, { headers: { [TIMESTAMP_HEADER]: '1e9' } })
  assert.equal((await send(d2, bad)).status, 401)
})

void test('replay inside the window and resends are harmless: idempotent by id', async () => {
  const { deps, mem } = setup()
  const body = JSON.stringify(EVENT)
  const first = await send(deps, signedRequest(body))
  const again = await send(deps, signedRequest(body))
  assert.equal(first.status, 202)
  assert.equal(again.status, 202)
  assert.deepEqual(await again.json(), { ok: true, id: EVENT.id, duplicate: true })
  // A changed body with the same id does not replace the stored event.
  const changed = JSON.stringify({ ...EVENT, period: 4 })
  const third = await send(deps, signedRequest(changed))
  assert.deepEqual(await third.json(), { ok: true, id: EVENT.id, duplicate: true })
  assert.equal(mem.rows.size, 1)
  assert.equal(mem.rows.get(EVENT.id)!.payload['period'], 3)
})

void test('size limit: declared or real body over 4 KB is 413', async () => {
  const big = JSON.stringify({ ...EVENT, team_abbr: 'x'.repeat(MAX_BODY_BYTES) })
  const { deps, mem } = setup()
  assert.equal((await send(deps, signedRequest(big))).status, 413)
  // A lying content-length: the real body is still capped while it is read.
  const ts = Math.floor(NOW / 1000)
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(big))
      c.close()
    },
  })
  const lying = new Request(URL_TS, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
      [TIMESTAMP_HEADER]: String(ts),
      [SIGNATURE_HEADER]: `sha256=${signLiveEvent(big, ts, KEY)}`,
    },
    body: stream,
    duplex: 'half',
  } as RequestInit)
  assert.equal((await send(deps, lying)).status, 413)
  // Exactly 4096 bytes passes the size check (then fails validation for the unknown field).
  const pad = MAX_BODY_BYTES - JSON.stringify({ ...EVENT, x: '' }).length
  const exact = JSON.stringify({ ...EVENT, x: 'y'.repeat(pad) })
  assert.equal(Buffer.byteLength(exact), MAX_BODY_BYTES)
  assert.equal((await send(deps, signedRequest(exact))).status, 400)
  assert.equal(mem.rows.size, 0)
})

void test('validation: required fields, known types and sources, v1, field types, unknown fields', async () => {
  const bad: [Record<string, unknown> | string, RegExp][] = [
    ['not json', /not JSON/],
    ['[1]', /not a JSON object/],
    [{ ...EVENT, v: 2 }, /v must be 1/],
    [{ ...EVENT, type: 'shot' }, /unknown type/],
    [{ ...EVENT, source: 'phone' }, /unknown source/],
    [{ ...EVENT, at: 'yesterday' }, /bad field: at/],
    [{ ...EVENT, at: '2026-11-14T03:20:41' }, /bad field: at/], // no zone
    [{ ...EVENT, id: '' }, /bad field: id/],
    [{ ...EVENT, id: 'has space' }, /bad field: id/],
    [{ ...EVENT, id: 'x'.repeat(129) }, /bad field: id/],
    [{ ...EVENT, period: 7 }, /bad field: period/],
    [{ ...EVENT, period: '3' }, /bad field: period/],
    [{ ...EVENT, score: { bgm: 5 } }, /bad field: score/],
    [{ ...EVENT, team: 'home' }, /bad field: team/],
    [{ ...EVENT, strength: 'so' }, /bad field: strength/],
    [{ ...EVENT, assist_names: ['A', 'B', 'C', 'D', 'E'] }, /bad field: assist_names/],
    [{ ...EVENT, sure: 'yes' }, /bad field: sure/],
    [{ ...EVENT, match_type: 'gameType99' }, /bad field: match_type/],
    [{ ...EVENT, password: 'x' }, /unknown field: password/],
  ]
  for (const key of ['v', 'id', 'type', 'source', 'at']) {
    const copy: Record<string, unknown> = { ...EVENT }
    delete copy[key]
    bad.push([copy, new RegExp(`missing field: ${key}`)])
  }
  for (const [value, expected] of bad) {
    const { deps, mem } = setup()
    const body = typeof value === 'string' ? value : JSON.stringify(value)
    const res = await send(deps, signedRequest(body))
    assert.equal(res.status, 400, body)
    const answer = (await res.json()) as { error: string }
    assert.match(answer.error, expected, body)
    assert.equal(mem.rows.size, 0)
  }
  // Every v1 type and a full goal event pass; nulls are allowed for optional fields.
  const goal = {
    v: 1,
    id: 'engine-goal-1',
    type: 'goal',
    source: 'engine',
    at: '2026-11-14T03:12:00.250-07:00',
    game_title: 'nhl27',
    period: 6,
    clock_left_ds: 1234,
    score: { bgm: 2, opp: 1 },
    team: 'bgm',
    team_abbr: 'BM',
    side: 'home',
    scorer_name: 'WAY',
    scorer_gamertag: null,
    assist_names: ['NARD'],
    assist_gamertags: [null],
    strength: 'pp',
    ea_match_id: null,
    sure: true,
  }
  const { deps } = setup()
  assert.equal((await send(deps, signedRequest(JSON.stringify(goal)))).status, 202)
  for (const type of [
    'lobby_countdown',
    'game_start',
    'period_end',
    'penalty',
    'end_of_game_screen',
    'game_end',
  ]) {
    const e = { ...EVENT, id: `t-${type}`, type }
    assert.equal((await send(deps, signedRequest(JSON.stringify(e)))).status, 202, type)
  }
  const withMatch = {
    ...EVENT,
    id: 'end-1',
    type: 'game_end',
    ea_match_id: '12345678901',
    match_type: 'gameType5',
  }
  assert.equal((await send(deps, signedRequest(JSON.stringify(withMatch)))).status, 202)
})

void test('rate limit: the 61st request in a minute is 429 with Retry-After; it refills', async () => {
  let t = NOW
  const { deps } = setup({ limiter: new RateLimiter(60, () => t), now: () => t })
  for (let i = 0; i < 60; i++) {
    const e = { ...EVENT, id: `rl-${String(i)}` }
    assert.equal((await send(deps, signedRequest(JSON.stringify(e)))).status, 202, String(i))
  }
  const over = await send(deps, signedRequest(JSON.stringify({ ...EVENT, id: 'rl-60' })))
  assert.equal(over.status, 429)
  assert.equal(over.headers.get('retry-after'), '1')
  // Unauthenticated requests are limited too (they cannot flood the HMAC or the store).
  assert.equal((await send(deps, signedRequest('{}', { token: null }))).status, 429)
  t += 1000
  const after = await send(deps, signedRequest(JSON.stringify({ ...EVENT, id: 'rl-61' })))
  assert.equal(after.status, 202)
})

void test('public tunnel: Cloudflare headers or the public host are refused with 404', async () => {
  const body = JSON.stringify(EVENT)
  const cases: Record<string, string>[] = [
    { 'cf-connecting-ip': '203.0.113.9' },
    { 'cf-ray': '8f00000000000000-YYZ' },
    { 'cdn-loop': 'cloudflare' },
    { 'x-forwarded-host': 'boogeymen.app' },
  ]
  for (const headers of cases) {
    const { deps, mem } = setup()
    const res = await send(deps, signedRequest(body, { headers }))
    assert.equal(res.status, 404, JSON.stringify(headers))
    assert.equal(mem.rows.size, 0)
  }
  const { deps } = setup()
  const viaHost = signedRequest(body, { url: 'https://boogeymen.app/api/internal/live-events' })
  assert.equal((await send(deps, viaHost)).status, 404)
  // Direct paths: Tailscale address, Tailscale name, Docker network.
  assert.equal(cameThroughPublicTunnel(new Headers({ host: '100.98.29.119:3100' })), false)
  assert.equal(cameThroughPublicTunnel(new Headers({ host: 'hotel-echo:3100' })), false)
  assert.equal(cameThroughPublicTunnel(new Headers({ host: 'web:3000' })), false)
  assert.equal(cameThroughPublicTunnel(new Headers({ host: 'www.boogeymen.app' })), true)
  assert.equal(cameThroughPublicTunnel(new Headers({ host: 'BOOGEYMEN.APP:443' })), true)
  assert.equal(
    cameThroughPublicTunnel(new Headers({ host: 'other.example' }), ['other.example']),
    true,
  )
  assert.equal(cameThroughPublicTunnel(new Headers({ host: 'notboogeymen.app' })), false)
})

void test('unset or short secrets refuse everyone with 503', async () => {
  const body = JSON.stringify(EVENT)
  for (const over of [
    { token: undefined },
    { hmacKey: undefined },
    { token: '' },
    { hmacKey: 'short' },
    { token: 'x'.repeat(31) },
  ]) {
    const { deps, mem } = setup(over)
    assert.equal((await send(deps, signedRequest(body))).status, 503, JSON.stringify(over))
    assert.equal(mem.rows.size, 0)
  }
})

void test('wrong content type is 415; a failing store is 503 (retry), not 500', async () => {
  const { deps } = setup()
  const req = signedRequest(JSON.stringify(EVENT), { headers: { 'content-type': 'text/plain' } })
  assert.equal((await send(deps, req)).status, 415)
  const failing = setup({ store: () => Promise.reject(new Error('relation does not exist')) })
  const res = await send(failing.deps, signedRequest(JSON.stringify(EVENT)))
  assert.equal(res.status, 503)
})

void test('logs never hold the token, the HMAC key, the signature or the body', async () => {
  const { deps, lines } = setup()
  const body = JSON.stringify({ ...EVENT, scorer_name: 'SECRETNAME' })
  const sig = `sha256=${signLiveEvent(body, Math.floor(NOW / 1000), KEY)}`
  await send(deps, signedRequest(body))
  await send(deps, signedRequest(body, { token: 'y'.repeat(48) }))
  await send(deps, signedRequest('{"v":1', {}))
  const all = lines.join('\n')
  assert.ok(lines.length >= 3)
  for (const secret of [TOKEN, KEY, sig.slice(7), 'SECRETNAME', 'y'.repeat(48)]) {
    assert.ok(!all.includes(secret), 'a secret or the body reached the log')
  }
})
