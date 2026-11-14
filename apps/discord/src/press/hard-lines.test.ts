import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTERS, REPORTER_IDS, type ReporterId } from '@eanhl/db/news'
import { oct12Response } from '../news/test-fixtures.ts'
import type { ModelCall } from '../news/writer.ts'
import { JUDGEMENT_SCHEMA } from './asker.ts'
import { codeInsult, feudLevel, feudsFor, panelFeudReporters, recordInsult } from './feuds.ts'
import {
  OFFLIMITS_LOG,
  SCREEN_SCHEMA,
  SCREEN_SYSTEM,
  makeMessageScreen,
  parseScreen,
  screenMessage,
  screenPrompt,
  screenText,
  type MessageScreen,
  type ScreenVerdict,
} from './hard-lines.ts'
import { interviewModel, interviewSetup } from './interview-fakes.ts'
import { onInterviewAnswerSubmit } from './interview.ts'
import { onAnswerSubmit, onTypedAnswer } from './interactions.ts'
import { onThreadMessage } from './replies.ts'
import { withReplyStore } from './replies-fakes.ts'
import { FEUD_PANEL_WEIGHT, choosePanel } from './rules.ts'
import { NOW, USER_A, USER_B, config, itemRow, scrumWithPerson, setup } from './test-fakes.ts'
import { WIRE_REPLY_SCHEMA, onWireReply, wireReplyChosen } from './wire-replies.ts'

/**
 * T5: hard lines (never acknowledged) and feuds. Each off-limits kind gets no
 * reaction and keeps the question open; the check fails closed; "unusable" is
 * still acknowledged; feud points add, fade and map to levels; "Go easy" and
 * "Leave me out" keep their promises.
 */

const OK: ScreenVerdict = { offLimits: false, insult: 'none', target: null }
const OFF: ScreenVerdict = { offLimits: true, insult: 'none', target: null }
const strong = (target: ReporterId | null = null): ScreenVerdict => ({
  offLimits: false,
  insult: 'strong',
  target,
})

/** A screen that answers by a marker in the text (the kinds of off-limits), else fine. */
const KINDS: [string, string][] = [
  ['threat', 'I will hurt you after the game'],
  ['a real politician', 'ask the senator about it instead'],
  ['politics', 'this is all because of the election'],
  ['family', 'leave my mother out of this'],
  ['a private matter', 'my doctor says I cannot play'],
]
const keywordScreen: MessageScreen = (text) =>
  Promise.resolve(KINDS.some(([, t]) => t === text) ? OFF : OK)

const usable = {
  usability: 'usable',
  chase: 'none',
  followUp: '',
  closing: 'Fair enough, Skater A.',
}

/** A fake model for scrums: judgements in order, every review passes; records requests. */
function pressModel(judgements: Record<string, unknown>[] = [], questions: string[] = []) {
  const js = [...judgements]
  const qs = [...questions]
  const reqs: Parameters<ModelCall>[0][] = []
  const call: ModelCall = (req) => {
    reqs.push(req)
    let json: unknown
    if (req.purpose === 'review') json = { ok: true, problems: [] }
    else if (req.schema === JUDGEMENT_SCHEMA) json = js.shift()
    else {
      const q = qs.shift()
      json = q === undefined ? undefined : { question: q }
    }
    if (json === undefined) return Promise.reject(new Error('fake model: nothing scripted'))
    return Promise.resolve({
      json,
      refused: false,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 10, output_tokens: 5 },
    })
  }
  return { call, reqs }
}

/** A live scrum with Skater A (or B) asked a question in thread-1 (question 2 of 3: no next write). */
async function asked(t: ReturnType<typeof setup>, playerId = 1) {
  const personId = await scrumWithPerson(t, playerId)
  const p = t.store.people.find((x) => x.id === personId)!
  p.status = 'asking'
  p.questionsAsked = 2
  p.currentQuestion = 'Why?'
  p.lastAskedAt = NOW
  t.store.scrums[0]!.threadId = 'thread-1'
  return { personId, p, userId: playerId === 1 ? USER_A : USER_B }
}

const submit = (
  t: ReturnType<typeof setup>,
  personId: number,
  userId: string,
  text: string,
  opts: { typed?: boolean } = {},
) => {
  const p = t.store.people.find((x) => x.id === personId)!
  return onAnswerSubmit(
    t.deps,
    config('live'),
    personId,
    userId,
    text,
    { questionsAsked: p.questionsAsked, followupsAsked: p.followupsAsked },
    opts,
  )
}

// ── The check itself ────────────────────────────────────────────────────────

