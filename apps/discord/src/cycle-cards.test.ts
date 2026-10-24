import test from 'node:test'
import assert from 'node:assert/strict'
import type { DiscordCardUpdates } from '@eanhl/db/discord'
import { runCardUpdatesCycle, type CardPosterDeps } from './cycle-cards.ts'
import type { WebhookPayload } from './message.ts'
import { WebhookOutcomeUnknownError } from './webhook.ts'

const data = (players: number): DiscordCardUpdates => ({
  batchEventId: 500,
  gameTitleName: 'NHL 27',
  players: Array.from({ length: players }, (_, i) => ({
    playerId: i + 1,
    name: `P${String(i + 1)}`,
    changes: ['Goals II → III'],
  })),
  cardCount: Math.min(players, 9),
})

function harness(over: Partial<CardPosterDeps> = {}) {
  const events: string[] = []
  const claimed = new Set<number>()
  const sent: { payload: WebhookPayload; image: Uint8Array | null }[] = []
  const deps: CardPosterDeps = {
    store: {
      candidates: async () => [500],
      claim: async (id) =>
        claimed.has(id) ? false : (claimed.add(id), events.push(`claim:${String(id)}`), true),
      markPosted: async (id, m) => void events.push(`posted:${String(id)}:${String(m)}`),
      markFailed: async (id, e) => void events.push(`failed:${String(id)}:${e}`),
      markSkipped: async (id, r) => void events.push(`skipped:${String(id)}:${r}`),
    },
    fetchCardUpdates: async () => data(2),
    renderCards: async () => new Uint8Array([1]),
    send: async (payload, image) => (sent.push({ payload, image }), 'msg'),
    writeDryRun: async (k) => void events.push(`dry:${k}`),
    log: (m) => void events.push(`log:${m}`),
    now: () => new Date('2026-10-24T12:00:00Z'),
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

void test('happy path: claim, render, send with image, mark posted', async () => {
  const h = harness()
  const s = await runCardUpdatesCycle(h.deps, OPTS)
  assert.equal(s.posted, 1)
  assert.ok(h.events.includes('posted:500:msg'))
  assert.equal(h.sent[0]?.image?.length, 1)
})

void test('web down ⇒ nothing claimed, retried next cycle', async () => {
  const h = harness({
    fetchCardUpdates: async () => {
      throw new Error('card data HTTP 502')
    },
  })
  await runCardUpdatesCycle(h.deps, OPTS)
  assert.ok(!h.events.some((e) => e.startsWith('claim:') || e.startsWith('failed:')))
})

void test('nothing to show (membership changed) ⇒ skipped, never sent', async () => {
  const h = harness({ fetchCardUpdates: async () => data(0) })
  await runCardUpdatesCycle(h.deps, OPTS)
  assert.equal(h.sent.length, 0)
  assert.ok(h.events.includes('skipped:500:nothing to show'))
})

void test('no cards ⇒ text-only, no render', async () => {
  let rendered = false
  const h = harness({
    fetchCardUpdates: async () => ({ ...data(1), cardCount: 0 }),
    renderCards: async () => {
      rendered = true
      return new Uint8Array()
    },
  })
  await runCardUpdatesCycle(h.deps, OPTS)
  assert.equal(rendered, false)
  assert.equal(h.sent[0]?.image, null)
})

void test('unknown send outcome stays pending; markPosted failure never re-posts', async () => {
  const a = harness({
    send: async () => {
      throw new WebhookOutcomeUnknownError('x')
    },
  })
  await runCardUpdatesCycle(a.deps, OPTS)
  assert.ok(!a.events.some((e) => e.startsWith('failed:')))
  const b = harness()
  b.deps.store.markPosted = async () => {
    throw new Error('reset')
  }
  await runCardUpdatesCycle(b.deps, OPTS)
  assert.ok(!b.events.some((e) => e.startsWith('failed:')))
})

void test('dry run writes and skips', async () => {
  const h = harness()
  const s = await runCardUpdatesCycle(h.deps, { ...OPTS, dryRun: true })
  assert.equal(s.dryRun, 1)
  assert.ok(h.events.includes('dry:card-500'))
  assert.ok(h.events.includes('skipped:500:dry run'))
})
