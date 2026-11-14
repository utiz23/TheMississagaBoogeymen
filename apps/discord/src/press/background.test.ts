import test from 'node:test'
import assert from 'node:assert/strict'
import { oct12Response } from '../news/test-fixtures.ts'
import {
  BACKGROUND_RULES,
  askBackgroundQuestion,
  backgroundQuestionProblems,
  finishBackgroundAnswer,
  lostBy,
  type BackgroundAskContext,
} from './background-ask.ts'
import { backgroundStoreOf } from './background-store.ts'
import { bgModel, bgSetup, type BgJudgement } from './background-fakes.ts'
import {
  interviewHistory,
  onGmInterview,
  onInterviewAccept,
  onInterviewAnswerSubmit,
} from './interview.ts'
import { runPressPass } from './pass.ts'
import { pressRecorder, scrumHistory, startScrumQuestion } from './question.ts'
import { GM, NOW, USER_A, USER_B, config, scrumWithPerson } from './test-fakes.ts'
import { acceptFacts, factProblems, type FactProposalContext } from '../news/background-facts.ts'
import { backgroundForSheet } from '../news/cycle.ts'
import { backgroundBlock } from '../news/prompts.ts'

// Zero real model calls: every model here is a fake (`bgModel`) that records its requests.

type T = ReturnType<typeof bgSetup>

const usable: BgJudgement = { usability: 'usable', chase: 'none', followUp: '', closing: 'Thanks.' }
const joke: BgJudgement = { usability: 'joke', chase: 'none', followUp: '', closing: 'Ha.' }
const unusableJ: BgJudgement = {
  usability: 'unusable',
  chase: 'none',
  followUp: '',
  closing: 'Noted.',
}

function answer(t: T, cfg: ReturnType<typeof config>, id: number, userId: string, text: string) {
  const r = t.store.interviews.find((x) => x.id === id)!
  const seen = { questionsAsked: r.questionsAsked, followupsAsked: r.followupsAsked }
  return onInterviewAnswerSubmit(t.deps, cfg, id, userId, text, seen)
}

/** The GM offers an interview, the player accepts: question 1 is out. */
async function startInterview(t: T, user = USER_A) {
  const cfg = config('live')
  await onGmInterview(t.deps, cfg, GM, { player: user, reporter: 'barlow', topic: null })
  await runPressPass(t.deps, cfg)
  await onInterviewAccept(t.deps, cfg, 1, user)
  return cfg
}

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf']
const ORDINARY = (n: number) => `Ordinary question ${WORDS[n - 1]!} about the night?`
const SEVEN = [1, 2, 3, 4, 6, 7].map(ORDINARY)

/** Answer all 7 items of an interview with one judgement each. */
async function runAll(t: T, cfg: ReturnType<typeof config>, user: string, texts: string[]) {
  for (const text of texts) await answer(t, cfg, 1, user, text)
}

const sentQuestions = (t: T) =>
  t.sent
    .filter((s) => s.msg.content.startsWith('<@'))
    .map((s) => s.msg.content.replace(/^<@\d+> /, ''))

// ── Interviews ───────────────────────────────────────────────────────────────

void test('interview: the switch is OFF, so no background question is asked and no fact is proposed', async () => {
  const m = bgModel({ questions: SEVEN, judgements: Array(7).fill(usable) })
  const t = bgSetup({ model: m.call })
  t.store.switchOn = false
  const cfg = await startInterview(t)
  await runAll(t, cfg, USER_A, Array(7).fill('A plain hockey answer, nothing more.'))
  assert.deepEqual(m.kinds(), { backgroundQuestions: 0, proposers: 0 })
  assert.equal(t.store.asks.length, 0)
  assert.equal(t.store.facts.length, 0)
  assert.equal(t.store.interviews[0]!.status, 'done')
})