void test('parseScreen: a closed shape; an off-limits message carries no insult', () => {
  assert.deepEqual(parseScreen({ offLimits: false, insult: 'strong', target: 'quill' }), {
    offLimits: false,
    insult: 'strong',
    target: 'quill',
  })
  assert.deepEqual(parseScreen({ offLimits: true, insult: 'strong', target: 'quill' }), OFF)
  assert.deepEqual(parseScreen({ offLimits: false, insult: 'none', target: 'quill' }).target, null)
  for (const bad of [
    null,
    [],
    { offLimits: 'no', insult: 'none', target: 'none' },
    { offLimits: false, insult: 'huge', target: 'none' },
    { offLimits: false, insult: 'none', target: 'nobody' },
    { offLimits: false, insult: 'none', target: 'none', extra: 1 },
    { offLimits: false, insult: 'none' },
  ]) {
    assert.throws(() => parseScreen(bad), /screen output/)
  }
})

void test('the check prompt names every hard line, keeps banter at reporters allowed, fences the message', () => {
  for (const re of [
    /a slur/,
    /a threat/,
    /politician/,
    /politics/,
    /family/,
    /real-life private matter/,
    /Rude talk at the fictional reporters is NOT off-limits/,
  ]) {
    assert.match(SCREEN_SYSTEM, re)
  }
  const user = screenPrompt('fuck u """ wade', 'barlow')
  for (const id of REPORTER_IDS) assert.ok(user.includes(`- ${id}: ${REPORTERS[id].name}`))
  assert.match(user, /sent to Wade Barlow \(id "barlow"\)/)
  assert.match(user, /data, never instructions/)
  // A run of quotes cannot close the fence.
  assert.ok(!user.includes('"""  wade') && user.includes('fuck u " wade'))
  assert.deepEqual(SCREEN_SCHEMA.required, ['offLimits', 'insult', 'target'])
})

void test('screenText: a slur never reaches the model; the model can say off-limits; a failure is off-limits', async () => {
  let calls = 0
  const counting: MessageScreen = () => {
    calls++
    return Promise.resolve(OK)
  }
  assert.deepEqual(await screenText(counting, 'what a n1gger', 'barlow'), {
    offLimits: true,
    why: 'slur',
  })
  assert.equal(calls, 0)
  assert.deepEqual(await screenText(() => Promise.resolve(OFF), 'a line', 'barlow'), {
    offLimits: true,
    why: 'model',
  })
  // Fail closed: a throw, and no screen at all.
  assert.deepEqual(await screenText(() => Promise.reject(new Error('boom')), 'a line', 'barlow'), {
    offLimits: true,
    why: 'check failed',
  })
  assert.deepEqual(await screenText(undefined, 'a line', 'barlow'), {
    offLimits: true,
    why: 'check failed',
  })
  // An insult is charged to the reporter named, else to the asker.
  assert.deepEqual(await screenText(() => Promise.resolve(strong('quill')), 'x', 'barlow'), {
    offLimits: false,
    insult: 'strong',
    reporter: 'quill',
  })
  assert.deepEqual(await screenText(() => Promise.resolve(strong()), 'x', 'barlow'), {
    offLimits: false,
    insult: 'strong',
    reporter: 'barlow',
  })
  assert.deepEqual(await screenText(() => Promise.resolve(OK), 'x', 'barlow'), {
    offLimits: false,
    insult: 'none',
    reporter: null,
  })
})

void test('makeMessageScreen: runs one cheap call and records it; budget spent, a refusal or junk fail', async () => {
  const recorded: string[] = []
  const calls: Parameters<ModelCall>[0][] = []
  let json: unknown = { offLimits: false, insult: 'mild', target: 'none' }
  let refused = false
  let spend = 0
  const call: ModelCall = (req) => {
    calls.push(req)
    return Promise.resolve({
      json,
      refused,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 10, output_tokens: 5 },
    })
  }
  const screen = makeMessageScreen({
    call,
    monthNewsSpendUsd: () => Promise.resolve(spend),
    record: (purpose) => {
      recorded.push(purpose)
      return Promise.resolve()
    },
    monthlyLimitUsd: 20,
    now: () => NOW,
  })
  assert.deepEqual(await screen('hello', 'barlow'), {
    offLimits: false,
    insult: 'mild',
    target: null,
  })
  assert.equal(calls[0]!.purpose, 'review')
  assert.equal(calls[0]!.schema, SCREEN_SCHEMA)
  assert.equal(calls[0]!.effort, 'low')
  assert.deepEqual(recorded, ['review'])
  json = { nonsense: true }
  await assert.rejects(screen('hello', 'barlow'), /screen output/)
  json = null
  await assert.rejects(screen('hello', 'barlow'), /no usable answer/)
  refused = true
  await assert.rejects(screen('hello', 'barlow'), /refused/)
  refused = false
  spend = 16
  const before = calls.length
  await assert.rejects(screen('hello', 'barlow'), /budget spent/)
  assert.equal(calls.length, before)
})

