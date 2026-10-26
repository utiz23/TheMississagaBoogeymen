import test from 'node:test'
import assert from 'node:assert/strict'
import {
  acceptButton,
  answerButton,
  deleteBotMessage,
  editBotMessage,
  sendBotMessage,
  sendDirectMessage,
  startThread,
  talkButton,
  type BotMessage,
} from './bot-rest.ts'
import { WebhookOutcomeUnknownError } from './webhook.ts'

const TOKEN = 'secret-token'
const msg: BotMessage = { content: 'hello', allowed_mentions: { parse: [] } }

interface Seen {
  url: string
  method: string
  auth: string | null
  body: unknown
}

/** A fake fetch that records each call and answers from a queue of responses. */
function recorder(...responses: Response[]): { fake: typeof fetch; calls: Seen[] } {
  const calls: Seen[] = []
  const fake = (async (url: URL | string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? '',
      auth: new Headers(init?.headers).get('Authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    })
    const next = responses.shift()
    if (next === undefined) throw new Error('unexpected extra fetch call')
    return next
  }) as typeof fetch
  return { fake, calls }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })

void test('sendBotMessage POSTs the channel messages route as the bot and returns the id', async () => {
  const { fake, calls } = recorder(json({ id: '555' }))
  const id = await sendBotMessage(TOKEN, '123', msg, fake)
  assert.equal(id, '555')
  assert.equal(calls[0]!.url, 'https://discord.com/api/v10/channels/123/messages')
  assert.equal(calls[0]!.method, 'POST')
  assert.equal(calls[0]!.auth, 'Bot secret-token')
  assert.deepEqual(calls[0]!.body, msg)
})

void test('sendBotMessage: an HTTP error names the status and never the token', async () => {
  const { fake } = recorder(json({ message: `bad ${TOKEN}` }, 429))
  await assert.rejects(sendBotMessage(TOKEN, '123', msg, fake), (err: Error) => {
    assert.match(err.message, /HTTP 429\b/)
    assert.doesNotMatch(err.message, /secret-token/)
    assert.ok(!(err instanceof WebhookOutcomeUnknownError))
    return true
  })
})

void test('sendBotMessage: a response with no id is an error', async () => {
  const { fake } = recorder(json({}))
  await assert.rejects(sendBotMessage(TOKEN, '123', msg, fake), /no message id/)
})

void test('sendBotMessage: a timeout is an unknown outcome and hides the token', async () => {
  const fake = (async () => {
    throw new DOMException(`timed out ${TOKEN}`, 'TimeoutError')
  }) as typeof fetch
  await assert.rejects(sendBotMessage(TOKEN, '123', msg, fake), (err: Error) => {
    assert.ok(err instanceof WebhookOutcomeUnknownError)
    assert.doesNotMatch(err.message, /secret-token/)
    return true
  })
})

void test('sendBotMessage: connection refused is a definite failure (nothing was sent)', async () => {
  const fake = (async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })
  }) as typeof fetch
  await assert.rejects(sendBotMessage(TOKEN, '123', msg, fake), (err: Error) => {
    assert.ok(!(err instanceof WebhookOutcomeUnknownError))
    assert.match(err.message, /ECONNREFUSED/)
    return true
  })
})

void test('editBotMessage PATCHes the message route', async () => {
  const { fake, calls } = recorder(json({ id: '456' }))
  await editBotMessage(TOKEN, '123', '456', { content: 'edited' }, fake)
  assert.equal(calls[0]!.url, 'https://discord.com/api/v10/channels/123/messages/456')
  assert.equal(calls[0]!.method, 'PATCH')
  assert.equal(calls[0]!.auth, 'Bot secret-token')
  assert.deepEqual(calls[0]!.body, { content: 'edited' })
})

void test('editBotMessage: HTTP error names the status; a network failure is a plain Error', async () => {
  const bad = recorder(json({}, 403))
  await assert.rejects(editBotMessage(TOKEN, '1', '2', { content: 'x' }, bad.fake), /HTTP 403\b/)
  const down = (async () => {
    throw new DOMException(`timed out ${TOKEN}`, 'TimeoutError')
  }) as typeof fetch
  await assert.rejects(editBotMessage(TOKEN, '1', '2', { content: 'x' }, down), (err: Error) => {
    assert.ok(!(err instanceof WebhookOutcomeUnknownError))
    assert.match(err.message, /TimeoutError/)
    assert.doesNotMatch(err.message, /secret-token/)
    return true
  })
})

