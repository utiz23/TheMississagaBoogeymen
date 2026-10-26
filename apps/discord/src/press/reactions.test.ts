import test from 'node:test'
import assert from 'node:assert/strict'
import { onReaction, REACTION_MAX_AGE_MS } from './reactions.ts'
import { NOW, NIGHT, GM, config, itemRow, setup } from './test-fakes.ts'

const USERS = ['400000000000000001', '400000000000000002', '400000000000000003']
const FOURTH = '400000000000000004'

/** A reaction on `messageId` in the mode's channel. */
const on = (messageId: string, userId: string, mode: 'trial' | 'live' = 'live', bot = false) => ({
  channelId: config(mode).channelId,
  messageId,
  userId,
  userIsBot: bot,
})

async function react(
  t: ReturnType<typeof setup>,
  messageId: string,
  users: readonly string[],
  mode: 'trial' | 'live' = 'live',
): Promise<void> {
  for (const u of users) await onReaction(t.deps, config(mode), on(messageId, u, mode))
}

void test('the third different person triggers a follow-up once; a fourth does not trigger again', async () => {
  const t = setup()
  t.store.items.push(itemRow({ id: 10 }))
  await react(t, 'msg-10', USERS.slice(0, 2))
  assert.equal(t.store.triggers.length, 0)
  await react(t, 'msg-10', [USERS[2]!])
  assert.deepEqual(t.store.triggers, [{ itemId: 10, night: NIGHT, isTest: false }])
  await react(t, 'msg-10', [FOURTH])
  assert.equal(t.store.triggers.length, 1)
  assert.equal(t.store.votes.length, 4)
  assert.equal(t.dms.length, 0)
})

void test('the same person reacting twice (any emoji) counts once', async () => {
  const t = setup()
  t.store.items.push(itemRow({ id: 10 }))
  await react(t, 'msg-10', [USERS[0]!, USERS[0]!, USERS[1]!, USERS[1]!])
  assert.equal(t.store.votes.length, 2)
  assert.equal(t.store.triggers.length, 0)
})

void test("a bot's reaction, another channel and a message that is not a news item are ignored", async () => {
  const t = setup()
  t.store.items.push(itemRow({ id: 10 }))
  await onReaction(t.deps, config('live'), on('msg-10', USERS[0]!, 'live', true))
  await onReaction(t.deps, config('live'), { ...on('msg-10', USERS[1]!), channelId: 'elsewhere' })
  await onReaction(t.deps, config('live'), on('not-an-item', USERS[2]!))
  assert.equal(t.store.votes.length, 0)
})

void test('the third trigger of a night is not created (test and live count together)', async () => {
  const t = setup()
  t.store.items.push(itemRow({ id: 10 }), itemRow({ id: 11 }), itemRow({ id: 12 }))
  t.store.triggers.push({ itemId: 99, night: NIGHT, isTest: true })
  await react(t, 'msg-10', USERS)
  await react(t, 'msg-11', USERS)
  assert.deepEqual(
    t.store.triggers.map((x) => x.itemId),
    [99, 10],
  )
  // Another night still has room.
  t.store.items.push(itemRow({ id: 13, night: '2026-10-13' }))
  await react(t, 'msg-13', USERS)
  assert.deepEqual(
    t.store.triggers.map((x) => x.itemId),
    [99, 10, 13],
  )
})

void test('no follow-up to a correction, to a follow-up, to an item older than 24 h, or after 80% spend', async () => {
  const t = setup()
  t.store.items.push(
    itemRow({ id: 10, isCorrection: true }),
    itemRow({ id: 11, jobId: 7 }),
    itemRow({ id: 12, createdAt: new Date(NOW.getTime() - REACTION_MAX_AGE_MS - 1) }),
    itemRow({ id: 13 }),
  )
  t.store.jobKinds.set(7, 'reaction')
  for (const id of [10, 11, 12]) await react(t, `msg-${String(id)}`, USERS)
  t.store.spend = 16 // 80% of the 20 USD limit
  await react(t, 'msg-13', USERS)
  assert.equal(t.store.triggers.length, 0)
})

void test('a weekly piece (no night, no game) gets no follow-up', async () => {
  const t = setup()
  t.store.items.push(itemRow({ id: 10, kind: 'article', matchId: null, night: null }))
  await react(t, 'msg-10', USERS)
  assert.equal(t.store.triggers.length, 0)
})

void test('trial: votes count on the mirror; a test item gets a test trigger', async () => {
  const t = setup()
  t.store.items.push(itemRow({ id: 10, isTest: true, discordMessageId: null }))
  t.store.mirrors.push({
    itemId: 10,
    channelId: 'test-channel',
    messageId: 'mirror-10',
    deletedAt: null,
  })
  // The item's own message id is not the mirror: nothing.
  await react(t, 'msg-10', USERS, 'trial')
  assert.equal(t.store.votes.length, 0)
  await react(t, 'mirror-10', USERS, 'trial')
  assert.deepEqual(t.store.triggers, [{ itemId: 10, night: NIGHT, isTest: true }])
  assert.equal(t.dms.length, 0)
})

void test('trial with the news desk live: no trigger, one DM to the GM per item', async () => {
  const t = setup()
  const body =
    'The Boogeymen beat Shake N Bake 4-2 on the back of 31 saves from the net, a steal by any measure.'
  t.store.items.push(itemRow({ id: 10, body }))
  t.store.mirrors.push({
    itemId: 10,
    channelId: 'test-channel',
    messageId: 'mirror-10',
    deletedAt: null,
  })
  await react(t, 'mirror-10', [...USERS, FOURTH], 'trial')
  assert.equal(t.store.triggers.length, 0)
  assert.deepEqual(t.dms, [
    { userId: GM, content: `Test: "${body.slice(0, 60)}" would get a fan follow-up.` },
  ])
})

void test('trial: an article mirror previews its headline and dek', async () => {
  const t = setup()
  t.store.items.push(
    itemRow({ id: 10, kind: 'article', headline: 'Net gain', dek: 'Goalie G stole one.' }),
  )
  t.store.mirrors.push({
    itemId: 10,
    channelId: 'test-channel',
    messageId: 'mirror-10',
    deletedAt: null,
  })
  await react(t, 'mirror-10', USERS, 'trial')
  assert.equal(
    t.dms[0]?.content,
    'Test: "Net gain — Goalie G stole one." would get a fan follow-up.',
  )
})
