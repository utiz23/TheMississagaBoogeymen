import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ARTICLE_SCHEMA,
  GAME_POSTS_SCHEMA,
  REVIEW_SCHEMA,
  parseArticle,
  parseGamePosts,
  parseReview,
} from './outputs.ts'

const post = (reporter: string) => ({ reporter, text: 'Hello.', mentions: [], clubs: [] })

void test('parseGamePosts accepts the assigned reporters in order', () => {
  const r = parseGamePosts({ posts: [post('mercer'), post('barlow')] }, ['mercer', 'barlow'])
  assert.equal(r.posts.length, 2)
  assert.equal(r.posts[1]!.reporter, 'barlow')
  assert.equal(parseGamePosts({ posts: [post('barlow')] }, ['barlow']).posts.length, 1)
})

void test('parseGamePosts rejects a reporter not assigned, 3 posts, an extra field, a wrong count', () => {
  assert.throws(() => parseGamePosts({ posts: [post('vale')] }, ['barlow']))
  assert.throws(() => parseGamePosts({ posts: [post('barlow'), post('vale')] }, ['vale', 'barlow']))
  assert.throws(() =>
    parseGamePosts({ posts: [post('a'), post('b'), post('c')] }, ['barlow', 'quill']),
  )
  assert.throws(() =>
    parseGamePosts({ posts: [post('barlow'), post('quill'), post('voss')] }, [
      'barlow',
      'quill',
      'voss',
    ]),
  )
  assert.throws(() => parseGamePosts({ posts: [{ ...post('barlow'), extra: 1 }] }, ['barlow']))
  assert.throws(() => parseGamePosts({ posts: [post('barlow')], more: true }, ['barlow']))
  assert.throws(() => parseGamePosts({ posts: [post('barlow')] }, ['barlow', 'quill']))
  assert.throws(() => parseGamePosts({ posts: [] }, []))
  assert.throws(() => parseGamePosts({ posts: [{ ...post('barlow'), text: '  ' }] }, ['barlow']))
  assert.throws(() => parseGamePosts('nope', ['barlow']))
})

const article = {
  headline: 'H',
  dek: 'D',
  paragraphs: ['One.', 'Two.'],
  summary: 'S',
  mentions: ['Skater A'],
  clubs: ['Shake N Bake'],
}

void test('parseArticle', () => {
  assert.deepEqual(parseArticle(article), article)
  assert.throws(() => parseArticle({ ...article, extra: 1 }))
  assert.throws(() => parseArticle({ ...article, paragraphs: [] }))
  assert.throws(() => parseArticle({ ...article, paragraphs: ['ok', ''] }))
  assert.throws(() => parseArticle({ ...article, headline: '' }))
  assert.throws(() => parseArticle({ ...article, mentions: [1] }))
  const { summary: _s, ...missing } = article
  assert.throws(() => parseArticle(missing))
})

void test('parseReview', () => {
  assert.deepEqual(parseReview({ ok: true, problems: [] }), { ok: true, problems: [] })
  assert.deepEqual(parseReview({ ok: false, problems: ['invented quote'] }), {
    ok: false,
    problems: ['invented quote'],
  })
  assert.throws(() => parseReview({ ok: 'yes', problems: [] }))
  assert.throws(() => parseReview({ ok: true }))
  assert.throws(() => parseReview({ ok: true, problems: [], x: 1 }))
})

function everyObjectIsClosed(schema: unknown, path = 'schema'): void {
  if (typeof schema !== 'object' || schema === null) return
  const s = schema as Record<string, unknown>
  if (s['type'] === 'object') {
    assert.equal(s['additionalProperties'], false, `${path} additionalProperties`)
    const props = Object.keys(s['properties'] as object).sort()
    assert.deepEqual([...(s['required'] as string[])].sort(), props, `${path} required`)
  }
  for (const [k, v] of Object.entries(s)) {
    if (Array.isArray(v)) v.forEach((x, i) => everyObjectIsClosed(x, `${path}.${k}[${String(i)}]`))
    else everyObjectIsClosed(v, `${path}.${k}`)
  }
}

void test('every schema object has additionalProperties false and required for all properties', () => {
  everyObjectIsClosed(GAME_POSTS_SCHEMA)
  everyObjectIsClosed(ARTICLE_SCHEMA)
  everyObjectIsClosed(REVIEW_SCHEMA)
  assert.equal((GAME_POSTS_SCHEMA as { type: string }).type, 'object')
})