void test('deleteBotMessage: DELETE route; 204 and 404 both mean done', async () => {
  const gone = recorder(new Response(null, { status: 204 }))
  await deleteBotMessage(TOKEN, '123', '456', gone.fake)
  assert.equal(gone.calls[0]!.url, 'https://discord.com/api/v10/channels/123/messages/456')
  assert.equal(gone.calls[0]!.method, 'DELETE')
  assert.equal(gone.calls[0]!.auth, 'Bot secret-token')
  const missing = recorder(json({ message: 'Unknown Message' }, 404))
  await deleteBotMessage(TOKEN, '123', '456', missing.fake)
})

void test('deleteBotMessage: another status throws and never names the token', async () => {
  const { fake } = recorder(json({ message: TOKEN }, 500))
  await assert.rejects(deleteBotMessage(TOKEN, '123', '456', fake), (err: Error) => {
    assert.match(err.message, /HTTP 500\b/)
    assert.doesNotMatch(err.message, /secret-token/)
    return true
  })
})

void test('startThread POSTs the threads route and returns the thread id', async () => {
  const { fake, calls } = recorder(json({ id: '789' }))
  const id = await startThread(TOKEN, '123', '456', 'Scrum', fake)
  assert.equal(id, '789')
  assert.equal(calls[0]!.url, 'https://discord.com/api/v10/channels/123/messages/456/threads')
  assert.equal(calls[0]!.method, 'POST')
  assert.deepEqual(calls[0]!.body, { name: 'Scrum' })
})

void test('startThread cuts the name to 100 characters', async () => {
  const { fake, calls } = recorder(json({ id: '789' }))
  await startThread(TOKEN, '123', '456', 'x'.repeat(150), fake)
  assert.equal((calls[0]!.body as { name: string }).name.length, 100)
})

void test('startThread: a response with no id is an error', async () => {
  const { fake } = recorder(json({}))
  await assert.rejects(startThread(TOKEN, '1', '2', 'n', fake), /no thread id/)
})

void test('sendDirectMessage opens the DM channel, then posts with no mentions', async () => {
  const { fake, calls } = recorder(json({ id: 'dm-1' }), json({ id: 'm-1' }))
  await sendDirectMessage(TOKEN, '42', 'hi there', fake)
  assert.equal(calls.length, 2)
  assert.equal(calls[0]!.url, 'https://discord.com/api/v10/users/@me/channels')
  assert.equal(calls[0]!.method, 'POST')
  assert.deepEqual(calls[0]!.body, { recipient_id: '42' })
  assert.equal(calls[1]!.url, 'https://discord.com/api/v10/channels/dm-1/messages')
  assert.equal(calls[1]!.auth, 'Bot secret-token')
  assert.deepEqual(calls[1]!.body, { content: 'hi there', allowed_mentions: { parse: [] } })
})

void test('sendDirectMessage: DMs closed (HTTP 403) throws; the token never shows', async () => {
  const { fake } = recorder(json({ id: 'dm-1' }), json({ message: TOKEN }, 403))
  await assert.rejects(sendDirectMessage(TOKEN, '42', 'hi', fake), (err: Error) => {
    assert.match(err.message, /HTTP 403\b/)
    assert.doesNotMatch(err.message, /secret-token/)
    return true
  })
})

void test('sendDirectMessage: a timeout on the post is an unknown outcome', async () => {
  let n = 0
  const fake = (async () => {
    n += 1
    if (n === 1) return json({ id: 'dm-1' })
    throw new DOMException('timed out', 'TimeoutError')
  }) as typeof fetch
  await assert.rejects(sendDirectMessage(TOKEN, '42', 'hi', fake), WebhookOutcomeUnknownError)
})

void test('button builders produce action-row-ready primary buttons', () => {
  assert.deepEqual(talkButton(9), {
    type: 2,
    style: 1,
    label: 'Talk to the press',
    custom_id: 'press:talk:9',
  })
  assert.deepEqual(acceptButton(7), {
    type: 2,
    style: 1,
    label: 'Accept',
    custom_id: 'press:accept:7',
  })
  assert.deepEqual(answerButton(7), {
    type: 2,
    style: 1,
    label: 'Answer',
    custom_id: 'press:answer:7',
  })
})
