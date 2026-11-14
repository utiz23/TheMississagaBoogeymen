import test from 'node:test'
import assert from 'node:assert/strict'
import { oct12Response } from '../news/test-fixtures.ts'
import type { ModelCall } from '../news/writer.ts'
import { BOX_REQUEST_STUCK_MS, boxRequestStoreOf, runBoxRequests } from './box-requests.ts'
import type { BoxRequestStore } from './box-requests.ts'
import { runPressPass } from './pass.ts'
import { GM, NOW, config, setup } from './test-fakes.ts'

/**
 * Press Box requests (migration 0080): the admin page writes a request, the press pass does it.
 * Only `testscrum` exists: the same code as `/gm testscrum`, run as the GM, with no model call.
 */

const TEST_CH = 'bot-test'
const live = { ...config('live'), testChannelId: TEST_CH }

interface Request {
  id: number
  kind: 'testscrum'
  requestedBy: string
  status: 'pending' | 'running' | 'done' | 'failed'
  result: string | null
}

function boxSetup(requests: Request[]) {
  const reported: { mode: string; at: Date }[] = []
  const stuck: Date[] = []
  const box: BoxRequestStore = {
    claimPressBoxRequest: () => {
      const r = requests.find((x) => x.status === 'pending')
      if (r === undefined) return Promise.resolve(null)
      r.status = 'running'
      return Promise.resolve({ id: r.id, kind: r.kind, requestedBy: r.requestedBy })
    },
    finishPressBoxRequest: (id, status, result) => {
      const r = requests.find((x) => x.id === id)!
      r.status = status
      r.result = result
      return Promise.resolve()
    },
    failStuckPressBoxRequests: (before) => {
      stuck.push(before)
      return Promise.resolve(0)
    },
    reportPressMode: (mode, at) => {
      reported.push({ mode, at })
      return Promise.resolve()
    },
  }
  let modelCalls = 0
  const model: ModelCall = () => {
    modelCalls++
    return Promise.reject(new Error('a test scrum must make no model call'))
  }
  const t = setup({ response: oct12Response('game'), model })
  Object.assign(t.store, box)
  // The GM is a player who played the game (Silky is linked on the real site).
  t.store.discordIds.set(1, GM)
  return { ...t, reported, stuck, modelCalls: () => modelCalls }
}

void test('a pending request makes a test scrum in the test channel, with no model call', async () => {
  const requests: Request[] = [
    { id: 1, kind: 'testscrum', requestedBy: 'Silky', status: 'pending', result: null },
  ]
  const t = boxSetup(requests)
  assert.equal(await runBoxRequests(t.deps, live), 1)
  assert.equal(requests[0]!.status, 'done')
  assert.match(requests[0]!.result ?? '', /Test scrum made/)
  // One recap post, in the test channel only; a scrum row marked as a test.
  assert.equal(t.sent.length, 1)
  assert.equal(t.sent[0]!.channelId, TEST_CH)
  assert.equal(t.store.scrums.length, 1)
  assert.equal(t.store.scrums[0]!.isTest, true)
  assert.equal(t.modelCalls(), 0)
})

void test('every pass reports the mode and fails requests stuck in running', async () => {
  const t = boxSetup([])
  assert.equal(await runBoxRequests(t.deps, live), 0)
  assert.deepEqual(t.reported, [{ mode: 'live', at: NOW }])
  assert.deepEqual(t.stuck, [new Date(NOW.getTime() - BOX_REQUEST_STUCK_MS)])
  assert.equal(t.sent.length, 0)
})

void test('the timer pass runs the box step (trial mode reports trial)', async () => {
  const requests: Request[] = [
    { id: 2, kind: 'testscrum', requestedBy: 'Silky', status: 'pending', result: null },
  ]
  const t = boxSetup(requests)
  await runPressPass(t.deps, config('trial'))
  assert.equal(t.reported.at(-1)?.mode, 'trial')
  assert.equal(requests[0]!.status, 'done')
})

void test('a request that throws is marked failed with a fixed line, never retried', async () => {
  const requests: Request[] = [
    { id: 3, kind: 'testscrum', requestedBy: 'Silky', status: 'pending', result: null },
  ]
  const t = boxSetup(requests)
  t.store.listDisabledReporters = () => Promise.reject(new Error('database down'))
  assert.equal(await runBoxRequests(t.deps, live), 1)
  assert.equal(requests[0]!.status, 'failed')
  assert.equal(requests[0]!.result, 'The test scrum could not be made.')
  assert.ok(t.logs.some((l) => l.includes('database down')))
  assert.equal(await runBoxRequests(t.deps, live), 0)
  assert.equal(t.store.scrums.length, 0)
})

void test('a store without the request methods has no requests (nothing is run)', async () => {
  const t = setup({ response: oct12Response('game') })
  assert.equal(boxRequestStoreOf(t.store), null)
  assert.equal(await runBoxRequests(t.deps, live), 0)
  assert.equal(t.sent.length, 0)
})
