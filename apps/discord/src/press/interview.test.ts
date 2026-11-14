import test from 'node:test'
import assert from 'node:assert/strict'
import { interviewParagraph } from '@eanhl/db/news'
import { oct12Response } from '../news/test-fixtures.ts'
import { interviewModel, interviewSetup, type Judgement } from './interview-fakes.ts'
import { onPressThreadMessage } from './interview-gateway.ts'
import { INTERVIEW_ANSWER_MS, INTERVIEW_OFFER_MS, interviewClosing } from './interview-rules.ts'
import {
  INTERVIEW_TEXT,
  onGmInterview,
  onInterviewAccept,
  onInterviewAnswerButton,
  onInterviewAnswerSubmit,
  onInterviewCommand,
} from './interview.ts'
import { JUDGEMENT_SCHEMA } from './asker.ts'
import { TEXT } from './interactions.ts'
import { runPressPass } from './pass.ts'
import { FakeStore, GM, NIGHT, NOW, USER_A, USER_B, config } from './test-fakes.ts'

const STRANGER = '200000000000000009'
const ephemeral = (text: string) => ({ kind: 'ephemeral', text })
const usable = (followUp = ''): Judgement => ({
  usability: 'usable',
  chase: followUp === '' ? 'none' : 'strong',
  followUp,
  closing: 'Good talk. That is the interview.',
})

type T = ReturnType<typeof interviewSetup>

/** Submit like a fresh pop-up: `seen` = the counters the Answer button saw just now. */
function answer(t: T, cfg: ReturnType<typeof config>, id: number, userId: string, text: string) {
  const r = t.store.interviews.find((x) => x.id === id)!
  const seen = { questionsAsked: r.questionsAsked, followupsAsked: r.followupsAsked }
  return onInterviewAnswerSubmit(t.deps, cfg, id, userId, text, seen)
}

/** The GM offers Skater A an interview with Wade Barlow; the pass posts the offer. */
async function gmOffer(t: T, cfg = config('live'), topic: string | null = null) {
  const reply = await onGmInterview(t.deps, cfg, GM, {
    player: USER_A,
    reporter: 'barlow',
    topic,
  })
  assert.deepEqual(
    reply,
    ephemeral('Got it: Wade Barlow will offer Skater A an interview (open for 30 minutes).'),
  )
  await runPressPass(t.deps, cfg)
  return t.store.interviews[0]!
}

const ANSWERS = [
  'We got outshot badly but I kept skating hard all night.',
  'The second game was rough, no excuses from me at all.',
  'I mean we just did not get pucks deep enough, simple as that.',
  'My season is fine, I want more goals though.',
  'Ha, I am the best player on this team and everyone knows it.',
  'The club needs to clear the front of our net better.',
  'Chasing a winning record before the season ends.',
]

