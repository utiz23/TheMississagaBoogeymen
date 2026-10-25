import test from 'node:test'
import assert from 'node:assert/strict'
import Anthropic from '@anthropic-ai/sdk'
import {
  NewsJobError,
  NewsRetryableError,
  NewsStopError,
  anthropicModelCall,
  budgetLeft,
  MAX_WRITES,
  writeChecked,
  type ModelCall,
} from './writer.ts'
import { oct12Facts } from './test-fixtures.ts'
import type { Usage } from './cost.ts'

const USAGE: Usage = { input_tokens: 10, output_tokens: 5 }
const MODEL = 'claude-opus-5-5'

type Req = Parameters<ModelCall>[0]
type Res = Awaited<ReturnType<ModelCall>>

function fakeCall(answers: Partial<Res>[]): { call: ModelCall; reqs: Req[] } {
  const reqs: Req[] = []
  let i = 0
  const call: ModelCall = (req) => {
    reqs.push(req)
    const a = answers[i++]
    if (a === undefined) throw new Error('fake ModelCall ran out of answers')
    return Promise.resolve({ json: null, refused: false, model: MODEL, usage: USAGE, ...a })
  }
  return { call, reqs }
}

function harness() {
  const recorded: string[] = []
  return {
    recorded,
    record: (purpose: 'write' | 'review', model: string, usage: Usage) => {
      assert.equal(model, MODEL)
      assert.equal(usage, USAGE)
      recorded.push(purpose)
      return Promise.resolve()
    },
  }
}

const parse = (v: unknown): { text: string } => {
  if (typeof v !== 'object' || v === null || typeof (v as { text?: unknown }).text !== 'string') {
    throw new Error('bad shape')
  }
  return { text: (v as { text: string }).text }
}
const check = (out: { text: string }) =>
  out.text.includes('BAD')
    ? { ok: false as const, problems: ['has BAD in it'] }
    : { ok: true as const }

function args(call: ModelCall, h: ReturnType<typeof harness>) {
  return {
    call,
    system: 'SYS',
    user: 'USER',
    schema: { type: 'object' },
    parse,
    check,
    textForReview: (o: { text: string }) => o.text,
    facts: oct12Facts('game'),
    record: h.record,
  }
}

const REVIEW_OK = { json: { ok: true, problems: [] } }
const REVIEW_BAD = { json: { ok: false, problems: ['invented quote'] } }

void test('write fails the check, rewrite passes, review ok: 3 calls in order, problems in the rewrite prompt', async () => {
  const { call, reqs } = fakeCall([
    { json: { text: 'BAD one' } },
    { json: { text: 'good one' } },
    REVIEW_OK,
  ])
  const h = harness()
  const r = await writeChecked(args(call, h))
  assert.deepEqual(r, { ok: true, out: { text: 'good one' } })
  assert.deepEqual(h.recorded, ['write', 'write', 'review'])
  assert.deepEqual(
    reqs.map((q) => [q.purpose, q.effort]),
    [
      ['write', 'medium'],
      ['write', 'medium'],
      ['review', 'low'],
    ],
  )
  assert.equal(reqs[0]!.user, 'USER')
  assert.ok(reqs[1]!.user.startsWith('USER'))
  assert.ok(reqs[1]!.user.includes('has BAD in it'))
  assert.ok(reqs[2]!.user.includes('good one'))
})

void test('MAX_WRITES is 3: the first write and two rewrites', () => {
  assert.equal(MAX_WRITES, 3)
})

void test('fail, fail, then pass with review ok: 4 calls, each rewrite carries the latest problems', async () => {
  const { call, reqs } = fakeCall([
    { json: { text: 'BAD one' } },
    { json: { text: 'one' } },
    REVIEW_BAD,
    { json: { text: 'good three' } },
    REVIEW_OK,
  ])
  const h = harness()
  const r = await writeChecked(args(call, h))
  assert.deepEqual(r, { ok: true, out: { text: 'good three' } })
  assert.deepEqual(h.recorded, ['write', 'write', 'review', 'write', 'review'])
  assert.equal(reqs[0]!.user, 'USER')
  assert.ok(reqs[1]!.user.includes('has BAD in it'))
  // The third write sees the review's problems, not the first check's.
  assert.ok(reqs[3]!.user.includes('invented quote'))
  assert.ok(!reqs[3]!.user.includes('has BAD in it'))
})

void test('review says not ok three times: gives up after 3 writes and 3 reviews (6 calls)', async () => {
  const { call, reqs } = fakeCall([
    { json: { text: 'one' } },
    REVIEW_BAD,
    { json: { text: 'two' } },
    REVIEW_BAD,
    { json: { text: 'three' } },
    REVIEW_BAD,
  ])
  const h = harness()
  const r = await writeChecked(args(call, h))
  assert.equal(r.ok, false)
  if (!r.ok) assert.ok(r.reason.includes('invented quote'))
  assert.deepEqual(h.recorded, ['write', 'review', 'write', 'review', 'write', 'review'])
  assert.equal(reqs.length, 6)
  assert.ok(reqs[2]!.user.includes('invented quote'))
  assert.ok(reqs[4]!.user.includes('invented quote'))
})

void test('a refusal ends at once with reason "refused"', async () => {
  const { call } = fakeCall([{ refused: true }])
  const h = harness()
  assert.deepEqual(await writeChecked(args(call, h)), { ok: false, reason: 'refused' })
  assert.deepEqual(h.recorded, ['write'])
})

