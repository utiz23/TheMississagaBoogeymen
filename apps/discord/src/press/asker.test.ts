import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTERS, type NewsTake } from '@eanhl/db/news'
import { NewsRetryableError, NewsStopError, type ModelCall } from '../news/writer.ts'
import { oct12Facts } from '../news/test-fixtures.ts'
import type { Usage } from '../news/cost.ts'
import {
  FALLBACK_CLOSING,
  FALLBACK_QUESTION,
  askQuestion,
  judgeAnswer,
  type AskContext,
} from './asker.ts'

const USAGE: Usage = { input_tokens: 10, output_tokens: 5 }
const MODEL = 'claude-opus-5-5'

type Req = Parameters<ModelCall>[0]
type Res = Awaited<ReturnType<ModelCall>>

/** A fake model: answers in order; an Error answer is thrown. */
function fakeCall(answers: (Partial<Res> | Error)[]): { call: ModelCall; reqs: Req[] } {
  const reqs: Req[] = []
  let i = 0
  const call: ModelCall = (req) => {
    reqs.push(req)
    const a = answers[i++]
    if (a === undefined) throw new Error('fake ModelCall ran out of answers')
    if (a instanceof Error) return Promise.reject(a)
    return Promise.resolve({ json: null, refused: false, model: MODEL, usage: USAGE, ...a })
  }
  return { call, reqs }
}

