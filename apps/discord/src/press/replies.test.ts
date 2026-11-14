import test from 'node:test'
import assert from 'node:assert/strict'
import type { ModelCall } from '../news/writer.ts'
import { escapeMarkdown } from '../message.ts'
import { JUDGEMENT_SCHEMA } from './asker.ts'
import { createMessageRouter, type MessageInput } from './gateway.ts'
import { interviewModel, interviewSetup } from './interview-fakes.ts'
import { onGmInterview, onInterviewAccept } from './interview.ts'
import { onAnswerSubmit } from './interactions.ts'
import { runPressPass } from './pass.ts'
import { onThreadMessage, replyTargetProblem, type ReferencedMessage } from './replies.ts'
import { GM, NOW, USER_A, USER_B, config, scrumWithPerson, setup } from './test-fakes.ts'

type Judgement = { usability: string; chase?: string; followUp: string; closing: string }

/** A fake model: questions and judgements in order; every review passes. */
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

/** A question with characters the bots escape: the reply match must use the posted text. */
const QUESTION = 'Why the 3-2 loss?'
const live = config('live')
const SECRET = 'my-private-words'

function asking(t: ReturnType<typeof setup>, id: number, question = QUESTION, asked = 1) {
  const p = t.store.people.find((x) => x.id === id)!
  p.status = 'asking'
  p.questionsAsked = asked
  p.currentQuestion = question
  p.lastAskedAt = NOW
  t.store.scrums[0]!.threadId = 'thread-1'
  return p
}

/** The reporter's question message as Barlow reads it. */
const questionRef = (
  personId: number,
  question = QUESTION,
  userId = USER_A,
  kind = 'answer',
): ReferencedMessage => ({
  messageId: 'q-msg',
  authorId: 'bot-voss',
  content: `<@${userId}> ${escapeMarkdown(question)}`,
  customIds: [`press:${kind}:${String(personId)}`],
})

const said = (
  t: ReturnType<typeof setup>,
  text: string,
  extra: { reference?: ReferencedMessage | null; messageId?: string; userId?: string } = {},
) =>
  onThreadMessage(t.deps, live, {
    threadId: 'thread-1',
    userId: extra.userId ?? USER_A,
    text,
    messageId: extra.messageId ?? 'answer-msg',
    reference: extra.reference ?? null,
  })

// ── Item 1: which message answers ─────────────────────────────────────────

void test('replyTargetProblem: plain messages pass; a reply passes only for the current question', () => {
  assert.equal(replyTargetProblem(null, 'press:answer:1', USER_A, QUESTION), null)
  assert.equal(replyTargetProblem(questionRef(1), 'press:answer:1', USER_A, QUESTION), null)
  assert.equal(
    replyTargetProblem(questionRef(1, 'Old one?'), 'press:answer:1', USER_A, QUESTION),
    'a reply to an earlier question',
  )
  assert.equal(
    replyTargetProblem(questionRef(2), 'press:answer:1', USER_A, QUESTION),
    'a reply to another message',
  )
  assert.equal(
    replyTargetProblem(
      { messageId: 'x', authorId: USER_B, content: 'lol', customIds: [] },
      'press:answer:1',
      USER_A,
      QUESTION,
    ),
    'a reply to another message',
  )
  assert.equal(
    replyTargetProblem(
      { messageId: 'x', authorId: null, content: null, customIds: [] },
      'press:answer:1',
      USER_A,
      QUESTION,
    ),
    'a reply to a message that could not be read',
  )
})

void test('scrum: a Reply to the current question is its answer; one log line, never the text', async () => {
  const t = setup({
    model: pressModel({ judgements: [{ usability: 'usable', followUp: '', closing: 'Thanks.' }] }),
  })
  const personId = await scrumWithPerson(t)
  asking(t, personId, QUESTION, 2)
  await said(t, `Pucks deep. ${SECRET}`, { reference: questionRef(personId) })
  assert.equal(t.store.answerRows.length, 1)
  assert.equal(t.store.answerRows[0]!.question, QUESTION)
  const lines = t.logs.filter((l) => l.startsWith('[press] thread message:'))
  assert.deepEqual(lines, [
    `[press] thread message: thread thread-1 user ${USER_A}: person ${String(personId)}: taken`,
  ])
  assert.ok(!t.logs.some((l) => l.includes(SECRET)))
})

