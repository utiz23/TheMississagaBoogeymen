import test from 'node:test'
import assert from 'node:assert/strict'
import { lockedRulesBlock } from '@eanhl/db/news'
import { oct12Response } from '../news/test-fixtures.ts'
import type { ModelCall } from '../news/writer.ts'
import { boxRequestStoreOf, runBoxRequests } from './box-requests.ts'
import type { BoxRequestStore } from './box-requests.ts'
import { config, setup } from './test-fakes.ts'

/**
 * Press Box `preview` requests (task press-box-l4): one sample line from one reporter, ONE model
 * call, counted in the spend, nothing posted. An unknown request kind never becomes a test scrum.
 */

interface Request {
  id: number
  kind: 'testscrum' | 'preview' | 'profile' | 'interview'
  reporter: string | null
  status: 'pending' | 'running' | 'done' | 'failed'
  result: string | null
}

function previewSetup(requests: Request[], line: unknown) {
  const calls: Parameters<ModelCall>[0][] = []
  const model: ModelCall = (req) => {
    calls.push(req)
    return Promise.resolve({
      json: line,
      refused: false,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 2000, output_tokens: 60 },
    })
  }
  const box: BoxRequestStore = {
    claimPressBoxRequest: () => {
      const r = requests.find((x) => x.status === 'pending')
      if (r === undefined) return Promise.resolve(null)
      r.status = 'running'
      return Promise.resolve({
        id: r.id,
        kind: r.kind,
        requestedBy: 'Silky',
        targetPlayerId: null,
        targetDiscordUserId: null,
        reporter: r.reporter as never,
        topic: null,
      })
    },
    finishPressBoxRequest: (id, status, result) => {
      const r = requests.find((x) => x.id === id)!
      r.status = status
      r.result = result
      return Promise.resolve()
    },
    failStuckPressBoxRequests: () => Promise.resolve(0),
    reportPressMode: () => Promise.resolve(),
  }
  const t = setup({ response: oct12Response('game'), model })
  Object.assign(t.store, box)
  return { ...t, calls }
}

const live = config('live')

void test('a preview request makes one model call, records the spend and stores the line as the result', async () => {
  const requests: Request[] = [
    { id: 1, kind: 'preview', reporter: 'quill', status: 'pending', result: null },
  ]
  const t = previewSetup(requests, { line: 'Calling that a trend would be generous.' })
  assert.equal(await runBoxRequests(t.deps, live), 1)
  assert.equal(requests[0]!.status, 'done')
  assert.equal(requests[0]!.result, 'Calling that a trend would be generous.')
  assert.equal(t.calls.length, 1, 'one call')
  assert.ok(t.calls[0]!.system.endsWith(lockedRulesBlock()))
  assert.equal(t.store.usage.length, 1, 'the spend is recorded')
  assert.equal(t.store.usage[0]!.purpose, 'write')
  assert.ok(t.store.usage[0]!.costUsd > 0)
  assert.equal(t.sent.length, 0, 'nothing is posted to Discord')
  assert.equal(t.store.scrums.length, 0)
})

void test('a failed line is a short private reason, still one call and still counted', async () => {
  const requests: Request[] = [
    { id: 2, kind: 'preview', reporter: 'mercer', status: 'pending', result: null },
  ]
  const t = previewSetup(requests, { line: 'He scored 3 goals.' })
  await runBoxRequests(t.deps, live)
  assert.equal(requests[0]!.status, 'failed')
  assert.match(
    requests[0]!.result ?? '',
    /No sample line: the line failed the desk checks \(numbers\)/,
  )
  assert.equal(t.calls.length, 1)
  assert.equal(t.store.usage.length, 1)
  assert.equal(t.sent.length, 0)
})

void test('past the monthly 80% stop: no call at all', async () => {
  const requests: Request[] = [
    { id: 3, kind: 'preview', reporter: 'voss', status: 'pending', result: null },
  ]
  const t = previewSetup(requests, { line: 'Fine.' })
  t.store.spend = 19
  await runBoxRequests(t.deps, live)
  assert.equal(requests[0]!.status, 'failed')
  assert.match(requests[0]!.result ?? '', /80% stop/)
  assert.equal(t.calls.length, 0)
})

void test('a preview for no known reporter makes no call', async () => {
  const requests: Request[] = [
    { id: 4, kind: 'preview', reporter: null, status: 'pending', result: null },
  ]
  const t = previewSetup(requests, { line: 'Fine.' })
  await runBoxRequests(t.deps, live)
  assert.equal(requests[0]!.status, 'failed')
  assert.equal(t.calls.length, 0)
})

void test('an unknown request kind is failed, never run as a test scrum', async () => {
  const requests = [
    { id: 5, kind: 'something-new', reporter: null, status: 'pending', result: null },
  ] as unknown as Request[]
  const t = previewSetup(requests, { line: 'Fine.' })
  await runBoxRequests(t.deps, live)
  assert.equal(requests[0]!.status, 'failed')
  assert.match(requests[0]!.result ?? '', /does not know that kind/)
  assert.equal(t.sent.length, 0)
  assert.equal(t.store.scrums.length, 0)
  assert.equal(t.calls.length, 0)
  assert.ok(boxRequestStoreOf(t.store) !== null)
})
