import test from 'node:test'
import assert from 'node:assert/strict'
import type { PressDiscordOps } from './pass.ts'
import { joinOpenThreads, joinThread, listActiveThreads, withBarlowJoin } from './thread-join.ts'

type Call = { url: string; method: string; auth: string }

function fakeFetch(respond: (c: Call) => Response): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const fetchImpl = ((url: string, init: RequestInit) => {
    const c = {
      url,
      method: String(init.method),
      auth: (init.headers as Record<string, string>)['Authorization'] ?? '',
    }
    calls.push(c)
    return Promise.resolve(respond(c))
  }) as unknown as typeof fetch
  return { fetchImpl, calls }
}

const API = 'https://discord.com/api/v10'

void test('joinThread: PUT thread-members/@me with the bot token; 204 is done', async () => {
  const f = fakeFetch(() => new Response(null, { status: 204 }))
  await joinThread('tok-barlow', '400000000000000001', f.fetchImpl)
  assert.deepEqual(f.calls, [
    {
      url: `${API}/channels/400000000000000001/thread-members/@me`,
      method: 'PUT',
      auth: 'Bot tok-barlow',
    },
  ])
})

void test('joinThread: an HTTP error names the status, never the token', async () => {
  const f = fakeFetch(() => new Response(null, { status: 403 }))
  await assert.rejects(joinThread('tok-secret', 't1', f.fetchImpl), (err: Error) => {
    assert.equal(err.message, 'Discord bot HTTP 403')
    assert.ok(!err.message.includes('tok-secret'))
    return true
  })
})

void test('listActiveThreads: only the threads under the press channel', async () => {
  const f = fakeFetch(() =>
    Response.json({
      threads: [
        { id: 't1', parent_id: 'press' },
        { id: 't2', parent_id: 'general' },
        { id: 't3', parent_id: 'press' },
        { parent_id: 'press' },
      ],
      members: [],
    }),
  )
  assert.deepEqual(await listActiveThreads('tok', 'guild', 'press', f.fetchImpl), ['t1', 't3'])
  assert.equal(f.calls[0]!.url, `${API}/guilds/guild/threads/active`)
  assert.equal(f.calls[0]!.method, 'GET')
})

void test('joinOpenThreads: joins each open press thread; a failed join is logged, the rest go on', async () => {
  const logs: string[] = []
  const f = fakeFetch((c) => {
    if (c.method === 'GET') {
      return Response.json({
        threads: [
          { id: 't1', parent_id: 'press' },
          { id: 't2', parent_id: 'press' },
        ],
      })
    }
    return new Response(null, { status: c.url.includes('/t1/') ? 500 : 204 })
  })
  const n = await joinOpenThreads({
    token: 'tok',
    guildId: 'g',
    channelId: 'press',
    log: (m) => logs.push(m),
    fetchImpl: f.fetchImpl,
  })
  assert.equal(n, 1)
  assert.deepEqual(
    f.calls.filter((c) => c.method === 'PUT').map((c) => c.url),
    [`${API}/channels/t1/thread-members/@me`, `${API}/channels/t2/thread-members/@me`],
  )
  assert.deepEqual(logs, [
    '[press] thread join: thread t1: failed (Discord bot HTTP 500)',
    '[press] thread join: Barlow is in 1 of 2 open threads',
  ])
})

void test('joinOpenThreads: the list fails → one log line, no throw', async () => {
  const logs: string[] = []
  const f = fakeFetch(() => new Response(null, { status: 401 }))
  const n = await joinOpenThreads({
    token: 'tok',
    guildId: 'g',
    channelId: 'press',
    log: (m) => logs.push(m),
    fetchImpl: f.fetchImpl,
  })
  assert.equal(n, 0)
  assert.deepEqual(logs, ['[press] thread join: open threads not listed (Discord bot HTTP 401)'])
})

function opsWithThread(): { ops: PressDiscordOps; started: string[] } {
  const started: string[] = []
  const ops: PressDiscordOps = {
    send: () => Promise.resolve('m'),
    edit: () => Promise.resolve(),
    remove: () => Promise.resolve(),
    thread: (r, _c, messageId) => {
      started.push(`${r}:${messageId}`)
      return Promise.resolve(`thread-of-${messageId}`)
    },
    dm: () => Promise.resolve(),
  }
  return { ops, started }
}

void test('withBarlowJoin: Barlow joins a thread another reporter starts; not his own', async () => {
  const { ops, started } = opsWithThread()
  const joined: string[] = []
  const wrapped = withBarlowJoin(
    ops,
    (id) => {
      joined.push(id)
      return Promise.resolve()
    },
    () => undefined,
  )
  assert.equal(await wrapped.thread('voss', 'press', 'msg-1', 'Voss — A'), 'thread-of-msg-1')
  assert.equal(await wrapped.thread('barlow', 'press', 'msg-2', 'Barlow — A'), 'thread-of-msg-2')
  assert.deepEqual(started, ['voss:msg-1', 'barlow:msg-2'])
  assert.deepEqual(joined, ['thread-of-msg-1'])
})

void test('withBarlowJoin: a failed join is logged; the thread id still comes back', async () => {
  const { ops } = opsWithThread()
  const logs: string[] = []
  const wrapped = withBarlowJoin(
    ops,
    () => Promise.reject(new Error('Discord bot HTTP 403')),
    (m) => logs.push(m),
  )
  assert.equal(await wrapped.thread('mercer', 'press', 'm9', 'x'), 'thread-of-m9')
  assert.deepEqual(logs, [
    '[press] thread join: thread thread-of-m9: failed (Discord bot HTTP 403)',
  ])
})