void test('interview: at most one background question, at the 5th item; the answer proposes a fact (always proposed)', async () => {
  const m = bgModel({
    questions: SEVEN,
    background: ['What is the habit you lean on most when the game gets tight?'],
    judgements: Array(7).fill(usable),
    facts: [['Skater A leans on a hard forecheck when the game gets tight.']],
  })
  const t = bgSetup({ model: m.call })
  // The only open question is a non-teammate one, so the pick is certain.
  t.store.bank = [t.store.bank[0]!]
  const cfg = await startInterview(t)
  await runAll(t, cfg, USER_A, [
    'Answer one.',
    'Answer two.',
    'Answer three.',
    'Answer four.',
    'I lean on a hard forecheck when the game gets tight, always have.',
    'Answer six.',
    'Answer seven.',
  ])
  assert.equal(m.kinds().backgroundQuestions, 1)
  assert.equal(t.store.asks.length, 1)
  assert.equal(t.store.asks[0]!.kind, 'interview')
  assert.equal(t.store.asks[0]!.interviewId, 1)
  assert.equal(t.store.asks[0]!.subjectPlayerId, null)
  // Items 1-4, 6, 7 are the ordinary writer's; item 5 is the background question.
  const posted = sentQuestions(t).slice(1) // the first line is the offer
  assert.equal(posted[4], 'What is the habit you lean on most when the game gets tight?')
  assert.equal(posted.filter((q) => q.includes('Ordinary question')).length, 6)
  // One small request proposed one fact; it is proposed, linked to its ask and its answer.
  assert.equal(m.kinds().proposers, 1)
  assert.equal(t.store.facts.length, 1)
  assert.equal(t.store.facts[0]!.status, 'proposed')
  assert.equal(t.store.facts[0]!.askId, 1)
  assert.equal(t.store.facts[0]!.interviewAnswerId, 5)
  assert.ok(t.store.asks[0]!.answeredAt !== null)
})

void test('interview: a joke answer to a background question proposes nothing (and costs no request)', async () => {
  const m = bgModel({
    questions: SEVEN,
    background: ['What is your best habit on the ice?'],
    judgements: [usable, usable, usable, usable, joke, usable, usable],
  })
  const t = bgSetup({ model: m.call })
  t.store.bank = [t.store.bank[0]!]
  const cfg = await startInterview(t)
  await runAll(t, cfg, USER_A, [
    'One.',
    'Two.',
    'Three.',
    'Four.',
    'My best habit is being the best, obviously, ask anyone.',
    'Six.',
    'Seven.',
  ])
  assert.equal(m.kinds().backgroundQuestions, 1)
  assert.equal(m.kinds().proposers, 0)
  assert.equal(t.store.facts.length, 0)
  assert.ok(t.store.asks[0]!.answeredAt !== null, 'the ask is closed all the same')
})

void test('interview: an unusable answer to a background question proposes nothing', async () => {
  const m = bgModel({
    questions: SEVEN,
    background: ['What is your best habit on the ice?'],
    judgements: [usable, usable, usable, usable, unusableJ, usable, usable],
  })
  const t = bgSetup({ model: m.call })
  t.store.bank = [t.store.bank[0]!]
  const cfg = await startInterview(t)
  await runAll(t, cfg, USER_A, ['One.', 'Two.', 'Three.', 'Four.', 'Nope.', 'Six.', 'Seven.'])
  assert.equal(m.kinds().proposers, 0)
  assert.equal(t.store.facts.length, 0)
})

void test('interview: a teammate question is about an eligible teammate only (Go easy and Leave me out are never named); its facts are proposed with that teammate', async () => {
  const m = bgModel({
    questions: SEVEN,
    background: ['How well does Goalie G read your game when the play breaks down?'],
    judgements: Array(7).fill(usable),
    // The second fact names Skater B (Go easy): it is dropped by the code.
    facts: [
      [
        'Goalie G reads Skater A game well when the play breaks down.',
        'Skater B is a great passer.',
      ],
    ],
  })
  const t = bgSetup({ model: m.call })
  t.store.bank = [t.store.bank[1]!] // only the teammate question is open
  const cfg = await startInterview(t)
  await runAll(t, cfg, USER_A, [
    'One.',
    'Two.',
    'Three.',
    'Four.',
    'Goalie G reads my game when it breaks down, no question about it.',
    'Six.',
    'Seven.',
  ])
  assert.equal(t.store.asks.length, 1)
  assert.equal(t.store.asks[0]!.subjectPlayerId, 3, 'Goalie G: the only teammate at "full"')
  const bgReq = m.reqs.find(
    (r) => r.system.includes('BACKGROUND QUESTION RULES') && r.purpose === 'write',
  )!
  assert.match(bgReq.user, /the teammate Goalie G/)
  assert.doesNotMatch(bgReq.user, /Skater B|Hidden Hank/)
  // Only the fact that names the teammate and nobody else survives; always proposed.
  assert.equal(t.store.facts.length, 1)
  assert.equal(t.store.facts[0]!.subjectPlayerId, 3)
  assert.equal(t.store.facts[0]!.status, 'proposed')
  assert.match(t.store.facts[0]!.text, /Goalie G/)
})