void test('done when: a GM-started interview runs from the offer to a stored Q&A article', async () => {
  const planned = [
    'How did the night go for you?',
    'What went wrong in the second game?',
    'How do you rate your season so far?',
    'What do you bring to this team?',
    'What does the club need to fix?',
    'Last one: what are you chasing now?',
  ]
  const judgements = [
    usable(),
    usable('Why were the pucks not getting deep?'),
    usable(),
    usable(),
    { usability: 'joke', followUp: '', closing: 'Sure you are.' },
    usable(),
    usable(),
  ]
  const article = {
    headline: 'Skater A sits down after a hard night',
    dek: 'Wade Barlow talks shots, effort and the season with Skater A.',
    intro: [
      'Wade Barlow sat down with Skater A after two losses to talk about the night and the season.',
    ],
    answers: [
      { n: 1, text: 'We got outshot badly but I kept skating hard all night.' },
      { n: 3, text: 'we just did not get pucks deep enough…' },
      { n: 5, text: 'Ha, I am the best player on this team and everyone knows it.' },
      { n: 7, text: 'Chasing a winning record before the season ends.' },
    ],
  }
  const m = interviewModel({ questions: planned, judgements, articles: [article] })
  const t = interviewSetup({ model: m.call })
  const cfg = config('live')

  // The offer: in the channel, from the reporter, mentioning the player, with Accept.
  const iv = await gmOffer(t, cfg, 'his shot volume')
  assert.equal(iv.status, 'offered')
  assert.equal(iv.trigger, 'gm')
  assert.equal(iv.topic, 'his shot volume')
  assert.equal(iv.isTest, false)
  const offer = t.sent[0]!
  assert.equal(offer.reporter, 'barlow')
  assert.equal(offer.channelId, 'chel')
  assert.match(
    offer.msg.content,
    new RegExp(`^<@${USER_A}> — Wade Barlow would like a sit-down interview`),
  )
  assert.deepEqual(offer.msg.allowed_mentions, { parse: [], users: [USER_A] })
  assert.equal(
    (offer.msg.components as { components: { custom_id: string }[] }[])[0]!.components[0]!
      .custom_id,
    'press:iaccept:1',
  )
  assert.equal(iv.offerMessageId, 'sent-1')

  // Accept: the thread opens on the offer, question 1 goes out with the Answer button.
  assert.deepEqual(await onInterviewAccept(t.deps, cfg, 1, USER_A), { kind: 'ack' })
  assert.deepEqual(t.threads[0], {
    channelId: 'chel',
    messageId: 'sent-1',
    name: 'Wade Barlow — Skater A: interview',
  })
  assert.deepEqual(t.edits[0], { messageId: 'sent-1', msg: { components: [] } })
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> How did the night go for you?`)

  // Seven items: six planned questions and one follow-up (it replaces a planned one).
  for (const text of ANSWERS) {
    assert.deepEqual(await answer(t, cfg, 1, USER_A, text), { kind: 'ack' })
  }
  const done = t.store.interviews[0]!
  assert.equal(done.status, 'done')
  assert.equal(done.questionsAsked, 6)
  assert.equal(done.followupsAsked, 1)
  assert.equal(t.store.ivAnswers.length, 7)
  assert.deepEqual(
    t.store.ivAnswers.map((a) => [a.position, a.isFollowup, a.usability]),
    [
      [1, false, 'usable'],
      [2, false, 'usable'],
      [3, true, 'usable'],
      [4, false, 'usable'],
      [5, false, 'joke'],
      [6, false, 'usable'],
      [7, false, 'usable'],
    ],
  )
  assert.equal(t.store.ivAnswers[2]!.question, 'Why were the pucks not getting deep?')
  // The reporter closed with the judge's closing line.
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> Good talk. That is the interview.`)
  // The topic reached the question writer, never as a source.
  assert.ok(m.reqs.some((r) => r.user.includes('his shot volume')))

  // The pass writes the article: a news item by that reporter.
  await runPressPass(t.deps, cfg)
  const after = t.store.interviews[0]!
  assert.equal(after.articleStatus, 'written')
  const item = t.store.newsItems[0]!
  assert.equal(after.articleItemId, item.id)
  assert.equal(item.kind, 'article')
  assert.equal(item.reporter, 'barlow')
  assert.equal(item.isTest, false)
  assert.equal(item.night ?? null, null)
  assert.match(item.slug!, /^interview-1-skater-a-sits-down/)
  assert.equal(item.headline, article.headline)
  assert.deepEqual(item.mentions, [{ name: 'Skater A', playerId: 1 }])
  // A real article waits for the news service's delivery pass, due now.
  assert.equal(item.sendAfter?.getTime(), NOW.getTime())
  const paragraphs = item.body.split('\n\n').map(interviewParagraph)
  assert.deepEqual(paragraphs, [
    { kind: 'intro', text: article.intro[0] },
    { kind: 'question', text: 'How did the night go for you?' },
    { kind: 'answer', text: ANSWERS[0] },
    { kind: 'question', text: 'Why were the pucks not getting deep?' },
    { kind: 'answer', text: 'we just did not get pucks deep enough…' },
    { kind: 'question', text: 'What do you bring to this team?' },
    { kind: 'answer', text: ANSWERS[4] },
    { kind: 'question', text: 'Last one: what are you chasing now?' },
    { kind: 'answer', text: ANSWERS[6] },
  ])
  // The joke answer went to the review marked as a joke.
  const review = m.reqs.filter((r) => r.purpose === 'review').at(-1)!
  assert.match(review.user, /answered \(a JOKE: never state it as fact\)/)
})

