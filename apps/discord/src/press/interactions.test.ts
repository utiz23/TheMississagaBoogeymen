import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTERS, type ReporterId } from '@eanhl/db/news'
import type { ModelCall } from '../news/writer.ts'
import { JUDGEMENT_SCHEMA } from './asker.ts'
import {
  onAccept,
  onAnswerButton,
  onAnswerSubmit,
  onScrumCommand,
  onTalk,
  onTypedAnswer,
} from './interactions.ts'
import { runPressPass } from './pass.ts'
import {
  GM,
  NOW,
  USER_A,
  USER_B,
  config,
  itemRow,
  isPoolLine,
  liveRecap,
  scrumWithPerson,
  setup,
} from './test-fakes.ts'

const USER_C = '200000000000000003'
const STRANGER = '200000000000000009'
const TRIAL = 'The press bots are on trial.'
const LINK = 'Link your Discord on boogeymen.app (sign in) to talk to the press.'
const TOO_LATE = 'Too late — the reporter moved on.'
const ephemeral = (text: string) => ({ kind: 'ephemeral', text })

/** Submit like a fresh pop-up: `seen` = the counters the Answer button saw just now. */
function submit(
  t: ReturnType<typeof setup>,
  cfg: ReturnType<typeof config>,
  personId: number,
  userId: string,
  text: string,
) {
  const p = t.store.people.find((x) => x.id === personId)
  const seen = { questionsAsked: p?.questionsAsked ?? 0, followupsAsked: p?.followupsAsked ?? 0 }
  return onAnswerSubmit(t.deps, cfg, personId, userId, text, seen)
}

type Judgement = { usability: string; chase?: string; followUp: string; closing: string }

/** A fake model: questions and judgements in order; every review passes. */
function pressModel(script: { questions?: string[]; judgements?: Judgement[] } = {}) {
  const questions = [...(script.questions ?? [])]
  const judgements = [...(script.judgements ?? [])]
  const reqs: Parameters<ModelCall>[0][] = []
  const call: ModelCall = (req) => {
    reqs.push(req)
    let json: unknown
    if (req.purpose === 'review') json = { ok: true, problems: [] }
    else if (req.schema === JUDGEMENT_SCHEMA) json = judgements.shift()
    else {
      const q = questions.shift()
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

/** A live scrum on the fixture game with no person in it. */
async function liveScrum(t: ReturnType<typeof setup>) {
  liveRecap(t.store)
  await runPressPass(t.deps, config('live'))
  t.store.scrums[0]!.heat = 'normal'
  return t.store.scrums[0]!
}

/** Person `id` is being asked `question` (question 1 unless set). */
function asking(t: ReturnType<typeof setup>, id: number, question: string, asked = 1) {
  const p = t.store.people.find((x) => x.id === id)!
  p.status = 'asking'
  p.questionsAsked = asked
  p.currentQuestion = question
  p.lastAskedAt = NOW
  t.store.scrums[0]!.threadId = 'thread-1'
  return p
}

// ── Trial and links ────────────────────────────────────────────────────────

void test('open trial (operator, 2026-11-13): each person acts for themselves; others are refused as in live', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?')
  const trial = config('trial')
  const notYou = ephemeral('This one is for Skater A.')
  // The GM is not the person: refused like anyone else.
  assert.deepEqual(await onAnswerButton(t.deps, trial, personId, GM), notYou)
  assert.deepEqual(await submit(t, trial, personId, GM, 'x'), notYou)
  assert.deepEqual(await onAnswerButton(t.deps, trial, personId, USER_B), notYou)
  // The person answers for themselves in the trial too.
  assert.equal((await onAnswerButton(t.deps, trial, personId, USER_A)).kind, 'modal')
  // An unlinked Discord user still needs a link, trial or live.
  assert.deepEqual(
    await onScrumCommand(t.deps, trial, USER_C, { player: null, random: false }),
    ephemeral('Link your Discord on boogeymen.app (sign in) to talk to the press.'),
  )
  assert.equal(t.store.answerRows.length, 0)
})

void test('unlinked user: told to link their Discord', async () => {
  const t = setup()
  await liveScrum(t)
  assert.deepEqual(await onTalk(t.deps, config('live'), 10, STRANGER), ephemeral(LINK))
  assert.deepEqual(
    await onScrumCommand(t.deps, config('live'), STRANGER, { player: null, random: true }),
    ephemeral(LINK),
  )
  assert.equal(t.store.people.length, 0)
})

// ── Extras budget ──────────────────────────────────────────────────────────

void test('budget out (80%): Talk, Accept and /scrum say the press is off, and change nothing', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  t.store.spend = 16 // 80% of the 20 USD limit
  const off = ephemeral('The press is off until next month.')
  const live = config('live')
  const before = JSON.stringify(t.store.people)
  assert.deepEqual(await onTalk(t.deps, live, 10, USER_B), off)
  assert.deepEqual(await onAccept(t.deps, live, personId, USER_A), off)
  assert.deepEqual(await onScrumCommand(t.deps, live, USER_B, { player: null, random: false }), off)
  assert.deepEqual(
    await onScrumCommand(t.deps, live, USER_A, { player: USER_B, random: false }),
    off,
  )
  assert.deepEqual(await onScrumCommand(t.deps, live, USER_A, { player: null, random: true }), off)
  assert.equal(JSON.stringify(t.store.people), before)
  assert.equal(t.sent.length, 0)
  assert.equal(t.modelCalls.length, 0)
})

// ── Talk to the press ──────────────────────────────────────────────────────

void test('onTalk: closed scrum, a player not in the game, already in it', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  t.store.discordIds.set(4, USER_C)
  const live = config('live')
  assert.deepEqual(
    await onTalk(t.deps, live, 10, USER_C),
    ephemeral('This scrum is for players of this game.'),
  )
  // T10: someone already in the scrum is answered by their state (here: done).
  t.store.people[0]!.status = 'done'
  assert.deepEqual(
    await onTalk(t.deps, live, 10, USER_A),
    ephemeral("You've already talked to the press about this game."),
  )
  t.store.scrums[0]!.openUntil = NOW
  assert.deepEqual(
    await onTalk(t.deps, live, 10, USER_B),
    ephemeral('The press has left. Catch them after the next game.'),
  )
  assert.deepEqual(
    t.store.people.map((p) => p.id),
    [personId],
  )
  assert.equal(t.sent.length, 0)
})