void test('interview: when no teammate is at "full", a teammate question is not asked at all', async () => {
  const m = bgModel({ questions: [...SEVEN, ORDINARY(5)], judgements: Array(7).fill(usable) })
  const t = bgSetup({ model: m.call })
  t.store.bank = [t.store.bank[1]!]
  t.store.roster[2]!.pressLevel = 'easy' // Goalie G goes to Go easy; Skater B is Go easy; Hank is Leave me out
  const cfg = await startInterview(t)
  await runAll(t, cfg, USER_A, Array(7).fill('Plain answer about hockey.'))
  assert.equal(m.kinds().backgroundQuestions, 0)
  assert.equal(t.store.asks.length, 0)
})

void test('interview: an answer to a teammate question is never offered to a writer (not in history, not in the article)', async () => {
  const SECRET = 'ZEBRA-TEAMMATE-ANSWER Goalie G is the best at hockey'
  const m = bgModel({
    questions: SEVEN,
    background: ['How well does Goalie G read your game when the play breaks down?'],
    judgements: Array(7).fill(usable),
    facts: [[]],
  })
  const t = bgSetup({ model: m.call })
  t.store.bank = [t.store.bank[1]!]
  const cfg = await startInterview(t)
  await runAll(t, cfg, USER_A, ['One.', 'Two.', 'Three.', 'Four.', SECRET, 'Six.', 'Seven.'])
  // The ordinary writer's next question (item 6) never saw the answer text.
  const later = m.reqs.filter(
    (r) =>
      r.purpose === 'write' &&
      !r.system.includes('BACKGROUND QUESTION RULES') &&
      r.user.includes('Task: ask question 6'),
  )
  assert.ok(later.length > 0)
  for (const r of later) assert.doesNotMatch(r.user, /ZEBRA-TEAMMATE-ANSWER/)
  // The stored list marks it, and the history builder turns it into "no usable answer".
  const stored = await t.store.listInterviewAnswers(1)
  assert.equal(stored.find((a) => a.answer === SECRET)?.aboutTeammate, true)
  const history = interviewHistory(stored)
  assert.equal(history.find((h) => h.question.includes('Goalie G'))?.answer, null)
})

void test('interview: a Go easy person is never asked a question for the bad side; a plain one still is', async () => {
  const m = bgModel({
    questions: SEVEN,
    background: ['What is your best habit on the ice?'],
    judgements: Array(7).fill(usable),
    facts: [[]],
  })
  const t = bgSetup({ model: m.call })
  t.store.bank = [
    {
      id: 10,
      part: 'hockey',
      question: 'What does a classic bad {name} game look like?',
      aboutTeammate: false,
    },
    { id: 11, part: 'hockey', question: 'What is the best habit of {name}?', aboutTeammate: false },
  ]
  const cfg = await startInterview(t, USER_B) // Skater B is at Go easy
  await runAll(t, cfg, USER_B, Array(7).fill('Plain answer about hockey.'))
  const bgReq = m.reqs.find(
    (r) => r.system.includes('BACKGROUND QUESTION RULES') && r.purpose === 'write',
  )!
  assert.match(bgReq.user, /best habit of Skater B/)
  assert.doesNotMatch(bgReq.user, /classic bad/)
  assert.equal(t.store.asks[0]!.questionId, 11)
})

