import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTERS } from '@eanhl/db/news'
import type { ProfileMaterial } from '@eanhl/db/queries'
import { oct12Response } from '../news/test-fixtures.ts'
import { PROFILE_SCHEMA } from '../news/profile.ts'
import { interviewSetup } from './interview-fakes.ts'
import type { ModelCall } from '../news/writer.ts'
import { BOX_REQUEST_STUCK_MS, boxRequestStoreOf, runBoxRequests } from './box-requests.ts'
import type { BoxRequestStore } from './box-requests.ts'
import { runPressPass } from './pass.ts'
import { GM, NOW, USER_A, config, setup } from './test-fakes.ts'

/**
 * Press Box requests (migration 0080): the admin page writes a request, the press pass does it.
 * Only `testscrum` exists: the same code as `/gm testscrum`, run as the GM, with no model call.
 */

const TEST_CH = 'bot-test'
const live = { ...config('live'), testChannelId: TEST_CH }

interface Request {
  id: number
  kind: 'testscrum' | 'profile' | 'interview'
  requestedBy: string
  targetPlayerId?: number | null
  targetDiscordUserId?: string | null
  reporter?: 'barlow' | null
  topic?: string | null
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
      return Promise.resolve({
        id: r.id,
        kind: r.kind,
        requestedBy: r.requestedBy,
        targetPlayerId: r.targetPlayerId ?? null,
        targetDiscordUserId: r.targetDiscordUserId ?? null,
        reporter: r.reporter ?? null,
        topic: r.topic ?? null,
      })
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

// ── Release L2 (migration 0081): profile and interview requests ──────────────

const GOOD_PROFILE =
  'Quill sees a steady skater who has settled in, and Vale reads a reinvention rather than a slump. The press agrees he is team first.'
const CANARY_ANSWER = 'OFF-LIMITS-CANARY-TEXT that must never appear anywhere at all'

function material(over: Partial<ProfileMaterial> = {}): ProfileMaterial {
  return {
    name: 'Skater A',
    role: 'player',
    pressLevel: 'full',
    playerId: 1,
    discordUserId: null,
    quotes: [
      {
        id: 'scrum:1',
        source: 'scrum',
        usability: 'usable',
        question: 'How did it go?',
        text: 'We stuck to the plan and trusted the system',
        reporter: 'vale',
        at: NOW,
      },
    ],
    takes: [{ id: 4, reporter: 'quill', take: 'a steady hand', active: true, updatedAt: NOW }],
    ...over,
  }
}

function profileSetup(requests: Request[], mat: ProfileMaterial | null = material()) {
  const calls: Parameters<ModelCall>[0][] = []
  const saved: { key: unknown; text: string; model: string; costUsd: number }[] = []
  const model: ModelCall = (req) => {
    calls.push(req)
    const json =
      req.purpose === 'review'
        ? { ok: true, problems: [] }
        : req.schema === PROFILE_SCHEMA
          ? { profile: GOOD_PROFILE }
          : undefined
    if (json === undefined) return Promise.reject(new Error('unexpected schema'))
    return Promise.resolve({
      json,
      refused: false,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 2000, output_tokens: 300 },
    })
  }
  const t = interviewSetup({ response: oct12Response('night'), model })
  Object.assign(t.store, {
    claimPressBoxRequest: () => {
      const next = requests.find((x) => x.status === 'pending')
      if (next === undefined) return Promise.resolve(null)
      next.status = 'running'
      return Promise.resolve({
        id: next.id,
        kind: next.kind,
        requestedBy: next.requestedBy,
        targetPlayerId: next.targetPlayerId ?? null,
        targetDiscordUserId: next.targetDiscordUserId ?? null,
        reporter: next.reporter ?? null,
        topic: next.topic ?? null,
      })
    },
    finishPressBoxRequest: (id: number, status: 'done' | 'failed', result: string) => {
      const r = requests.find((x) => x.id === id)!
      r.status = status
      r.result = result
      return Promise.resolve()
    },
    failStuckPressBoxRequests: () => Promise.resolve(0),
    reportPressMode: () => Promise.resolve(),
    getProfileMaterial: () => Promise.resolve(mat),
    savePlayerProfile: (p: { key: unknown; text: string; model: string; costUsd: number }) => {
      saved.push(p)
      return Promise.resolve()
    },
  })
  t.store.playerNights.set(1, NIGHT_OF_GAME)
  t.store.discordIds.set(1, USER_A)
  t.store.discordIds.set(2, GM)
  return { ...t, calls, saved }
}

const NIGHT_OF_GAME = '2026-10-12'

void test('a profile request: one write and one review, both counted in the spend, the profile stored', async () => {
  const requests: Request[] = [
    {
      id: 10,
      kind: 'profile',
      requestedBy: 'Silky',
      status: 'pending',
      result: null,
      targetPlayerId: 1,
    },
  ]
  const t = profileSetup(requests)
  assert.equal(await runBoxRequests(t.deps, live), 1)
  assert.equal(requests[0]!.status, 'done')
  assert.match(requests[0]!.result ?? '', /Profile written for Skater A\. Cost about \$/)
  assert.deepEqual(
    t.calls.map((c) => c.purpose),
    ['write', 'review'],
  )
  // Both calls are in the monthly spend, and the stored cost is their sum.
  assert.deepEqual(
    t.store.usage.map((u) => u.purpose),
    ['write', 'review'],
  )
  const spent = t.store.usage.reduce((n, u) => n + u.costUsd, 0)
  assert.ok(spent > 0)
  assert.equal(t.saved.length, 1)
  assert.equal(t.saved[0]!.text, GOOD_PROFILE)
  assert.ok(Math.abs(t.saved[0]!.costUsd - spent) < 1e-9)
  assert.deepEqual(t.saved[0]!.key, { playerId: 1 })
  // The press posts nothing to Discord for a profile.
  assert.equal(t.sent.length, 0)
})

