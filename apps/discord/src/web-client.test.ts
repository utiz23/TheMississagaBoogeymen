import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchGameResult } from './web-client.ts'

void test('sends the token header and parses the contract', async () => {
  let header: string | null = null
  const fake = (async (_u: URL | string, init?: RequestInit) => {
    header = new Headers(init?.headers).get('x-internal-token')
    return new Response('{"bad": true}', { status: 200 })
  }) as typeof fetch
  await assert.rejects(
    fetchGameResult({ webBaseUrl: 'http://web:3000', token: 't'.repeat(32), matchId: 1 }, fake),
    /discord contract/,
  )
  assert.equal(header, 't'.repeat(32))
})

void test('non-2xx is an error naming only the status', async () => {
  const fake = (async () => new Response('nope', { status: 404 })) as typeof fetch
  await assert.rejects(
    fetchGameResult({ webBaseUrl: 'http://web:3000', token: 't'.repeat(32), matchId: 1 }, fake),
    /game data HTTP 404/,
  )
})