void test('a refusal in the review also ends at once', async () => {
  const { call } = fakeCall([{ json: { text: 'fine' } }, { refused: true }])
  const h = harness()
  assert.deepEqual(await writeChecked(args(call, h)), { ok: false, reason: 'refused' })
  assert.deepEqual(h.recorded, ['write', 'review'])
})

void test('missing or unparsable output counts as a failed attempt', async () => {
  const { call } = fakeCall([{ json: null }, { json: { nope: 1 } }, { json: null }])
  const h = harness()
  const r = await writeChecked(args(call, h))
  assert.equal(r.ok, false)
  assert.deepEqual(h.recorded, ['write', 'write', 'write'])
})

void test('three failed checks never call the review', async () => {
  const { call, reqs } = fakeCall([
    { json: { text: 'BAD' } },
    { json: { text: 'BAD again' } },
    { json: { text: 'BAD a third time' } },
  ])
  const h = harness()
  const r = await writeChecked(args(call, h))
  assert.equal(r.ok, false)
  assert.deepEqual(h.recorded, ['write', 'write', 'write'])
  assert.equal(reqs.length, 3)
})

void test('budgetLeft keeps a 0.50 reserve', () => {
  assert.equal(budgetLeft(9.49, 10), true)
  assert.equal(budgetLeft(9.5, 10), false)
  assert.equal(budgetLeft(12, 10), false)
})

// ── anthropicModelCall ─────────────────────────────────────────────────────

function fakeClient(impl: (body: Record<string, unknown>) => unknown): {
  client: Anthropic
  bodies: Record<string, unknown>[]
} {
  const bodies: Record<string, unknown>[] = []
  const client = {
    beta: {
      messages: {
        create: (body: Record<string, unknown>) => {
          bodies.push(body)
          try {
            return Promise.resolve(impl(body))
          } catch (e) {
            return Promise.reject(e)
          }
        },
      },
    },
  } as unknown as Anthropic
  return { client, bodies }
}

const REQ: Req = {
  purpose: 'write',
  system: 'S',
  user: 'U',
  schema: { type: 'object' },
  effort: 'medium',
}

void test('anthropicModelCall sends the agreed request and reads the first text block', async () => {
  const { client, bodies } = fakeClient(() => ({
    model: MODEL,
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: '{"a":1}' }],
    usage: {
      input_tokens: 3,
      output_tokens: 4,
      cache_read_input_tokens: 1,
      cache_creation_input_tokens: 2,
    },
  }))
  const res = await anthropicModelCall(client, MODEL)(REQ)
  assert.deepEqual(res.json, { a: 1 })
  assert.equal(res.refused, false)
  assert.equal(res.model, MODEL)
  assert.deepEqual(res.usage, {
    input_tokens: 3,
    output_tokens: 4,
    cache_read_input_tokens: 1,
    cache_creation_input_tokens: 2,
  })
  const b = bodies[0]!
  assert.equal(b['model'], MODEL)
  assert.equal(b['max_tokens'], 16000)
  assert.deepEqual(b['betas'], ['server-side-fallback-2026-07-01'])
  assert.equal(b['fallbacks'], 'default')
  assert.deepEqual(b['system'], [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }])
  assert.deepEqual(b['messages'], [{ role: 'user', content: 'U' }])
  assert.deepEqual(b['output_config'], {
    effort: 'medium',
    format: { type: 'json_schema', schema: { type: 'object' } },
  })
  for (const k of ['temperature', 'top_p', 'top_k', 'thinking']) assert.ok(!(k in b), k)
})

void test('anthropicModelCall: refusal, max_tokens, empty and non-JSON output', async () => {
  const mk = (stop_reason: string, content: unknown[]) =>
    fakeClient(() => ({ model: MODEL, stop_reason, content, usage: USAGE })).client
  const text = [{ type: 'text', text: '{"a":1}' }]
  const refused = await anthropicModelCall(mk('refusal', []), MODEL)(REQ)
  assert.equal(refused.refused, true)
  assert.equal(refused.json, null)
  assert.equal((await anthropicModelCall(mk('max_tokens', text), MODEL)(REQ)).json, null)
  assert.equal((await anthropicModelCall(mk('end_turn', []), MODEL)(REQ)).json, null)
  assert.equal(
    (await anthropicModelCall(mk('end_turn', [{ type: 'text', text: 'not json' }]), MODEL)(REQ))
      .json,
    null,
  )
})

void test('anthropicModelCall maps SDK errors by class', async () => {
  const fail = (status: number | undefined) => {
    const { client } = fakeClient(() => {
      throw status === undefined
        ? new Anthropic.APIConnectionError({ message: 'socket closed' })
        : Anthropic.APIError.generate(
            status,
            { error: { message: `E${String(status)}` } },
            `E${String(status)}`,
            new Headers(),
          )
    })
    return anthropicModelCall(client, MODEL)(REQ)
  }
  await assert.rejects(fail(401), NewsStopError)
  await assert.rejects(fail(403), NewsStopError)
  await assert.rejects(fail(429), NewsRetryableError)
  await assert.rejects(fail(500), NewsRetryableError)
  await assert.rejects(fail(undefined), NewsRetryableError)
  await assert.rejects(
    fail(400),
    (e: unknown) => e instanceof NewsJobError && e.message.includes('E400'),
  )
})
