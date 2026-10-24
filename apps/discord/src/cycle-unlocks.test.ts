import test from 'node:test'
import assert from 'node:assert/strict'
import type { DiscordUnlock } from '@eanhl/db/discord'
import { runUnlockCycle, type UnlockDeps } from './cycle-unlocks.ts'
import type { MessagePayload } from './message.ts'
import { WebhookOutcomeUnknownError } from './webhook.ts'

const unlock = (id: number, graphic: DiscordUnlock['graphic'] = 'badge'): DiscordUnlock => ({
  eventId: id,
  playerId: 2,
  name: 'SILKY',
  kind: 'badge',
  subject: 'Shots · Home II',
  graphic,
})

function harness(ids: number[], over: Partial<UnlockDeps> = {}) {
  const events: string[] = []
  const claimed = new Set<number>()
  const sent: { id: number; payload: MessagePayload; image: Uint8Array | null }[] = []
  let current = 0
  const deps: UnlockDeps = {
    store: {
      candidates: async () => ids,
      claim: async (id) => {
        if (claimed.has(id)) return false
        claimed.add(id)
        events.push(`claim:${String(id)}`)
        return true
      },
      markPosted: async (id) => void events.push(`posted:${String(id)}`),
      markFailed: async (id, e) => void events.push(`failed:${String(id)}:${e}`),
      markSkipped: async (id, r) => void events.push(`skipped:${String(id)}:${r}`),
    },
    fetchUnlock: async (id) => ((current = id), unlock(id)),
    render: async (id) => new Uint8Array([id]),
    send: async (payload, image) => (
      sent.push({ id: current, payload, image }),
      `m${String(current)}`
    ),
    writeDryRun: async (k) => void events.push(`dry:${k}`),
    pause: async (ms) => void events.push(`pause:${String(ms)}`),
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
  batchLimit: 20,
}

void test('posts each unlock in candidate order, one message each, paused between sends', async () => {
  const h = harness([5, 6, 7])
  const s = await runUnlockCycle(h.deps, OPTS)
  assert.equal(s.posted, 3)
  assert.deepEqual(
    h.sent.map((x) => x.id),
    [5, 6, 7],
  )
  assert.equal(h.events.filter((e) => e.startsWith('pause:')).length, 2)
})

void test('web says skip ⇒ claimed, skipped with its reason, logged, never sent', async () => {
  const h = harness([5], { fetchUnlock: async () => ({ skip: 'nothing to show' }) })
  await runUnlockCycle(h.deps, OPTS)
  assert.equal(h.sent.length, 0)
  assert.ok(h.events.includes('skipped:5:nothing to show'))
  assert.ok(h.events.some((e) => e.startsWith('log:unlock 5: skipped')))
})

void test('a 404 (old web image, bad token) is a retry, never a skip', async () => {
  const h = harness([5], {
    fetchUnlock: async () => {
      throw new Error('unlock data HTTP 404')
    },
  })
  await runUnlockCycle(h.deps, OPTS)
  assert.ok(!h.events.some((e) => e.startsWith('claim:') || e.startsWith('skipped:')))
})

void test('Discord rate limit (429) ⇒ that unlock failed, the pass stops for this cycle', async () => {
  const h = harness([5, 6, 7], {
    send: async () => {
      throw new Error('Discord webhook HTTP 429')
    },
  })
  const s = await runUnlockCycle(h.deps, OPTS)
  assert.equal(s.failed, 1)
  assert.ok(h.events.includes('failed:5:Discord webhook HTTP 429'))
  assert.ok(!h.events.some((e) => e === 'claim:6' || e === 'claim:7'))
})

void test('web down (5xx / network) ⇒ nothing claimed, retried next cycle', async () => {
  const h = harness([5], {
    fetchUnlock: async () => {
      throw new Error('unlock data HTTP 502')
    },
  })
  await runUnlockCycle(h.deps, OPTS)
  assert.ok(!h.events.some((e) => e.startsWith('claim:')))
})

void test("graphic 'none' ⇒ text-only, no render", async () => {
  let rendered = false
  const h = harness([5], {
    fetchUnlock: async (id) => unlock(id, 'none'),
    render: async () => {
      rendered = true
      return new Uint8Array()
    },
  })
  await runUnlockCycle(h.deps, OPTS)
  assert.equal(rendered, false)
  assert.equal(h.sent[0]?.image, null)
})

void test('a crash-like failure mid-run never re-sends earlier unlocks; unknown outcome stays pending', async () => {
  let n = 0
  const h = harness([5, 6, 7], {
    send: async () => {
      n++
      if (n === 2) throw new WebhookOutcomeUnknownError('timeout')
      return 'm'
    },
  })
  const s = await runUnlockCycle(h.deps, OPTS)
  assert.equal(s.posted, 2)
  assert.ok(!h.events.some((e) => e.startsWith('failed:6')))
  assert.ok(h.events.includes('posted:5') && h.events.includes('posted:7'))
})

void test('dry run writes each unlock and skips it', async () => {
  const h = harness([5, 6])
  const s = await runUnlockCycle(h.deps, { ...OPTS, dryRun: true })
  assert.equal(s.dryRun, 2)
  assert.ok(h.events.includes('dry:unlock-5') && h.events.includes('skipped:6:dry run'))
})