void test('onTalk: a volunteer is asked their question in the thread', async () => {
  const m = pressModel({ questions: ['Skater B, how did the second period feel?'] })
  const t = setup({ model: m.call })
  const scrum = await liveScrum(t)
  const reply = await onTalk(t.deps, config('live'), 10, USER_B)
  assert.deepEqual(reply, { kind: 'ack' })
  const p = t.store.people[0]!
  assert.equal(p.playerId, 2)
  assert.equal(p.discordUserId, USER_B)
  assert.equal(p.role, 'volunteer')
  assert.equal(p.requestedBy, 'self')
  assert.equal(p.requestedByUserId, USER_B)
  assert.equal(p.status, 'asking')
  assert.equal(p.questionsAsked, 1)
  const q = t.sent.at(-1)!
  assert.equal(q.reporter, scrum.reporter)
  assert.equal(q.msg.content, `<@${USER_B}> Skater B, how did the second period feel?`)
  assert.match(JSON.stringify(q.msg.components), new RegExp(`press:answer:${String(p.id)}`))
})

void test('onTalk in the open trial: a player volunteers for themselves; the scrum is test', async () => {
  const t = setup()
  // The trial mirrors item 10 into the test channel; the scrum hangs on the mirror.
  t.store.settings.mirrorFromItemId = 0
  t.store.items.push(itemRow({ id: 10, isGameRecap: true }))
  await runPressPass(t.deps, config('trial'))
  assert.equal(t.store.scrums.length, 1)
  assert.equal(t.store.scrums[0]!.isTest, true)
  const reply = await onTalk(t.deps, config('trial'), 10, USER_B)
  assert.deepEqual(reply, { kind: 'ack' })
  const p = t.store.people[0]!
  assert.equal(p.playerId, 2)
  assert.equal(p.discordUserId, USER_B)
  assert.equal(p.requestedByUserId, USER_B)
  assert.match(t.sent.at(-1)!.msg.content, new RegExp(`^<@${USER_B}> `))
  assert.deepEqual(t.sent.at(-1)!.msg.allowed_mentions, { parse: [], users: [USER_B] })
})

// ── Accept ─────────────────────────────────────────────────────────────────

void test('onAccept: another user, too late, twice; the person accepts and is asked', async () => {
  const m = pressModel({ questions: ['Skater A, what changed after the first period?'] })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  const live = config('live')
  assert.deepEqual(
    await onAccept(t.deps, live, personId, USER_B),
    ephemeral('This one is for Skater A.'),
  )
  const p = t.store.people.find((x) => x.id === personId)!
  p.pingedAt = new Date(NOW.getTime() - 901_000)
  assert.deepEqual(await onAccept(t.deps, live, personId, USER_A), ephemeral(TOO_LATE))
  assert.equal(p.status, 'pinged')
  // The accept window is 15 minutes: a ping 10 minutes old (too late before) still works.
  p.pingedAt = new Date(NOW.getTime() - 600_000)
  assert.deepEqual(await onAccept(t.deps, live, personId, USER_A), { kind: 'ack' })
  assert.equal(p.status, 'asking')
  assert.equal(p.questionsAsked, 1)
  assert.equal(
    t.sent.at(-1)!.msg.content,
    `<@${USER_A}> Skater A, what changed after the first period?`,
  )
  const sent = t.sent.length
  assert.deepEqual(
    await onAccept(t.deps, live, personId, USER_A),
    ephemeral("You're already in this scrum."),
  )
  assert.equal(t.sent.length, sent)
})

void test('onAccept in the open trial: the pinged player accepts; the GM cannot accept for them', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  t.store.scrums[0]!.isTest = true
  assert.deepEqual(
    await onAccept(t.deps, config('trial'), personId, GM),
    ephemeral('This one is for Skater A.'),
  )
  assert.deepEqual(await onAccept(t.deps, config('trial'), personId, USER_A), { kind: 'ack' })
  const q = t.sent.at(-1)!
  assert.ok(isPoolLine('question', q, USER_A), q.msg.content)
})

