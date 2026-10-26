import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTERS } from '@eanhl/db/news'
import type { ModelCall } from '../news/writer.ts'
import { FALLBACK_CLOSING, JUDGEMENT_SCHEMA } from './asker.ts'
import { onAccept, onAnswerButton, onAnswerSubmit, onScrumCommand, onTalk } from './interactions.ts'
import { runPressPass } from './pass.ts'
import {
  GM,
  NOW,
  USER_A,
  USER_B,
  config,
  itemRow,
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

type Judgement = { usability: string; followUp: string; closing: string }

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

void test('trial: only the GM may talk, accept, answer or use /scrum', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  asking(t, personId, 'Why?')
  const trial = config('trial')
  assert.deepEqual(await onTalk(t.deps, trial, 10, USER_A), ephemeral(TRIAL))
  assert.deepEqual(await onAccept(t.deps, trial, personId, USER_A), ephemeral(TRIAL))
  assert.deepEqual(await onAnswerButton(t.deps, trial, personId, USER_A), ephemeral(TRIAL))
  assert.deepEqual(await submit(t, trial, personId, USER_A, 'x'), ephemeral(TRIAL))
  assert.deepEqual(
    await onScrumCommand(t.deps, trial, USER_A, { player: null, random: false }),
    ephemeral(TRIAL),
  )
  // A scrum left over from the trial stays GM-only in live.
  t.store.scrums[0]!.isTest = true
  assert.deepEqual(await submit(t, config('live'), personId, USER_A, 'x'), ephemeral(TRIAL))
  assert.equal(t.store.answerRows.length, 0)
  assert.equal(t.sent.length, 0)
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

// ── Talk to the press ──────────────────────────────────────────────────────

void test('onTalk: closed scrum, a player not in the game, already in it', async () => {
  const t = setup()
  t.store.spend = 100
  const personId = await scrumWithPerson(t)
  t.store.discordIds.set(4, USER_C)
  const live = config('live')
  assert.deepEqual(
    await onTalk(t.deps, live, 10, USER_C),
    ephemeral('This scrum is for players of this game.'),
  )
  assert.deepEqual(
    await onTalk(t.deps, live, 10, USER_A),
    ephemeral("You're already in this scrum."),
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

void test('onTalk in the trial: the GM volunteers as the scrum pick, mentions go to the GM', async () => {
  const t = setup()
  t.store.spend = 100
  // The trial mirrors item 10 into the test channel; the scrum hangs on the mirror.
  t.store.settings.mirrorFromItemId = 0
  t.store.items.push(itemRow({ id: 10, isGameRecap: true }))
  await runPressPass(t.deps, config('trial'))
  assert.equal(t.store.scrums.length, 1)
  assert.equal(t.store.scrums[0]!.isTest, true)
  const reply = await onTalk(t.deps, config('trial'), 10, GM)
  assert.deepEqual(reply, { kind: 'ack' })
  const p = t.store.people[0]!
  // The fixture's pick: Skater A (most points). The stored ID is the player's own.
  assert.equal(p.playerId, 1)
  assert.equal(p.discordUserId, USER_A)
  assert.equal(p.requestedByUserId, GM)
  assert.equal(t.sent.at(-1)!.msg.content, `<@${GM}> Walk me through that one, Skater A.`)
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
  p.pingedAt = new Date(NOW.getTime() - 301_000)
  assert.deepEqual(await onAccept(t.deps, live, personId, USER_A), ephemeral(TOO_LATE))
  assert.equal(p.status, 'pinged')
  p.pingedAt = new Date(NOW.getTime() - 60_000)
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

void test('onAccept in the trial: the GM accepts for the picked player', async () => {
  const t = setup()
  t.store.spend = 100
  const personId = await scrumWithPerson(t)
  t.store.scrums[0]!.isTest = true
  assert.deepEqual(await onAccept(t.deps, config('trial'), personId, GM), { kind: 'ack' })
  assert.equal(t.sent.at(-1)!.msg.content, `<@${GM}> Walk me through that one, Skater A.`)
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

void test('onAnswerSubmit: a picked player gets question 2 after question 1', async () => {
  const m = pressModel({
    questions: ['Skater A, what changed after the first period?', 'Skater A, and the third?'],
    judgements: [{ usability: 'usable', followUp: '', closing: 'Good, thanks.' }],
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  await onAccept(t.deps, config('live'), personId, USER_A)
  const reply = await submit(t, config('live'), personId, USER_A, 'We stopped chasing the puck.')
  assert.deepEqual(reply, { kind: 'ack' })
  const row = t.store.answerRows[0]!
  assert.equal(row.question, 'Skater A, what changed after the first period?')
  assert.equal(row.answer, 'We stopped chasing the puck.')
  assert.equal(row.usability, 'usable')
  assert.equal(row.scrumId, 1)
  assert.equal(row.playerId, 1)
  assert.equal(row.night, t.store.scrums[0]!.night)
  assert.equal(row.isTest, false)
  const p = t.store.people[0]!
  assert.equal(p.status, 'asking')
  assert.equal(p.questionsAsked, 2)
  assert.equal(p.currentQuestion, 'Skater A, and the third?')
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> Skater A, and the third?`)
  // The judgement saw the question being answered; usage has no job.
  const judge = m.reqs.find((r) => r.schema === JUDGEMENT_SCHEMA)!
  assert.match(judge.user, /what changed after the first period/)
  assert.match(judge.user, /We stopped chasing the puck/)
  assert.ok(t.store.usage.length >= 4)
  assert.ok(t.store.usage.every((u) => u.jobId === null))
})

void test('onAnswerSubmit: a volunteer after one question and one follow-up gets the closing', async () => {
  const m = pressModel({
    questions: ['Skater B, how did the second period feel?'],
    judgements: [
      { usability: 'usable', followUp: 'And the power play?', closing: 'Noted.' },
      { usability: 'joke', followUp: 'Another one?', closing: 'Ha. Thanks, Skater B.' },
    ],
  })
  const t = setup({ model: m.call })
  await liveScrum(t)
  const live = config('live')
  await onTalk(t.deps, live, 10, USER_B)
  const p = t.store.people[0]!
  await submit(t, live, p.id, USER_B, 'It felt slow.')
  assert.equal(p.followupsAsked, 1)
  assert.equal(p.currentQuestion, 'And the power play?')
  assert.equal(p.status, 'asking')
  const fu = t.sent.at(-1)!
  assert.equal(fu.msg.content, `<@${USER_B}> And the power play?`)
  assert.deepEqual(fu.msg.allowed_mentions, { parse: [], users: [USER_B] })
  assert.match(JSON.stringify(fu.msg.components), new RegExp(`press:answer:${String(p.id)}`))
  assert.equal(p.askingFollowup, true)
  // A stale second pop-up (opened for question 1) is not the answer to the follow-up.
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
  assert.equal(p.followupsAsked, 1)
  const last = t.sent.at(-1)!
  assert.equal(last.msg.content, `<@${USER_B}> Ha. Thanks, Skater B.`)
  assert.equal(last.msg.components, undefined)
  assert.deepEqual(
    t.store.answerRows.map((a) => [a.question, a.usability]),
    [
      ['Skater B, how did the second period feel?', 'usable'],
      ['And the power play?', 'joke'],
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
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> ${FALLBACK_CLOSING}`)
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
  t.store.spend = 100
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

void test('onAnswerSubmit: picked — no follow-up on Q1, Q2 may get one, never a second', async () => {
  const m = pressModel({
    questions: ['Skater A, what changed after the first period?', 'Skater A, and the third?'],
    judgements: [
      { usability: 'usable', followUp: '', closing: 'Good.' },
      { usability: 'usable', followUp: 'And then?', closing: 'Thanks, Skater A.' },
      { usability: 'usable', followUp: 'And after that?', closing: 'Thanks, Skater A.' },
    ],
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  const live = config('live')
  await onAccept(t.deps, live, personId, USER_A)
  await submit(t, live, personId, USER_A, 'We slowed down.')
  const p = t.store.people[0]!
  assert.equal(p.questionsAsked, 2)
  assert.equal(p.askingFollowup, false)
  await submit(t, live, personId, USER_A, 'We held on.')
  // Q2 is a question: its follow-up is allowed.
  assert.equal(p.followupsAsked, 1)
  assert.equal(p.askingFollowup, true)
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> And then?`)
  await submit(t, live, personId, USER_A, 'Then we lost.')
  assert.equal(p.status, 'done')
  assert.equal(p.followupsAsked, 1)
  assert.ok(!t.sent.some((s) => s.msg.content.includes('And after that?')))
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> Thanks, Skater A.`)
})

void test('onAnswerSubmit: picked — Q1, its follow-up, then question 2 (no second follow-up)', async () => {
  const m = pressModel({
    questions: ['Skater A, what changed after the first period?', 'Skater A, and the third?'],
    judgements: [
      { usability: 'usable', followUp: 'And then?', closing: 'Good.' },
      { usability: 'usable', followUp: 'Again?', closing: 'Good.' },
    ],
  })
  const t = setup({ model: m.call })
  const personId = await scrumWithPerson(t)
  const live = config('live')
  await onAccept(t.deps, live, personId, USER_A)
  await submit(t, live, personId, USER_A, 'We slowed down.')
  const p = t.store.people[0]!
  assert.equal(p.askingFollowup, true)
  await submit(t, live, personId, USER_A, 'We changed lines.')
  assert.equal(p.questionsAsked, 2)
  assert.equal(p.followupsAsked, 1)
  assert.equal(p.askingFollowup, false)
  assert.equal(p.currentQuestion, 'Skater A, and the third?')
  assert.ok(!t.sent.some((s) => s.msg.content.includes('Again?')))
})

void test('onTalk: the question could not be posted → the reporter will be right with you', async () => {
  const t = setup()
  t.store.spend = 100
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
  t.store.spend = 100
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
