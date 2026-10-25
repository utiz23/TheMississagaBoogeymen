import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTER_IDS } from '@eanhl/db/news'
import { oct12Facts } from './test-fixtures.ts'
import {
  criticizedAsOnSheet,
  ARTICLE_SCHEMA,
  GAME_POSTS_SCHEMA,
  REVIEW_SCHEMA,
  parseArticle,
  HEADLINE_MAX_CHARS,
  DEK_MAX_CHARS,
  parseGamePosts,
  parseReview,
  FEATURE_SCHEMA,
  parseFeature,
} from './outputs.ts'

const post = (reporter: string) => ({
  reporter,
  text: 'Hello.',
  mentions: [],
  clubs: [],
  criticized: [],
  zeroCalled: [],
  stances: [],
  takesUsed: [],
})

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
  // C3a: the buzz assigns 1 to 9 posts (one per reporter); 3 assigned is fine, 10 never.
  assert.equal(
    parseGamePosts({ posts: [post('barlow'), post('quill'), post('voss')] }, [
      'barlow',
      'quill',
      'voss',
    ]).posts.length,
    3,
  )
  const ten = [...REPORTER_IDS, 'barlow' as const]
  assert.throws(() => parseGamePosts({ posts: ten.map(post) }, ten), /1 to 9/)
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
  criticized: [],
  zeroCalled: [],
  stances: [],
  takesUsed: [],
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