void test('writers: the ordinary interview question writer sees the CONFIRMED background only; a proposed fact never reaches a prompt', async () => {
  const m = bgModel({
    questions: SEVEN,
    background: ['What is your best habit on the ice?'],
    judgements: Array(7).fill(usable),
    facts: [['Skater A plays the slot hard and shoots first.']],
  })
  const t = bgSetup({ model: m.call })
  t.store.bank = [t.store.bank[0]!]
  t.store.confirmed = [{ part: 'hockey', text: 'CONFIRMED-FACT plays centre on the first line.' }]
  const cfg = await startInterview(t)
  await runAll(t, cfg, USER_A, Array(7).fill('A hockey answer about the slot and shooting first.'))
  const ordinary = m.reqs.filter(
    (r) =>
      r.purpose === 'write' &&
      !r.system.includes('BACKGROUND QUESTION RULES') &&
      r.user.includes('Task: ask question'),
  )
  assert.ok(ordinary.length > 0)
  for (const r of ordinary) assert.match(r.user, /CONFIRMED-FACT plays centre/)
  // The proposed fact (stored by the fake) never appears in any later request.
  assert.equal(t.store.facts.length, 1)
  for (const r of m.reqs.slice(
    m.reqs.findIndex((x) => 'facts' in ((x.schema as { properties?: object }).properties ?? {})) +
      1,
  )) {
    assert.doesNotMatch(r.user, /shoots first/)
  }
})

void test('Leave me out: no background question is planned for that person', async () => {
  const m = bgModel({ background: ['x?'] })
  const t = bgSetup({ model: m.call })
  const bs = backgroundStoreOf(t.deps.store)!
  const { planBackgroundQuestion } = await import('./background-ask.ts')
  const res = oct12Response('night')
  const plan = await planBackgroundQuestion(t.deps, bs, {
    kind: 'interview',
    by: { interviewId: 1 },
    playerId: 4, // Hidden Hank, Leave me out
    name: 'Hidden Hank',
    pressLevel: 'full',
    isTest: false,
    seed: 1,
    reporter: 'barlow',
    res,
    history: [],
    record: pressRecorder(t.store),
  })
  assert.equal(plan, null)
  assert.equal(m.reqs.length, 0)
})

// ── The answer step (proposed facts) ─────────────────────────────────────────

async function withAsk(
  t: T,
  over: { subject?: number | null; isTest?: boolean; player?: number } = {},
) {
  const id = await t.store.insertBackgroundAsk({
    questionId: over.subject === undefined || over.subject === null ? 1 : 2,
    playerId: over.player ?? 1,
    subjectPlayerId: over.subject ?? null,
    kind: 'interview',
    interviewId: 1,
    isTest: over.isTest ?? false,
    at: NOW,
  })
  return id!
}

const finish = (
  t: T,
  m: ReturnType<typeof bgModel>,
  over: Partial<Parameters<typeof finishBackgroundAnswer>[3]> = {},
) =>
  finishBackgroundAnswer(t.deps, config('live'), backgroundStoreOf(t.deps.store)!, {
    by: { interviewId: 1 },
    answerId: { interviewAnswerId: 9 },
    usability: 'usable',
    question: 'What is your best habit?',
    answer: 'I play the slot hard and shoot first.',
    forbiddenNames: ['Hidden Hank'],
    record: pressRecorder(t.store),
    ...over,
  }).then((r) => ({ r, m }))

void test('answer step: a usable answer proposes facts; a second call for the same ask does nothing', async () => {
  const m = bgModel({ facts: [['Skater A plays the slot hard and shoots first.']] })
  const t = bgSetup({ model: m.call })
  await withAsk(t)
  const a = await finish(t, m)
  assert.deepEqual(a.r, { proposed: 1 })
  const again = await finish(t, m)
  assert.equal(again.r, null)
  assert.equal(m.kinds().proposers, 1)
  assert.equal(t.store.facts.length, 1)
  assert.equal(t.store.facts[0]!.status, 'proposed')
  // The cost is recorded (the monthly spend), and the budget is checked first.
  assert.equal(t.store.usage.length, 1)
})

