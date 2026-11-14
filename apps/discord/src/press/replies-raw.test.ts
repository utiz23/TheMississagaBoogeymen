import test from 'node:test'
import assert from 'node:assert/strict'
import { messageFromRaw } from './replies-raw.ts'

const USER = '200000000000000001'
const base = {
  id: 'm1',
  channel_id: 'thread-1',
  guild_id: 'g1',
  author: { id: USER },
  type: 0,
  content: 'We pushed hard.',
}
const cachedThread = (id: string) => (id === 'thread-1' ? true : id === 'press' ? false : null)

void test('messageFromRaw: a plain thread message', () => {
  assert.deepEqual(messageFromRaw(base, cachedThread), {
    channelId: 'thread-1',
    guildId: 'g1',
    userId: USER,
    userIsBot: false,
    isPlain: true,
    inThread: true,
    text: 'We pushed hard.',
    messageId: 'm1',
    reference: null,
  })
})

void test('messageFromRaw: a Reply carries the target id, author, text and button ids', () => {
  const m = messageFromRaw(
    {
      ...base,
      type: 19,
      message_reference: { message_id: 'q1', channel_id: 'thread-1' },
      referenced_message: {
        id: 'q1',
        author: { id: 'bot-voss', bot: true },
        content: `<@${USER}> Why?`,
        components: [{ type: 1, components: [{ type: 2, custom_id: 'press:answer:7' }] }],
      },
    },
    cachedThread,
  )
  assert.equal(m!.isPlain, true)
  assert.deepEqual(m!.reference, {
    messageId: 'q1',
    authorId: 'bot-voss',
    content: `<@${USER}> Why?`,
    customIds: ['press:answer:7'],
  })
})

void test('messageFromRaw: a Reply to a deleted message has an unknown target', () => {
  const m = messageFromRaw(
    { ...base, type: 19, message_reference: { message_id: 'gone' }, referenced_message: null },
    cachedThread,
  )
  assert.deepEqual(m!.reference, {
    messageId: 'gone',
    authorId: null,
    content: null,
    customIds: [],
  })
})

void test('messageFromRaw: a forward (type 0 with a reference) is not a Reply', () => {
  const m = messageFromRaw(
    { ...base, message_reference: { message_id: 'x', type: 1 } },
    cachedThread,
  )
  assert.equal(m!.reference, null)
})

void test('messageFromRaw: an uncached channel counts as a thread unless channel_type says no', () => {
  const unknown = () => null
  assert.equal(messageFromRaw({ ...base, channel_id: 'new' }, unknown)!.inThread, true)
  assert.equal(
    messageFromRaw({ ...base, channel_id: 'new', channel_type: 11 }, unknown)!.inThread,
    true,
  )
  assert.equal(
    messageFromRaw({ ...base, channel_id: 'new', channel_type: 0 }, unknown)!.inThread,
    false,
  )
  // The cache wins over channel_type.
  assert.equal(
    messageFromRaw({ ...base, channel_id: 'press', channel_type: 11 }, cachedThread)!.inThread,
    false,
  )
})

void test('messageFromRaw: bots, webhooks and notices are marked; junk is null', () => {
  assert.equal(
    messageFromRaw({ ...base, author: { id: 'b', bot: true } }, cachedThread)!.userIsBot,
    true,
  )
  assert.equal(messageFromRaw({ ...base, webhook_id: 'w' }, cachedThread)!.userIsBot, true)
  assert.equal(messageFromRaw({ ...base, type: 7 }, cachedThread)!.isPlain, false)
  assert.equal(messageFromRaw(null, cachedThread), null)
  assert.equal(messageFromRaw({ ...base, author: undefined }, cachedThread), null)
  assert.equal(messageFromRaw({ ...base, content: undefined }, cachedThread)!.text, '')
})
