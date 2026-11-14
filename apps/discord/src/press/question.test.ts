import test from 'node:test'
import assert from 'node:assert/strict'
import type { ModelCall } from '../news/writer.ts'
import { oct12Response } from '../news/test-fixtures.ts'
import { runPressPass } from './pass.ts'
import { startScrumQuestion } from './question.ts'
import { NOW, GM, USER_A, USER_B, config, itemRow, setup, scrumWithPerson } from './test-fakes.ts'

void test('startScrumQuestion: thread "<Reporter> — <player>", question with the Answer button, asking', async () => {
  const reqs: Parameters<ModelCall>[0][] = []
  const model: ModelCall = (req) => {
    reqs.push(req)
    const json =
      req.purpose === 'write'
        ? { question: 'Skater A, what changed after the first period?' }
        : { ok: true, problems: [] }
    return Promise.resolve({
      json,
      refused: false,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 10, output_tokens: 5 },
    })
  }
  const t = setup({ model })
  const personId = await scrumWithPerson(t)
  t.store.gmNotes = [
    {
      id: 1,
      playerId: 1,
      playerName: 'Skater A',
      note: 'Skater A broke a stick on the post.',
      matchId: 90001,
      critical: true,
    },
    {
      id: 2,
      playerId: null,
      playerName: null,
      note: 'Other game note.',
      matchId: 90002,
      critical: false,
    },
  ]
  t.store.answers.push({ personId: 99, question: 'Not theirs', answer: 'x', usability: 'usable' })
  await startScrumQuestion(t.deps, config('live'), personId)
  const scrum = t.store.scrums[0]!
  const reporterName = t.threads[0]!.name.split(' — ')[0]!
  assert.deepEqual(t.threads, [
    { channelId: 'chel', messageId: 'msg-10', name: `${reporterName} — Skater A` },
  ])
  assert.equal(scrum.threadId, 'msg-10')
  const q = t.sent.at(-1)!
  assert.equal(q.channelId, 'msg-10')
  assert.equal(q.reporter, scrum.reporter)
  assert.equal(q.msg.content, `<@${USER_A}> Skater A, what changed after the first period?`)
  assert.deepEqual(q.msg.allowed_mentions, { parse: [], users: [USER_A] })
  assert.match(JSON.stringify(q.msg.components), new RegExp(`press:answer:${String(personId)}`))
  const p = t.store.people.find((x) => x.id === personId)!
  assert.equal(p.status, 'asking')
  assert.equal(p.questionsAsked, 1)
  assert.equal(p.lastAskedAt?.getTime(), NOW.getTime())
  assert.ok(p.currentQuestion !== null && p.currentQuestion.length > 0)
  // The model saw this match's GM note only, and usage is recorded without a job.
  const write = reqs.find((r) => r.purpose === 'write')!
  assert.match(write.user, /broke a stick on the post/)
  assert.doesNotMatch(write.user, /Other game note/)
  assert.doesNotMatch(write.user, /Not theirs/)
  assert.ok(t.store.usage.length > 0)
  assert.ok(t.store.usage.every((u) => u.jobId === null))
})