void test('answer step: nothing from a joke, an unusable, a crude, a test or an over-budget answer', async () => {
  for (const over of [
    { usability: 'joke' as const },
    { usability: 'unusable' as const },
    { answer: 'I play the damn slot and shit like that, fuck' },
  ]) {
    const m = bgModel({ facts: [['Skater A plays the slot.']] })
    const t = bgSetup({ model: m.call })
    await withAsk(t)
    await finish(t, m, over)
    assert.equal(m.kinds().proposers, 0, JSON.stringify(over))
    assert.equal(t.store.facts.length, 0)
  }
  // A test row.
  {
    const m = bgModel({ facts: [['Skater A plays the slot.']] })
    const t = bgSetup({ model: m.call })
    await withAsk(t, { isTest: true })
    await finish(t, m)
    assert.equal(m.kinds().proposers, 0)
    assert.equal(t.store.facts.length, 0)
  }
  // The extras budget is spent (80% of the month): the check runs before the request.
  {
    const m = bgModel({ facts: [['Skater A plays the slot.']] })
    const t = bgSetup({ model: m.call })
    t.store.spend = 19
    await withAsk(t)
    await finish(t, m)
    assert.equal(m.kinds().proposers, 0)
    assert.equal(t.store.facts.length, 0)
  }
})

void test('answer step: nothing for a Leave me out owner, and nothing about a teammate who moved off "full" since the ask', async () => {
  {
    const m = bgModel({ facts: [['Hidden Hank plays the slot.']] })
    const t = bgSetup({ model: m.call })
    await withAsk(t, { player: 4 })
    await finish(t, m, { forbiddenNames: [] })
    assert.equal(m.kinds().proposers, 0)
  }
  {
    const m = bgModel({ facts: [['Goalie G reads Skater A game well.']] })
    const t = bgSetup({ model: m.call })
    await withAsk(t, { subject: 3 })
    t.store.roster[2]!.pressLevel = 'easy'
    await finish(t, m)
    assert.equal(m.kinds().proposers, 0)
    assert.equal(t.store.facts.length, 0)
  }
})

void test('answer step: a model failure proposes nothing and never throws', async () => {
  const t = bgSetup({ model: () => Promise.reject(new Error('down')) })
  await withAsk(t)
  const r = await finishBackgroundAnswer(t.deps, config('live'), backgroundStoreOf(t.deps.store)!, {
    by: { interviewId: 1 },
    answerId: { interviewAnswerId: 9 },
    usability: 'usable',
    question: 'q?',
    answer: 'I play the slot hard.',
    forbiddenNames: [],
    record: pressRecorder(t.store),
  })
  assert.deepEqual(r, { proposed: 0 })
  assert.equal(t.store.facts.length, 0)
})

// ── The fact code checks ─────────────────────────────────────────────────────

const FCTX: FactProposalContext = {
  ownerName: 'Skater A',
  subjectName: null,
  blockedNames: ['Skater B', 'skaterb77', 'Hidden Hank'],
  question: 'What is your best habit?',
  answer: 'I play the slot hard, and we won 4 in a row.',
}

void test('fact checks: short, third person, hockey words only, no quote, no invented number, no other player', () => {
  assert.deepEqual(factProblems('Skater A plays the slot hard.', FCTX), [])
  assert.match(factProblems('I play the slot hard.', FCTX).join(), /third person/)
  assert.match(factProblems('Skater A said "the slot is mine".', FCTX).join(), /quotation/)
  assert.match(
    factProblems('Skater A scored 12 goals.', FCTX).join(),
    /number the answer did not use/,
  )
  assert.deepEqual(factProblems('Skater A won 4 in a row.', FCTX), [])
  assert.match(factProblems('Skater A plays with Skater B.', FCTX).join(), /another person/)
  assert.match(factProblems('Skater A hates Hidden Hank.', FCTX).join(), /another person/)
  assert.ok(factProblems('x'.repeat(401), FCTX).length > 0)
  assert.ok(factProblems('   ', FCTX).length > 0)
  assert.match(factProblems('Skater A is a fucking beast.', FCTX).join(), /crude/)
})

