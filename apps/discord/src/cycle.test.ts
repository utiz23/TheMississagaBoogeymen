import test from 'node:test'
import assert from 'node:assert/strict'
import type { DiscordGameResult } from '@eanhl/db/discord'
import { runPosterCycle, type PosterDeps, type PosterStore } from './cycle.ts'
import type { WebhookPayload } from './message.ts'

const NOW = new Date('2026-10-10T12:00:00Z')
const result = (id: number, cards: number[]): DiscordGameResult => ({
  matchId: id,
  result: 'WIN',
  overtime: false,
  scoreFor: 3,
  scoreAgainst: 1,
  opponentName: 'Opp',
  gameTitleName: 'NHL 26',
  gameMode: '6s',
  playedAt: '2026-10-10T11:00:00.000Z',
  stars: cards.map((pid, i) => ({
    rank: i + 1,
    gamertag: `P${String(pid)}`,
    kind: 'member',
    playerId: pid,
    score: 5,
    statLine: '',
    teamAbbrev: null,
  })),
  cardPlayerIds: cards,
})

function harness(over: Partial<PosterDeps> = {}, candidates = [1]) {
  const events: string[] = []
  const claimed = new Set<number>()
  const store: PosterStore = {
    candidates: async (since, limit) => {
      events.push(`candidates:${since.toISOString()}:${String(limit)}`)
      return candidates
    },
    claim: async (id) => {
      if (claimed.has(id)) return false
      claimed.add(id)
      events.push(`claim:${String(id)}`)
      return true
    },
    markPosted: async (id, msg) => void events.push(`posted:${String(id)}:${String(msg)}`),
    markFailed: async (id, err) => void events.push(`failed:${String(id)}:${err}`),
    markSkipped: async (id, why) => void events.push(`skipped:${String(id)}:${why}`),
  }
  const sent: { payload: WebhookPayload; image: Uint8Array | null }[] = []
  const deps: PosterDeps = {
    store,
    fetchGameResult: async (id) => result(id, [7]),
    renderCards: async () => new Uint8Array([1, 2, 3]),
    send: async (payload, image) => {
      sent.push({ payload, image })
      return 'msg-1'
    },
    writeDryRun: async (id) => void events.push(`dry:${String(id)}`),
    log: (m) => void events.push(`log:${m}`),
    now: () => NOW,
    ...over,
  }
  return { deps, events, sent }
}

const OPTS = {
  dryRun: false,
  siteUrl: 'https://boogeymen.app',
  windowMs: 86_400_000,
  batchLimit: 5,
}

void test('asks for the last 24 h only', async () => {
  const h = harness()
  await runPosterCycle(h.deps, OPTS)
  assert.equal(h.events[0], 'candidates:2026-10-09T12:00:00.000Z:5')
})

void test('happy path: claim, render, send with image, mark posted', async () => {
  const h = harness()
  const s = await runPosterCycle(h.deps, OPTS)
  assert.deepEqual(s, { posted: 1, failed: 0, dryRun: 0 })
  assert.ok(h.events.includes('posted:1:msg-1'))
  assert.equal(h.sent[0]?.image?.length, 3)
  assert.ok(h.sent[0]?.payload.embeds[0]?.image)
})

void test('render failure ⇒ text-only post, still posted', async () => {
  const h = harness({
    renderCards: async () => {
      throw new Error('chromium died')
    },
  })
  const s = await runPosterCycle(h.deps, OPTS)
  assert.equal(s.posted, 1)
  assert.equal(h.sent[0]?.image, null)
  assert.equal(h.sent[0]?.payload.embeds[0]?.image, undefined)
})

void test('no member cards ⇒ no render call, no image', async () => {
  let rendered = false
  const h = harness({
    fetchGameResult: async (id) => result(id, []),
    renderCards: async () => {
      rendered = true
      return new Uint8Array()
    },
  })
  await runPosterCycle(h.deps, OPTS)
  assert.equal(rendered, false)
  assert.equal(h.sent[0]?.image, null)
})

void test('send failure ⇒ marked failed, not posted', async () => {
  const h = harness({
    send: async () => {
      throw new Error('Discord webhook HTTP 429')
    },
  })
  const s = await runPosterCycle(h.deps, OPTS)
  assert.deepEqual(s, { posted: 0, failed: 1, dryRun: 0 })
  assert.ok(h.events.includes('failed:1:Discord webhook HTTP 429'))
})

void test('game data failure ⇒ marked failed, nothing sent', async () => {
  const h = harness({
    fetchGameResult: async () => {
      throw new Error('game data HTTP 500')
    },
  })
  await runPosterCycle(h.deps, OPTS)
  assert.equal(h.sent.length, 0)
  assert.ok(h.events.includes('failed:1:game data HTTP 500'))
})

void test('a game the store will not let us claim is never sent', async () => {
  const h = harness({}, [1, 1])
  await runPosterCycle(h.deps, OPTS)
  assert.equal(h.sent.length, 1)
})

void test('dry run writes files, marks skipped, sends nothing', async () => {
  const h = harness()
  const s = await runPosterCycle(h.deps, { ...OPTS, dryRun: true })
  assert.deepEqual(s, { posted: 0, failed: 0, dryRun: 1 })
  assert.equal(h.sent.length, 0)
  assert.ok(h.events.includes('dry:1'))
  assert.ok(h.events.includes('skipped:1:dry run'))
})
