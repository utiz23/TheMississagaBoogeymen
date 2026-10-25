import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchNewsFacts } from './web-client.ts'
import { oct12Response } from './test-fixtures.ts'

const TOKEN = 'x'.repeat(32)

void test('GETs the internal route with the token header and parses the sheet', async () => {
  let seenUrl = ''
  let seenToken: string | null = null
  const fake = (async (url: URL | string, init?: RequestInit) => {
    seenUrl = String(url)
    seenToken = new Headers(init?.headers).get('x-internal-token')
    return new Response(JSON.stringify(oct12Response('night')), { status: 200 })
  }) as typeof fetch
  const r = await fetchNewsFacts(
    { webBaseUrl: 'http://web:3000', token: TOKEN, kind: 'night', key: '2026-10-12' },
    fake,
  )
  assert.equal(seenUrl, 'http://web:3000/internal/news/night/2026-10-12')
  assert.equal(seenToken, TOKEN)
  assert.equal(r.facts.key, '2026-10-12')
  assert.deepEqual(r.forbiddenNames, ['Hidden Hank'])
})

void test('a 404 throws with the status only (no token)', async () => {
  const fake = (async () => new Response('Not Found', { status: 404 })) as typeof fetch
  await assert.rejects(
    fetchNewsFacts({ webBaseUrl: 'http://web:3000', token: TOKEN, kind: 'game', key: '5' }, fake),
    (err: Error) => {
      assert.equal(err.message, 'news game facts HTTP 404')
      return true
    },
  )
})