void test('/gm interview: only the GM; never a "Leave me out" player, an unlinked one, a benched reporter, or twice', async () => {
  const t = interviewSetup()
  const cfg = config('live')
  const ask = (userId: string, over: Partial<{ player: string; reporter: string }> = {}) =>
    onGmInterview(t.deps, cfg, userId, {
      player: over.player ?? USER_A,
      reporter: over.reporter ?? null,
      topic: null,
    })
  assert.deepEqual(await ask(USER_A), ephemeral(INTERVIEW_TEXT.gmOnly))
  assert.deepEqual(await ask(GM, { player: STRANGER }), ephemeral(INTERVIEW_TEXT.notLinked))
  // "Leave me out" (or a guest): not on the night sheet.
  const out = oct12Response('night')
  out.facts.people = out.facts.people.filter((p) => p.playerId !== 1)
  t.deps.fetchFacts = () => Promise.resolve(out)
  assert.deepEqual(await ask(GM), ephemeral("Skater A can't be interviewed."))
  t.deps.fetchFacts = () => Promise.resolve(oct12Response('night'))
  // No game in the last 30 days.
  t.store.playerNights.delete(1)
  assert.deepEqual(await ask(GM), ephemeral('Skater A has no game in the last 30 days.'))
  t.store.playerNights.set(1, NIGHT)
  t.store.disabled = ['pettibone']
  assert.deepEqual(
    await ask(GM, { reporter: 'pettibone' }),
    ephemeral('Gord Pettibone is switched off.'),
  )
  assert.equal(t.store.interviews.length, 0)
  assert.match((await ask(GM)).kind, /ephemeral/)
  assert.equal(t.store.interviews.length, 1)
  assert.notEqual(t.store.interviews[0]!.reporter, 'pettibone')
  assert.deepEqual(await ask(GM), ephemeral('Skater A already has an interview open.'))
})

void test('the 80% budget stop covers interviews', async () => {
  const t = interviewSetup()
  t.store.spend = 16 // 80% of the 20 USD test limit
  assert.deepEqual(
    await onGmInterview(t.deps, config('live'), GM, {
      player: USER_A,
      reporter: null,
      topic: null,
    }),
    ephemeral(TEXT.pressOff),
  )
  assert.deepEqual(
    await onInterviewCommand(t.deps, config('live'), USER_A),
    ephemeral(TEXT.pressOff),
  )
  assert.equal(t.store.interviews.length, 0)
})

void test('offer window: only the offered player, within 30 minutes; then the pass expires it', async () => {
  const t = interviewSetup({
    model: interviewModel({ questions: ['How did the night go for you?'] }).call,
  })
  const cfg = config('live')
  await gmOffer(t, cfg)
  assert.deepEqual(
    await onInterviewAccept(t.deps, cfg, 1, USER_B),
    ephemeral('This one is for Skater A.'),
  )
  // Thirty minutes later: too late, and the pass ends it and removes the button.
  t.deps.now = () => new Date(NOW.getTime() + INTERVIEW_OFFER_MS + 1000)
  assert.deepEqual(await onInterviewAccept(t.deps, cfg, 1, USER_A), ephemeral(TEXT.tooLate))
  await runPressPass(t.deps, cfg)
  assert.equal(t.store.interviews[0]!.status, 'expired')
  assert.deepEqual(t.edits.at(-1), { messageId: 'sent-1', msg: { components: [] } })
  // No reminder, no thread, no article.
  assert.equal(t.sent.length, 1)
  assert.equal(t.threads.length, 0)
  await runPressPass(t.deps, cfg)
  assert.equal(t.store.interviews[0]!.articleStatus, 'waiting')
  assert.equal(t.store.newsItems.length, 0)
})

void test('/interview: the player starts their own at once (no Accept), at most once a week', async () => {
  const t = interviewSetup({
    model: interviewModel({ questions: ['How did the night go for you?'] }).call,
  })
  const cfg = config('live')
  assert.deepEqual(await onInterviewCommand(t.deps, cfg, STRANGER), ephemeral(TEXT.link))
  assert.deepEqual(
    await onInterviewCommand(t.deps, cfg, USER_A),
    ephemeral(INTERVIEW_TEXT.inThread),
  )
  const iv = t.store.interviews[0]!
  assert.equal(iv.trigger, 'player')
  assert.equal(iv.status, 'active')
  assert.equal(iv.requestedByUserId, USER_A)
  const opening = t.sent[0]!
  assert.match(opening.msg.content, /sits down with you/)
  assert.equal(opening.msg.components, undefined)
  assert.equal(t.threads.length, 1)
  assert.equal(t.sent[1]!.msg.content, `<@${USER_A}> How did the night go for you?`)
  // The pass never posts an offer for it.
  await runPressPass(t.deps, cfg)
  assert.equal(t.sent.length, 2)
  // A second one the same week is refused, even after the first ended.
  t.store.interviews[0]!.status = 'done'
  assert.deepEqual(await onInterviewCommand(t.deps, cfg, USER_A), ephemeral(INTERVIEW_TEXT.weekly))
})

