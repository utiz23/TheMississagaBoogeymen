import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTER_IDS, REPORTERS, type ReporterId } from '@eanhl/db/news'
import type { PressDiscord } from '../press/config.ts'
import { WebhookOutcomeUnknownError } from '../webhook.ts'
import { newsDelivery } from './delivery.ts'
import { buildNewsPostPayload } from './messages.ts'

const WEBHOOK = 'https://discord.com/api/webhooks/1/secret-hook'
const CHANNEL = '123456789012345678'

const bots: PressDiscord = {
  mode: 'live',
  tokens: Object.fromEntries(REPORTER_IDS.map((id) => [id, `token-${id}`])) as Record<
    ReporterId,
    string
  >,
  guildId: '223456789012345678',
  channelId: CHANNEL,
  gmUserId: '323456789012345678',
}

const payload = buildNewsPostPayload({
  reporter: REPORTERS.mercer,
  text: 'The Boogeymen took 14 shots.',
  replyToName: null,
  siteUrl: 'https://boogeymen.app',
})

interface Seen {
  url: string
  method: string
  auth: string | null
  body: unknown
}

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

void test('no bots: send goes by webhook, as before', async () => {
  const { fake, calls } = recorder(json({ id: '77' }))
  const d = newsDelivery({ webhookUrl: WEBHOOK, bots: null, log: () => {}, fetchImpl: fake })
  const sent = await d.send({ itemId: 5, reporter: 'mercer', payload, isGameRecap: true })
  assert.deepEqual(sent, { messageId: '77', via: 'webhook', channelId: null })
  assert.equal(calls[0]!.url, `${WEBHOOK}?wait=true`)
  assert.equal(calls[0]!.auth, null)
})

void test('bots: a recap goes as its reporter bot to the channel, with the talk button', async () => {
  const { fake, calls } = recorder(json({ id: '88' }))
  const d = newsDelivery({ webhookUrl: null, bots, log: () => {}, fetchImpl: fake })
  const sent = await d.send({ itemId: 5, reporter: 'mercer', payload, isGameRecap: true })
  assert.deepEqual(sent, { messageId: '88', via: 'bot', channelId: CHANNEL })
  assert.equal(calls[0]!.url, `https://discord.com/api/v10/channels/${CHANNEL}/messages`)
  assert.equal(calls[0]!.auth, 'Bot token-mercer')
  assert.deepEqual(calls[0]!.body, {
    content: payload.content,
    allowed_mentions: { parse: [] },
    components: [
      {
        type: 1,
        components: [{ type: 2, style: 1, label: 'Talk to the press', custom_id: 'press:talk:5' }],
      },
    ],
  })
})

void test('bots: any other post has no button', async () => {
  const { fake, calls } = recorder(json({ id: '89' }))
  const d = newsDelivery({ webhookUrl: WEBHOOK, bots, log: () => {}, fetchImpl: fake })
  await d.send({ itemId: 6, reporter: 'barlow', payload, isGameRecap: false })
  assert.equal(calls[0]!.auth, 'Bot token-barlow')
  assert.deepEqual(calls[0]!.body, { content: payload.content, allowed_mentions: { parse: [] } })
})

void test('bots: an OK answer without a message id is an unknown outcome (never re-sent)', async () => {
  const { fake } = recorder(json({}))
  const d = newsDelivery({ webhookUrl: null, bots, log: () => {}, fetchImpl: fake })
  await assert.rejects(
    d.send({ itemId: 5, reporter: 'mercer', payload, isGameRecap: true }),
    (err: Error) => err instanceof WebhookOutcomeUnknownError && /no message id/.test(err.message),
  )
})

void test('bots: an HTTP 429 stays a plain error (rate limit), without the token', async () => {
  const { fake } = recorder(json({}, 429))
  const d = newsDelivery({ webhookUrl: null, bots, log: () => {}, fetchImpl: fake })
  await assert.rejects(
    d.send({ itemId: 5, reporter: 'mercer', payload, isGameRecap: true }),
    (err: Error) =>
      !(err instanceof WebhookOutcomeUnknownError) &&
      /HTTP 429\b/.test(err.message) &&
      !err.message.includes('token-'),
  )
})

void test('remove: a bot message is deleted by its reporter bot in its channel', async () => {
  const { fake, calls } = recorder(new Response(null, { status: 204 }))
  const d = newsDelivery({ webhookUrl: null, bots, log: () => {}, fetchImpl: fake })
  await d.remove({
    messageId: '88',
    via: 'bot',
    channelId: '999999999999999999',
    reporter: 'quill',
  })
  assert.equal(calls[0]!.method, 'DELETE')
  assert.equal(calls[0]!.url, 'https://discord.com/api/v10/channels/999999999999999999/messages/88')
  assert.equal(calls[0]!.auth, 'Bot token-quill')
})

void test('remove: a bot message without the bots configured is retried later (throws)', async () => {
  const { fake, calls } = recorder()
  const d = newsDelivery({ webhookUrl: WEBHOOK, bots: null, log: () => {}, fetchImpl: fake })
  await assert.rejects(
    d.remove({ messageId: '88', via: 'bot', channelId: CHANNEL, reporter: 'quill' }),
  )
  assert.equal(calls.length, 0)
})

void test('remove: a webhook message goes through the webhook when it is set', async () => {
  const { fake, calls } = recorder(new Response(null, { status: 204 }))
  const d = newsDelivery({ webhookUrl: WEBHOOK, bots, log: () => {}, fetchImpl: fake })
  await d.remove({ messageId: '77', via: 'webhook', channelId: null, reporter: 'mercer' })
  assert.equal(calls[0]!.method, 'DELETE')
  assert.equal(calls[0]!.url, `${WEBHOOK}/messages/77`)
})

void test('remove: a webhook message with no webhook set logs one line and resolves', async () => {
  const { fake, calls } = recorder()
  const lines: string[] = []
  const d = newsDelivery({ webhookUrl: null, bots, log: (m) => lines.push(m), fetchImpl: fake })
  await d.remove({ messageId: '77', via: 'webhook', channelId: null, reporter: 'mercer' })
  assert.equal(calls.length, 0)
  assert.equal(lines.length, 1)
  assert.match(lines[0]!, /webhook message/)
  assert.doesNotMatch(lines[0]!, /secret-hook/)
})
