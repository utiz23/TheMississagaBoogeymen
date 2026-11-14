import test from 'node:test'
import assert from 'node:assert/strict'
import type { ModelCall } from '../news/writer.ts'
import { JUDGEMENT_SCHEMA } from './asker.ts'
import { interviewModel, interviewSetup } from './interview-fakes.ts'
import { onGmInterview, onInterviewAccept } from './interview.ts'
import { onAccept, onTalk } from './interactions.ts'
import { runPressPass } from './pass.ts'
import { onThreadMessage, replyTargetProblem } from './replies.ts'
import { escapeMarkdown } from '../message.ts'
import { startScrumQuestion } from './question.ts'
import { GM, NOW, USER_A, USER_B, config, liveRecap, scrumWithPerson, setup } from './test-fakes.ts'

/**
 * T6: one scrum thread per player (from the ping, or from a step-up line), only the player's
 * messages count there, reporters reply to the player's latest message, and no Answer button
 * while typed answers are on.
 */

const live = config('live')
const typed = { ...live, typedAnswers: true }

type Judgement = { usability: string; chase?: string; followUp: string; closing: string }

function pressModel(script: { questions?: string[]; judgements?: Judgement[] } = {}) {
  const questions = [...(script.questions ?? [])]
  const judgements = [...(script.judgements ?? [])]
  const call: ModelCall = (req) => {
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
  return call
}

const THANKS: Judgement = { usability: 'usable', followUp: '', closing: 'Thanks.' }

/** A scrum with one pinged person (player 1), ping posted by the real pass. Returns the ids. */
async function pinged(
  t: ReturnType<typeof setup>,
  requestedBy: 'auto' | 'gm' | 'command',
  playerId = 1,
) {
  if (t.store.scrums.length === 0) {
    liveRecap(t.store)
    await runPressPass(t.deps, live)
    t.store.scrums[0]!.heat = 'normal'
  }
  const id = (await t.store.insertScrumPerson({
    scrumId: 1,
    playerId,
    discordUserId: playerId === 1 ? USER_A : USER_B,
    role: 'picked',
    requestedBy,
    // A GM ping waits a minute.
    createdAt: new Date(NOW.getTime() - 120_000),
  }))!
  await runPressPass(t.deps, live)
  const person = t.store.people.find((p) => p.id === id)!
  assert.notEqual(person.pingMessageId, null, 'the ping was posted')
  return { id, ping: person.pingMessageId! }
}

// ── One thread per player ───────────────────────────────────────────────────

for (const kind of ['auto', 'gm', 'command'] as const) {
  void test(`a pinged player (${kind}) gets a thread of their own, started from their ping message`, async () => {
    const t = setup()
    const { id, ping } = await pinged(t, kind)
    const before = t.sent.length
    assert.deepEqual(await onAccept(t.deps, live, id, USER_A), { kind: 'ack' })
    assert.deepEqual(t.threads, [
      { channelId: 'chel', messageId: ping, name: 'Skater A — press scrum' },
    ])
    // No step-up line and no shared thread: the first question is the only new post.
    assert.equal(t.sent.length, before + 1)
    const q = t.sent.at(-1)!
    assert.equal(q.channelId, ping)
    assert.match(q.msg.content, new RegExp(`^<@${USER_A}> `))
    assert.equal(q.msg.message_reference, undefined)
    assert.equal(t.store.scrums[0]!.threadId, null)
  })
}

void test('a volunteer: the reporter posts a step-up line under the recap; the thread starts from it', async () => {
  const t = setup({
    model: pressModel({ questions: ['Skater B, how did the second period feel?'] }),
  })
  liveRecap(t.store)
  await runPressPass(t.deps, live)
  const before = t.sent.length
  assert.deepEqual(await onTalk(t.deps, live, 10, USER_B), { kind: 'ack' })
  const [stepUp, question] = t.sent.slice(before)
  const scrum = t.store.scrums[0]!
  assert.equal(stepUp!.channelId, 'chel')
  assert.equal(stepUp!.reporter, scrum.reporter)
  assert.match(stepUp!.msg.content, new RegExp(`^<@${USER_B}> `))
  assert.deepEqual(stepUp!.msg.allowed_mentions, { parse: [], users: [USER_B] })
  assert.equal(stepUp!.msg.message_reference?.message_id, scrum.messageId)
  const stepUpId = `sent-${String(before + 1)}`
  assert.deepEqual(t.threads, [
    { channelId: 'chel', messageId: stepUpId, name: 'Skater B — press scrum' },
  ])
  assert.equal(question!.channelId, stepUpId)
  assert.equal(t.store.people[0]!.pingMessageId, stepUpId)
  assert.equal(scrum.threadId, null)
})

void test('two players of one scrum get two threads, and a later question stays in the same one', async () => {
  const t = setup()
  const a = await pinged(t, 'auto', 1)
  const b = await pinged(t, 'command', 2)
  await onAccept(t.deps, live, a.id, USER_A)
  await onAccept(t.deps, live, b.id, USER_B)
  assert.deepEqual(
    t.threads.map((x) => x.messageId),
    [a.ping, b.ping],
  )
  assert.notEqual(a.ping, b.ping)
  // Question 2 of player A: no new thread, same place.
  t.threads.length = 0
  await startScrumQuestion(t.deps, live, a.id)
  assert.equal(t.threads.length, 0)
  assert.equal(t.sent.at(-1)!.channelId, a.ping)
})

// ── Only the player's own messages count ────────────────────────────────────

void test("in a player's thread another user's message is ignored: no answer, no echo, no screen, no feud points", async () => {
  const t = setup({ model: pressModel({ judgements: [THANKS] }) })
  const { id, ping } = await pinged(t, 'auto')
  await onAccept(t.deps, typed, id, USER_A)
  const before = t.sent.length
  const heckle = (text: string) =>
    onThreadMessage(t.deps, typed, {
      threadId: ping,
      userId: USER_B,
      text,
      messageId: 'heckle-1',
    })
  await heckle('We played well.')
  await heckle('gord ur an asshole')
  assert.equal(t.sent.length, before)
  assert.equal(t.store.answerRows.length, 0)
  assert.equal(t.screened.length, 0)
  assert.equal(t.store.feudRows.length, 0)
  assert.equal(t.store.people[0]!.status, 'asking')
  assert.deepEqual(
    t.logs.filter((l) => l.startsWith('[press] thread message:')),
    [
      `[press] thread message: thread ${ping} user ${USER_B}: not taken (a player's own thread: the message is not the player's)`,
      `[press] thread message: thread ${ping} user ${USER_B}: not taken (a player's own thread: the message is not the player's)`,
    ],
  )
  // The player's own message there still answers, and their own insult still counts.
  await onThreadMessage(t.deps, typed, {
    threadId: ping,
    userId: USER_A,
    text: 'We played well.',
    messageId: 'typed-1',
  })
  assert.equal(t.store.answerRows.length, 1)
  assert.equal(t.screened.length, 1)
})

void test("the player's own insult in their thread (no open question) still counts for a feud", async () => {
  const t = setup()
  const { id, ping } = await pinged(t, 'auto')
  await onAccept(t.deps, typed, id, USER_A)
  t.store.people[0]!.currentQuestion = null
  await onThreadMessage(t.deps, typed, {
    threadId: ping,
    userId: USER_A,
    text: 'gord ur an asshole',
    messageId: 'm',
  })
  assert.ok(t.store.feudRows.length > 0)
})

// ── Reporters reply to the player ───────────────────────────────────────────

void test('every reporter line after the first player message replies to their latest message', async () => {
  const t = setup({
    model: pressModel({
      questions: ['Skater A, how did the first period feel?', 'Skater A, what changed after?'],
      judgements: [THANKS, THANKS],
    }),
  })
  const { id, ping } = await pinged(t, 'auto')
  const p = t.store.people[0]!
  p.panel = ['voss', 'mercer']
  p.targetTotal = 2
  await onAccept(t.deps, typed, id, USER_A)
  const first = t.sent.at(-1)!
  // The first question is not a reply: the player has said nothing yet.
  assert.equal(first.msg.message_reference, undefined)
  const said = (text: string, messageId: string) =>
    onThreadMessage(t.deps, typed, { threadId: ping, userId: USER_A, text, messageId })
  const before = t.sent.length
  await said('Pucks deep.', 'typed-1')
  const second = t.sent.slice(before).at(-1)!
  assert.equal(second.reporter, 'mercer')
  assert.match(second.msg.content, /what changed after/)
  assert.deepEqual(second.msg.message_reference, {
    message_id: 'typed-1',
    fail_if_not_exists: false,
  })
  assert.deepEqual(second.msg.allowed_mentions, { parse: [], users: [USER_A] })
  const mid = t.sent.length
  await said('We tired late.', 'typed-2')
  const closing = t.sent.slice(mid).at(-1)!
  assert.equal(closing.msg.content, `<@${USER_A}> Thanks.`)
  assert.equal(closing.msg.message_reference?.message_id, 'typed-2')
  assert.equal(t.store.people[0]!.status, 'done')
})

void test('the "no answer" closing replies to the latest player message; none said yet: a plain line', async () => {
  const t = setup({
    model: pressModel({
      questions: ['Skater A, how did the first period feel?', 'Skater A, what changed after?'],
      judgements: [THANKS],
    }),
  })
  const a = await pinged(t, 'auto', 1)
  const b = await pinged(t, 'auto', 2)
  for (const p of t.store.people) {
    p.panel = ['voss', 'mercer', 'vale']
    p.targetTotal = 3
  }
  await onAccept(t.deps, typed, a.id, USER_A)
  await onThreadMessage(t.deps, typed, {
    threadId: a.ping,
    userId: USER_A,
    text: 'Pucks deep.',
    messageId: 'typed-1',
  })
  // Player B accepts but never types (model has no more questions: fixed line).
  await onAccept(t.deps, typed, b.id, USER_B)
  for (const p of t.store.people) p.lastAskedAt = new Date(NOW.getTime() - 16 * 60_000)
  const before = t.sent.length
  await runPressPass(t.deps, typed)
  const closings = t.sent.slice(before)
  const ofA = closings.find((s) => s.channelId === a.ping)!
  const ofB = closings.find((s) => s.channelId === b.ping)!
  assert.equal(ofA.msg.message_reference?.message_id, 'typed-1')
  assert.equal(ofB.msg.message_reference, undefined)
})

// ── No Answer button while typed answers are on ─────────────────────────────

void test('typed answers on: questions and follow-ups have no Answer button; off: the button stays', async () => {
  for (const on of [true, false]) {
    const cfg = on ? typed : live
    const t = setup({
      model: pressModel({
        questions: ['Skater A, how did the first period feel?'],
        judgements: [
          { usability: 'usable', chase: 'strong', followUp: 'And the third?', closing: 'Ok.' },
        ],
      }),
    })
    const { id, ping } = await pinged(t, 'auto')
    const p = t.store.people[0]!
    p.panel = ['voss', 'mercer']
    p.targetTotal = 3
    await onAccept(t.deps, cfg, id, USER_A)
    const question = t.sent.at(-1)!
    await onThreadMessage(t.deps, cfg, {
      threadId: ping,
      userId: USER_A,
      text: 'Pucks deep.',
      messageId: 'typed-1',
    })
    const followUp = t.sent.at(-1)!
    assert.match(followUp.msg.content, /And the third\?/)
    for (const line of [question, followUp]) {
      if (on) assert.equal(line.msg.components, undefined)
      else
        assert.match(JSON.stringify(line.msg.components), new RegExp(`press:answer:${String(id)}`))
    }
  }
})

void test('replyTargetProblem: with no Answer button the question text decides', () => {
  const line = `<@${USER_A}> ${escapeMarkdown('Why the 3-2 loss?')}`
  const ref = (content: string, customIds: string[] = []) => ({
    messageId: 'q',
    authorId: 'bot',
    content,
    customIds,
  })
  assert.equal(replyTargetProblem(ref(line), 'press:answer:1', USER_A, 'Why the 3-2 loss?'), null)
  assert.equal(
    replyTargetProblem(ref(`<@${USER_A}> Older?`), 'press:answer:1', USER_A, 'Why the 3-2 loss?'),
    'a reply to an earlier question',
  )
  assert.equal(
    replyTargetProblem(ref('nice game'), 'press:answer:1', USER_A, 'Why the 3-2 loss?'),
    'a reply to another message',
  )
  // Another person's Answer button is still another message, whatever the text.
  assert.equal(
    replyTargetProblem(
      ref(line, ['press:answer:2']),
      'press:answer:1',
      USER_A,
      'Why the 3-2 loss?',
    ),
    'a reply to another message',
  )
})

void test('a Reply to the button-less current question is its answer', async () => {
  const t = setup({ model: pressModel({ judgements: [THANKS] }) })
  const { id, ping } = await pinged(t, 'auto')
  await onAccept(t.deps, typed, id, USER_A)
  const question = t.store.people[0]!.currentQuestion!
  await onThreadMessage(t.deps, typed, {
    threadId: ping,
    userId: USER_A,
    text: 'Pucks deep.',
    messageId: 'typed-1',
    reference: {
      messageId: 'q-msg',
      authorId: 'bot-voss',
      content: `<@${USER_A}> ${escapeMarkdown(question)}`,
      customIds: [],
    },
  })
  assert.equal(t.store.answerRows.length, 1)
})

// ── Old scrums with one shared thread keep working ──────────────────────────

void test('a scrum made before T6 (one shared thread) still takes both players and posts there', async () => {
  const t = setup({ model: pressModel({ judgements: [THANKS, THANKS] }) })
  const a = await scrumWithPerson(t, 1)
  const scrum = t.store.scrums[0]!
  scrum.threadId = 'thread-shared'
  const b = (await t.store.insertScrumPerson({
    scrumId: 1,
    playerId: 2,
    discordUserId: USER_B,
    role: 'picked',
    requestedBy: 'auto',
    pingedAt: NOW,
  }))!
  for (const [id, userId] of [
    [a, USER_A],
    [b, USER_B],
  ] as const) {
    const p = t.store.people.find((x) => x.id === id)!
    p.status = 'asking'
    p.questionsAsked = 2
    p.currentQuestion = 'Why the loss?'
    p.lastAskedAt = NOW
    await onThreadMessage(t.deps, typed, {
      threadId: 'thread-shared',
      userId,
      text: 'We pushed hard.',
      messageId: `m-${userId}`,
    })
  }
  assert.equal(t.store.answerRows.length, 2)
  assert.equal(t.threads.length, 0)
  assert.ok(t.sent.every((s) => s.channelId === 'thread-shared'))
  // A new question in that scrum goes to the shared thread, with no step-up line.
  const p = t.store.people.find((x) => x.id === a)!
  p.status = 'asking'
  p.questionsAsked = 0
  p.pingMessageId = null
  await startScrumQuestion(t.deps, typed, a, 'm-x')
  assert.equal(t.threads.length, 0)
  const q = t.sent.at(-1)!
  assert.equal(q.channelId, 'thread-shared')
  assert.equal(q.msg.message_reference?.message_id, 'm-x')
})

// ── Interviews ──────────────────────────────────────────────────────────────

async function activeInterview(m: ReturnType<typeof interviewModel>, cfg: typeof live) {
  const t = interviewSetup({ model: m.call })
  await onGmInterview(t.deps, cfg, GM, { player: USER_A, reporter: 'barlow', topic: null })
  await runPressPass(t.deps, cfg)
  await onInterviewAccept(t.deps, cfg, 1, USER_A)
  return { t, thread: t.store.interviews[0]!.threadId! }
}

void test('interview: the next question replies to the answer; no Answer button with typed answers on', async () => {
  for (const on of [true, false]) {
    const cfg = on ? typed : live
    const m = interviewModel({
      questions: ['How did the night go for you?', 'What about the third period?'],
      judgements: [{ usability: 'usable', followUp: '', closing: 'Ok.' }],
    })
    const { t, thread } = await activeInterview(m, cfg)
    const first = t.sent.at(-1)!
    assert.equal(first.msg.message_reference, undefined)
    const before = t.sent.length
    await onThreadMessage(t.deps, cfg, {
      threadId: thread,
      userId: USER_A,
      text: 'We kept working hard.',
      messageId: 'iv-typed',
    })
    const next = t.sent.slice(before).at(-1)!
    assert.match(next.msg.content, /third period/)
    assert.equal(next.msg.message_reference?.message_id, 'iv-typed')
    for (const line of [first, next]) {
      if (on) assert.equal(line.msg.components, undefined)
      else assert.match(JSON.stringify(line.msg.components), /press:ianswer:1/)
    }
  }
})

void test('interview: the "no answer" closing replies to the latest player message', async () => {
  const m = interviewModel({
    questions: ['How did the night go for you?', 'What about the third period?'],
    judgements: [{ usability: 'usable', followUp: '', closing: 'Ok.' }],
  })
  const { t, thread } = await activeInterview(m, typed)
  await onThreadMessage(t.deps, typed, {
    threadId: thread,
    userId: USER_A,
    text: 'We kept working hard.',
    messageId: 'iv-typed',
  })
  t.store.interviews[0]!.lastAskedAt = new Date(NOW.getTime() - 2 * 3_600_000)
  const before = t.sent.length
  await runPressPass(t.deps, typed)
  const closing = t.sent.slice(before).find((s) => s.channelId === thread)!
  assert.equal(closing.msg.message_reference?.message_id, 'iv-typed')
})