void test('a profile request for Leave me out: failed, no model call, nothing stored', async () => {
  const requests: Request[] = [
    {
      id: 11,
      kind: 'profile',
      requestedBy: 'Silky',
      status: 'pending',
      result: null,
      targetPlayerId: 1,
    },
  ]
  const t = profileSetup(requests, material({ pressLevel: 'out', quotes: [], takes: [] }))
  await runBoxRequests(t.deps, live)
  assert.equal(requests[0]!.status, 'failed')
  assert.equal(requests[0]!.result, 'Leave me out: no profile is written.')
  assert.equal(t.calls.length, 0)
  assert.equal(t.store.usage.length, 0)
  assert.equal(t.saved.length, 0)
})

void test('a profile request past the 80% stop makes no model call; a Go easy request never offers the critical take', async () => {
  const requests: Request[] = [
    {
      id: 12,
      kind: 'profile',
      requestedBy: 'Silky',
      status: 'pending',
      result: null,
      targetPlayerId: 1,
    },
  ]
  const t = profileSetup(requests)
  t.store.spend = 1000
  await runBoxRequests(t.deps, live)
  assert.equal(requests[0]!.status, 'failed')
  assert.match(requests[0]!.result ?? '', /80% stop/)
  assert.equal(t.calls.length, 0)

  const easyRequests: Request[] = [
    {
      id: 13,
      kind: 'profile',
      requestedBy: 'Silky',
      status: 'pending',
      result: null,
      targetPlayerId: 1,
    },
  ]
  const e = profileSetup(
    easyRequests,
    material({
      pressLevel: 'easy',
      takes: [
        {
          id: 4,
          reporter: 'quill',
          take: 'a fraud who cannot finish',
          active: true,
          updatedAt: NOW,
        },
      ],
    }),
  )
  await runBoxRequests(e.deps, live)
  assert.equal(easyRequests[0]!.status, 'done')
  const write = e.calls[0]!
  assert.match(write.system, /press level "easy" \(Go easy\) gets NO criticism at all/)
  assert.doesNotMatch(write.user, /a fraud who cannot finish/)
})

void test('a profile that fails the checks stores nothing and its result and log never carry an answer', async () => {
  const requests: Request[] = [
    {
      id: 14,
      kind: 'profile',
      requestedBy: 'Silky',
      status: 'pending',
      result: null,
      targetPlayerId: 1,
    },
  ]
  const t = profileSetup(
    requests,
    material({
      quotes: [
        {
          id: 'scrum:2',
          source: 'scrum',
          usability: 'usable',
          question: 'Anything else?',
          text: CANARY_ANSWER,
          reporter: null,
          at: NOW,
        },
      ],
    }),
  )
  // The writer copies the answer: the code check refuses it.
  t.deps.call = (req) => {
    t.calls.push(req)
    return Promise.resolve({
      json: { profile: `He says ${CANARY_ANSWER} every night.` },
      refused: false,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 10, output_tokens: 5 },
    })
  }
  await runBoxRequests(t.deps, live)
  assert.equal(requests[0]!.status, 'failed')
  assert.match(requests[0]!.result ?? '', /did not pass the writing checks/)
  assert.equal(t.saved.length, 0)
  assert.equal(t.calls.length, 1, 'one write, no review, no rewrite')
  const everything = JSON.stringify([requests, t.logs])
  assert.ok(!everything.includes('CANARY'))
})

void test('an old store without the profile methods fails a profile request with a fixed line', async () => {
  const requests: Request[] = [
    {
      id: 15,
      kind: 'profile',
      requestedBy: 'Silky',
      status: 'pending',
      result: null,
      targetPlayerId: 1,
    },
  ]
  const t = boxSetup(requests)
  await runBoxRequests(t.deps, live)
  assert.equal(requests[0]!.status, 'failed')
  assert.equal(requests[0]!.result, 'Profiles are off in this press service.')
  assert.equal(t.modelCalls(), 0)
})

void test('an interview request offers the interview as the GM with the chosen reporter and topic', async () => {
  const requests: Request[] = [
    {
      id: 20,
      kind: 'interview',
      requestedBy: 'Silky',
      status: 'pending',
      result: null,
      targetPlayerId: 1,
      reporter: 'barlow',
      topic: 'the third period',
    },
  ]
  const t = profileSetup(requests)
  await runBoxRequests(t.deps, live)
  assert.equal(requests[0]!.status, 'done')
  assert.equal(
    requests[0]!.result,
    `Got it: ${REPORTERS.barlow.name} will offer Skater A an interview (open for 30 minutes).`,
  )
  assert.equal(t.store.interviews.length, 1)
  assert.equal(t.store.interviews[0]!.reporter, 'barlow')
  assert.equal(t.store.interviews[0]!.topic, 'the third period')
  assert.equal(t.store.interviews[0]!.trigger, 'gm')
  assert.equal(t.calls.length, 0, 'offering an interview makes no model call')
})

void test('an interview request for someone who cannot be interviewed is failed with the reason', async () => {
  const requests: Request[] = [
    {
      id: 21,
      kind: 'interview',
      requestedBy: 'Silky',
      status: 'pending',
      result: null,
      targetPlayerId: 1,
    },
  ]
  const t = profileSetup(requests)
  t.store.discordIds.delete(1)
  await runBoxRequests(t.deps, live)
  assert.equal(requests[0]!.status, 'failed')
  assert.equal(requests[0]!.result, 'This person has no Discord link.')
  assert.equal(t.store.interviews.length, 0)
})
