import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTERS } from '@eanhl/db/news'
import { articleSlug, buildArticlePayload, buildNewsPostPayload, toBotMessage } from './messages.ts'

const SITE = 'https://boogeymen.app'

void test('a post keeps a gamertag literal and sends no mentions', () => {
  const p = buildNewsPostPayload({
    reporter: REPORTERS.barlow,
    text: 'x_Sniper_x had **nothing**.',
    replyToName: null,
    siteUrl: SITE,
  })
  assert.equal(p.content, 'x\\_Sniper\\_x had \\*\\*nothing\\*\\*.')
  assert.deepEqual(p.allowed_mentions.parse, [])
  assert.equal(p.username, 'Wade Barlow')
  assert.equal(p.avatar_url, `${SITE}/news/avatar/barlow`)
})

void test('a reply starts with the reply marker', () => {
  const p = buildNewsPostPayload({
    reporter: REPORTERS.barlow,
    text: 'Fraud.',
    replyToName: 'Dex Mercer',
    siteUrl: SITE,
  })
  assert.ok(p.content.startsWith('↪ to Dex Mercer: '))
  assert.deepEqual(p.allowed_mentions.parse, [])
})

void test('@everyone in model text cannot ping', () => {
  const p = buildNewsPostPayload({
    reporter: REPORTERS.mercer,
    text: '@everyone look',
    replyToName: null,
    siteUrl: `${SITE}/`,
  })
  assert.deepEqual(p.allowed_mentions, { parse: [] })
  assert.equal(p.avatar_url, `${SITE}/news/avatar/mercer`)
})

void test('article payload: headline, dek, url', () => {
  const p = buildArticlePayload({
    reporter: REPORTERS.quill,
    headline: 'Twelve Against',
    dek: 'Outshot 45-17.',
    url: `${SITE}/news/2026-10-12-twelve-against`,
    siteUrl: SITE,
  })
  assert.equal(
    p.content,
    `**Twelve Against**\nOutshot 45\\-17.\n${SITE}/news/2026-10-12-twelve-against`,
  )
  assert.deepEqual(p.allowed_mentions.parse, [])
})

void test('articleSlug', () => {
  assert.equal(
    articleSlug('2026-10-12', 'Twelve Against, Two For: A Night to Forget'),
    '2026-10-12-twelve-against-two-for-a-night-to-forget',
  )
  assert.equal(articleSlug('2026-10-12', "Don't Café — Ünïcode!"), '2026-10-12-dont-cafe-unicode')
  const long = articleSlug('2026-10-12', 'word '.repeat(60))
  assert.ok(long.length <= 80)
  assert.ok(!long.endsWith('-'))
  assert.match(long, /^[a-z0-9-]+$/)
  assert.equal(articleSlug('2026-10-12', '???'), '2026-10-12')
})

void test('toBotMessage: the recap gets the talk button, with the same content and no mentions', () => {
  const p = buildNewsPostPayload({
    reporter: REPORTERS.mercer,
    text: '@everyone x_Sniper_x scored.',
    replyToName: null,
    siteUrl: SITE,
  })
  const m = toBotMessage(p, 5)
  assert.equal(m.content, p.content)
  assert.deepEqual(m.allowed_mentions, { parse: [] })
  assert.deepEqual(m.components, [
    {
      type: 1,
      components: [{ type: 2, style: 1, label: 'Talk to the press', custom_id: 'press:talk:5' }],
    },
  ])
  // The bot has its own name and avatar: the webhook fields are not sent.
  assert.ok(!('username' in m))
  assert.ok(!('avatar_url' in m))
})

void test('toBotMessage: without an item id there are no components', () => {
  const p = buildNewsPostPayload({
    reporter: REPORTERS.barlow,
    text: 'Fraud.',
    replyToName: 'Dex Mercer',
    siteUrl: SITE,
  })
  const m = toBotMessage(p, null)
  assert.deepEqual(m, { content: p.content, allowed_mentions: { parse: [] } })
  assert.ok(!('components' in m))
})
