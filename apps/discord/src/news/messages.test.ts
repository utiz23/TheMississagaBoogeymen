import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTERS } from '@eanhl/db/news'
import { articleSlug, buildArticlePayload, buildNewsPostPayload } from './messages.ts'

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