void test('scrum: replies to an old question, to someone else’s question or to another message are ignored', async () => {
  const t = setup({ model: pressModel() })
  const personId = await scrumWithPerson(t)
  asking(t, personId, QUESTION, 2)
  await said(t, 'old', { reference: questionRef(personId, 'Earlier question?') })
  await said(t, 'theirs', { reference: questionRef(personId + 1, QUESTION, USER_B) })
  await said(t, 'chat', {
    reference: { messageId: 'c', authorId: USER_B, content: 'nice game', customIds: [] },
  })
  await said(t, 'gone', {
    reference: { messageId: 'd', authorId: null, content: null, customIds: [] },
  })
  assert.equal(t.store.answerRows.length, 0)
  assert.equal(t.sent.length, 0)
  assert.equal(t.store.people[0]!.currentQuestion, QUESTION)
  const p = String(personId)
  assert.deepEqual(
    t.logs
      .filter((l) => l.startsWith('[press] thread message:'))
      .map((l) => l.replace(`[press] thread message: thread thread-1 user ${USER_A}: `, '')),
    [
      `not taken (person ${p}: a reply to an earlier question)`,
      `not taken (person ${p}: a reply to another message)`,
      `not taken (person ${p}: a reply to another message)`,
      `not taken (person ${p}: a reply to a message that could not be read)`,
    ],
  )
})

void test('scrum: a plain message still answers (T1); someone without a question gets a log line only', async () => {
  const t = setup({
    model: pressModel({ judgements: [{ usability: 'usable', followUp: '', closing: 'Thanks.' }] }),
  })
  const personId = await scrumWithPerson(t)
  asking(t, personId, QUESTION, 2)
  await said(t, 'heckle', { userId: USER_B })
  await said(t, 'We pushed hard.')
  assert.equal(t.store.answerRows.length, 1)
  assert.deepEqual(
    t.logs.filter((l) => l.startsWith('[press] thread message:')),
    [
      `[press] thread message: thread thread-1 user ${USER_B}: not taken (no open question for this user here)`,
      `[press] thread message: thread thread-1 user ${USER_A}: person ${String(personId)}: taken`,
    ],
  )
})

// ── Item 2: the reporter's lines reply to the answer ──────────────────────

void test('scrum: after a typed answer the follow-up replies to the typed message', async () => {
  const t = setup({
    model: pressModel({
      judgements: [
        { usability: 'usable', chase: 'strong', followUp: 'And the third?', closing: 'Ok.' },
      ],
    }),
  })
  const personId = await scrumWithPerson(t)
  asking(t, personId, QUESTION, 1)
  await said(t, 'We pushed hard.', { messageId: 'typed-1' })
  const line = t.sent.at(-1)!
  assert.equal(line.msg.content, `<@${USER_A}> And the third?`)
  assert.deepEqual(line.msg.message_reference, { message_id: 'typed-1', fail_if_not_exists: false })
})

void test('scrum: after a pop-up answer the closing replies to the echo', async () => {
  const t = setup({
    model: pressModel({
      judgements: [{ usability: 'usable', followUp: '', closing: 'Thanks, Skater A.' }],
    }),
  })
  const personId = await scrumWithPerson(t)
  asking(t, personId, QUESTION, 2)
  const before = t.sent.length
  await onAnswerSubmit(t.deps, live, personId, USER_A, 'We pushed hard.', {
    questionsAsked: 2,
    followupsAsked: 0,
  })
  const [echo, closing] = t.sent.slice(before)
  assert.equal(echo!.msg.content, '**Skater A:** We pushed hard.')
  assert.equal(echo!.msg.message_reference, undefined)
  assert.equal(closing!.msg.content, `<@${USER_A}> Thanks, Skater A.`)
  // The fake Discord numbers its messages: the echo was sent-N.
  assert.deepEqual(closing!.msg.message_reference, {
    message_id: `sent-${String(before + 1)}`,
    fail_if_not_exists: false,
  })
})

void test('scrum: an unusable answer gets its acknowledgement as a reply too', async () => {
  const t = setup({
    model: pressModel({
      questions: ['Skater A, and the third period?'],
      judgements: [{ usability: 'unusable', followUp: '', closing: 'Leave that one there.' }],
    }),
  })
  const personId = await scrumWithPerson(t)
  asking(t, personId, QUESTION, 1)
  await said(t, 'asdf', { messageId: 'typed-2' })
  const ack = t.sent.find((s) => s.msg.content === `<@${USER_A}> Leave that one there.`)!
  assert.equal(ack.msg.message_reference?.message_id, 'typed-2')
})

void test('scrum: an answer that names a forbidden person gets no reply reference', async () => {
  const t = setup({
    model: pressModel({ judgements: [{ usability: 'usable', followUp: '', closing: 'Thanks.' }] }),
  })
  const personId = await scrumWithPerson(t)
  asking(t, personId, QUESTION, 2)
  await said(t, 'Ask Hidden Hank about it.', { messageId: 'typed-3' })
  assert.ok(t.sent.length > 0)
  assert.ok(t.sent.every((s) => s.msg.message_reference === undefined))
})

