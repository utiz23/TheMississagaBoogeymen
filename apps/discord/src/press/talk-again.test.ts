import test from 'node:test'
import assert from 'node:assert/strict'
import { oct12Response } from '../news/test-fixtures.ts'
import { onAccept, onTalk } from './interactions.ts'
import { runPressPass } from './pass.ts'
import { onGmTestScrum } from './test-scrum.ts'
import { GM, NOW, USER_A, USER_B, config, liveRecap, setup } from './test-fakes.ts'

/**
 * T10: "Talk to the press" from someone who is already in the scrum. Pinged inside the accept
 * window it counts as Accept (the same claim); pinged too late: the press has moved on; answering:
 * a link to their own thread; done: nothing more to do.
 */

const live = config('live')
const ephemeral = (text: string) => ({ kind: 'ephemeral', text })
const MOVED_ON = ephemeral('The press has moved on.')
const TALKED = ephemeral("You've already talked to the press about this game.")
const MINUTE = 60_000

/** A live scrum with player 1 (USER_A) pinged; the real pass posted the ping. */
async function pingedA() {
  const t = setup()
  liveRecap(t.store)
  await runPressPass(t.deps, live)
  t.store.scrums[0]!.heat = 'normal'
  const id = (await t.store.insertScrumPerson({
    scrumId: 1,
    playerId: 1,
    discordUserId: USER_A,
    role: 'picked',
    requestedBy: 'command',
    createdAt: new Date(NOW.getTime() - 120_000),
  }))!
  await runPressPass(t.deps, live)
  const person = t.store.people.find((p) => p.id === id)!
  assert.equal(person.status, 'pinged')
  assert.notEqual(person.pingMessageId, null)
  return { t, id, person, ping: person.pingMessageId! }
}

void test('Talk while pinged (inside the window) is an Accept: their own thread, the first question', async () => {
  const { t, person, ping } = await pingedA()
  const before = t.sent.length
  assert.deepEqual(await onTalk(t.deps, live, 10, USER_A), { kind: 'ack' })
  assert.equal(person.status, 'asking')
  assert.equal(person.questionsAsked, 1)
  assert.equal(t.sent.length, before + 1)
  const q = t.sent.at(-1)!
  assert.equal(q.channelId, ping)
  assert.match(q.msg.content, new RegExp(`^<@${USER_A}> `))
  assert.deepEqual(
    t.threads.map((x) => x.messageId),
    [ping],
  )
})

void test('Talk and Accept take the one claim: pressed in either order, one question only', async () => {
  for (const talkFirst of [true, false]) {
    const { t, id, person, ping } = await pingedA()
    const before = t.sent.length
    const first = talkFirst
      ? await onTalk(t.deps, live, 10, USER_A)
      : await onAccept(t.deps, live, id, USER_A)
    assert.deepEqual(first, { kind: 'ack' })
    const second = talkFirst
      ? await onAccept(t.deps, live, id, USER_A)
      : await onTalk(t.deps, live, 10, USER_A)
    // The second press changes nothing: Accept says "already", Talk links to the thread.
    assert.deepEqual(
      second,
      talkFirst
        ? ephemeral("You're already in this scrum.")
        : ephemeral(`Your questions are in your thread → <#${ping}>`),
    )
    assert.equal(person.questionsAsked, 1)
    assert.equal(t.sent.length, before + 1)
    assert.equal(t.threads.length, 1)
  }
})

void test('Talk while pinged but past the accept window: the press has moved on, nothing changes', async () => {
  const { t, person } = await pingedA()
  t.deps.now = () => new Date(NOW.getTime() + 16 * MINUTE)
  const before = t.sent.length
  assert.deepEqual(await onTalk(t.deps, live, 10, USER_A), MOVED_ON)
  assert.equal(person.status, 'pinged')
  assert.equal(t.sent.length, before)
  // The expiry pass closed the ping: the same answer.
  person.status = 'expired'
  assert.deepEqual(await onTalk(t.deps, live, 10, USER_A), MOVED_ON)
  assert.equal(t.sent.length, before)
})

