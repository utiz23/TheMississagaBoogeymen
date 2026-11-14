import test from 'node:test'
import assert from 'node:assert/strict'
import type { ReporterId } from '@eanhl/db/news'
import { escapeMarkdown } from '../message.ts'
import type { ModelCall } from '../news/writer.ts'
import { JUDGEMENT_SCHEMA, QUESTION_SCHEMA } from './asker.ts'
import { onAccept, onAnswerSubmit, onTalk, onTypedAnswer } from './interactions.ts'
import { runPressPass } from './pass.ts'
import {
  NOW,
  USER_A,
  USER_B,
  config,
  isPoolLine,
  liveRecap,
  scrumWithPerson,
  setup,
} from './test-fakes.ts'

/**
 * Panel scrums (task T2): 3 reporters per picked player (2 per volunteer),
 * follow-ups to reach the drawn target, no silent answers, variety across
 * players, typed answers for every reporter of a panel, and the GM's first
 * question. The unit rules are in rules.test.ts.
 */

const live = config('live')

interface Judge {
  usability?: string
  chase?: string
  followUp?: string
  closing?: string
}

/**
 * A fake model. Questions come in order (`Q<n>` when the script runs out).
 * Judgements: `judge(n)` for the n-th judgement (0-based); every review passes.
 */
function model(
  opts: { questions?: string[]; judge?: (n: number) => Judge; failJudgement?: boolean } = {},
) {
  const questions = [...(opts.questions ?? [])]
  const reqs: Parameters<ModelCall>[0][] = []
  let judgements = 0
  let asked = 0
  const call: ModelCall = (req) => {
    reqs.push(req)
    let json: unknown
    if (req.purpose === 'review') json = { ok: true, problems: [] }
    else if (req.schema === JUDGEMENT_SCHEMA) {
      if (opts.failJudgement === true) return Promise.reject(new Error('model down'))
      const j = opts.judge?.(judgements++) ?? {}
      json = {
        usability: j.usability ?? 'usable',
        chase: j.chase ?? 'none',
        followUp: j.followUp ?? '',
        closing: j.closing ?? 'Thanks.',
      }
    } else if (req.schema === QUESTION_SCHEMA) {
      json = { question: questions.shift() ?? `Skater A, question ${String(++asked)}?` }
    }
    return Promise.resolve({
      json,
      refused: false,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 10, output_tokens: 5 },
    })
  }
  const questionCalls = () => reqs.filter((r) => r.schema === QUESTION_SCHEMA)
  return { call, reqs, questionCalls }
}

function withPanel(
  t: ReturnType<typeof setup>,
  id: number,
  panel: ReporterId[],
  targetTotal: number | null,
): void {
  const p = t.store.people.find((x) => x.id === id)!
  p.panel = panel
  p.targetTotal = targetTotal
}

/** Answer whatever is open (pop-up path), as the person. */
function answer(t: ReturnType<typeof setup>, personId: number, userId: string, text: string) {
  const p = t.store.people.find((x) => x.id === personId)!
  return onAnswerSubmit(t.deps, live, personId, userId, text, {
    questionsAsked: p.questionsAsked,
    followupsAsked: p.followupsAsked,
  })
}

/** Answer until the round is done; returns the items posted with a button (questions and follow-ups). */
async function runRound(t: ReturnType<typeof setup>, personId: number, userId: string) {
  const p = t.store.people.find((x) => x.id === personId)!
  for (let i = 0; i < 12 && p.status === 'asking'; i++) {
    await answer(t, personId, userId, `We did our best, answer ${String(i)}.`)
  }
  assert.equal(p.status, 'done')
  return t.sent.filter(
    (s) => s.msg.components !== undefined && s.msg.content.startsWith(`<@${userId}>`),
  )
}

// ── The panel: 3 different reporters, made at the first question ────────────

void test('a picked player is asked by 3 different reporters, the scrum reporter first; the panel is stored', async () => {
  const t = setup({ model: model().call })
  const personId = await scrumWithPerson(t)
  const scrumReporter = t.store.scrums[0]!.reporter
  await onAccept(t.deps, live, personId, USER_A)
  const p = t.store.people[0]!
  assert.equal(p.panel.length, 3)
  assert.equal(new Set(p.panel).size, 3)
  assert.ok(!p.panel.includes('rink'))
  assert.equal(p.panel[0], scrumReporter)
  assert.ok(p.targetTotal !== null && p.targetTotal >= 3 && p.targetTotal <= 6)
  // Question 1 is posted by the first reporter of the panel.
  assert.equal(t.sent.at(-1)!.reporter, p.panel[0])
  // Made once: a later question reads the stored panel.
  const stored = [...p.panel]
  await answer(t, personId, USER_A, 'We did our best.')
  assert.deepEqual(p.panel, stored)
  assert.equal(t.sent.at(-1)!.reporter, stored[1])
})