function recorder() {
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

function ctx(over: Partial<AskContext> = {}): AskContext {
  return {
    facts: oct12Facts('game'),
    forbiddenNames: ['Hidden Hank'],
    reporter: 'mercer',
    heat: 'hot',
    player: { name: 'Skater A', pressLevel: 'full' },
    gmNotes: [],
    takes: [],
    history: [],
    questionNumber: 1,
    ...over,
  }
}

const REVIEW_OK = { json: { ok: true, problems: [] } }
const q = (question: string) => ({ json: { question } })

void test('FALLBACK_QUESTION and FALLBACK_CLOSING are the fixed texts', () => {
  assert.equal(FALLBACK_QUESTION('Raz'), 'Walk me through that one, Raz.')
  assert.equal(FALLBACK_CLOSING, 'Fair enough — next game.')
})

void test('askQuestion: a number not on the sheet is rewritten, then reviewed', async () => {
  const { call, reqs } = fakeCall([
    q('Skater A, 7 shots and one goal. What happened?'),
    q('Skater A, 5 shots and one goal against Shake N Bake. What happened?'),
    REVIEW_OK,
  ])
  const r = recorder()
  const out = await askQuestion(call, ctx(), r.record)
  assert.equal(out, 'Skater A, 5 shots and one goal against Shake N Bake. What happened?')
  assert.deepEqual(
    reqs.map((x) => x.purpose),
    ['write', 'write', 'review'],
  )
  assert.deepEqual(r.recorded, ['write', 'write', 'review'])
  assert.match(reqs[1]!.user, /rejected/)
  assert.match(reqs[1]!.user, /The number 7 is not on the fact sheet/)
  assert.equal(reqs[0]!.effort, 'medium')
  assert.equal(reqs[2]!.effort, 'low')
})

void test('askQuestion: two bad writes give the fallback question (max 2 writes)', async () => {
  const { call, reqs } = fakeCall([q('Raz, 7 shots?'), q('Raz, 7 shots again?')])
  const r = recorder()
  const out = await askQuestion(
    call,
    ctx({ player: { name: 'Raz', pressLevel: 'full' } }),
    r.record,
  )
  assert.equal(out, FALLBACK_QUESTION('Raz'))
  assert.equal(reqs.length, 2)
  assert.deepEqual(r.recorded, ['write', 'write'])
})

void test('askQuestion: a GM note may be asked about; the review sees it as a true event', async () => {
  const { call, reqs } = fakeCall([
    q('Skater A, the goal of the year in game 7. Was it planned?'),
    REVIEW_OK,
  ])
  const r = recorder()
  const out = await askQuestion(
    call,
    ctx({ gmNotes: ['Skater A scored the goal of the year in game 7.'] }),
    r.record,
  )
  assert.equal(out, 'Skater A, the goal of the year in game 7. Was it planned?')
  assert.match(reqs[0]!.user, /goal of the year/)
  assert.equal(reqs[1]!.purpose, 'review')
  assert.match(reqs[1]!.user, /true events/)
  assert.match(reqs[1]!.user, /goal of the year/)
  assert.match(reqs[1]!.user, /14\. The text says or hints that a note came from a tip/)
})

void test('askQuestion: naming another teammate or a forbidden name is rewritten', async () => {
  const { call, reqs } = fakeCall([
    q('Skater A, did Skater B leave you alone out there?'),
    q('Skater A, did Hidden Hank out-skate you?'),
    REVIEW_OK,
  ])
  const r = recorder()
  const out = await askQuestion(call, ctx(), r.record)
  assert.equal(out, FALLBACK_QUESTION('Skater A'))
  assert.equal(reqs.length, 2)
  assert.match(reqs[1]!.user, /The question names Skater B\. Name only Skater A\./)
  assert.ok(!r.recorded.includes('review'))
})

void test('askQuestion: over 280 characters is rewritten', async () => {
  const long = `Skater A, ${'why '.repeat(80)}?`
  const { call, reqs } = fakeCall([q(long), q('Skater A, why?'), REVIEW_OK])
  const out = await askQuestion(call, ctx(), recorder().record)
  assert.equal(out, 'Skater A, why?')
  assert.match(reqs[1]!.user, /280/)
})

void test('askQuestion: a NewsStopError or a retryable error gives the fallback, no throw', async () => {
  for (const err of [new NewsStopError('bad key'), new NewsRetryableError('down')]) {
    const { call } = fakeCall([err])
    const out = await askQuestion(call, ctx(), recorder().record)
    assert.equal(out, FALLBACK_QUESTION('Skater A'))
  }
})

void test("askQuestion: the system prompt carries the reporter's voice and the scrum rules", async () => {
  const { call, reqs } = fakeCall([q('Skater A, why?'), REVIEW_OK])
  await askQuestion(call, ctx({ reporter: 'vale', heat: 'cool' }), recorder().record)
  assert.ok(reqs[0]!.system.includes(REPORTERS.vale.voice))
  assert.ok(!reqs[0]!.system.includes(REPORTERS.mercer.voice))
  assert.match(reqs[0]!.system, /one question/i)
  assert.match(reqs[0]!.user, /cool/)
  assert.match(reqs[0]!.user, /what went well/)
})

void test('askQuestion: an easy player gets no criticism at any heat', async () => {
  const { call, reqs } = fakeCall([q('Skater B, why?'), REVIEW_OK])
  await askQuestion(
    call,
    ctx({ player: { name: 'Skater B', pressLevel: 'easy' } }),
    recorder().record,
  )
  assert.match(reqs[0]!.user, /no criticism/)
  // The review is not told the player may be criticised harshly.
  assert.match(reqs[1]!.user, /criticised harshly: nobody/)
})

void test("askQuestion: a take's words never reach the review's problems and are offered as private", async () => {
  const take: NewsTake = {
    id: 9,
    reporter: 'mercer',
    critics: [],
    defender: null,
    playerId: 1,
    player: 'Skater A',
    take: 'never backchecks when it matters most',
    spread: 'some',
    dataAngle: null,
    intensity: 1,
    mild: false,
  }
  const { call, reqs } = fakeCall([q('Skater A, why?'), REVIEW_OK])
  await askQuestion(call, ctx({ takes: [take] }), recorder().record)
  assert.match(reqs[0]!.user, /never backchecks when it matters most/)
  assert.match(reqs[1]!.user, /refer to a take only as "take N"/)
})

const judged = (usability: string, followUp: string, closing: string) => ({
  json: { usability, followUp, closing },
})

void test('judgeAnswer: followUpAllowed false drops a follow-up the model wrote', async () => {
  const { call } = fakeCall([
    judged('usable', 'And the second goal?', 'Fair, Skater A. Next game.'),
    REVIEW_OK,
  ])
  const out = await judgeAnswer(
    call,
    {
      ...ctx({ history: [{ question: 'Why?', answer: null }] }),
      answer: 'We got outworked.',
      followUpAllowed: false,
    },
    recorder().record,
  )
  assert.deepEqual(out, {
    usability: 'usable',
    followUp: null,
    closing: 'Fair, Skater A. Next game.',
  })
})

void test('judgeAnswer: a follow-up may use a number from the answer; the review lists the answer', async () => {
  const { call, reqs } = fakeCall([
    judged('usable', 'You said 7 bad changes. Which one hurt most?', 'Noted.'),
    REVIEW_OK,
  ])
  const out = await judgeAnswer(
    call,
    {
      ...ctx({ history: [{ question: 'Why?', answer: null }] }),
      answer: 'We made 7 bad changes.',
      followUpAllowed: true,
    },
    recorder().record,
  )
  assert.equal(out.followUp, 'You said 7 bad changes. Which one hurt most?')
  assert.match(reqs[1]!.user, /We made 7 bad changes\./)
  assert.match(reqs[1]!.user, /1\. A teammate quote not backed by the listed answers/)
})

void test('judgeAnswer: a joke answer is listed as a joke for the review', async () => {
  const { call, reqs } = fakeCall([judged('joke', '', 'Very funny, Skater A.'), REVIEW_OK])
  const out = await judgeAnswer(
    call,
    {
      ...ctx({ history: [{ question: 'Why?', answer: null }] }),
      answer: 'The puck was haunted.',
      followUpAllowed: true,
    },
    recorder().record,
  )
  assert.deepEqual(out, { usability: 'joke', followUp: null, closing: 'Very funny, Skater A.' })
  assert.match(reqs[1]!.user, /The puck was haunted\..*joke/i)
})

void test('judgeAnswer: an unusable answer is not repeated and is not a trusted answer', async () => {
  const answer = 'my boss yelled at me all day today'
  const { call, reqs } = fakeCall([
    judged('unusable', 'Why did your boss yell?', 'So my boss yelled at me all day. Next game.'),
    judged('unusable', 'Why did your boss yell?', 'Fair enough. Next game.'),
    REVIEW_OK,
  ])
  const out = await judgeAnswer(
    call,
    { ...ctx({ history: [{ question: 'Why?', answer: null }] }), answer, followUpAllowed: true },
    recorder().record,
  )
  assert.deepEqual(out, {
    usability: 'unusable',
    followUp: null,
    closing: 'Fair enough. Next game.',
  })
  assert.match(reqs[1]!.user, /repeats the player's answer/)
  assert.ok(!reqs[2]!.user.includes(answer))
})

void test('judgeAnswer: a stop error or two bad writes give the fallback, no throw', async () => {
  const fallback = { usability: 'usable', followUp: null, closing: FALLBACK_CLOSING }
  const stop = fakeCall([new NewsStopError('bad key')])
  assert.deepEqual(
    await judgeAnswer(
      stop.call,
      { ...ctx(), answer: 'x', followUpAllowed: true },
      recorder().record,
    ),
    fallback,
  )
  const bad = fakeCall([judged('usable', '', 'Skater B, 7?'), judged('maybe', '', 'ok')])
  assert.deepEqual(
    await judgeAnswer(
      bad.call,
      { ...ctx(), answer: 'x', followUpAllowed: true },
      recorder().record,
    ),
    fallback,
  )
  assert.equal(bad.reqs.length, 2)
})
