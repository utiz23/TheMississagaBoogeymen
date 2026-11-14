import test from 'node:test'
import assert from 'node:assert/strict'
import { FALLBACK_CLOSING } from './asker.ts'
import { runPressPass } from './pass.ts'
import {
  NOW,
  NIGHT,
  GM,
  USER_A,
  USER_B,
  config,
  itemRow,
  bigResponse,
  setup,
  liveRecap,
  type Sent,
} from './test-fakes.ts'

const pings = (sent: Sent[]) => sent.filter((s) => s.msg.content.includes('has a question for you'))

void test('a big game creates one scrum and one ping, replied under the recap with Accept', async () => {
  const t = setup({ response: bigResponse() })
  liveRecap(t.store)
  const summary = await runPressPass(t.deps, config('live'))
  assert.equal(t.store.scrums.length, 1)
  const scrum = t.store.scrums[0]!
  assert.equal(scrum.recapItemId, 10)
  assert.equal(scrum.buzzLevel, 'historic')
  assert.equal(scrum.isTest, false)
  assert.equal(scrum.channelId, 'chel')
  assert.equal(scrum.messageId, 'msg-10')
  assert.equal(scrum.night, NIGHT)
  assert.notEqual(scrum.reporter, 'rink')
  assert.equal(scrum.openUntil.getTime(), NOW.getTime() - 10 * 60_000 + 3_600_000)
  assert.equal(t.store.people.length, 1)
  const person = t.store.people[0]!
  assert.equal(person.requestedBy, 'auto')
  assert.equal(person.role, 'picked')
  assert.equal(person.discordUserId, USER_A)
  const ps = pings(t.sent)
  assert.equal(ps.length, 1)
  const ping = ps[0]!
  assert.equal(ping.reporter, scrum.reporter)
  assert.equal(ping.channelId, 'chel')
  assert.match(
    ping.msg.content,
    new RegExp(`^<@${USER_A}> — .+ has a question for you about tonight's game\\.$`),
  )
  assert.deepEqual(ping.msg.allowed_mentions, { parse: [], users: [USER_A] })
  assert.deepEqual(ping.msg.message_reference, { message_id: 'msg-10', fail_if_not_exists: false })
  assert.match(JSON.stringify(ping.msg.components), /press:accept:1/)
  assert.equal(person.pingMessageId, 'sent-1')
  assert.ok(person.pingedAt !== null)
  assert.equal(summary.scrums, 1)
  assert.equal(summary.pings, 1)
})

void test('running the pass twice creates one scrum and sends one ping (claims)', async () => {
  const t = setup({ response: bigResponse() })
  liveRecap(t.store)
  await runPressPass(t.deps, config('live'))
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.scrums.length, 1)
  assert.equal(pings(t.sent).length, 1)
})

void test('a ping already claimed is never sent again', async () => {
  const t = setup({ response: bigResponse() })
  liveRecap(t.store)
  const claim = t.store.claimPing
  // Another pass claims every ping first.
  t.store.claimPing = async (id) => {
    await claim(id)
    return false
  }
  await runPressPass(t.deps, config('live'))
  assert.equal(pings(t.sent).length, 0)
})

void test('a quiet game creates a scrum without a ping', async () => {
  const t = setup()
  liveRecap(t.store)
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.scrums.length, 1)
  assert.equal(t.store.scrums[0]!.buzzLevel, 'quiet')
  assert.equal(t.store.people.length, 0)
  assert.equal(t.sent.length, 0)
})

void test('a GM note that asks a player pings them on a quiet game, requested by the GM', async () => {
  const t = setup()
  liveRecap(t.store)
  t.store.gmAsks.set(90001, 2)
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.people.length, 1)
  assert.equal(t.store.people[0]!.playerId, 2)
  assert.equal(t.store.people[0]!.requestedBy, 'gm')
  // A GM ping waits a minute (the GM may still correct the note).
  assert.equal(pings(t.sent).length, 0)
  t.deps.now = () => new Date(NOW.getTime() + 61_000)
  await runPressPass(t.deps, config('live'))
  assert.equal(pings(t.sent)[0]!.msg.allowed_mentions.users?.[0], USER_B)
})

void test('a GM-requested person is pinged only once 60 s old', async () => {
  const t = setup()
  liveRecap(t.store)
  await runPressPass(t.deps, config('live')) // a quiet game: a scrum, nobody pinged
  await t.store.insertScrumPerson({
    scrumId: 1,
    playerId: 1,
    discordUserId: USER_A,
    role: 'picked',
    requestedBy: 'gm',
    requestedByUserId: GM,
    createdAt: new Date(NOW.getTime() - 30_000),
  })
  await runPressPass(t.deps, config('live'))
  assert.equal(pings(t.sent).length, 0)
  assert.equal(t.store.people[0]!.pingedAt, null)
  t.store.people[0]!.createdAt = new Date(NOW.getTime() - 61_000)
  await runPressPass(t.deps, config('live'))
  assert.equal(pings(t.sent).length, 1)
  assert.equal(pings(t.sent)[0]!.msg.allowed_mentions.users?.[0], USER_A)
})