void test('/interview whose opening message fails does not count toward the weekly limit', async () => {
  const t = interviewSetup({
    model: interviewModel({ questions: ['How did the night go for you?'] }).call,
  })
  const cfg = config('live')
  t.failSendWhen(() => true)
  assert.deepEqual(await onInterviewCommand(t.deps, cfg, USER_A), ephemeral(TEXT.rightWithYou))
  assert.equal(t.store.interviews[0]!.status, 'expired')
  t.failSendWhen(() => false)
  assert.deepEqual(
    await onInterviewCommand(t.deps, cfg, USER_A),
    ephemeral(INTERVIEW_TEXT.inThread),
  )
})

void test('button answers: the pop-up names its item; a stale pop-up and other people are refused', async () => {
  const m = interviewModel({
    questions: ['How did the night go for you?', 'And the season?'],
    judgements: [usable()],
  })
  const t = interviewSetup({ model: m.call })
  const cfg = config('live')
  await gmOffer(t, cfg)
  await onInterviewAccept(t.deps, cfg, 1, USER_A)
  assert.deepEqual(await onInterviewAnswerButton(t.deps, cfg, 1, USER_A), {
    kind: 'modal',
    customId: 'press:imodal:1:1:0',
    title: 'Wade Barlow asks',
    label: 'How did the night go for you?',
    maxLength: 500,
  })
  assert.deepEqual(
    await onInterviewAnswerButton(t.deps, cfg, 1, USER_B),
    ephemeral('This one is for Skater A.'),
  )
  const stale = { questionsAsked: 1, followupsAsked: 0 }
  assert.deepEqual(
    await onInterviewAnswerSubmit(t.deps, cfg, 1, USER_A, 'We kept working hard out there.', stale),
    { kind: 'ack' },
  )
  // The echo: a usable answer is shown in the thread as the reporter, no mentions.
  const echo = t.sent.find((s) => s.msg.content.startsWith('**Skater A:**'))!
  assert.deepEqual(echo.msg.allowed_mentions, { parse: [] })
  // The same pop-up again: already answered.
  assert.deepEqual(
    await onInterviewAnswerSubmit(t.deps, cfg, 1, USER_A, 'Again.', stale),
    ephemeral(TEXT.answered),
  )
})

void test('typed answers in the interview thread count (not echoed); others in the thread are ignored', async () => {
  const m = interviewModel({
    questions: ['How did the night go for you?', 'And the season?'],
    judgements: [usable()],
  })
  const t = interviewSetup({ model: m.call })
  const cfg = { ...config('live'), typedAnswers: true }
  await gmOffer(t, cfg)
  await onInterviewAccept(t.deps, cfg, 1, USER_A)
  const thread = t.store.interviews[0]!.threadId!
  const before = t.sent.length
  await onPressThreadMessage(t.deps, cfg, { threadId: thread, userId: USER_B, text: 'heckle' })
  assert.equal(t.store.ivAnswers.length, 0)
  assert.equal(t.sent.length, before)
  await onPressThreadMessage(t.deps, cfg, {
    threadId: thread,
    userId: USER_A,
    text: 'We kept working hard out there.',
  })
  assert.equal(t.store.ivAnswers.length, 1)
  assert.equal(t.store.ivAnswers[0]!.answer, 'We kept working hard out there.')
  // No echo (the typed answer is already in the thread); the next question went out.
  assert.ok(!t.sent.some((s) => s.msg.content.startsWith('**Skater A:**')))
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> And the season?`)
})

void test('the player says it is over: the reporter closes politely, the short answer is not used', async () => {
  const m = interviewModel({ questions: ['How did the night go for you?'] })
  const t = interviewSetup({ model: m.call })
  const cfg = config('live')
  await gmOffer(t, cfg)
  await onInterviewAccept(t.deps, cfg, 1, USER_A)
  assert.deepEqual(await answer(t, cfg, 1, USER_A, "I'm done, thanks"), { kind: 'ack' })
  assert.equal(t.store.interviews[0]!.status, 'stopped')
  assert.equal(t.store.ivAnswers[0]!.usability, 'unusable')
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> ${interviewClosing('Skater A')}`)
  // No judge call for it.
  assert.equal(m.reqs.filter((r) => r.user.includes("I'm done")).length, 0)
})