void test('fact checks: a teammate fact must name the teammate, and at most 2 facts are accepted', () => {
  const ctx = { ...FCTX, subjectName: 'Goalie G' }
  assert.match(factProblems('Skater A plays the slot hard.', ctx).join(), /name the teammate/)
  assert.deepEqual(factProblems('Goalie G calms Skater A down.', ctx), [])
  const many = acceptFacts(
    [
      'Goalie G calms Skater A down.',
      'Goalie G reads the play well.',
      'Goalie G talks a lot.',
      'goalie g CALMS skater a down.',
    ],
    ctx,
  )
  assert.deepEqual(many, ['Goalie G calms Skater A down.', 'Goalie G reads the play well.'])
})

// ── The question writer ──────────────────────────────────────────────────────

const ACTX = (over: Partial<BackgroundAskContext> = {}): BackgroundAskContext => ({
  kind: 'interview',
  facts: oct12Response('night').facts,
  forbiddenNames: ['Hidden Hank'],
  reporter: 'barlow',
  player: { name: 'Skater A', pressLevel: 'full' },
  seed: 'What is the best habit of Skater A?',
  subject: null,
  blockedNames: ['Skater B', 'skaterb77'],
  history: [],
  ...over,
})

void test('background question check: names only the person and the named teammate, no number, no forbidden name', () => {
  assert.deepEqual(backgroundQuestionProblems('What habit do you lean on, Skater A?', ACTX()), [])
  assert.ok(backgroundQuestionProblems('What does Skater B bring?', ACTX()).length > 0)
  assert.ok(backgroundQuestionProblems('What about Hidden Hank?', ACTX()).length > 0)
  assert.ok(backgroundQuestionProblems('What about Goalie G?', ACTX()).length > 0)
  const withSubject = ACTX({ subject: { name: 'Goalie G' } })
  assert.deepEqual(backgroundQuestionProblems('How well does Goalie G read you?', withSubject), [])
  assert.ok(backgroundQuestionProblems('How well do you read the room?', withSubject).length > 0)
  assert.ok(
    backgroundQuestionProblems('Goalie G or Skater B, who is better?', withSubject).length > 0,
  )
  assert.ok(backgroundQuestionProblems('You scored 77 goals, right?', ACTX()).length > 0)
  assert.ok(backgroundQuestionProblems('x'.repeat(300), ACTX()).length > 0)
})