void test('a disabled reporter is never on a panel', async () => {
  const t = setup({ model: model().call })
  const personId = await scrumWithPerson(t)
  t.store.disabled = ['mercer', 'vale', 'quill']
  await onAccept(t.deps, live, personId, USER_A)
  const panel = t.store.people[0]!.panel
  assert.equal(panel.length, 3)
  for (const id of ['mercer', 'vale', 'quill'] as const) {
    if (id !== t.store.scrums[0]!.reporter) assert.ok(!panel.includes(id), id)
  }
})

void test('a volunteer: 2 reporters, no follow-up even when the model offers and the answer is strong', async () => {
  const m = model({
    judge: () => ({ chase: 'strong', followUp: 'Why though?', closing: 'Thanks.' }),
  })
  const t = setup({ model: m.call })
  liveRecap(t.store)
  await runPressPass(t.deps, live)
  await onTalk(t.deps, live, 10, USER_B)
  const p = t.store.people[0]!
  const items = await runRound(t, p.id, USER_B)
  assert.equal(p.panel.length, 2)
  assert.equal(items.length, 2)
  assert.deepEqual(
    items.map((s) => s.reporter),
    p.panel,
  )
  assert.equal(p.followupsAsked, 0)
})

// ── The target total: follow-ups fill the gap, by the same reporter ─────────

for (const target of [3, 4, 5, 6]) {
  void test(`target ${String(target)}: questions plus follow-ups reach it; a follow-up is by the reporter who asked`, async () => {
    // Every answer is usable and the model always offers a follow-up, with no chase at all:
    // the follow-ups still come when the target needs them.
    const m = model({ judge: () => ({ chase: 'none', followUp: 'And why is that?' }) })
    const t = setup({ model: m.call })
    const personId = await scrumWithPerson(t)
    withPanel(t, personId, ['voss', 'mercer', 'vale'], target)
    await onAccept(t.deps, live, personId, USER_A)
    const items = await runRound(t, personId, USER_A)
    assert.equal(items.length, target)
    const p = t.store.people[0]!
    assert.equal(p.questionsAsked, 3)
    assert.equal(p.followupsAsked, target - 3)
    // At most one follow-up per reporter, each by the reporter of the question before it.
    const by = items.map((s) => s.reporter)
    for (const id of ['voss', 'mercer', 'vale'] as const) {
      assert.ok(by.filter((r) => r === id).length <= 2, id)
    }
    assert.deepEqual(
      t.store.answerRows.map((a) => a.reporter),
      by,
    )
    assert.equal(t.store.answerRows.length, target)
    // Order: a reporter's follow-up comes right after their question, before the next reporter.
    const firstOf = (id: ReporterId) => by.indexOf(id)
    assert.ok(firstOf('voss') < firstOf('mercer') && firstOf('mercer') < firstOf('vale'))
    assert.deepEqual(
      by,
      [...by].sort((a, b) => firstOf(a) - firstOf(b)),
    )
  })
}

