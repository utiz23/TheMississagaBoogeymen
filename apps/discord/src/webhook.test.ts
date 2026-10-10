import test from 'node:test'
import assert from 'node:assert/strict'
import { sendWebhook, WebhookOutcomeUnknownError } from './webhook.ts'
import type { WebhookPayload } from './message.ts'

const HOOK = 'https://discord.com/api/webhooks/123/SECRET-TOKEN-VALUE'
const payload: WebhookPayload = { allowed_mentions: { parse: [] }, embeds: [] }

void test('posts multipart with wait=true, payload_json and the png; returns the message id', async () => {
  let seenUrl = ''
  let seenBody: FormData | null = null
  const fake = (async (url: URL | string, init?: RequestInit) => {
    seenUrl = String(url)
    seenBody = init?.body as FormData
    return new Response(JSON.stringify({ id: '555' }), { status: 200 })
  }) as typeof fetch
  const id = await sendWebhook(HOOK, payload, new Uint8Array([137, 80, 78, 71]), fake)
  assert.equal(id, '555')
  assert.match(seenUrl, /\?wait=true$/)
  assert.equal(JSON.parse(String(seenBody!.get('payload_json'))).allowed_mentions.parse.length, 0)
  const file = seenBody!.get('files[0]') as File
  assert.equal(file.name, 'cards.png')
})

void test('no image ⇒ no file part', async () => {
  let seenBody: FormData | null = null
  const fake = (async (_u: URL | string, init?: RequestInit) => {
    seenBody = init?.body as FormData
    return new Response('{"id":"1"}', { status: 200 })
  }) as typeof fetch
  await sendWebhook(HOOK, payload, null, fake)
  assert.equal(seenBody!.get('files[0]'), null)
})

void test('an HTTP error never leaks the webhook URL or token', async () => {
  const fake = (async () =>
    new Response(`{"message": "Unknown Webhook", "url": "${HOOK}"}`, {
      status: 404,
    })) as typeof fetch
  await assert.rejects(sendWebhook(HOOK, payload, null, fake), (err: Error) => {
    assert.match(err.message, /HTTP 404/)
    assert.ok(!err.message.includes('SECRET-TOKEN-VALUE'))
    assert.ok(!err.message.includes('/api/webhooks/'))
    return true
  })
})

void test('a network failure never leaks the webhook URL', async () => {
  const fake = (async () => {
    throw new TypeError(`fetch failed for ${HOOK}`)
  }) as typeof fetch
  await assert.rejects(sendWebhook(HOOK, payload, null, fake), (err: Error) => {
    assert.ok(!err.message.includes('SECRET-TOKEN-VALUE'))
    return true
  })
})

void test('a timeout is an unknown outcome (Discord may have posted)', async () => {
  const fake = (async () => {
    throw new DOMException('timed out', 'TimeoutError')
  }) as typeof fetch
  await assert.rejects(sendWebhook(HOOK, payload, null, fake), WebhookOutcomeUnknownError)
})

void test('connection refused is a definite failure (nothing was sent)', async () => {
  const fake = (async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })
  }) as typeof fetch
  await assert.rejects(sendWebhook(HOOK, payload, null, fake), (err: Error) => {
    assert.ok(!(err instanceof WebhookOutcomeUnknownError))
    return true
  })
})