void test('startScrumQuestion: earlier answers go in as history (unusable ones as no answer)', async () => {
  const reqs: Parameters<ModelCall>[0][] = []
  const model: ModelCall = (req) => {
    reqs.push(req)
    return Promise.reject(new Error('stop after the prompt'))
  }
  const t = setup({ model })
  const personId = await scrumWithPerson(t)
  t.store.people.find((x) => x.id === personId)!.questionsAsked = 2
  t.store.people.find((x) => x.id === personId)!.status = 'asking'
  t.store.answers.push(
    { personId, question: 'First question?', answer: 'We pushed hard.', usability: 'usable' },
    { personId, question: 'Second question?', answer: 'my job is awful', usability: 'unusable' },
  )
  await startScrumQuestion(t.deps, config('live'), personId)
  const write = reqs.find((r) => r.purpose === 'write')!
  assert.match(write.user, /First question\?/)
  assert.match(write.user, /We pushed hard\./)
  assert.match(write.user, /Second question\?/)
  assert.doesNotMatch(write.user, /my job is awful/)
  assert.match(write.user, /question 3 of the scrum/)
  // The model failed: the fallback question is posted, and the person moves on.
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> Walk me through that one, Skater A.`)
  assert.equal(t.store.people.find((x) => x.id === personId)!.questionsAsked, 3)
})

void test('startScrumQuestion: budget spent → fallback question, no model call, logged once a month', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  t.store.spend = 16
  await startScrumQuestion(t.deps, config('live'), personId)
  assert.equal(t.modelCalls.length, 0)
  assert.equal(t.sent.at(-1)!.msg.content, `<@${USER_A}> Walk me through that one, Skater A.`)
  t.store.people.find((x) => x.id === personId)!.status = 'asking'
  await startScrumQuestion(t.deps, config('live'), personId)
  assert.equal(t.modelCalls.length, 0)
  assert.equal(t.logs.filter((l) => l.startsWith('[press] budget:')).length, 1)
})

void test('startScrumQuestion: an existing thread is reused; a finished person is not asked', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  t.store.spend = 100
  t.store.scrums[0]!.threadId = 'thread-old'
  await startScrumQuestion(t.deps, config('live'), personId)
  assert.equal(t.threads.length, 0)
  assert.equal(t.sent.at(-1)!.channelId, 'thread-old')
  const before = t.sent.length
  t.store.people.find((x) => x.id === personId)!.status = 'done'
  await startScrumQuestion(t.deps, config('live'), personId)
  assert.equal(t.sent.length, before)
})

void test('startScrumQuestion: two calls for the same question post it once (claim)', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  t.store.spend = 100
  t.store.scrums[0]!.threadId = 'thread-old'
  await Promise.all([
    startScrumQuestion(t.deps, config('live'), personId),
    startScrumQuestion(t.deps, config('live'), personId),
  ])
  assert.equal(t.sent.filter((s) => s.channelId === 'thread-old').length, 1)
})

void test('startScrumQuestion: a thread that already exists (Discord 400) is the scrum message', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  t.store.spend = 100
  t.threadFails(new Error('Discord bot HTTP 400'))
  await startScrumQuestion(t.deps, config('live'), personId)
  assert.equal(t.threads.length, 1)
  assert.equal(t.store.scrums[0]!.threadId, 'msg-10')
  assert.equal(t.sent.at(-1)!.channelId, 'msg-10')
  assert.equal(t.store.people.find((x) => x.id === personId)!.status, 'asking')
})

void test('startScrumQuestion: another thread error posts nothing and claims nothing', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  t.store.spend = 100
  const before = t.sent.length
  t.threadFails(new Error('Discord bot HTTP 500'))
  await assert.rejects(startScrumQuestion(t.deps, config('live'), personId), /HTTP 500/)
  assert.equal(t.sent.length, before)
  assert.equal(t.store.scrums[0]!.threadId, null)
  assert.equal(t.store.people.find((x) => x.id === personId)!.questionsAsked, 0)
})

void test('open trial: the question and the closing line mention the player themselves', async () => {
  const t = setup()
  t.store.settings.mirrorFromItemId = 9
  t.store.items.push(itemRow({ id: 10, isGameRecap: true }))
  await runPressPass(t.deps, config('trial'))
  const id = (await t.store.insertScrumPerson({
    scrumId: 1,
    playerId: 1,
    discordUserId: USER_A,
    role: 'picked',
    requestedBy: 'auto',
    pingedAt: NOW,
  }))!
  t.store.spend = 100
  await startScrumQuestion(t.deps, config('trial'), id)
  const q = t.sent.at(-1)!
  assert.equal(q.msg.content, `<@${USER_A}> Walk me through that one, Skater A.`)
  assert.deepEqual(q.msg.allowed_mentions, { parse: [], users: [USER_A] })
  t.store.people[0]!.lastAskedAt = new Date(NOW.getTime() - 901_000)
  await runPressPass(t.deps, config('trial'))
  const closing = t.sent.at(-1)!
  assert.equal(closing.msg.content, `<@${USER_A}> Fair enough — next game.`)
  assert.deepEqual(closing.msg.allowed_mentions, { parse: [], users: [USER_A] })
})

void test('startScrumQuestion: a Go easy player gets no critical GM note; other notes stay', async () => {
  const reqs: Parameters<ModelCall>[0][] = []
  const model: ModelCall = (req) => {
    reqs.push(req)
    return Promise.reject(new Error('stop after the prompt'))
  }
  const t = setup({ model })
  const personId = await scrumWithPerson(t, 2)
  t.store.gmNotes = [
    {
      id: 1,
      playerId: 2,
      playerName: 'Skater B',
      note: 'Skater B lost the puck twice.',
      matchId: 90001,
      critical: true,
    },
    {
      id: 2,
      playerId: 2,
      playerName: 'Skater B',
      note: 'Skater B blocked a big shot.',
      matchId: 90001,
      critical: false,
    },
  ]
  await startScrumQuestion(t.deps, config('live'), personId)
  const write = reqs.find((r) => r.purpose === 'write')!
  assert.doesNotMatch(write.user, /lost the puck/)
  assert.match(write.user, /blocked a big shot/)
})

void test("startScrumQuestion: GM notes are filtered by the note's own player, then by the scrum's match", async () => {
  const reqs: Parameters<ModelCall>[0][] = []
  const model: ModelCall = (req) => {
    reqs.push(req)
    return Promise.reject(new Error('stop after the prompt'))
  }
  const t = setup({ model })
  // Skater A (full) is asked.
  const personId = await scrumWithPerson(t, 1)
  const note = (id: number, playerId: number | null, text: string, over = {}) => ({
    id,
    playerId,
    playerName: playerId === null ? null : `Player ${String(playerId)}`,
    note: text,
    matchId: 90001,
    critical: false,
    ...over,
  })
  t.store.gmNotes = [
    // A critical note about a "Go easy" teammate: never used, whoever is asked.
    note(1, 2, 'NOTE-EASY-CRITICAL', { critical: true }),
    // A note about a player not on the sheet ("Leave me out"): never used.
    note(2, 4, 'NOTE-OFF-SHEET'),
    // Another game's note: not this scrum's.
    note(3, 1, 'NOTE-OTHER-GAME', { matchId: 90002 }),
    note(4, 2, 'NOTE-EASY-POSITIVE'),
    note(5, null, 'NOTE-GAME'),
    note(6, 1, 'NOTE-SELF-CRITICAL', { critical: true }),
  ]
  await startScrumQuestion(t.deps, config('live'), personId)
  const write = reqs.find((r) => r.purpose === 'write')!
  assert.doesNotMatch(write.user, /NOTE-EASY-CRITICAL|NOTE-OFF-SHEET|NOTE-OTHER-GAME/)
  assert.match(write.user, /NOTE-EASY-POSITIVE/)
  assert.match(write.user, /NOTE-GAME/)
  assert.match(write.user, /NOTE-SELF-CRITICAL/)
})

void test('startScrumQuestion: a person no longer on the sheet gets no thread and no question, and ends', async () => {
  const res = oct12Response('game')
  res.facts.people = res.facts.people.filter((p) => p.playerId !== 1)
  const t = setup({ response: res })
  const pinged = await scrumWithPerson(t)
  const asking = (await t.store.insertScrumPerson({
    scrumId: 1,
    playerId: 3,
    discordUserId: USER_B,
    role: 'volunteer',
    requestedBy: 'self',
    status: 'asking',
  }))!
  // Player 3 is on the sheet in the fixture; take them off too.
  res.facts.people = res.facts.people.filter((p) => p.playerId !== 3)
  const before = t.sent.length
  await startScrumQuestion(t.deps, config('live'), pinged)
  await startScrumQuestion(t.deps, config('live'), asking)
  assert.equal(t.threads.length, 0)
  assert.equal(t.sent.length, before)
  assert.equal(t.modelCalls.length, 0)
  assert.equal(t.store.people.find((x) => x.id === pinged)!.status, 'expired')
  assert.equal(t.store.people.find((x) => x.id === asking)!.status, 'done')
})