void test('Talk while answering: a link to their own thread; no thread yet: on its way', async () => {
  const { t, person, ping } = await pingedA()
  person.status = 'asking'
  person.questionsAsked = 1
  person.currentQuestion = 'Why?'
  person.lastAskedAt = NOW
  const before = t.sent.length
  assert.deepEqual(
    await onTalk(t.deps, live, 10, USER_A),
    ephemeral(`Your questions are in your thread → <#${ping}>`),
  )
  person.pingMessageId = null
  assert.deepEqual(await onTalk(t.deps, live, 10, USER_A), ephemeral('The question is on its way.'))
  // An old shared thread of the scrum counts as their thread.
  t.store.scrums[0]!.threadId = 'shared-1'
  assert.deepEqual(
    await onTalk(t.deps, live, 10, USER_A),
    ephemeral('Your questions are in your thread → <#shared-1>'),
  )
  assert.equal(t.sent.length, before)
  assert.equal(person.questionsAsked, 1)
})

void test('Talk when done: already talked to the press about this game', async () => {
  const { t, person } = await pingedA()
  person.status = 'done'
  person.questionsAsked = 2
  const before = t.sent.length
  assert.deepEqual(await onTalk(t.deps, live, 10, USER_A), TALKED)
  assert.equal(t.sent.length, before)
  assert.equal(person.status, 'done')
})

void test('a volunteer who presses Talk again is answered by state, not "already in this scrum"', async () => {
  const t = setup()
  liveRecap(t.store)
  await runPressPass(t.deps, live)
  assert.deepEqual(await onTalk(t.deps, live, 10, USER_B), { kind: 'ack' })
  const p = t.store.people[0]!
  const reply = await onTalk(t.deps, live, 10, USER_B)
  assert.equal(
    reply.kind === 'ephemeral' && reply.text.startsWith('Your questions are in your thread'),
    true,
  )
  p.status = 'done'
  assert.deepEqual(await onTalk(t.deps, live, 10, USER_B), TALKED)
})

void test('test scrum: Talk from a pinged person is an Accept, free (no model)', async () => {
  const cfg = { ...live, testChannelId: 'bot-test', typedAnswers: true }
  const res = oct12Response('game')
  const weeks = 42 * 24 * 3_600_000
  res.facts.games = res.facts.games.map((g) => ({
    ...g,
    playedAt: new Date(new Date(g.playedAt).getTime() - weeks).toISOString(),
  }))
  let modelCalls = 0
  const t = setup({
    response: res,
    model: () => {
      modelCalls++
      return Promise.reject(new Error('a test scrum must make no model call'))
    },
    screen: () => Promise.reject(new Error('a test scrum must not use the model screen')),
  })
  const made = await onGmTestScrum(t.deps, cfg, GM, {
    inGuild: true,
    game: null,
    players: [USER_A],
    bench: null,
  })
  assert.equal(made.kind, 'ephemeral')
  await runPressPass(t.deps, cfg)
  const person = t.store.people[0]!
  assert.equal(person.status, 'pinged')
  const itemId = t.store.scrums[0]!.recapItemId
  t.store.spend = 1000
  assert.deepEqual(await onTalk(t.deps, cfg, itemId, USER_A), { kind: 'ack' })
  assert.equal(person.status, 'asking')
  assert.equal(person.questionsAsked, 1)
  assert.equal(modelCalls, 0)
  const link = await onTalk(t.deps, cfg, itemId, USER_A)
  assert.equal(
    link.kind === 'ephemeral' && link.text.startsWith('Your questions are in your thread'),
    true,
  )
  person.status = 'done'
  assert.deepEqual(await onTalk(t.deps, cfg, itemId, USER_A), TALKED)
})