void test('no answer in 30 minutes: the pass closes politely; fewer than 3 usable answers ⇒ no article', async () => {
  const m = interviewModel({
    questions: ['How did the night go for you?', 'And the season?'],
    judgements: [usable()],
  })
  const t = interviewSetup({ model: m.call })
  const cfg = config('live')
  await gmOffer(t, cfg)
  await onInterviewAccept(t.deps, cfg, 1, USER_A)
  await answer(t, cfg, 1, USER_A, 'We kept working hard out there.')
  t.deps.now = () => new Date(NOW.getTime() + INTERVIEW_ANSWER_MS + 1000)
  await runPressPass(t.deps, cfg)
  const iv = t.store.interviews[0]!
  assert.equal(iv.status, 'stopped')
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> ${interviewClosing('Skater A')}`)
  // The same pass reaches the article step: 1 usable answer is not enough.
  assert.equal(iv.articleStatus, 'skipped')
  assert.equal(t.store.newsItems.length, 0)
  assert.ok(t.logs.some((l) => /article skipped \(fewer than 3 usable answers\)/.test(l)))
})

void test('trial: everything is test; the article never goes to the news delivery, only the trial mirror', async () => {
  const article = {
    headline: 'Skater A on a long night',
    dek: 'Wade Barlow sits down with Skater A.',
    intro: ['Wade Barlow sat down with Skater A after the night.'],
    answers: [
      { n: 1, text: ANSWERS[0] },
      { n: 2, text: ANSWERS[1] },
      { n: 3, text: ANSWERS[3] },
    ],
  }
  const m = interviewModel({ articles: [article] })
  const t = interviewSetup({ model: m.call })
  const cfg = config('trial')
  await gmOffer(t, cfg)
  const iv = t.store.interviews[0]!
  assert.equal(iv.isTest, true)
  assert.equal(iv.channelId, 'test-channel')
  assert.match(t.sent.at(-1)!.msg.content, /^\(trial\) <@/)
  // Three usable answers stored by hand, then finished.
  for (const [i, a] of [ANSWERS[0]!, ANSWERS[1]!, ANSWERS[3]!].entries()) {
    await t.store.insertInterviewAnswer({
      interviewId: 1,
      playerId: 1,
      reporter: 'barlow',
      position: i + 1,
      question: `Question ${['one', 'two', 'three'][i]!}?`,
      answer: a,
      usability: 'usable',
      isTest: true,
    })
  }
  Object.assign(iv, { status: 'done' })
  await runPressPass(t.deps, cfg)
  const item = t.store.newsItems[0]!
  assert.equal(item.isTest, true)
  assert.equal(item.sendAfter, null)
  // The next pass mirrors it into the test channel as the teaser (headline, dek, link).
  await runPressPass(t.deps, cfg)
  const teaser = t.sent.find((s) => s.msg.content.includes('/news/interview-1-'))
  assert.ok(teaser, 'teaser mirrored')
  assert.equal(teaser.channelId, 'test-channel')
  assert.match(teaser.msg.content, /^\*\*Skater A on a long night\*\*/)
})

void test('automatic offer: a night with a milestone offers once; at most one a week for the club', async () => {
  const t = interviewSetup()
  const cfg = config('live')
  t.store.nightRecaps.push({
    night: NIGHT,
    createdAt: new Date(NOW.getTime() - 60_000),
    isTest: false,
  })
  await runPressPass(t.deps, cfg)
  // Skater B hit 25 goals on the sheet (and is linked): the offer goes to them.
  assert.equal(t.store.interviews.length, 1)
  const iv = t.store.interviews[0]!
  assert.equal(iv.trigger, 'auto')
  assert.equal(iv.playerId, 2)
  assert.equal(iv.night, NIGHT)
  assert.match(t.sent.at(-1)!.msg.content, new RegExp(`^<@${USER_B}> — `))
  await runPressPass(t.deps, cfg)
  assert.equal(t.store.interviews.length, 1)
  // Another night in the same week: no second automatic offer.
  t.store.nightRecaps.push({
    night: '2026-10-11',
    createdAt: new Date(NOW.getTime() - 30_000),
    isTest: false,
  })
  t.store.interviews[0]!.status = 'expired'
  await runPressPass(t.deps, cfg)
  assert.equal(t.store.interviews.length, 1)
})

void test('automatic offer: only within 30 minutes of the night recap, never hours later', async () => {
  const t = interviewSetup()
  t.store.nightRecaps.push({
    night: NIGHT,
    createdAt: new Date(NOW.getTime() - 31 * 60_000),
    isTest: false,
  })
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.interviews.length, 0)
  t.store.nightRecaps[0]!.createdAt = new Date(NOW.getTime() - 29 * 60_000)
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.interviews.length, 1)
})

void test('automatic offer: live never uses a test night recap; trial does', async () => {
  const t = interviewSetup()
  t.store.nightRecaps.push({
    night: NIGHT,
    createdAt: new Date(NOW.getTime() - 60_000),
    isTest: true,
  })
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.interviews.length, 0)
  await runPressPass(t.deps, config('trial'))
  assert.equal(t.store.interviews.length, 1)
  assert.equal(t.store.interviews[0]!.isTest, true)
})

void test('a store without interview methods: no interview, no error', async () => {
  const t = interviewSetup()
  // The scrum FakeStore (no interview methods) behaves as "interviews off".
  t.deps.store = new FakeStore()
  assert.deepEqual(
    await onGmInterview(t.deps, config('live'), GM, {
      player: USER_A,
      reporter: null,
      topic: null,
    }),
    ephemeral(INTERVIEW_TEXT.off),
  )
  await runPressPass(t.deps, config('live'))
  assert.ok(!t.logs.some((l) => /interview/.test(l)))
})

void test('follow-up: only on an answer with a lot to chase ("chased"); an unusable answer is acknowledged', async () => {
  const m = interviewModel({
    questions: ['How did the night go for you?', 'And the season?', 'What comes next?'],
    judgements: [
      { usability: 'usable', chase: 'some', followUp: 'Why so?', closing: 'Fine.' },
      { usability: 'unusable', chase: 'none', followUp: '', closing: "I'll leave that one there." },
    ],
  })
  const t = interviewSetup({ model: m.call })
  const cfg = config('live')
  await gmOffer(t, cfg)
  await onInterviewAccept(t.deps, cfg, 1, USER_A)
  await answer(t, cfg, 1, USER_A, 'We kept working hard out there.')
  // No follow-up: the chase was only "some". The next planned question went out.
  assert.equal(t.store.interviews[0]!.followupsAsked, 0)
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> And the season?`)
  const judge = m.reqs.filter((r) => r.schema === JUDGEMENT_SCHEMA)[0]!
  assert.match(judge.user, /only when "chase" is "strong"/)
  await answer(t, cfg, 1, USER_A, 'My boss called me during the game, ugh.')
  // The unusable answer: acknowledged (never repeated), then the next question.
  const lines = t.sent.slice(-2).map((x) => x.msg.content)
  assert.deepEqual(lines, [
    `<@${USER_A}> I'll leave that one there.`,
    `<@${USER_A}> What comes next?`,
  ])
  assert.equal(t.store.ivAnswers[1]!.usability, 'unusable')
})

void test('an answer naming a forbidden person is never echoed and is unusable with no model call', async () => {
  const m = interviewModel({ questions: ['How did the night go for you?', 'And the season?'] })
  const t = interviewSetup({ model: m.call })
  const cfg = config('live')
  await gmOffer(t, cfg)
  await onInterviewAccept(t.deps, cfg, 1, USER_A)
  const before = m.reqs.length
  await answer(t, cfg, 1, USER_A, 'Ask Hidden Hank about that one.')
  assert.ok(!t.sent.some((x) => x.msg.content.includes('Hidden Hank')))
  assert.equal(t.store.ivAnswers[0]!.usability, 'unusable')
  assert.ok(!m.reqs.slice(before).some((r) => r.schema === JUDGEMENT_SCHEMA))
  assert.equal(t.sent.at(-2)!.msg.content, `<@${USER_A}> Noted. Moving on.`)
})