// ── Interviews ────────────────────────────────────────────────────────────

async function activeInterview(m: ReturnType<typeof interviewModel>) {
  const t = interviewSetup({ model: m.call })
  const cfg = { ...live, typedAnswers: true }
  await onGmInterview(t.deps, cfg, GM, { player: USER_A, reporter: 'barlow', topic: null })
  await runPressPass(t.deps, cfg)
  await onInterviewAccept(t.deps, cfg, 1, USER_A)
  const iv = t.store.interviews[0]!
  return { t, cfg, thread: iv.threadId!, iv }
}

void test('interview: a Reply to the current question is the answer; the next reporter line replies to it', async () => {
  const m = interviewModel({
    questions: ['How did the night go for you?'],
    judgements: [
      {
        usability: 'usable',
        chase: 'strong',
        followUp: 'Why were pucks not deep?',
        closing: 'Ok.',
      },
    ],
  })
  const { t, cfg, thread } = await activeInterview(m)
  const before = t.sent.length
  await onThreadMessage(t.deps, cfg, {
    threadId: thread,
    userId: USER_A,
    text: 'We kept working hard out there.',
    messageId: 'iv-typed',
    reference: questionRef(1, 'How did the night go for you?', USER_A, 'ianswer'),
  })
  assert.equal(t.store.ivAnswers.length, 1)
  const followUp = t.sent.slice(before).at(-1)!
  assert.equal(followUp.msg.content, `<@${USER_A}> Why were pucks not deep?`)
  assert.equal(followUp.msg.message_reference?.message_id, 'iv-typed')
  assert.ok(
    t.logs.includes(`[press] thread message: thread ${thread} user ${USER_A}: interview 1: taken`),
  )
})

void test('interview: a Reply to another message is ignored and logged', async () => {
  const m = interviewModel({ questions: ['How did the night go for you?'] })
  const { t, cfg, thread } = await activeInterview(m)
  const before = t.sent.length
  await onThreadMessage(t.deps, cfg, {
    threadId: thread,
    userId: USER_A,
    text: 'reply to an old line',
    messageId: 'x',
    reference: questionRef(1, 'Some earlier question?', USER_A, 'ianswer'),
  })
  assert.equal(t.store.ivAnswers.length, 0)
  assert.equal(t.sent.length, before)
  assert.ok(
    t.logs.includes(
      `[press] thread message: thread ${thread} user ${USER_A}: not taken (interview 1: a reply to an earlier question)`,
    ),
  )
})

// ── The router ────────────────────────────────────────────────────────────

const MSG: MessageInput = {
  channelId: 'thread-1',
  guildId: '300000000000000001',
  userId: USER_A,
  userIsBot: false,
  isPlain: true,
  inThread: true,
  text: 'hi',
  messageId: 'm1',
  reference: questionRef(5),
}

void test('router: a thread message reaches the handler with its id and reply target', async () => {
  const t = setup()
  const got: unknown[] = []
  const route = createMessageRouter({
    deps: t.deps,
    config: live,
    log: () => undefined,
    handler: (_d, _c, msg) => {
      got.push(msg)
      return Promise.resolve()
    },
  })
  await route(MSG)
  assert.deepEqual(got, [
    {
      threadId: 'thread-1',
      userId: USER_A,
      text: 'hi',
      messageId: 'm1',
      reference: questionRef(5),
    },
  ])
})

void test('router: a Reply in the press channel goes to the wire handler only with PRESS_WIRE_REPLIES on', async () => {
  const t = setup()
  const wires: unknown[] = []
  const threadMsgs: unknown[] = []
  const make = (wireReplies: boolean) =>
    createMessageRouter({
      deps: t.deps,
      config: { ...live, wireReplies },
      log: () => undefined,
      handler: (_d, _c, m) => {
        threadMsgs.push(m)
        return Promise.resolve()
      },
      wireHandler: (_d, _c, input) => {
        wires.push(input)
        return Promise.resolve()
      },
    })
  const inChannel: MessageInput = {
    ...MSG,
    channelId: 'chel',
    inThread: false,
    reference: { messageId: 'post-1', authorId: 'bot', content: 'post', customIds: [] },
  }
  await make(false)(inChannel)
  assert.equal(wires.length, 0)
  await make(true)(inChannel)
  await make(true)({ ...inChannel, channelId: 'general' })
  await make(true)({ ...inChannel, reference: null })
  assert.deepEqual(wires, [
    { userId: USER_A, messageId: 'm1', targetMessageId: 'post-1', text: 'hi' },
  ])
  assert.equal(threadMsgs.length, 0)
})