void test('parseArticle: headline at most 120 characters, dek at most 160 (M7)', () => {
  const h120 = 'H'.repeat(120)
  const d160 = 'D'.repeat(160)
  assert.equal(parseArticle({ ...article, headline: h120, dek: d160 }).dek, d160)
  assert.throws(
    () => parseArticle({ ...article, headline: 'H'.repeat(121) }),
    /headline has 121 characters; the limit is 120/,
  )
  assert.throws(
    () => parseArticle({ ...article, dek: 'D'.repeat(161) }),
    /dek has 161 characters; the limit is 160/,
  )
  assert.equal(HEADLINE_MAX_CHARS, 120)
  assert.equal(DEK_MAX_CHARS, 160)
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

void test('every post and article lists the people it criticises harshly (rev 2, B4)', () => {
  const items = GAME_POSTS_SCHEMA.properties.posts.items
  assert.deepEqual(items.properties.criticized, { type: 'array', items: { type: 'string' } })
  assert.ok((items.required as readonly string[]).includes('criticized'))
  assert.deepEqual(ARTICLE_SCHEMA.properties.criticized, {
    type: 'array',
    items: { type: 'string' },
  })
  assert.ok((ARTICLE_SCHEMA.required as readonly string[]).includes('criticized'))
  const p = parseGamePosts({ posts: [{ ...post('barlow'), criticized: ['Skater A'] }] }, ['barlow'])
  assert.deepEqual(p.posts[0]!.criticized, ['Skater A'])
  const { criticized: _c, ...noList } = post('barlow')
  assert.throws(() => parseGamePosts({ posts: [noList] }, ['barlow']), /criticized/)
  assert.throws(() =>
    parseGamePosts({ posts: [{ ...post('barlow'), criticized: [3] }] }, ['barlow']),
  )
  assert.deepEqual(parseArticle({ ...article, criticized: ['Skater A'] }).criticized, ['Skater A'])
  const { criticized: _a, ...noArticleList } = article
  assert.throws(() => parseArticle(noArticleList), /criticized/)
})

void test('feature schema: the article fields plus prediction and receipt (rev 2, B3)', () => {
  for (const k of ARTICLE_SCHEMA.required) {
    assert.ok((FEATURE_SCHEMA.required as readonly string[]).includes(k), k)
  }
  assert.deepEqual(FEATURE_SCHEMA.properties.prediction, { type: 'string' })
  assert.deepEqual(FEATURE_SCHEMA.properties.receipt, { type: 'string' })
  assert.ok((FEATURE_SCHEMA.required as readonly string[]).includes('prediction'))
  assert.ok((FEATURE_SCHEMA.required as readonly string[]).includes('receipt'))
  assert.equal(FEATURE_SCHEMA.additionalProperties, false)
  const f = { ...article, prediction: 'They win the week.', receipt: '', receiptVerdict: 'none' }
  assert.deepEqual(parseFeature(f), { ...f, receiptVerdict: null })
  assert.equal(parseFeature({ ...f, receipt: 'It came true.' }).receipt, 'It came true.')
  assert.throws(() => parseFeature({ ...f, prediction: ' ' }), /prediction/)
  const { prediction: _p, ...noPrediction } = f
  assert.throws(() => parseFeature(noPrediction), /prediction/)
  const { receipt: _r, ...noReceipt } = f
  assert.throws(() => parseFeature(noReceipt), /receipt/)
  assert.throws(() => parseFeature({ ...f, receipt: 3 }), /receipt/)
  // C3a.4: the verdict is hit, miss or none (none = no prediction to judge).
  assert.deepEqual(FEATURE_SCHEMA.properties.receiptVerdict, {
    type: 'string',
    enum: ['hit', 'miss', 'none'],
  })
  assert.equal(parseFeature({ ...f, receiptVerdict: 'hit' }).receiptVerdict, 'hit')
  assert.equal(parseFeature({ ...f, receiptVerdict: 'miss' }).receiptVerdict, 'miss')
  assert.throws(() => parseFeature({ ...f, receiptVerdict: 'maybe' }), /receiptVerdict/)
  const { receiptVerdict: _v, ...noVerdict } = f
  assert.throws(() => parseFeature(noVerdict), /receiptVerdict/)
  // A night article does not take them.
  assert.throws(() => parseArticle(f), /unexpected field/)
})

void test("criticizedAsOnSheet: stored with the sheet's spelling, each person once (C1.9, Q7)", () => {
  const facts = oct12Facts('night') // people: Skater A, Skater B, Goalie G
  assert.deepEqual(criticizedAsOnSheet(['skater  a', 'GOALIE G', 'Skater A'], facts), [
    'Skater A',
    'Goalie G',
  ])
  // A name not on the sheet (the fact check already rejects those) stays as written, trimmed.
  assert.deepEqual(criticizedAsOnSheet(['  Igor ', ''], facts), ['Igor'])
  assert.deepEqual(criticizedAsOnSheet([], facts), [])
})

void test('piece fields (C3a.4): zeroCalled, stances and takesUsed on posts and articles', () => {
  for (const props of [
    GAME_POSTS_SCHEMA.properties.posts.items.properties,
    ARTICLE_SCHEMA.properties,
  ]) {
    assert.deepEqual(props.zeroCalled, { type: 'array', items: { type: 'string' } })
    assert.deepEqual(props.takesUsed, { type: 'array', items: { type: 'integer' } })
    assert.deepEqual(props.stances.items.required, ['threadKey', 'stance'])
  }
  const p = {
    ...post('barlow'),
    zeroCalled: ['Skater A'],
    stances: [{ threadKey: 'pp-drought@2026-10-08', stance: 'It ends soon.' }],
    takesUsed: [3],
  }
  assert.deepEqual(parseGamePosts({ posts: [p] }, ['barlow']).posts[0], p)
  for (const bad of [
    { ...p, zeroCalled: [1] },
    { ...p, stances: [{ threadKey: 'x' }] },
    { ...p, stances: [{ threadKey: '', stance: 'y' }] },
    { ...p, stances: [{ threadKey: 'x', stance: 'y', extra: 1 }] },
    { ...p, takesUsed: ['3'] },
    { ...p, takesUsed: [0] },
    { ...p, takesUsed: [1.5] },
  ]) {
    assert.throws(() => parseGamePosts({ posts: [bad] }, ['barlow']), JSON.stringify(bad))
  }
  const { takesUsed: _t, ...noTakes } = p
  assert.throws(() => parseGamePosts({ posts: [noTakes] }, ['barlow']), /takesUsed/)
  const a = { ...article, zeroCalled: [], stances: [], takesUsed: [7] }
  assert.deepEqual(parseArticle(a).takesUsed, [7])
  const { stances: _s, ...noStances } = a
  assert.throws(() => parseArticle(noStances), /stances/)
})