void test('open trial: the scrum hangs on the mirror, is test, and the picked player is pinged, marked (trial)', async () => {
  const t = setup({ response: bigResponse() })
  t.store.settings.mirrorFromItemId = 9
  t.store.items.push(
    itemRow({ id: 10, isGameRecap: true, discordVia: 'webhook', discordChannelId: null }),
  )
  await runPressPass(t.deps, config('trial'))
  const mirror = t.sent[0]!
  assert.equal(mirror.channelId, 'test-channel')
  assert.match(JSON.stringify(mirror.msg.components), /press:talk:10/)
  assert.equal(t.store.mirrors.length, 1)
  assert.equal(t.store.scrums.length, 1)
  const scrum = t.store.scrums[0]!
  assert.equal(scrum.isTest, true)
  assert.equal(scrum.channelId, 'test-channel')
  assert.equal(scrum.messageId, t.store.mirrors[0]!.messageId)
  const ping = pings(t.sent)[0]!
  assert.match(ping.msg.content, new RegExp(`^\\(trial\\) <@${USER_A}> — `))
  assert.deepEqual(ping.msg.allowed_mentions, { parse: [], users: [USER_A] })
  assert.equal(ping.channelId, 'test-channel')
})

void test('the third automatic ping of a night for the same player is not sent', async () => {
  const t = setup({ response: bigResponse() })
  for (const id of [1, 2]) {
    t.store.scrums.push({
      id,
      matchId: 80000 + id,
      night: NIGHT,
      recapItemId: id,
      channelId: 'chel',
      messageId: `old-${String(id)}`,
      threadId: null,
      reporter: 'barlow',
      heat: 'normal',
      buzzLevel: 'big',
      openUntil: NOW,
      isTest: false,
      createdAt: NOW,
    })
    await t.store.insertScrumPerson({
      scrumId: id,
      playerId: 1,
      discordUserId: USER_A,
      role: 'picked',
      requestedBy: 'auto',
      status: 'done',
      pingedAt: NOW,
    })
  }
  liveRecap(t.store)
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.scrums.length, 3)
  assert.equal(t.store.people.length, 2)
  assert.equal(pings(t.sent).length, 0)
})

void test('command pings count toward the ping limit; GM pings do not', async () => {
  const t = setup({ response: bigResponse() })
  for (const [id, requestedBy] of [
    [1, 'command'],
    [2, 'gm'],
    [3, 'command'],
  ] as const) {
    t.store.scrums.push({
      id,
      matchId: 80000 + id,
      night: NIGHT,
      recapItemId: id,
      channelId: 'chel',
      messageId: `old-${String(id)}`,
      threadId: null,
      reporter: 'barlow',
      heat: 'normal',
      buzzLevel: 'big',
      openUntil: NOW,
      isTest: false,
      createdAt: NOW,
    })
    await t.store.insertScrumPerson({
      scrumId: id,
      playerId: 1,
      discordUserId: USER_A,
      role: 'picked',
      requestedBy,
      status: 'done',
      pingedAt: NOW,
    })
  }
  liveRecap(t.store)
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.scrums.length, 4)
  assert.equal(t.store.people.length, 3)
  assert.equal(pings(t.sent).length, 0)
  assert.ok(t.logs.some((l) => l.includes('had 2 pings tonight, no ping')))
})

void test('budget out (80%): the scrum is made but nobody is picked or pinged; logged once a month', async () => {
  const t = setup({ response: bigResponse() })
  t.store.spend = 16 // 80% of the 20 USD limit
  liveRecap(t.store)
  await runPressPass(t.deps, config('live'))
  t.store.items.push(itemRow({ id: 11, isGameRecap: true, reporter: 'voss' }))
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.scrums.length, 2)
  assert.equal(t.store.people.length, 0)
  assert.equal(pings(t.sent).length, 0)
  assert.equal(t.logs.filter((l) => l.includes('extras budget')).length, 1)
  // A GM ask is not pinged either.
  const t2 = setup()
  t2.store.spend = 16
  t2.store.gmAsks.set(90001, 2)
  liveRecap(t2.store)
  await runPressPass(t2.deps, config('live'))
  assert.equal(t2.store.people.length, 0)
})