void test('follow-ups go to the answers with the most to chase (target 4: only the strong one)', async () => {
  const m = model({
    judge: (n) =>
      n === 1
        ? { chase: 'strong', followUp: 'And the second goal?' }
        : { chase: 'some', followUp: 'And?' },
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  withPanel(t, personId, ['voss', 'mercer', 'vale'], 4)
  await onAccept(t.deps, live, personId, USER_A)
  const items = await runRound(t, personId, USER_A)
  assert.equal(items.length, 4)
  // Judgements: 0 = Q1 (some: none), 1 = Q2 (strong: its follow-up), 2 = the follow-up, 3 = Q3.
  assert.ok(items.some((s) => s.msg.content.includes('And the second goal?')))
  assert.equal(items[2]!.reporter, 'mercer')
  assert.equal(items[1]!.reporter, 'mercer')
  assert.ok(!items.some((s) => s.msg.content.endsWith(' And?')))
})

void test('never a follow-up after an unusable answer: the round is shorter when the target cannot be reached', async () => {
  // Target 6, but the first two answers are unusable: only Vale's can be chased.
  const m = model({
    judge: (n) =>
      n < 2 ? { usability: 'unusable', followUp: 'Tell me more?' } : { followUp: 'Why?' },
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  withPanel(t, personId, ['voss', 'mercer', 'vale'], 6)
  await onAccept(t.deps, live, personId, USER_A)
  const items = await runRound(t, personId, USER_A)
  const p = t.store.people[0]!
  assert.equal(p.followupsAsked, 1)
  assert.equal(items.length, 4)
  assert.ok(!t.sent.some((s) => s.msg.content.includes('Tell me more?')))
  assert.deepEqual(
    t.store.answerRows.map((a) => a.usability),
    ['unusable', 'unusable', 'usable', 'usable'],
  )
})

void test('an answer to a follow-up never gets another follow-up (one per reporter)', async () => {
  const m = model({ judge: () => ({ chase: 'strong', followUp: 'Why?' }) })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  withPanel(t, personId, ['voss', 'mercer', 'vale'], 6)
  await onAccept(t.deps, live, personId, USER_A)
  const items = await runRound(t, personId, USER_A)
  assert.equal(items.length, 6)
  // Q, FU, Q, FU, Q, FU: no two follow-ups in a row.
  assert.deepEqual(
    items.map((s) => s.msg.content.includes('Why?')),
    [false, true, false, true, false, true],
  )
})

// ── No silent answers ───────────────────────────────────────────────────────

void test('an unusable answer is acknowledged by its reporter before the next reporter asks; its words are never repeated', async () => {
  const bad = 'Look listen here pett-a-bone i dont like your tone, this will end here'
  const m = model({
    judge: (n) =>
      n === 0
        ? { usability: 'unusable', closing: 'Noted, Skater A. I will leave that one there.' }
        : {},
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  withPanel(t, personId, ['voss', 'mercer', 'vale'], 3)
  await onAccept(t.deps, live, personId, USER_A)
  const before = t.sent.length
  await answer(t, personId, USER_A, bad)
  const lines = t.sent.slice(before)
  assert.equal(lines.length, 3)
  // The player sees their own answer at once (operator, 2026-11-13)...
  assert.equal(lines[0]!.msg.content, `**Skater A:** ${escapeMarkdown(bad)}`)
  // ...then the acknowledgement, in the asking reporter's own post, with no button...
  assert.equal(lines[1]!.reporter, 'voss')
  assert.equal(lines[1]!.msg.content, `<@${USER_A}> Noted, Skater A. I will leave that one there.`)
  assert.equal(lines[1]!.msg.components, undefined)
  assert.deepEqual(lines[1]!.msg.allowed_mentions, { parse: [], users: [USER_A] })
  // ...then the next reporter's question.
  assert.equal(lines[2]!.reporter, 'mercer')
  assert.notEqual(lines[2]!.msg.components, undefined)
  // The acknowledgement never repeats the answer; the answer is stored unusable.
  assert.ok(!lines[1]!.msg.content.includes('tone'))
  assert.equal(t.store.answerRows[0]!.usability, 'unusable')
})

void test('an answer the code marked unusable (forbidden name) gets the fixed acknowledgement; no model call for it', async () => {
  const m = model()
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  withPanel(t, personId, ['voss', 'mercer', 'vale'], 3)
  await onAccept(t.deps, live, personId, USER_A)
  const calls = m.reqs.length
  const before = t.sent.length
  await answer(t, personId, USER_A, 'Hidden Hank was in net for them.')
  // Only question 2 was written (a write and its review); nothing was judged.
  assert.equal(m.reqs.length, calls + 2)
  assert.equal(m.reqs.filter((r) => r.schema === JUDGEMENT_SCHEMA).length, 0)
  const lines = t.sent.slice(before)
  // No echo: the code refuses an answer that names a forbidden person. The fixed line is
  // from Talia Voss's own acknowledgement pool.
  assert.equal(lines.length, 2)
  assert.ok(isPoolLine('ack', lines[0]!, USER_A), lines[0]!.msg.content)
  assert.equal(lines[0]!.reporter, 'voss')
  assert.equal(lines[1]!.reporter, 'mercer')
  assert.ok(!t.sent.some((s) => s.msg.content.includes('Hidden Hank')))
})

void test('a judgement that failed closed is still acknowledged (fixed line), and the round goes on', async () => {
  const m = model({ failJudgement: true })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  withPanel(t, personId, ['voss', 'mercer', 'vale'], 3)
  await onAccept(t.deps, live, personId, USER_A)
  const before = t.sent.length
  await answer(t, personId, USER_A, 'We just ran out of gas.')
  const lines = t.sent.slice(before)
  assert.equal(lines[0]!.msg.content, '**Skater A:** We just ran out of gas.')
  assert.ok(isPoolLine('ack', lines[1]!, USER_A), lines[1]!.msg.content)
  assert.equal(lines[2]!.reporter, 'mercer')
  assert.ok(t.logs.some((l) => l.includes('judgement failed closed')))
})

void test('the last answer unusable: the closing line is the acknowledgement (no extra line)', async () => {
  const m = model({
    judge: (n) =>
      n === 2 ? { usability: 'unusable', closing: 'Fair enough, thanks Skater A.' } : {},
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  withPanel(t, personId, ['voss', 'mercer', 'vale'], 3)
  await onAccept(t.deps, live, personId, USER_A)
  await answer(t, personId, USER_A, 'one')
  await answer(t, personId, USER_A, 'two')
  const before = t.sent.length
  await answer(t, personId, USER_A, 'three')
  const lines = t.sent.slice(before)
  assert.equal(lines.length, 2)
  assert.equal(lines[0]!.msg.content, '**Skater A:** three')
  assert.equal(lines[1]!.msg.content, `<@${USER_A}> Fair enough, thanks Skater A.`)
  assert.equal(lines[1]!.reporter, 'vale')
  assert.equal(t.store.people[0]!.status, 'done')
})

void test('a failed acknowledgement post is logged; the next question still goes out', async () => {
  const m = model({
    judge: (n) => (n === 0 ? { usability: 'unusable', closing: 'Moving on.' } : {}),
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  withPanel(t, personId, ['voss', 'mercer', 'vale'], 3)
  await onAccept(t.deps, live, personId, USER_A)
  t.failSendWhen((s) => s.msg.content.endsWith('Moving on.'))
  await answer(t, personId, USER_A, 'x')
  assert.ok(t.logs.some((l) => l.includes('acknowledgement failed')))
  assert.equal(t.sent.at(-1)!.reporter, 'mercer')
  assert.equal(t.store.people[0]!.questionsAsked, 2)
})

void test('a usable answer gets no acknowledgement line (the next question follows)', async () => {
  const t = setup({ model: model().call })
  const personId = await scrumWithPerson(t)
  withPanel(t, personId, ['voss', 'mercer', 'vale'], 3)
  await onAccept(t.deps, live, personId, USER_A)
  const before = t.sent.length
  await answer(t, personId, USER_A, 'A real answer.')
  // The echo of the answer, then the next question: no acknowledgement in between.
  const lines = t.sent.slice(before)
  assert.equal(lines.length, 2)
  assert.ok(lines[0]!.msg.content.startsWith('**Skater A:**'))
  assert.equal(lines[1]!.reporter, 'mercer')
})

// ── Typed answers keep working for every reporter of the panel ──────────────

void test('typed answers count for each reporter of the panel, in the shared thread', async () => {
  const t = setup({ model: model().call })
  const personId = await scrumWithPerson(t)
  withPanel(t, personId, ['voss', 'mercer', 'vale'], 3)
  await onAccept(t.deps, live, personId, USER_A)
  const thread = t.store.scrums[0]!.threadId!
  for (const _ of [1, 2, 3]) {
    await onTypedAnswer(t.deps, live, {
      threadId: thread,
      userId: USER_A,
      text: 'Typed in the thread.',
    })
  }
  assert.deepEqual(
    t.store.answerRows.map((a) => a.reporter),
    ['voss', 'mercer', 'vale'],
  )
  assert.equal(t.store.people[0]!.status, 'done')
  // A typed answer is already in the thread: it is not echoed.
  assert.ok(!t.sent.some((s) => s.msg.content.startsWith('**Skater A:**')))
  // One thread for the scrum, opened once.
  assert.equal(t.threads.length, 1)
})

// ── Variety across the players of one scrum ─────────────────────────────────

void test('the questions put to other players are passed to the question writer (no repeated angle)', async () => {
  const m = model({
    questions: ['Skater A, what about the hits?', 'Skater B, how did the third period feel?'],
  })
  const t = setup({ model: m.call })
  const aId = await scrumWithPerson(t)
  withPanel(t, aId, ['voss', 'mercer', 'vale'], 3)
  await onAccept(t.deps, live, aId, USER_A)
  const bId = await t.store.insertScrumPerson({
    scrumId: 1,
    playerId: 2,
    discordUserId: USER_B,
    role: 'picked',
    requestedBy: 'auto',
    pingedAt: NOW,
  })
  withPanel(t, bId!, ['halberd', 'quill', 'bergstrom'], 3)
  await onAccept(t.deps, live, bId!, USER_B)
  const [first, second] = m.questionCalls()
  // The first player's question had nothing to avoid.
  assert.ok(!first!.user.includes('already put to other players'))
  // The second player's writer sees the first player's open question, and the ban.
  assert.match(second!.user, /Questions already put to other players in this scrum/)
  assert.match(second!.user, /- Skater A, what about the hits\?/)
  assert.match(second!.user, /never ask about the same moment, stat, number or angle/)
})

// ── The GM's first question ─────────────────────────────────────────────────

function gmAsk(
  t: ReturnType<typeof setup>,
  over: Partial<{
    playerId: number
    question: string
    exact: boolean
    reporter: ReporterId | null
  }> = {},
) {
  t.store.askRows.push({
    id: t.store.askRows.length + 1,
    matchId: t.store.scrums[0]!.matchId,
    night: t.store.scrums[0]!.night,
    playerId: over.playerId ?? 1,
    question: over.question ?? 'Why are you so pissy tonight?',
    exact: over.exact ?? true,
    reporter: 'reporter' in over ? (over.reporter ?? null) : 'pettibone',
    status: 'active',
    refusal: null,
    requestedByUserId: '100000000000000001',
    isTest: false,
    createdAt: NOW,
  })
}

void test('GM ask, exact: the chosen reporter asks the GM question word for word as question 1; no model call for it', async () => {
  const m = model()
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  gmAsk(t, { question: 'Why are you so pissy tonight?', reporter: 'pettibone' })
  await onAccept(t.deps, live, personId, USER_A)
  const p = t.store.people[0]!
  // The chosen reporter is part of the panel, and first.
  assert.equal(p.panel[0], 'pettibone')
  assert.equal(p.panel.length, 3)
  assert.equal(new Set(p.panel).size, 3)
  const q1 = t.sent.at(-1)!
  assert.equal(q1.reporter, 'pettibone')
  assert.equal(q1.msg.content, `<@${USER_A}> Why are you so pissy tonight?`)
  assert.equal(p.currentQuestion, 'Why are you so pissy tonight?')
  // Word for word: the model wrote no question.
  assert.equal(m.questionCalls().length, 0)
  // Question 2 is the model's, from the next reporter; the GM question is not asked again.
  await answer(t, personId, USER_A, 'Because we lost.')
  assert.equal(m.questionCalls().length, 1)
  assert.equal(t.sent.at(-1)!.reporter, p.panel[1])
  assert.ok(!t.sent.at(-1)!.msg.content.includes('pissy'))
  assert.equal(t.store.answerRows[0]!.reporter, 'pettibone')
})

void test('GM ask, exact, no reporter chosen: the first reporter of the panel (the scrum reporter) asks', async () => {
  const t = setup({ model: model().call })
  const personId = await scrumWithPerson(t)
  gmAsk(t, { reporter: null, question: 'What was that pass in the second?' })
  await onAccept(t.deps, live, personId, USER_A)
  const p = t.store.people[0]!
  assert.equal(p.panel[0], t.store.scrums[0]!.reporter)
  assert.equal(t.sent.at(-1)!.reporter, t.store.scrums[0]!.reporter)
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> What was that pass in the second?`)
})

void test('GM ask as a topic: the reporter writes the question in their own voice from it, as question 1', async () => {
  const m = model({ questions: ['Skater A, what was going on in the corners tonight?'] })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  gmAsk(t, { exact: false, question: 'the corner battles', reporter: 'vale' })
  await onAccept(t.deps, live, personId, USER_A)
  const [qCall] = m.questionCalls()
  assert.match(qCall!.user, /ask Skater A about this topic, in your own words and your own voice/)
  assert.match(qCall!.user, /the corner battles/)
  // It is written as Rico Vale (his voice is in the system prompt).
  assert.match(qCall!.system, /Rico Vale/)
  assert.equal(t.sent.at(-1)!.reporter, 'vale')
  assert.equal(
    t.sent.at(-1)!.msg.content,
    `<@${USER_A}> Skater A, what was going on in the corners tonight?`,
  )
  assert.equal(t.store.people[0]!.panel[0], 'vale')
  // The topic is for question 1 only.
  await answer(t, personId, USER_A, 'Corners were ugly.')
  assert.ok(!m.questionCalls()[1]!.user.includes('the corner battles'))
})

void test('GM ask: an exact question that names a forbidden person is not posted word for word', async () => {
  const m = model({ questions: ['Skater A, how did the game feel?'] })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  gmAsk(t, { question: 'Did Hidden Hank bother you?' })
  await onAccept(t.deps, live, personId, USER_A)
  assert.ok(!t.sent.some((s) => s.msg.content.includes('Hidden Hank')))
  assert.ok(t.logs.some((l) => l.includes("the GM's question names a forbidden person")))
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> Skater A, how did the game feel?`)
})

void test("GM ask for another player does not change this player's first question", async () => {
  const m = model({ questions: ['Skater A, how did it feel?'] })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  gmAsk(t, { playerId: 2, question: 'Only for B?' })
  await onAccept(t.deps, live, personId, USER_A)
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> Skater A, how did it feel?`)
})

void test('a GM request is a picked player: 3 reporters, and the GM question is not a volunteer round', async () => {
  const t = setup({ model: model().call })
  const personId = await scrumWithPerson(t)
  const p = t.store.people[0]!
  p.requestedBy = 'gm'
  gmAsk(t, { reporter: 'halberd' })
  await onAccept(t.deps, live, personId, USER_A)
  assert.equal(p.role, 'picked')
  assert.equal(p.panel.length, 3)
  assert.equal(p.panel[0], 'halberd')
})

// ── A failed reply line no longer costs the verdict (Lead, 2026-11-13) ───────

void test('the reply line fails all 4 tries: a usable answer stays usable; a neutral pool line is posted; the reason is logged without the answer', async () => {
  const answer = 'Pucks in deep forecheck and then we got tired late'
  // Always a usable verdict, but the closing names another teammate every time.
  const m = model({ judge: () => ({ usability: 'usable', closing: 'Skater B, 7?' }) })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  withPanel(t, personId, ['voss', 'mercer', 'vale'], 3)
  await onAccept(t.deps, live, personId, USER_A)
  await answer_(t, personId, answer)
  await answer_(t, personId, 'second')
  const before = t.sent.length
  await answer_(t, personId, 'third')
  // The verdict of the model stands (usable, quotable), for every answer.
  assert.deepEqual(
    t.store.answerRows.map((a) => a.usability),
    ['usable', 'usable', 'usable'],
  )
  // The round ends with a neutral closing from Rico Vale's own pool.
  const closing = t.sent.slice(before).at(-1)!
  assert.equal(closing.reporter, 'vale')
  assert.ok(isPoolLine('closing', closing, USER_A), closing.msg.content)
  const logged = t.logs.filter((l) => l.includes("the model's verdict is kept"))
  assert.equal(logged.length, 3)
  assert.ok(logged.every((l) => l.includes('failed after 4 writes')))
  assert.ok(logged.every((l) => !l.includes('forecheck')))
})

void test('fallback lines are never the same twice in one thread', async () => {
  // Every judgement fails closed and every question write fails: all lines are fixed lines.
  const t = setup({ model: model({ failJudgement: true }).call })
  const personId = await scrumWithPerson(t)
  // A pinged player: the thread starts from the ping, so no step-up line is posted.
  t.store.people.find((x) => x.id === personId)!.pingMessageId = 'ping-1'
  withPanel(t, personId, ['voss', 'mercer', 'vale'], 3)
  t.deps.call = () => Promise.reject(new Error('model down'))
  await onAccept(t.deps, live, personId, USER_A)
  await runRound(t, personId, USER_A)
  const lines = t.sent
    .filter((s) => s.msg.content.startsWith(`<@${USER_A}>`))
    .map((s) => s.msg.content)
  assert.equal(new Set(lines).size, lines.length, lines.join(' | '))
  // 3 questions, 2 acknowledgements and a closing, each from its own reporter's pool.
  assert.equal(lines.length, 6)
})

function answer_(t: ReturnType<typeof setup>, personId: number, text: string) {
  return answer(t, personId, USER_A, text)
}