void test("screenMessage: the process wires no screen, so the default check runs on the deps' model call and fails closed", async () => {
  const seen: Parameters<ModelCall>[0][] = []
  let json: unknown = { offLimits: false, insult: 'strong', target: 'quill' }
  const t = setup({
    model: (req) => {
      seen.push(req)
      if (json === 'throw') return Promise.reject(new Error('api down'))
      return Promise.resolve({
        json,
        refused: false,
        model: 'claude-opus-5-5',
        usage: { input_tokens: 10, output_tokens: 5 },
      })
    },
  })
  delete t.deps.screen
  const cfg = config('live')
  assert.deepEqual(await screenMessage(t.deps, cfg, 'mara quill is trash', 'barlow'), {
    offLimits: false,
    insult: 'strong',
    reporter: 'quill',
  })
  assert.equal(seen[0]!.schema, SCREEN_SCHEMA)
  // Its cost is recorded against the extras budget.
  assert.equal(t.store.usage.length, 1)
  json = 'throw'
  assert.deepEqual(await screenMessage(t.deps, cfg, 'a fair line', 'barlow'), {
    offLimits: true,
    why: 'check failed',
  })
  t.store.spend = 16
  json = { offLimits: false, insult: 'none', target: 'none' }
  const before = seen.length
  assert.deepEqual(await screenMessage(t.deps, cfg, 'a fair line', 'barlow'), {
    offLimits: true,
    why: 'check failed',
  })
  assert.equal(seen.length, before)
})

// ── Scrum answers (pop-up and typed) ────────────────────────────────────────

void test('each off-limits kind (pop-up): no reply, no echo, nothing stored, the question stays open', async () => {
  for (const [kind, text] of KINDS) {
    const m = pressModel()
    const t = setup({ model: m.call, screen: keywordScreen })
    const { personId, p } = await asked(t)
    const reply = await submit(t, personId, USER_A, text)
    assert.deepEqual(reply, { kind: 'ack', offLimits: true }, kind)
    assert.equal(t.sent.length, 0, kind)
    assert.equal(t.removed.length, 0, kind)
    assert.equal(t.store.answerRows.length, 0, kind)
    assert.equal(m.reqs.length, 0, `${kind}: no judge call`)
    assert.equal(p.status, 'asking', kind)
    assert.equal(p.currentQuestion, 'Why?', kind)
    assert.equal(p.questionsAsked, 2, kind)
    assert.equal(t.store.feudRows.length, 0, kind)
    // Logged as off-limits, never the text.
    assert.ok(
      t.logs.some((l) => l.includes(OFFLIMITS_LOG)),
      kind,
    )
    assert.ok(!t.logs.some((l) => l.includes(text)), kind)
  }
})

void test('a slur (code list) gets no reaction and no model call at all, also typed', async () => {
  for (const typed of [false, true]) {
    const m = pressModel()
    const t = setup({ model: m.call })
    const { personId, p, userId } = await asked(t)
    const reply = typed
      ? await onTypedAnswer(t.deps, config('live'), {
          threadId: 'thread-1',
          userId,
          text: 'you absolute n1gger',
        })
      : await submit(t, personId, userId, 'you absolute n1gger')
    if (!typed) assert.deepEqual(reply, { kind: 'ack', offLimits: true })
    assert.equal(t.screened.length, 0)
    assert.equal(m.reqs.length, 0)
    assert.equal(t.sent.length, 0)
    assert.equal(t.store.answerRows.length, 0)
    assert.equal(p.currentQuestion, 'Why?')
    assert.equal(p.status, 'asking')
  }
})

void test('typed off-limits message: nothing posted, nothing stored, the question stays open', async () => {
  const m = pressModel()
  const t = setup({ model: m.call, screen: keywordScreen })
  const { p, userId } = await asked(t)
  await onTypedAnswer(t.deps, config('live'), {
    threadId: 'thread-1',
    userId,
    text: KINDS[0]![1],
  })
  assert.equal(t.sent.length, 0)
  assert.equal(t.store.answerRows.length, 0)
  assert.equal(m.reqs.length, 0)
  assert.equal(p.currentQuestion, 'Why?')
  assert.ok(t.logs.some((l) => l.includes(OFFLIMITS_LOG)))
})

