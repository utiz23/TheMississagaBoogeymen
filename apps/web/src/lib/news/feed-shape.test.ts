/**
 * Feed paging, query-string checks and The Wire grouping.
 *
 * Run: node --test apps/web/src/lib/news/feed-shape.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import type { NewsItemRow } from '@eanhl/db/queries'
import {
  ARTICLE_PAGE_SIZE,
  POST_PAGE_SIZE,
  groupWire,
  pageOf,
  parseFeedParams,
  toFeedItem,
  type FeedItem,
} from './feed-shape.ts'

function row(id: number, over: Partial<NewsItemRow> = {}): NewsItemRow {
  return {
    id,
    jobId: null,
    kind: 'article',
    reporter: 'barlow',
    matchId: null,
    night: '2026-10-12',
    weekStart: null,
    replyTo: null,
    slug: `story-${String(id)}`,
    headline: `Headline ${String(id)}`,
    dek: 'Dek.',
    body: 'Long body.',
    summary: null,
    mentions: [{ name: 'Silky', playerId: 2 }],
    facts: null,
    criticized: [],
    prediction: null,
    featureKind: null,
    receiptVerdict: null,
    isTest: false,
    discordStatus: 'posted',
    discordAttempts: 1,
    discordMessageId: null,
    lastError: null,
    deletedAt: null,
    discordDeletedAt: null,
    createdAt: new Date('2026-10-13T04:00:00Z'),
    ...over,
  }
}

test('an article item has no body or mentions; its date is the game night', () => {
  const item = toFeedItem(row(5))
  assert.equal(item.body, null)
  assert.deepEqual(item.mentions, [])
  assert.match(item.dateLabel, /^Oct 12/)
})

test('a post item keeps its text, mentions and a time stamp', () => {
  const item = toFeedItem(
    row(6, { kind: 'post', slug: null, headline: null, body: 'Silky scored.' }),
  )
  assert.equal(item.body, 'Silky scored.')
  assert.deepEqual(item.mentions, [{ name: 'Silky', playerId: 2 }])
  // 04:00 UTC on Oct 13 is 22:00 on Oct 12 in Edmonton.
  assert.match(item.dateLabel, /^Oct 12, 10:00 PM$/)
})

test('a week piece is dated "Week of ..."', () => {
  const item = toFeedItem(row(7, { night: null, weekStart: '2026-10-05' }))
  assert.match(item.dateLabel, /^Week of Oct 5/)
})

test('feed items carry the kicker: night recap, feature kind, none on posts (rev 2, A6)', () => {
  assert.equal(toFeedItem(row(8)).kicker, 'Night recap')
  assert.equal(
    toFeedItem(row(9, { night: null, weekStart: '2026-10-05', featureKind: 'notes' })).kicker,
    'Notes',
  )
  assert.equal(
    toFeedItem(row(10, { kind: 'post', slug: null, headline: null, body: 'x' })).kicker,
    null,
  )
})

test('page sizes: The Wire shows 10 posts, stories 10 (rev 2, A6)', () => {
  assert.equal(POST_PAGE_SIZE, 10)
  assert.equal(ARTICLE_PAGE_SIZE, 10)
})

test('pageOf: the extra row proves there is more and is not shown', () => {
  const rows = [row(30), row(29), row(28)]
  const page = pageOf(rows, 2)
  assert.deepEqual(
    page.items.map((i) => i.id),
    [30, 29],
  )
  assert.equal(page.nextBefore, 29)
})

test('pageOf: a short page ends the feed', () => {
  assert.equal(pageOf([row(3), row(2)], 2).nextBefore, null)
  assert.deepEqual(pageOf([], 2), { items: [], nextBefore: null })
})

test('parseFeedParams accepts article/post and a positive integer cursor', () => {
  assert.deepEqual(parseFeedParams(new URLSearchParams('kind=article')), {
    ok: true,
    kind: 'article',
    before: null,
  })
  assert.deepEqual(parseFeedParams(new URLSearchParams('kind=post&before=120')), {
    ok: true,
    kind: 'post',
    before: 120,
  })
})

test('parseFeedParams rejects bad input', () => {
  for (const q of [
    '',
    'kind=other',
    'kind=post&before=abc',
    'kind=post&before=0',
    'kind=post&before=-3',
    'kind=post&before=1.5',
    'kind=post&before=',
  ]) {
    assert.deepEqual(parseFeedParams(new URLSearchParams(q)), { ok: false }, q)
  }
})

function post(id: number, replyTo: number | null): FeedItem {
  return toFeedItem(
    row(id, { kind: 'post', slug: null, headline: null, body: `p${String(id)}`, replyTo }),
  )
}

test('groupWire nests a reply under its parent; orphan replies stay on their own', () => {
  // newest first: 12 replies to 10, 11 replies to an unloaded post, 10 and 9 are roots
  const threads = groupWire([post(12, 10), post(11, 3), post(10, null), post(9, null)])
  assert.deepEqual(
    threads.map((t) => [t.post.id, t.replies.map((r) => r.id)]),
    [
      [11, []],
      [10, [12]],
      [9, []],
    ],
  )
})

test('groupWire orders several replies oldest first', () => {
  const threads = groupWire([post(14, 10), post(13, 10), post(10, null)])
  assert.deepEqual(
    threads[0]?.replies.map((r) => r.id),
    [13, 14],
  )
})