// ── Answer button ──────────────────────────────────────────────────────────

void test('onAnswerButton: only the person, only while asking; the modal fits Discord limits', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  const live = config('live')
  assert.deepEqual(await onAnswerButton(t.deps, live, personId, USER_A), ephemeral(TOO_LATE))
  // Accepted, question not posted yet.
  const p0 = t.store.people.find((x) => x.id === personId)!
  p0.status = 'asking'
  p0.lastAskedAt = NOW
  assert.deepEqual(
    await onAnswerButton(t.deps, live, personId, USER_A),
    ephemeral('The question is on its way.'),
  )
  const long = 'Skater A, walk me through the turnover late in the second period?'
  asking(t, personId, long)
  assert.deepEqual(
    await onAnswerButton(t.deps, live, personId, USER_B),
    ephemeral('This one is for Skater A.'),
  )
  const reply = await onAnswerButton(t.deps, live, personId, USER_A)
  const reporter = REPORTERS[t.store.scrums[0]!.reporter].name
  assert.equal(reply.kind, 'modal')
  if (reply.kind !== 'modal') return
  assert.equal(reply.customId, `press:modal:${String(personId)}:1:0`)
  assert.equal(reply.title, `${reporter} asks`.slice(0, 45))
  assert.ok(reply.title.length <= 45)
  assert.equal(reply.label.length, 45)
  assert.ok(long.startsWith(reply.label.slice(0, 44)))
  assert.equal(reply.maxLength, 500)
  // Past the answer window: too late.
  t.store.people.find((x) => x.id === personId)!.lastAskedAt = new Date(NOW.getTime() - 900_000)
  assert.deepEqual(await onAnswerButton(t.deps, live, personId, USER_A), ephemeral(TOO_LATE))
})

// ── Answer pop-up ──────────────────────────────────────────────────────────

void test('onAnswerSubmit: empty answer is not saved', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?')
  assert.deepEqual(
    await submit(t, config('live'), personId, USER_A, '   \n '),
    ephemeral('No answer saved.'),
  )
  assert.equal(t.store.answerRows.length, 0)
  assert.equal(t.sent.length, 0)
  assert.equal(t.store.people[0]!.currentQuestion, 'Why?')
})