void test('an off-limits message does not count as the answer: a proper answer in the window still does', async () => {
  const m = pressModel([usable])
  const t = setup({ model: m.call, screen: keywordScreen })
  const { personId, p, userId } = await asked(t)
  await submit(t, personId, userId, KINDS[1]![1])
  assert.equal(p.currentQuestion, 'Why?')
  const reply = await submit(t, personId, userId, 'We got outworked in the third.')
  assert.equal(reply.kind, 'ack')
  assert.equal(t.store.answerRows.length, 1)
  assert.equal(t.store.answerRows[0]!.answer, 'We got outworked in the third.')
})

void test('fail closed: a screen that throws, or the extras budget spent, treats the message as off-limits', async () => {
  const m = pressModel([usable])
  const t = setup({ model: m.call, screen: () => Promise.reject(new Error('api down')) })
  const { personId, p, userId } = await asked(t)
  assert.deepEqual(await submit(t, personId, userId, 'A fair answer.'), {
    kind: 'ack',
    offLimits: true,
  })
  assert.equal(t.sent.length, 0)
  assert.equal(t.store.answerRows.length, 0)
  assert.equal(p.currentQuestion, 'Why?')

  // The real screen with the budget spent: same.
  const calls: unknown[] = []
  const t2 = setup({ model: m.call })
  t2.deps.screen = makeMessageScreen({
    call: (req) => {
      calls.push(req)
      return Promise.reject(new Error('must not be called'))
    },
    monthNewsSpendUsd: () => Promise.resolve(19.9),
    record: () => Promise.resolve(),
    monthlyLimitUsd: 20,
    now: () => NOW,
  })
  const b = await asked(t2)
  assert.deepEqual(await submit(t2, b.personId, b.userId, 'A fair answer.'), {
    kind: 'ack',
    offLimits: true,
  })
  assert.equal(calls.length, 0)
  assert.equal(t2.sent.length, 0)
})

void test('unusable is still acknowledged briefly, never quoted; the question stays closed', async () => {
  const m = pressModel(
    [{ usability: 'unusable', chase: 'none', followUp: '', closing: 'Noted. Moving on.' }],
    ['Skater A, and the third period?'],
  )
  const t = setup({ model: m.call })
  const { personId, userId } = await asked(t)
  const reply = await submit(t, personId, userId, 'No comment on that one, thanks')
  assert.deepEqual(reply, { kind: 'ack' })
  assert.equal(t.store.answerRows[0]!.usability, 'unusable')
  // Echo, acknowledgement, next question: the player sees the answer arrived.
  assert.ok(t.sent.some((s) => s.msg.content === `<@${userId}> Noted. Moving on.`))
})

void test("the judge's second line: an 'offlimits' verdict takes the echo down, reopens the question, stores nothing, adds no feud points", async () => {
  const m = pressModel([{ usability: 'offlimits', chase: 'none', followUp: '', closing: '' }])
  const t = setup({ model: m.call, screen: () => Promise.resolve(strong('barlow')) })
  const { personId, p, userId } = await asked(t)
  const reply = await submit(t, personId, userId, 'A line the screen missed.')
  assert.deepEqual(reply, { kind: 'ack', offLimits: true })
  // The echo went out before the judgement and was removed again.
  assert.equal(t.sent.length, 1)
  assert.deepEqual(t.removed, ['sent-1'])
  assert.equal(t.store.answerRows.length, 0)
  assert.equal(p.status, 'asking')
  assert.equal(p.currentQuestion, 'Why?')
  assert.equal(p.lastAskedAt?.getTime(), NOW.getTime())
  assert.equal(t.store.feudRows.length, 0)
  assert.equal(m.reqs.filter((r) => r.purpose === 'review').length, 0)
  assert.ok(t.logs.some((l) => l.includes(OFFLIMITS_LOG) && l.includes('judge')))
})

// ── Feuds from scrum answers ────────────────────────────────────────────────

void test('an insult adds feud points to the reporter named, else the asker; the answer still counts', async () => {
  const m = pressModel([usable, usable])
  const t = setup({ model: m.call, screen: () => Promise.resolve(strong('quill')) })
  const a = await asked(t)
  await submit(t, a.personId, a.userId, 'mara quill has no clue')
  assert.deepEqual(
    t.store.feudRows.map((r) => [r.playerId, r.reporter, r.points]),
    [[1, 'quill', 2]],
  )
  assert.equal(t.store.answerRows.length, 1)

  const t2 = setup({ model: pressModel([usable]).call, screen: () => Promise.resolve(strong()) })
  const b = await asked(t2)
  await submit(t2, b.personId, b.userId, 'whatever you say, press')
  const asker = t2.store.feudRows[0]!.reporter
  assert.equal(asker, t2.store.people[0]!.panel[0] ?? t2.store.scrums[0]!.reporter)
})