void test('heat: a "next" heat is used once; a Go easy pick lowers Hot to normal and the GM is told', async () => {
  const res = bigResponse()
  // Skater B (Go easy) becomes the pick through a GM note.
  const t = setup({ response: res })
  liveRecap(t.store)
  t.store.gmAsks.set(90001, 2)
  t.store.settings = { ...t.store.settings, heat: 'hot', heatScope: 'next' }
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.scrums[0]!.heat, 'normal')
  assert.equal(t.store.settings.heatScope, 'night')
  assert.deepEqual(t.dms, [
    { userId: GM, content: "Heat for Skater B's scrum lowered to Normal (Go easy)." },
  ])
})

void test('an accept older than 15 minutes becomes expired and loses its button', async () => {
  const t = setup()
  liveRecap(t.store)
  await runPressPass(t.deps, config('live'))
  await t.store.insertScrumPerson({
    scrumId: 1,
    playerId: 1,
    discordUserId: USER_A,
    role: 'picked',
    requestedBy: 'auto',
    pingedAt: new Date(NOW.getTime() - 901_000),
    pingMessageId: 'ping-1',
  })
  await t.store.insertScrumPerson({
    scrumId: 1,
    playerId: 2,
    discordUserId: USER_B,
    role: 'picked',
    requestedBy: 'gm',
    pingedAt: new Date(NOW.getTime() - 60_000),
    pingMessageId: 'ping-2',
  })
  const summary = await runPressPass(t.deps, config('live'))
  assert.equal(t.store.people[0]!.status, 'expired')
  assert.equal(t.store.people[1]!.status, 'pinged')
  assert.deepEqual(t.edits, [{ messageId: 'ping-1', msg: { components: [] } }])
  assert.equal(summary.expiredPings, 1)
})

void test('an unanswered question older than 15 minutes gets the closing line and ends', async () => {
  const t = setup()
  liveRecap(t.store)
  await runPressPass(t.deps, config('live'))
  t.store.scrums[0]!.threadId = 'thread-9'
  await t.store.insertScrumPerson({
    scrumId: 1,
    playerId: 1,
    discordUserId: USER_A,
    role: 'picked',
    requestedBy: 'auto',
    status: 'asking',
    pingedAt: new Date(NOW.getTime() - 30 * 60_000),
    lastAskedAt: new Date(NOW.getTime() - 901_000),
    currentQuestion: 'Why?',
    questionsAsked: 1,
  })
  await runPressPass(t.deps, config('live'))
  const p = t.store.people[0]!
  assert.equal(p.status, 'done')
  assert.equal(p.currentQuestion, null)
  assert.equal(t.sent.length, 1)
  assert.equal(t.sent[0]!.channelId, 'thread-9')
  assert.equal(t.sent[0]!.msg.content, `<@${USER_A}> ${FALLBACK_CLOSING}`)
  assert.equal(t.sent[0]!.msg.content, `<@${USER_A}> Fair enough — next game.`)
  assert.deepEqual(t.sent[0]!.msg.allowed_mentions, { parse: [], users: [USER_A] })
  // A second pass does not close it again.
  await runPressPass(t.deps, config('live'))
  assert.equal(t.sent.length, 1)
})

void test('first trial pass: the mark is the newest item, so history is never mirrored', async () => {
  const t = setup()
  t.store.items.push(itemRow({ id: 5 }), itemRow({ id: 6, isGameRecap: true }))
  await runPressPass(t.deps, config('trial'))
  assert.equal(t.store.settings.mirrorFromItemId, 6)
  assert.equal(t.sent.length, 0)
  assert.equal(t.store.scrums.length, 0)
  t.store.items.push(itemRow({ id: 7, reporter: 'mercer', replyTo: 6 }))
  const summary = await runPressPass(t.deps, config('trial'))
  assert.equal(summary.mirrored, 1)
  assert.equal(t.sent.length, 1)
  assert.equal(t.sent[0]!.reporter, 'mercer')
  assert.equal(t.sent[0]!.channelId, 'test-channel')
  assert.match(t.sent[0]!.msg.content, /^↪ to Arthur Barlow: Post 7$|^↪ to .+: Post 7$/)
  assert.equal(t.sent[0]!.msg.components, undefined)
  assert.deepEqual(
    t.store.mirrors.map((m) => m.itemId),
    [7],
  )
})

void test('live: nothing is mirrored', async () => {
  const t = setup()
  t.store.items.push(itemRow({ id: 5 }))
  t.store.settings.mirrorFromItemId = 1
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.mirrors.length, 0)
})