void test('background question prompt: the reporter may ask for a rating or a fair criticism of a teammate; Go easy gets none', async () => {
  const m = bgModel({ background: ['How would you rate Goalie G in a tight game?'] })
  const out = await askBackgroundQuestion(m.call, ACTX({ subject: { name: 'Goalie G' } }), () =>
    Promise.resolve(),
  )
  assert.equal(out, 'How would you rate Goalie G in a tight game?')
  const sys = m.reqs[0]!.system
  assert.ok(BACKGROUND_RULES.some((r) => /rate them/.test(r) && /fair/.test(r)))
  assert.match(sys, /BACKGROUND QUESTION RULES/)
  assert.match(m.reqs[0]!.user, /ask Skater A about Goalie G's hockey, naming Goalie G/)
  const easy = bgModel({ background: ['What is your best habit?'] })
  await askBackgroundQuestion(
    easy.call,
    ACTX({ player: { name: 'Skater B', pressLevel: 'easy' } }),
    () => Promise.resolve(),
  )
  assert.match(easy.reqs[0]!.user, /press level "easy": no criticism at all/)
  // The review is told any criticism of a Go easy person is a problem.
  assert.ok(easy.reqs.some((r) => r.purpose === 'review' && /Go easy/.test(r.user)))
})

void test('background question: a failed write gives null (the caller then asks its ordinary question)', async () => {
  const m = bgModel({
    background: [
      'You scored 77 goals, right?',
      'You scored 77 goals, right?',
      'You scored 77 goals, right?',
    ],
  })
  assert.equal(await askBackgroundQuestion(m.call, ACTX(), () => Promise.resolve()), null)
  assert.equal(
    await askBackgroundQuestion(
      () => Promise.reject(new Error('x')),
      ACTX(),
      () => Promise.resolve(),
    ),
    null,
  )
})

// ── Scrums ───────────────────────────────────────────────────────────────────

const REPORTERS3 = ['barlow', 'voss', 'mercer'] as const

/** A picked person with a 3-reporter panel who is about to be asked question `n`. */
async function scrumAt(t: T, n: number, opts: { win?: boolean } = {}) {
  const personId = await scrumWithPerson(t)
  const res = oct12Response('game')
  if (opts.win !== false) {
    res.facts.games[0] = { ...res.facts.games[0]!, result: 'WIN', scoreFor: 5, scoreAgainst: 3 }
  }
  t.deps.fetchFacts = () => Promise.resolve(res)
  await t.store.setScrumPersonPanel(personId, [...REPORTERS3], 4)
  const p = t.store.people.find((x) => x.id === personId)!
  p.questionsAsked = n - 1
  p.status = 'asking'
  return personId
}

const bgScrumModel = () =>
  bgModel({
    questions: ['Ordinary scrum question about the game?'],
    background: ['What habit do you lean on when the game is close?'],
  })

void test('scrum: the LAST question of the panel is the background one (game questions come first)', async () => {
  for (const [n, expectBackground] of [
    [1, false],
    [2, false],
    [3, true],
  ] as const) {
    const m = bgScrumModel()
    const t = bgSetup({ model: m.call })
    t.store.bank = [t.store.bank[0]!]
    const personId = await scrumAt(t, n)
    await startScrumQuestion(t.deps, config('live'), personId)
    assert.equal(m.kinds().backgroundQuestions, expectBackground ? 1 : 0, `question ${String(n)}`)
    assert.equal(t.store.asks.length, expectBackground ? 1 : 0)
    if (expectBackground) {
      assert.equal(t.store.asks[0]!.kind, 'scrum')
      assert.equal(t.store.asks[0]!.scrumPersonId, personId)
    }
  }
})

void test('scrum: at most one per person per 7 days', async () => {
  const m = bgScrumModel()
  const t = bgSetup({ model: m.call })
  t.store.bank = [t.store.bank[0]!, { ...t.store.bank[2]! }]
  const personId = await scrumAt(t, 3)
  // An ask 3 days ago in another scrum: no second one now.
  t.store.asks.push({
    id: 50,
    questionId: 3,
    playerId: 1,
    subjectPlayerId: null,
    kind: 'scrum',
    scrumPersonId: 999,
    isTest: false,
    at: new Date(NOW.getTime() - 3 * 86_400_000),
    answeredAt: NOW,
    answerScrumId: 1,
    answerInterviewId: null,
  })
  await startScrumQuestion(t.deps, config('live'), personId)
  assert.equal(m.kinds().backgroundQuestions, 0)
  assert.equal(t.store.asks.length, 1)
})

void test('scrum: an ask 8 days ago does not block (the limit is 7 days)', async () => {
  const m = bgScrumModel()
  const t = bgSetup({ model: m.call })
  t.store.bank = [t.store.bank[0]!]
  const personId = await scrumAt(t, 3)
  t.store.asks.push({
    id: 50,
    questionId: 3,
    playerId: 1,
    subjectPlayerId: null,
    kind: 'scrum',
    scrumPersonId: 999,
    isTest: false,
    at: new Date(NOW.getTime() - 8 * 86_400_000),
    answeredAt: NOW,
    answerScrumId: 1,
    answerInterviewId: null,
  })
  await startScrumQuestion(t.deps, config('live'), personId)
  assert.equal(m.kinds().backgroundQuestions, 1)
})

void test('scrum: never in the scrum of a game lost by 3+ goals; a 2-goal loss is fine', async () => {
  for (const [against, expectBackground] of [
    [6, false],
    [5, false],
    [4, true],
  ] as const) {
    const m = bgScrumModel()
    const t = bgSetup({ model: m.call })
    t.store.bank = [t.store.bank[0]!]
    const personId = await scrumAt(t, 3, { win: false })
    const res = oct12Response('game')
    res.facts.games[0] = {
      ...res.facts.games[0]!,
      result: 'LOSS',
      scoreFor: 2,
      scoreAgainst: against,
    }
    t.deps.fetchFacts = () => Promise.resolve(res)
    await startScrumQuestion(t.deps, config('live'), personId)
    assert.equal(
      m.kinds().backgroundQuestions,
      expectBackground ? 1 : 0,
      `lost 2-${String(against)}`,
    )
  }
  const facts = oct12Response('game').facts
  assert.equal(lostBy(facts, facts.games[0]!.matchId), 4)
  assert.equal(lostBy(facts, 123456), 0)
})

void test('scrum: never more than one per panel, and none with the switch off or in a test scrum', async () => {
  {
    const m = bgScrumModel()
    const t = bgSetup({ model: m.call })
    t.store.bank = [t.store.bank[0]!]
    const personId = await scrumAt(t, 3)
    t.store.asks.push({
      id: 60,
      questionId: 3,
      playerId: 1,
      subjectPlayerId: null,
      kind: 'scrum',
      scrumPersonId: personId,
      isTest: false,
      at: NOW,
      answeredAt: null,
      answerScrumId: null,
      answerInterviewId: null,
    })
    await startScrumQuestion(t.deps, config('live'), personId)
    assert.equal(m.kinds().backgroundQuestions, 0)
    assert.equal(t.store.asks.length, 1)
  }
  {
    const m = bgScrumModel()
    const t = bgSetup({ model: m.call })
    t.store.switchOn = false
    const personId = await scrumAt(t, 3)
    await startScrumQuestion(t.deps, config('live'), personId)
    assert.equal(m.kinds().backgroundQuestions, 0)
    assert.equal(t.store.asks.length, 0)
  }
})

void test('scrum: the answer to a background question proposes a fact; an answer about a teammate is hidden from the scrum history', async () => {
  const m = bgModel({
    questions: [],
    background: ['How well does Goalie G read your game when the play breaks down?'],
    judgements: [usable],
    facts: [['Goalie G reads Skater A game well when the play breaks down.']],
  })
  const t = bgSetup({ model: m.call })
  t.store.bank = [t.store.bank[1]!]
  const personId = await scrumAt(t, 3)
  await startScrumQuestion(t.deps, config('live'), personId)
  assert.equal(t.store.asks.length, 1)
  assert.equal(t.store.asks[0]!.subjectPlayerId, 3)
  // The player answers in the pop-up.
  const { onAnswerSubmit } = await import('./interactions.ts')
  const p = t.store.people.find((x) => x.id === personId)!
  await onAnswerSubmit(
    t.deps,
    config('live'),
    personId,
    USER_A,
    'Goalie G reads my game, he always knows where I am.',
    {
      questionsAsked: p.questionsAsked,
      followupsAsked: p.followupsAsked,
    },
  )
  assert.equal(t.store.facts.length, 1)
  assert.equal(t.store.facts[0]!.status, 'proposed')
  assert.equal(t.store.facts[0]!.subjectPlayerId, 3)
  assert.equal(t.store.facts[0]!.scrumAnswerId, 1)
  const stored = await t.store.listScrumAnswers(personId)
  assert.equal(stored[0]!.aboutTeammate, true)
  assert.equal(scrumHistory(stored, 'barlow')[0]!.answer, null)
})

// ── The night recap: confirmed background only ──────────────────────────────

void test('night recap: only players on the sheet, a few lines each, nothing with a digit, none for others', () => {
  const facts = oct12Response('night').facts // Skater A (1), Skater B (2), Goalie G (3)
  const lines = backgroundForSheet(
    [
      {
        playerId: 1,
        facts: [
          { part: 'hockey', text: 'Plays centre on the first line.' },
          { part: 'career', text: 'Joined in 2024.' },
          { part: 'hockey', text: 'Shoots first.' },
          { part: 'hockey', text: 'Third fact is cut.' },
        ],
      },
      { playerId: 4, facts: [{ part: 'hockey', text: 'Hidden Hank plays wing.' }] },
    ],
    facts,
  )
  assert.deepEqual(lines, [
    { player: 'Skater A', text: 'Plays centre on the first line.' },
    { player: 'Skater A', text: 'Shoots first.' },
  ])
  const block = backgroundBlock(lines)!
  assert.match(block, /CONFIRMED BACKGROUND/)
  assert.match(block, /Never quote a line/)
  assert.equal(backgroundBlock([]), null)
  assert.equal(backgroundBlock(undefined), null)
})