void test('a mild insult is 1 point; a message that insults nobody adds none', async () => {
  const mild: ScreenVerdict = { offLimits: false, insult: 'mild', target: 'barlow' }
  const t = setup({ model: pressModel([usable]).call, screen: () => Promise.resolve(mild) })
  const a = await asked(t)
  await submit(t, a.personId, a.userId, 'keep your nose out of it')
  assert.deepEqual(
    t.store.feudRows.map((r) => r.points),
    [1],
  )
  const t2 = setup({ model: pressModel([usable]).call })
  const b = await asked(t2)
  await submit(t2, b.personId, b.userId, 'a plain answer')
  assert.equal(t2.store.feudRows.length, 0)
})

void test('"Go easy" (Skater B): points are stored, but the feud is never used in the prompt', async () => {
  const m = pressModel([usable])
  const t = setup({ model: m.call, screen: () => Promise.resolve(strong('barlow')) })
  const { personId, userId } = await asked(t, 2)
  // A war with every other reporter is already stored.
  for (const r of REPORTER_IDS.filter((x) => x !== 'barlow')) {
    t.store.feudRows.push({ playerId: 2, reporter: r, points: 12, lastEventAt: NOW })
  }
  await submit(t, personId, userId, 'barlow is useless')
  assert.equal(t.store.feudRows.find((r) => r.reporter === 'barlow')!.points, 2)
  const judge = m.reqs.find((r) => r.schema === JUDGEMENT_SCHEMA)!
  assert.doesNotMatch(judge.user, /feud|friction|open war/)
  assert.deepEqual(await feudsFor(t.deps, 2, 'easy'), [])
  assert.equal(await feudLevel(t.deps, 2, 'barlow', 'easy'), 'none')
})

void test('"Leave me out": nothing at all, not even points; a store without feuds changes nothing', async () => {
  const t = setup()
  await recordInsult(t.deps, {
    playerId: 4,
    reporter: 'quill',
    insult: 'strong',
    pressLevel: 'out',
    where: 'test',
  })
  assert.equal(t.store.feudRows.length, 0)
  assert.deepEqual(await feudsFor(t.deps, 4, 'out'), [])
  // A store that lacks the feud methods (an old fake): no points, level none, no throw.
  const bare = { ...t.deps, store: { ...t.store, addFeudPoints: undefined, listFeuds: undefined } }
  await recordInsult(bare as never, {
    playerId: 1,
    reporter: 'quill',
    insult: 'strong',
    pressLevel: 'full',
    where: 'test',
  })
  assert.equal(t.store.feudRows.length, 0)
  assert.equal(await feudLevel(bare as never, 1, 'quill', 'full'), 'none')
})

void test('a failing feud write is logged and never breaks the answer', async () => {
  const m = pressModel([usable])
  const t = setup({ model: m.call, screen: () => Promise.resolve(strong('barlow')) })
  t.store.failFeudWrites = true
  const { personId, userId } = await asked(t)
  const reply = await submit(t, personId, userId, 'barlow is useless')
  assert.equal(reply.kind, 'ack')
  assert.equal(t.store.answerRows.length, 1)
  assert.ok(t.logs.some((l) => l.includes('points not saved')))
})

void test('feud levels follow the points: add, fade, thresholds; the reporter prompt shows only the level', async () => {
  const t = setup()
  const add = (n: number) =>
    recordInsult(t.deps, {
      playerId: 1,
      reporter: 'mercer',
      insult: n === 1 ? 'mild' : 'strong',
      pressLevel: 'full',
      where: 'test',
    })
  assert.equal(await feudLevel(t.deps, 1, 'mercer', 'full'), 'none')
  await add(1) // 1
  assert.equal(await feudLevel(t.deps, 1, 'mercer', 'full'), 'none')
  await add(2) // 3
  assert.equal(await feudLevel(t.deps, 1, 'mercer', 'full'), 'simmering')
  await add(2) // 5
  assert.equal(await feudLevel(t.deps, 1, 'mercer', 'full'), 'feud')
  await add(2)
  await add(2) // 9
  await add(2) // 11
  assert.equal(await feudLevel(t.deps, 1, 'mercer', 'full'), 'war')
  // Two weeks later (two half-lives): 11 -> 2.75, a simmer.
  const later = { ...t.deps, now: () => new Date(NOW.getTime() + 14 * 86_400_000) }
  assert.equal(await feudLevel(later, 1, 'mercer', 'full'), 'simmering')
  const muchLater = { ...t.deps, now: () => new Date(NOW.getTime() + 60 * 86_400_000) }
  assert.equal(await feudLevel(muchLater, 1, 'mercer', 'full'), 'none')
  assert.deepEqual(panelFeudReporters(await feudsFor(t.deps, 1, 'full')), ['mercer'])
  assert.deepEqual(panelFeudReporters(await feudsFor(later, 1, 'full')), [])
})