void test('mirror: an item not due yet waits, and so do the items after it', async () => {
  const t = setup()
  t.store.settings.mirrorFromItemId = 1
  t.store.items.push(
    itemRow({ id: 2, sendAfter: new Date(NOW.getTime() + 60_000) }),
    itemRow({ id: 3 }),
  )
  await runPressPass(t.deps, config('trial'))
  assert.equal(t.sent.length, 0)
})

void test('a deleted mirrored item: its mirror message is deleted and marked', async () => {
  const t = setup()
  t.store.settings.mirrorFromItemId = 1
  t.store.items.push(itemRow({ id: 2, deletedAt: NOW }))
  t.store.mirrors.push({
    itemId: 2,
    channelId: 'test-channel',
    messageId: 'mir-2',
    deletedAt: null,
  })
  const summary = await runPressPass(t.deps, config('trial'))
  assert.deepEqual(t.removed, ['mir-2'])
  assert.ok(t.store.mirrors[0]!.deletedAt !== null)
  assert.equal(summary.mirrorsDeleted, 1)
})

void test('a failing mirror send does not stop the scrum step', async () => {
  const t = setup()
  t.store.settings.mirrorFromItemId = 1
  // Item 2 is already mirrored (a recap without a scrum); item 3 fails to mirror.
  t.store.items.push(itemRow({ id: 2, isGameRecap: true }), itemRow({ id: 3 }))
  t.store.mirrors.push({
    itemId: 2,
    channelId: 'test-channel',
    messageId: 'mir-2',
    deletedAt: null,
  })
  t.failSendWhen((s) => s.msg.content === 'Post 3')
  const summary = await runPressPass(t.deps, config('trial'))
  assert.equal(t.store.scrums.length, 1)
  assert.equal(t.store.scrums[0]!.messageId, 'mir-2')
  assert.ok(t.logs.some((l) => /^\[press\] mirror: Discord bot HTTP 500$/.test(l)))
  assert.deepEqual(summary.failedSteps, ['mirror'])
})

void test('facts that fail to load skip the item (retried every pass) and log it once', async () => {
  const t = setup()
  liveRecap(t.store)
  let fetches = 0
  t.deps.fetchFacts = () => {
    fetches++
    return Promise.reject(new Error('news game facts HTTP 503'))
  }
  await runPressPass(t.deps, config('live'))
  await runPressPass(t.deps, config('live'))
  assert.equal(fetches, 2)
  assert.equal(t.store.scrums.length, 0)
  assert.deepEqual(
    t.logs.filter((l) => l.startsWith('[press] scrums: item 10')),
    ['[press] scrums: item 10: news game facts HTTP 503'],
  )
})

void test('a recap item without a match is logged once', async () => {
  const t = setup()
  t.store.items.push(itemRow({ id: 10, isGameRecap: true, matchId: null }))
  await runPressPass(t.deps, config('live'))
  await runPressPass(t.deps, config('live'))
  assert.equal(t.logs.filter((l) => l.startsWith('[press] scrums: item 10')).length, 1)
})

void test('a "next" heat is not used up when the scrum insert conflicts', async () => {
  const t = setup()
  liveRecap(t.store)
  t.store.settings = { ...t.store.settings, heat: 'hot', heatScope: 'next' }
  t.store.insertScrum = () => Promise.resolve(null)
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.consumeCalls, 0)
  assert.equal(t.store.settings.heatScope, 'next')
})

void test('a "next" heat is used up once the scrum is inserted, and the scrum runs at that heat', async () => {
  const t = setup()
  liveRecap(t.store)
  t.store.settings = { ...t.store.settings, heat: 'cool', heatScope: 'next' }
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.consumeCalls, 1)
  assert.equal(t.store.scrums[0]!.heat, 'cool')
  assert.equal(t.store.settings.heatScope, 'night')
})

void test('a failing closing line does not stop the other closings', async () => {
  const t = setup()
  liveRecap(t.store)
  await runPressPass(t.deps, config('live'))
  t.store.scrums[0]!.threadId = 'thread-9'
  for (const playerId of [1, 2]) {
    await t.store.insertScrumPerson({
      scrumId: 1,
      playerId,
      discordUserId: playerId === 1 ? USER_A : USER_B,
      role: 'volunteer',
      requestedBy: 'self',
      status: 'asking',
      lastAskedAt: new Date(NOW.getTime() - 901_000),
      questionsAsked: 1,
    })
  }
  let first = true
  t.failSendWhen(() => {
    const fail = first
    first = false
    return fail
  })
  await runPressPass(t.deps, config('live'))
  assert.deepEqual(
    t.store.people.map((p) => p.status),
    ['done', 'done'],
  )
  assert.equal(t.sent.length, 1)
  assert.ok(t.logs.some((l) => l === '[press] expired answers: person 1: Discord bot HTTP 500'))
})