void test('onAnswerSubmit: the echo is escaped and mentions nobody; 600 characters are cut to 500', async () => {
  const m = pressModel({
    judgements: [{ usability: 'usable', followUp: '', closing: 'Thanks, Skater A.' }],
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?', 2)
  const reply = await submit(t, config('live'), personId, USER_A, '  @everyone <@123> **x**  ')
  assert.deepEqual(reply, { kind: 'ack' })
  const echo = t.sent[0]!
  assert.equal(echo.channelId, 'thread-1')
  assert.equal(echo.reporter, t.store.scrums[0]!.reporter)
  assert.equal(echo.msg.content, '**Skater A:** @everyone \\<@123\\> \\*\\*x\\*\\*')
  assert.deepEqual(echo.msg.allowed_mentions, { parse: [] })
  // No link previews (SUPPRESS_EMBEDS).
  assert.equal(echo.msg.flags, 4)

  const t2 = setup({
    model: pressModel({
      judgements: [{ usability: 'usable', followUp: '', closing: 'Thanks, Skater A.' }],
    }).call,
  })
  const id2 = await scrumWithPerson(t2)
  asking(t2, id2, 'Why?', 2)
  await submit(t2, config('live'), id2, USER_A, 'a'.repeat(600))
  assert.equal(t2.store.answerRows[0]!.answer.length, 500)
})

/** Fix a person's panel and target (what the first question would draw), before the first question. */
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

void test('onAnswerSubmit: a picked player gets question 2 from the next reporter of the panel', async () => {
  const m = pressModel({
    questions: ['Skater A, what changed after the first period?', 'Skater A, and the third?'],
    judgements: [{ usability: 'usable', followUp: '', closing: 'Good, thanks.' }],
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  withPanel(t, personId, ['voss', 'mercer', 'vale'], 3)
  await onAccept(t.deps, config('live'), personId, USER_A)
  // Question 1 is Voss's.
  assert.equal(t.sent.at(-1)!.reporter, 'voss')
  const reply = await submit(t, config('live'), personId, USER_A, 'We stopped chasing the puck.')
  assert.deepEqual(reply, { kind: 'ack' })
  const row = t.store.answerRows[0]!
  assert.equal(row.question, 'Skater A, what changed after the first period?')
  assert.equal(row.answer, 'We stopped chasing the puck.')
  assert.equal(row.usability, 'usable')
  assert.equal(row.reporter, 'voss')
  assert.equal(row.scrumId, 1)
  assert.equal(row.playerId, 1)
  assert.equal(row.night, t.store.scrums[0]!.night)
  assert.equal(row.isTest, false)
  const p = t.store.people[0]!
  assert.equal(p.status, 'asking')
  assert.equal(p.questionsAsked, 2)
  assert.equal(p.currentQuestion, 'Skater A, and the third?')
  // Question 2 is Dex Mercer's own post, in the same thread.
  const q2 = t.sent.at(-1)!
  assert.equal(q2.reporter, 'mercer')
  assert.equal(q2.msg.content, `<@${USER_A}> Skater A, and the third?`)
  // The judgement saw the question being answered; usage has no job.
  const judge = m.reqs.find((r) => r.schema === JUDGEMENT_SCHEMA)!
  assert.match(judge.user, /what changed after the first period/)
  assert.match(judge.user, /We stopped chasing the puck/)
  assert.ok(t.store.usage.length >= 4)
  assert.ok(t.store.usage.every((u) => u.jobId === null))
})

void test('onAnswerSubmit: a volunteer is asked by 2 reporters, no follow-up, then gets the closing', async () => {
  const m = pressModel({
    questions: ['Skater B, how did the second period feel?', 'Skater B, and the power play?'],
    judgements: [
      // The model offers a follow-up: a volunteer gets none.
      { usability: 'usable', followUp: 'And the power play?', closing: 'Noted.' },
      { usability: 'joke', followUp: 'Another one?', closing: 'Ha. Thanks, Skater B.' },
    ],
  })
  const t = setup({ model: m.call })
  await liveScrum(t)
  const live = config('live')
  await onTalk(t.deps, live, 10, USER_B)
  const p = t.store.people[0]!
  assert.equal(p.role, 'volunteer')
  assert.equal(p.panel.length, 2)
  assert.equal(p.targetTotal, 2)
  assert.notEqual(p.panel[0], p.panel[1])
  const [first, second] = p.panel
  assert.equal(t.sent.at(-1)!.reporter, first)
  await submit(t, live, p.id, USER_B, 'It felt slow.')
  assert.equal(p.followupsAsked, 0)
  assert.equal(p.questionsAsked, 2)
  assert.equal(p.currentQuestion, 'Skater B, and the power play?')
  assert.equal(t.sent.at(-1)!.reporter, second)
  // A stale second pop-up (opened for question 1) is not the answer to question 2.
  assert.deepEqual(
    await onAnswerSubmit(t.deps, live, p.id, USER_B, 'Late copy.', {
      questionsAsked: 1,
      followupsAsked: 0,
    }),
    ephemeral('Already answered.'),
  )
  assert.equal(t.store.answerRows.length, 1)

  await submit(t, live, p.id, USER_B, 'We were saving energy for the playoffs.')
  assert.equal(p.status, 'done')
  assert.equal(p.currentQuestion, null)
  assert.equal(p.followupsAsked, 0)
  const last = t.sent.at(-1)!
  assert.equal(last.reporter, second)
  assert.equal(last.msg.content, `<@${USER_B}> Ha. Thanks, Skater B.`)
  assert.equal(last.msg.components, undefined)
  assert.deepEqual(
    t.store.answerRows.map((a) => [a.question, a.usability, a.reporter]),
    [
      ['Skater B, how did the second period feel?', 'usable', first],
      ['Skater B, and the power play?', 'joke', second],
    ],
  )
})

void test('onAnswerSubmit: an unusable answer is stored as unusable', async () => {
  const m = pressModel({
    judgements: [{ usability: 'unusable', followUp: '', closing: 'Fair enough. Next game.' }],
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?', 2)
  await submit(t, config('live'), personId, USER_A, 'my boss yelled at me all day')
  assert.equal(t.store.answerRows[0]!.usability, 'unusable')
  assert.equal(t.store.people[0]!.status, 'done')
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> Fair enough. Next game.`)
})

void test('onAnswerSubmit: the pop-up answer is echoed right after the submit, before the judgement', async () => {
  const m = pressModel({
    judgements: [{ usability: 'usable', followUp: '', closing: 'Thanks, Skater A.' }],
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?', 2)
  let echoedBeforeJudgement = false
  const call = t.deps.call
  t.deps.call = (req) => {
    if (t.sent.some((s) => s.msg.content.startsWith('**Skater A:**'))) echoedBeforeJudgement = true
    return call(req)
  }
  await submit(t, config('live'), personId, USER_A, 'We pushed hard.')
  assert.equal(echoedBeforeJudgement, true)
  const echo = t.sent.find((s) => s.msg.content.startsWith('**Skater A:**'))!
  assert.equal(echo.msg.content, '**Skater A:** We pushed hard.')
  assert.equal(echo.msg.flags, 4)
  assert.deepEqual(echo.msg.allowed_mentions, { parse: [] })
})

void test('onAnswerSubmit: an answer naming a Leave me out person is unusable: no model call, no echo', async () => {
  const m = pressModel({ questions: ['Skater A, and the third period?'] })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?')
  assert.deepEqual(
    await submit(t, config('live'), personId, USER_A, 'Ask hidden hank, he saw it.'),
    { kind: 'ack' },
  )
  assert.equal(t.store.answerRows[0]!.usability, 'unusable')
  assert.ok(!m.reqs.some((r) => r.schema === JUDGEMENT_SCHEMA))
  assert.ok(!t.sent.some((s) => s.msg.content.includes('hidden hank')))
  // The normal next step: question 2 (no follow-up).
  const p = t.store.people[0]!
  assert.equal(p.questionsAsked, 2)
  assert.equal(p.followupsAsked, 0)
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> Skater A, and the third period?`)
})

void test('onAnswerSubmit: an unusable answer is echoed too (the player sees it), then acknowledged; it is never quoted later', async () => {
  const m = pressModel({
    judgements: [{ usability: 'unusable', followUp: '', closing: 'Fair enough. Next game.' }],
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?', 2)
  await submit(t, config('live'), personId, USER_A, 'my boss yelled at me all day')
  assert.equal(t.sent[0]!.msg.content, '**Skater A:** my boss yelled at me all day')
  // The closing is the model's own line, never the answer repeated.
  assert.equal(t.sent.length, 2)
  assert.equal(t.sent[1]!.msg.content, `<@${USER_A}> Fair enough. Next game.`)
  assert.equal(t.store.answerRows[0]!.usability, 'unusable')
})

void test('onAnswerSubmit: extras budget spent → stored unusable, fallback closing, no model call', async () => {
  const t = setup()
  t.store.spend = 16
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?')
  assert.deepEqual(await submit(t, config('live'), personId, USER_A, 'We pushed hard.'), {
    kind: 'ack',
  })
  assert.equal(t.modelCalls.length, 0)
  assert.equal(t.store.answerRows[0]!.usability, 'unusable')
  const p = t.store.people[0]!
  assert.equal(p.status, 'done')
  // A neutral closing from the asking reporter's own pool, not the one stock line.
  const last = t.sent.at(-1)!
  assert.ok(isPoolLine('closing', last, USER_A), last.msg.content)
})

void test('onAnswerSubmit: a double submit stores one answer', async () => {
  const m = pressModel({
    judgements: [{ usability: 'usable', followUp: '', closing: 'Thanks, Skater A.' }],
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?', 2)
  const live = config('live')
  const replies = await Promise.all([
    submit(t, live, personId, USER_A, 'First.'),
    submit(t, live, personId, USER_A, 'First.'),
  ])
  assert.deepEqual(replies, [{ kind: 'ack' }, ephemeral('Already answered.')])
  assert.equal(t.store.answerRows.length, 1)
  assert.equal(t.sent.filter((s) => s.msg.content.startsWith('**Skater A:**')).length, 1)
})

void test('onAnswerSubmit: another user, or after the answer window, changes nothing', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?')
  const live = config('live')
  assert.deepEqual(
    await submit(t, live, personId, USER_B, 'x'),
    ephemeral('This one is for Skater A.'),
  )
  t.store.people[0]!.lastAskedAt = new Date(NOW.getTime() - 900_000)
  assert.deepEqual(await submit(t, live, personId, USER_A, 'x'), ephemeral(TOO_LATE))
  assert.equal(t.store.answerRows.length, 0)
  assert.equal(t.sent.length, 0)
})

// ── /scrum ─────────────────────────────────────────────────────────────────

void test('/scrum with no options volunteers for the latest game the user played', async () => {
  const t = setup()
  await liveScrum(t)
  const reply = await onScrumCommand(t.deps, config('live'), USER_B, {
    player: null,
    random: false,
  })
  assert.deepEqual(reply, ephemeral("The reporter's question is in the scrum thread."))
  const p = t.store.people[0]!
  assert.equal(p.playerId, 2)
  assert.equal(p.requestedBy, 'self')
  assert.equal(p.status, 'asking')
  // No game in the last 6 hours for a player who did not play.
  t.store.discordIds.set(4, USER_C)
  assert.deepEqual(
    await onScrumCommand(t.deps, config('live'), USER_C, { player: null, random: false }),
    ephemeral('No game with the press in the last 6 hours.'),
  )
})

void test('/scrum @player: picks a candidate for the pass to ping; refuses a non-candidate', async () => {
  const t = setup()
  await liveScrum(t)
  const live = config('live')
  t.store.discordIds.set(4, USER_C)
  t.store.played.set(90001, [1, 2, 3, 4])
  // Player 4 played but is not on the sheet's people (a guest / Leave me out).
  assert.deepEqual(
    await onScrumCommand(t.deps, live, USER_A, { player: USER_C, random: false }),
    ephemeral("Player 4 can't be asked about this game."),
  )
  const reply = await onScrumCommand(t.deps, live, USER_A, { player: USER_B, random: false })
  assert.equal(reply.kind, 'ephemeral')
  const p = t.store.people[0]!
  assert.equal(p.playerId, 2)
  assert.equal(p.discordUserId, USER_B)
  assert.equal(p.role, 'picked')
  assert.equal(p.requestedBy, 'command')
  assert.equal(p.requestedByUserId, USER_A)
  assert.equal(p.status, 'pinged')
  assert.equal(p.pingedAt, null)
  assert.equal(t.sent.length, 0)
})

void test('/scrum random: twice a night per user', async () => {
  const t = setup()
  await liveScrum(t)
  const live = config('live')
  // Two command uses tonight already.
  for (const playerId of [5, 6]) {
    await t.store.insertScrumPerson({
      scrumId: 1,
      playerId,
      discordUserId: USER_C,
      role: 'picked',
      requestedBy: 'command',
      requestedByUserId: USER_A,
    })
  }
  assert.deepEqual(
    await onScrumCommand(t.deps, live, USER_A, { player: null, random: true }),
    ephemeral("You've used that twice tonight."),
  )
  assert.equal(t.store.people.length, 2)
  // Another user: random picks a candidate other than themselves.
  const reply = await onScrumCommand(t.deps, live, USER_B, { player: null, random: true })
  assert.equal(reply.kind, 'ephemeral')
  const p = t.store.people[2]!
  assert.equal(p.playerId, 1)
  assert.equal(p.requestedBy, 'command')
})

/** `n` pings of `requestedBy` for `playerId` tonight, each in its own earlier scrum. */
function earlierPings(
  t: ReturnType<typeof setup>,
  playerId: number,
  requestedBy: 'auto' | 'command' | 'gm',
  n: number,
) {
  for (let i = 0; i < n; i++) {
    const id = t.store.scrums.length + 1
    t.store.scrums.push({ ...t.store.scrums[0]!, id, recapItemId: 1000 + id, matchId: 80000 + id })
    void t.store.insertScrumPerson({
      scrumId: id,
      playerId,
      discordUserId: playerId === 1 ? USER_A : USER_B,
      role: 'picked',
      requestedBy,
      status: 'done',
      pingedAt: NOW,
    })
  }
}

void test('/scrum @player: a player with 2 pings tonight has been asked enough; GM pings do not count', async () => {
  const t = setup()
  await liveScrum(t)
  const live = config('live')
  earlierPings(t, 2, 'auto', 1)
  earlierPings(t, 2, 'command', 1)
  const before = t.store.people.length
  assert.deepEqual(
    await onScrumCommand(t.deps, live, USER_A, { player: USER_B, random: false }),
    ephemeral('Skater B has been asked enough tonight.'),
  )
  assert.equal(t.store.people.length, before)
  // GM pings are not limited, and do not count.
  const t2 = setup()
  await liveScrum(t2)
  earlierPings(t2, 2, 'gm', 2)
  assert.deepEqual(
    await onScrumCommand(t2.deps, live, USER_A, { player: USER_B, random: false }),
    ephemeral(`${REPORTERS[t2.store.scrums[0]!.reporter].name} will ping Skater B.`),
  )
})

void test('/scrum random: skips players with 2 pings tonight', async () => {
  const t = setup()
  await liveScrum(t)
  const live = config('live')
  // Skater A is capped: random must not choose them.
  earlierPings(t, 1, 'auto', 2)
  const before = t.store.people.length
  assert.deepEqual(
    await onScrumCommand(t.deps, live, USER_B, { player: null, random: true }),
    ephemeral('Nobody else can be asked about this game.'),
  )
  assert.equal(t.store.people.length, before)
  // The goalie (no Discord in the fakes) gets a link: random picks them, not Skater A.
  t.store.discordIds.set(3, USER_C)
  const reply = await onScrumCommand(t.deps, live, USER_B, { player: null, random: true })
  assert.equal(reply.kind, 'ephemeral')
  assert.equal(t.store.people.at(-1)!.playerId, 3)
  assert.equal(t.store.people.at(-1)!.scrumId, 1)
})

void test('onAnswerSubmit: picked, target 4 — the one follow-up goes to the answer with the most to chase', async () => {
  const m = pressModel({
    questions: ['Q one?', 'Q two?', 'Q three?'],
    judgements: [
      // Q1: a small opening only: the follow-up is not used.
      { usability: 'usable', chase: 'some', followUp: 'Skip this?', closing: 'Good.' },
      // Q2: a lot to chase: Mercer follows up.
      { usability: 'usable', chase: 'strong', followUp: 'And then?', closing: 'Good.' },
      // The follow-up's answer: no second follow-up.
      { usability: 'usable', chase: 'strong', followUp: 'And after that?', closing: 'Good.' },
      {
        usability: 'usable',
        chase: 'strong',
        followUp: 'Once more?',
        closing: 'Thanks, Skater A.',
      },
    ],
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  const live = config('live')
  withPanel(t, personId, ['voss', 'mercer', 'vale'], 4)
  await onAccept(t.deps, live, personId, USER_A)
  const p = t.store.people[0]!
  await submit(t, live, personId, USER_A, 'We slowed down.')
  assert.equal(p.questionsAsked, 2)
  assert.equal(p.followupsAsked, 0)
  await submit(t, live, personId, USER_A, 'We held on.')
  assert.equal(p.followupsAsked, 1)
  assert.equal(p.askingFollowup, true)
  const fu = t.sent.at(-1)!
  assert.equal(fu.reporter, 'mercer')
  assert.equal(fu.msg.content, `<@${USER_A}> And then?`)
  // The follow-up's answer goes on to Rico Vale's question 3, not a second follow-up.
  await submit(t, live, personId, USER_A, 'Then we lost.')
  assert.equal(p.questionsAsked, 3)
  assert.equal(t.sent.at(-1)!.reporter, 'vale')
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> Q three?`)
  await submit(t, live, personId, USER_A, 'We were tired.')
  assert.equal(p.status, 'done')
  assert.equal(p.followupsAsked, 1)
  assert.ok(!t.sent.some((s) => s.msg.content.includes('Once more?')))
  assert.ok(!t.sent.some((s) => s.msg.content.includes('And after that?')))
  assert.equal(t.sent.at(-1)!.reporter, 'vale')
  assert.deepEqual(
    t.store.answerRows.map((a) => a.reporter),
    ['voss', 'mercer', 'mercer', 'vale'],
  )
})

void test('onAnswerSubmit: an old one-reporter round (no panel) keeps its old limits', async () => {
  const m = pressModel({
    questions: ['Skater A, and the third?'],
    judgements: [
      { usability: 'usable', followUp: 'And then?', closing: 'Good.' },
      { usability: 'usable', followUp: 'Again?', closing: 'Good.' },
    ],
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  const live = config('live')
  // Question 1 was asked before panels: no panel, no target.
  asking(t, personId, 'Why?')
  const p = t.store.people[0]!
  assert.deepEqual(p.panel, [])
  await submit(t, live, personId, USER_A, 'We slowed down.')
  assert.equal(p.askingFollowup, true)
  assert.equal(t.sent.at(-1)!.reporter, t.store.scrums[0]!.reporter)
  await submit(t, live, personId, USER_A, 'We changed lines.')
  assert.equal(p.questionsAsked, 2)
  assert.equal(p.followupsAsked, 1)
  assert.equal(p.askingFollowup, false)
  assert.equal(p.currentQuestion, 'Skater A, and the third?')
  // The scrum's own reporter asks it, and the panel is now the scrum's reporter alone.
  assert.equal(t.sent.at(-1)!.reporter, t.store.scrums[0]!.reporter)
  assert.deepEqual(p.panel, [t.store.scrums[0]!.reporter])
  assert.equal(p.targetTotal, null)
  assert.ok(!t.sent.some((s) => s.msg.content.includes('Again?')))
})

void test('onTalk: the question could not be posted → the reporter will be right with you', async () => {
  const t = setup()
  await liveScrum(t)
  t.threadFails(new Error('Discord bot HTTP 500'))
  assert.deepEqual(
    await onTalk(t.deps, config('live'), 10, USER_B),
    ephemeral('The reporter will be right with you.'),
  )
  // The volunteer is in, with the answer window running: the expiry pass ends the round.
  assert.equal(t.store.people[0]!.status, 'asking')
  assert.equal(t.store.people[0]!.lastAskedAt?.getTime(), NOW.getTime())
})

void test('/scrum @self is /scrum: a volunteer, no command use', async () => {
  const t = setup()
  await liveScrum(t)
  assert.deepEqual(
    await onScrumCommand(t.deps, config('live'), USER_B, { player: USER_B, random: false }),
    ephemeral("The reporter's question is in the scrum thread."),
  )
  const p = t.store.people[0]!
  assert.equal(p.playerId, 2)
  assert.equal(p.role, 'volunteer')
  assert.equal(p.requestedBy, 'self')
  assert.equal(await t.store.countCommandUsesTonight(USER_B, t.store.scrums[0]!.night), 0)
})

// ── Typed answers ──────────────────────────────────────────────────────────

const typed = (t: ReturnType<typeof setup>, userId: string, text: string, threadId = 'thread-1') =>
  onTypedAnswer(t.deps, config('live'), { threadId, userId, text })

void test('typed answer: the asked player counts like the pop-up (same store, same next step), no echo', async () => {
  const judgement = { usability: 'usable', followUp: '', closing: 'Thanks, Skater A.' }
  const typedRun = setup({ model: pressModel({ judgements: [judgement] }).call })
  const typedId = await scrumWithPerson(typedRun)
  asking(typedRun, typedId, 'Why?', 2)
  await typed(typedRun, USER_A, '  We pushed hard.  ')

  const popRun = setup({ model: pressModel({ judgements: [judgement] }).call })
  const popId = await scrumWithPerson(popRun)
  asking(popRun, popId, 'Why?', 2)
  await submit(popRun, config('live'), popId, USER_A, 'We pushed hard.')

  const row = typedRun.store.answerRows[0]!
  assert.deepEqual(typedRun.store.answerRows, popRun.store.answerRows)
  assert.equal(row.answer, 'We pushed hard.')
  assert.equal(row.usability, 'usable')
  assert.equal(typedRun.store.people[0]!.status, 'done')
  assert.equal(typedRun.store.people[0]!.currentQuestion, null)
  // The reporter's closing is posted in the thread; the answer is not echoed again.
  assert.equal(typedRun.sent.length, 1)
  assert.equal(typedRun.sent[0]!.channelId, 'thread-1')
  assert.equal(typedRun.sent[0]!.msg.content, `<@${USER_A}> Thanks, Skater A.`)
  assert.ok(!typedRun.sent.some((s) => s.msg.content.startsWith('**Skater A:**')))
  // The pop-up path did echo.
  assert.equal(popRun.sent.length, 2)
})

void test('typed answer: question 1 of a picked player goes on to question 2 in the thread', async () => {
  const m = pressModel({
    questions: ['Skater A, and the third period?'],
    judgements: [{ usability: 'usable', followUp: '', closing: 'Thanks.' }],
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?')
  await typed(t, USER_A, 'We pushed hard.')
  const p = t.store.people[0]!
  assert.equal(p.questionsAsked, 2)
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> Skater A, and the third period?`)
})

void test('typed answer: ignored for another user, in another thread, with no open question', async () => {
  const m = pressModel({ judgements: [] })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?', 2)
  await typed(t, USER_B, 'I will answer for him.')
  await typed(t, STRANGER, 'Hello?')
  await typed(t, USER_A, 'Wrong thread.', 'other-thread')
  assert.equal(t.store.answerRows.length, 0)
  assert.equal(t.sent.length, 0)
  assert.equal(t.modelCalls.length, 0)
  assert.equal(t.store.people[0]!.currentQuestion, 'Why?')

  // No question open (accepted, the last answer is being judged): ignored.
  t.store.people[0]!.currentQuestion = null
  await typed(t, USER_A, 'Early.')
  // Not asking any more: ignored.
  t.store.people[0]!.currentQuestion = 'Why?'
  t.store.people[0]!.status = 'done'
  await typed(t, USER_A, 'Late.')
  assert.equal(t.store.answerRows.length, 0)
  assert.equal(t.sent.length, 0)
  assert.equal(t.modelCalls.length, 0)
})

void test('typed answer: after the answer window nothing is stored or posted', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?')
  t.store.people[0]!.lastAskedAt = new Date(NOW.getTime() - 900_000)
  await typed(t, USER_A, 'Too slow.')
  assert.equal(t.store.answerRows.length, 0)
  assert.equal(t.sent.length, 0)
  assert.ok(t.logs.some((l) => l.includes('typed answer') && l.includes('not taken')))
})

void test('typed answer: empty text is not saved; 600 characters are cut to 500', async () => {
  const t = setup({
    model: pressModel({
      judgements: [{ usability: 'usable', followUp: '', closing: 'Thanks.' }],
    }).call,
  })
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?', 2)
  await typed(t, USER_A, '   ')
  assert.equal(t.store.answerRows.length, 0)
  assert.equal(t.store.people[0]!.currentQuestion, 'Why?')
  await typed(t, USER_A, 'a'.repeat(600))
  assert.equal(t.store.answerRows[0]!.answer.length, 500)
})

void test('typed answer: a typed message and a pop-up submit at once store one answer', async () => {
  const m = pressModel({
    judgements: [{ usability: 'usable', followUp: '', closing: 'Thanks, Skater A.' }],
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?', 2)
  // The pop-up was opened before the typed message arrived: it holds the same counters.
  const [, popup] = await Promise.all([
    typed(t, USER_A, 'Typed.'),
    submit(t, config('live'), personId, USER_A, 'Pop-up.'),
  ])
  // Whichever claims first wins; the other is refused (a typed refusal is only logged).
  assert.equal(t.store.answerRows.length, 1)
  const typedWon = t.store.answerRows[0]!.answer === 'Typed.'
  if (typedWon) assert.deepEqual(popup, ephemeral('Already answered.'))
  else assert.ok(t.logs.some((l) => l.includes('not taken (Already answered.)')))
  // A second typed message finds no open question.
  await typed(t, USER_A, 'Typed again.')
  assert.equal(t.store.answerRows.length, 1)
})

void test('typed answer: a stale pop-up cannot answer the question after a typed answer', async () => {
  const m = pressModel({
    questions: ['Skater A, and the third period?'],
    judgements: [{ usability: 'usable', followUp: '', closing: 'Thanks.' }],
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?')
  const stale = { questionsAsked: 1, followupsAsked: 0 }
  await typed(t, USER_A, 'We pushed hard.')
  assert.equal(t.store.people[0]!.questionsAsked, 2)
  assert.deepEqual(
    await onAnswerSubmit(t.deps, config('live'), personId, USER_A, 'Late pop-up.', stale),
    ephemeral('Already answered.'),
  )
  assert.equal(t.store.answerRows.length, 1)
})

void test('typed answer: an unusable verdict is stored unusable and never echoed', async () => {
  const m = pressModel({
    judgements: [{ usability: 'unusable', followUp: '', closing: 'Fair enough. Next game.' }],
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?', 2)
  await typed(t, USER_A, 'my boss yelled at me all day')
  assert.equal(t.store.answerRows[0]!.usability, 'unusable')
  assert.equal(t.sent.length, 1)
  assert.equal(t.sent[0]!.msg.content, `<@${USER_A}> Fair enough. Next game.`)
})

void test('a judgement that fails closed is logged with its reason (never the answer)', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?', 2)
  await submit(t, config('live'), personId, USER_A, 'We pushed hard.')
  assert.equal(t.store.answerRows[0]!.usability, 'unusable')
  assert.ok(
    t.logs.some((l) => l.includes('judgement failed closed') && !l.includes('We pushed hard')),
  )
})