void test('a feud shows in the next question and judgement of that reporter only', async () => {
  const m = pressModel([usable])
  const t = setup({ model: m.call })
  const { personId, p, userId } = await asked(t)
  const asker = p.panel[0] ?? t.store.scrums[0]!.reporter
  t.store.feudRows.push({ playerId: 1, reporter: asker, points: 6, lastEventAt: NOW })
  await submit(t, personId, userId, 'We got outworked in the third.')
  const judge = m.reqs.find((r) => r.schema === JUDGEMENT_SCHEMA)!
  assert.match(judge.user, /in a feud: be cool and pointed/)
  assert.match(judge.system, /never profanity, never a slur/)
  assert.match(judge.system, /professional and hockey only/)
})

void test('feud reporters are likelier on the panel at feud level and above', () => {
  const base = { size: 3, heat: 'normal' as const, disabled: [], first: null, takeReporters: [] }
  let withFeud = 0
  let without = 0
  for (let seed = 1; seed <= 600; seed++) {
    if (choosePanel({ ...base, seed, feudReporters: ['pettibone'] }).includes('pettibone')) {
      withFeud++
    }
    if (choosePanel({ ...base, seed }).includes('pettibone')) without++
  }
  assert.ok(FEUD_PANEL_WEIGHT > 1)
  assert.ok(withFeud > without * 1.2, `${String(withFeud)} vs ${String(without)}`)
})

// ── Interviews ──────────────────────────────────────────────────────────────

async function interviewAsked(t: ReturnType<typeof interviewSetup>) {
  const id = await t.store.insertInterview({
    playerId: 1,
    discordUserId: USER_A,
    reporter: 'barlow',
    trigger: 'gm',
    night: oct12Night(),
    channelId: 'chel',
    isTest: false,
    status: 'active',
  } as never)
  const iv = t.store.interviews.find((x) => x.id === id)!
  iv.status = 'active'
  iv.questionsAsked = 1
  iv.currentQuestion = 'How did the night go?'
  iv.lastAskedAt = NOW
  iv.threadId = 'iv-thread'
  return iv
}
const oct12Night = (): string => '2026-10-12'

void test('interview: an off-limits answer gets no reaction and the question stays open; an insult adds points after', async () => {
  const m = interviewModel({
    judgements: [{ usability: 'usable', chase: 'none', followUp: '', closing: 'Good talk.' }],
    questions: ['Next one?'],
  })
  const t = interviewSetup({ model: m.call })
  t.deps.screen = (text) => Promise.resolve(text === 'senator line' ? OFF : strong('barlow'))
  const iv = await interviewAsked(t)
  const seen = () => ({ questionsAsked: iv.questionsAsked, followupsAsked: iv.followupsAsked })
  const reply = await onInterviewAnswerSubmit(
    t.deps,
    config('live'),
    iv.id,
    USER_A,
    'senator line',
    seen(),
  )
  assert.deepEqual(reply, { kind: 'ack', offLimits: true })
  assert.equal(t.sent.length, 0)
  assert.equal(t.store.ivAnswers.length, 0)
  assert.equal(iv.currentQuestion, 'How did the night go?')
  assert.equal(m.reqs.length, 0)
  assert.ok(t.logs.some((l) => l.includes(OFFLIMITS_LOG)))
  assert.ok(!t.logs.some((l) => l.includes('senator line')))
  assert.equal(t.store.feudRows.length, 0)

  // A slur: no screen call, same silence.
  const slurReply = await onInterviewAnswerSubmit(
    t.deps,
    config('live'),
    iv.id,
    USER_A,
    'you n1gger',
    seen(),
  )
  assert.deepEqual(slurReply, { kind: 'ack', offLimits: true })

  // A proper (rude) answer still counts, and the insult is charged to the reporter named.
  const ok = await onInterviewAnswerSubmit(
    t.deps,
    config('live'),
    iv.id,
    USER_A,
    'barlow asks bad questions',
    seen(),
  )
  assert.equal(ok.kind, 'ack')
  assert.equal(t.store.ivAnswers.length, 1)
  assert.deepEqual(
    t.store.feudRows.map((r) => [r.playerId, r.reporter, r.points]),
    [[1, 'barlow', 2]],
  )
})

// ── Replies to wire posts ───────────────────────────────────────────────────

const ANSWER = 'Saw it. Still waiting on the next one, Skater A.'

function wireWorld(screen: MessageScreen) {
  const reqs: Parameters<ModelCall>[0][] = []
  const call: ModelCall = (req) => {
    reqs.push(req)
    const json =
      req.purpose === 'review'
        ? { ok: true, problems: [] }
        : req.schema === WIRE_REPLY_SCHEMA
          ? { answer: true, text: ANSWER }
          : undefined
    if (json === undefined) return Promise.reject(new Error('fake model: nothing scripted'))
    return Promise.resolve({
      json,
      refused: false,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 10, output_tokens: 5 },
    })
  }
  const t = setup({ model: call, response: oct12Response('game'), screen })
  const rows = withReplyStore(t.store)
  t.store.discordIds.set(4, '200000000000000004')
  const cfg = { ...config('live'), typedAnswers: true, wireReplies: true }
  return { t, rows, cfg, reqs }
}

function postFor(userId: string, chosen = true): number {
  for (let id = 20; id < 2000; id++) if (wireReplyChosen(id, userId) === chosen) return id
  throw new Error('no id')
}

function wirePost(t: ReturnType<typeof setup>, id: number): string {
  t.store.items.push(itemRow({ id, reporter: 'mercer', body: 'Skater A had 2 goals.' }))
  return `msg-${String(id)}`
}

void test('wire reply: an off-limits reply gets no answer, no claim, no model write; the log says so', async () => {
  const w = wireWorld(() => Promise.resolve(OFF))
  const target = wirePost(w.t, postFor(USER_A))
  await onWireReply(w.t.deps, w.cfg, {
    userId: USER_A,
    messageId: 'm1',
    targetMessageId: target,
    text: 'the senator would agree',
  })
  assert.equal(w.t.sent.length, 0)
  assert.equal(w.rows.length, 0)
  assert.equal(w.reqs.length, 0)
  assert.ok(w.t.logs.some((l) => l.includes(OFFLIMITS_LOG)))
  assert.ok(!w.t.logs.some((l) => l.includes('senator')))
  // A slur never reaches the screen.
  let screened = 0
  const w2 = wireWorld(() => {
    screened++
    return Promise.resolve(OK)
  })
  await onWireReply(w2.t.deps, w2.cfg, {
    userId: USER_A,
    messageId: 'm1',
    targetMessageId: wirePost(w2.t, postFor(USER_A)),
    text: 'you n1gger',
  })
  assert.equal(screened, 0)
  assert.equal(w2.t.sent.length, 0)
  assert.equal(w2.rows.length, 0)
  // Fail closed.
  const w3 = wireWorld(() => Promise.reject(new Error('api down')))
  await onWireReply(w3.t.deps, w3.cfg, {
    userId: USER_A,
    messageId: 'm1',
    targetMessageId: wirePost(w3.t, postFor(USER_A)),
    text: 'a fair reply',
  })
  assert.equal(w3.t.sent.length, 0)
  assert.equal(w3.rows.length, 0)
})

void test('wire reply: an insult counts for the feud even when the reply is not chosen; a chosen one is answered', async () => {
  const w = wireWorld(() => Promise.resolve(strong()))
  const notChosen = postFor(USER_A, false)
  await onWireReply(w.t.deps, w.cfg, {
    userId: USER_A,
    messageId: 'm1',
    targetMessageId: wirePost(w.t, notChosen),
    text: 'mercer is trash',
  })
  assert.equal(w.t.sent.length, 0)
  assert.deepEqual(
    w.t.store.feudRows.map((r) => [r.playerId, r.reporter, r.points]),
    [[1, 'mercer', 2]],
  )
  const chosen = postFor(USER_A, true)
  await onWireReply(w.t.deps, w.cfg, {
    userId: USER_A,
    messageId: 'm2',
    targetMessageId: wirePost(w.t, chosen),
    text: 'mercer is trash again',
  })
  assert.equal(w.t.sent.length, 1)
  assert.equal(w.t.store.feudRows[0]!.points, 4)
})

void test('wire reply: the feud level reaches the writer; "Go easy" and "Leave me out" never get it', async () => {
  const w = wireWorld(() => Promise.resolve(OK))
  w.t.store.feudRows.push({ playerId: 1, reporter: 'mercer', points: 12, lastEventAt: NOW })
  w.t.store.feudRows.push({ playerId: 2, reporter: 'mercer', points: 12, lastEventAt: NOW })
  await onWireReply(w.t.deps, w.cfg, {
    userId: USER_A,
    messageId: 'm1',
    targetMessageId: wirePost(w.t, postFor(USER_A)),
    text: 'a fair reply',
  })
  const write = w.reqs.find((r) => r.schema === WIRE_REPLY_SCHEMA)!
  assert.match(write.user, /at open war: be cold and sharp/)
  assert.match(write.system, /11\. Feuds: only when the request says/)
  assert.match(write.system, /never profanity, never a slur/)

  // Skater B is "Go easy": same war on file, no feud text.
  await onWireReply(w.t.deps, w.cfg, {
    userId: USER_B,
    messageId: 'm2',
    targetMessageId: wirePost(w.t, postFor(USER_B)),
    text: 'a fair reply',
  })
  const writes = w.reqs.filter((r) => r.schema === WIRE_REPLY_SCHEMA)
  assert.doesNotMatch(writes.at(-1)!.user, /open war|feud|friction/)

  // "Leave me out" (Hank): no answer, no screen, no points.
  const before = w.t.store.feudRows.length
  await onWireReply(w.t.deps, w.cfg, {
    userId: '200000000000000004',
    messageId: 'm3',
    targetMessageId: wirePost(w.t, postFor('200000000000000004')),
    text: 'mercer is trash',
  })
  assert.equal(w.t.store.feudRows.length, before)
})

// ── Messages in a press thread that are not answers ─────────────────────────

void test('codeInsult: a reporter named plus a rude or crude word; never a slur, never a name alone', () => {
  assert.deepEqual(codeInsult('fuck u wade'), { reporter: 'barlow', insult: 'strong' })
  assert.deepEqual(codeInsult('#FuckMaraQuill'), { reporter: 'quill', insult: 'strong' })
  assert.deepEqual(codeInsult('gord ur an asshole'), { reporter: 'pettibone', insult: 'strong' })
  assert.deepEqual(codeInsult('Dex Mercer is useless'), { reporter: 'mercer', insult: 'mild' })
  assert.equal(codeInsult('thanks wade, good question'), null)
  assert.equal(codeInsult('this is useless'), null)
  assert.equal(codeInsult('wade you n1gger'), null)
  assert.equal(codeInsult('I love june in the playoffs, great month'), null)
})

void test('a non-answer message in a press thread adds feud points; in any other thread, nothing', async () => {
  const t = setup()
  await scrumWithPerson(t, 1)
  t.store.scrums[0]!.threadId = 'thread-1'
  const cfg = config('live')
  // No question is open for this user.
  await onThreadMessage(t.deps, cfg, {
    threadId: 'thread-1',
    userId: USER_A,
    text: 'gord ur an asshole',
  })
  assert.deepEqual(
    t.store.feudRows.map((r) => [r.playerId, r.reporter, r.points]),
    [[1, 'pettibone', 2]],
  )
  assert.equal(t.sent.length, 0)
  assert.equal(t.modelCalls.length, 0)
  // Some other thread of the guild: none.
  await onThreadMessage(t.deps, cfg, {
    threadId: 'elsewhere',
    userId: USER_A,
    text: 'gord ur an asshole',
  })
  assert.equal(t.store.feudRows[0]!.points, 2)
  // A slur: no reaction, no points.
  await onThreadMessage(t.deps, cfg, {
    threadId: 'thread-1',
    userId: USER_A,
    text: 'gord you n1gger',
  })
  assert.equal(t.store.feudRows[0]!.points, 2)
  // "Leave me out" (Hank) and an unlinked user: none.
  t.store.discordIds.set(4, '200000000000000004')
  await onThreadMessage(t.deps, cfg, {
    threadId: 'thread-1',
    userId: '200000000000000004',
    text: 'fuck u wade',
  })
  await onThreadMessage(t.deps, cfg, {
    threadId: 'thread-1',
    userId: '200000000000000009',
    text: 'fuck u wade',
  })
  assert.equal(t.store.feudRows.length, 1)
  // "Go easy" (Skater B): points may be stored.
  await onThreadMessage(t.deps, cfg, { threadId: 'thread-1', userId: USER_B, text: 'fuck u wade' })
  assert.deepEqual(t.store.feudRows.map((r) => r.playerId).sort(), [1, 2])
  // Never answered, stored as an answer or logged with the text.
  assert.equal(t.store.answerRows.length, 0)
  assert.ok(!t.logs.some((l) => l.includes('asshole')))
})
