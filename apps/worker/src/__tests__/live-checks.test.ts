/**
 * Quick checks at the horn (live events E1): the loop with a fake clock, fake passes and fake
 * events. No database, no EA.
 *   pnpm --filter @eanhl/worker build
 *   node --test apps/worker/dist/__tests__/live-checks.test.js apps/worker/dist/__tests__/quick-check.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LiveEventCursor, LiveEventTriggerRow } from '@eanhl/db/queries'
import {
  LiveCheckLoop,
  QUICK_CHECK_OFFSETS_MS,
  afterPass,
  applyTrigger,
  isQuickCheckTrigger,
  type Series,
} from '../live-checks.js'
import type { QuickCheckRequest, QuickCheckResult } from '../quick-check.js'

const S = 1000
const MIN = 60 * S
const T0 = Date.parse('2026-11-14T03:00:00Z')
const NORMAL_MS = 5 * MIN

interface Pass {
  kind: 'normal' | 'quick'
  start: number
  end: number
  request?: QuickCheckRequest
}

interface Ev {
  id: string
  type: string
  period?: number | null
  gameTitle?: string | null
  matchType?: string | null
  /** Seconds after T0 when stored. */
  storedAt: number
  /** Seconds after T0 of the sender's `at` (defaults to storedAt). */
  at?: number
}

/**
 * A simulated worker. EA lists the game from `gameAvailableAt` (seconds after T0); the first
 * pass that STARTS at or after it stores it.
 */
function simulate(opts: {
  events?: Ev[]
  gameAvailableAt?: number | null
  /** Seconds after T0 of the stored game's `played_at` (defaults to gameAvailableAt - 60). */
  gamePlayedAt?: number
  /** A game already stored before the run (seconds after T0 of its played_at). */
  storedGamePlayedAt?: number | null
  endAt: number
  /** How long a normal pass takes (the interval stays 5 minutes). */
  normalMs?: number
  quickMs?: number
  readTriggersFails?: boolean
}) {
  let t = T0
  const passes: Pass[] = []
  const logs: string[] = []
  const cleanups: Date[] = []
  let running = 0
  let maxRunning = 0
  let latest = 100
  const stored: { playedAt: number }[] = []
  if (opts.storedGamePlayedAt !== undefined && opts.storedGamePlayedAt !== null) {
    stored.push({ playedAt: T0 + opts.storedGamePlayedAt * S })
  }
  let gameStored = false
  const avail = opts.gameAvailableAt ?? null

  const pass = async (kind: 'normal' | 'quick', ms: number, request?: QuickCheckRequest) => {
    running++
    maxRunning = Math.max(maxRunning, running)
    const start = t
    let newGames = 0
    if (!gameStored && avail !== null && start >= T0 + avail * S) {
      gameStored = true
      latest++
      newGames = 1
      stored.push({ playedAt: T0 + (opts.gamePlayedAt ?? avail - 60) * S })
    }
    await Promise.resolve()
    t += ms
    passes.push({ kind, start, end: t, ...(request ? { request } : {}) })
    running--
    return newGames
  }

  const events: LiveEventTriggerRow[] = (opts.events ?? []).map((e) => ({
    id: e.id,
    type: e.type as 'period_end' | 'game_end',
    period: e.period ?? null,
    gameTitle: e.gameTitle ?? null,
    matchType: e.matchType ?? null,
    at: new Date(T0 + (e.at ?? e.storedAt) * S),
    receivedAt: new Date(T0 + e.storedAt * S),
  }))

  const loop = new LiveCheckLoop({
    runNormalPass: async () => {
      await pass('normal', opts.normalMs ?? 20 * S)
    },
    runQuickCheck: async (request): Promise<QuickCheckResult> => {
      const newGames = await pass('quick', opts.quickMs ?? 3 * S, request)
      const types = request.matchType
        ? [request.matchType]
        : ['gameType5', 'gameType10', 'club_private']
      return { calls: types.length, newGames, titles: ['nhl27'], matchTypes: types as never }
    },
    readTriggers: (cursor: LiveEventCursor) => {
      if (opts.readTriggersFails)
        return Promise.reject(new Error('relation "live_events" does not exist'))
      const c = cursor.receivedAt.getTime()
      return Promise.resolve(
        events
          .filter((e) => e.receivedAt.getTime() <= t)
          .filter((e) => {
            const r = e.receivedAt.getTime()
            return r > c || (r === c && e.id > cursor.id)
          })
          .sort(
            (a, b) => a.receivedAt.getTime() - b.receivedAt.getTime() || a.id.localeCompare(b.id),
          ),
      )
    },
    latestMatchId: () => Promise.resolve(latest),
    gameEndedSince: (since) => Promise.resolve(stored.some((g) => g.playedAt >= since.getTime())),
    cleanup: (cutoff) => {
      cleanups.push(cutoff)
      return Promise.resolve(0)
    },
    normalIntervalMs: NORMAL_MS,
    now: () => t,
    sleep: (ms) => {
      t += ms
      return Promise.resolve()
    },
    log: (l) => logs.push(l),
    shouldStop: () => t >= T0 + opts.endAt * S,
  })
  return {
    run: async () => {
      await loop.run()
      return { passes, logs, cleanups, maxRunning, loop }
    },
  }
}

const secs = (passes: Pass[], kind: 'normal' | 'quick') =>
  passes.filter((p) => p.kind === kind).map((p) => (p.start - T0) / S)

const horn = (storedAt: number, period = 3, extra: Partial<Ev> = {}): Ev => ({
  id: `obs-${String(storedAt)}-period_end`,
  type: 'period_end',
  period,
  storedAt,
  ...extra,
})

void test('the schedule: a horn in period 3 starts checks at once, +1, +2, +4, +8 min, then stops', async () => {
  const { passes, logs } = await simulate({ events: [horn(1001)], endAt: 3600 }).run()
  const quick = secs(passes, 'quick')
  assert.equal(quick.length, 5)
  const start = quick[0]!
  // Picked up within one 5 s event read of being stored.
  assert.ok(start >= 1001 && start <= 1006, String(start))
  assert.deepEqual(
    quick.map((q) => (q - start) * S),
    [...QUICK_CHECK_OFFSETS_MS],
  )
  assert.deepEqual(QUICK_CHECK_OFFSETS_MS, [0, MIN, 2 * MIN, 4 * MIN, 8 * MIN])
  // The normal 5-minute loop is unchanged.
  assert.deepEqual(
    secs(passes, 'normal'),
    Array.from({ length: 12 }, (_, i) => i * 300),
  )
  assert.equal(logs.filter((l) => l.includes('quick check ')).length, 5, 'one log line per check')
  assert.ok(logs.some((l) => l.includes('quick checks end (checks-done)')))
})

void test('early stop: the series ends when the check stores the new game', async () => {
  const { passes, logs } = await simulate({
    events: [horn(1001)],
    gameAvailableAt: 1001 + 90,
    endAt: 3600,
  }).run()
  const quick = secs(passes, 'quick')
  // At once, +1 (not yet listed), +2 (stores it): 3 checks, no more.
  assert.equal(quick.length, 3)
  assert.ok(logs.some((l) => /quick check 3\/5 .*1 new games/.test(l)))
  assert.ok(logs.some((l) => l.includes('quick checks end (new-game)')))
})

void test('early stop: a normal pass that stores the game ends the series too', async () => {
  // Horn at 1180; checks 1180, 1240 (+1); normal pass at 1200 stores the game (listed at 1190).
  const { passes } = await simulate({
    events: [horn(1176)],
    gameAvailableAt: 1190,
    endAt: 3600,
  }).run()
  const quick = secs(passes, 'quick')
  assert.equal(quick.length, 1, JSON.stringify(quick))
})

void test('no overlap: one pass at a time; a check due during a normal pass waits for it', async () => {
  // Normal passes take 100 s, so the checks at +1/+2 fall inside one.
  const { passes, maxRunning } = await simulate({
    events: [horn(1180)],
    normalMs: 100 * S,
    endAt: 3600,
  }).run()
  assert.equal(maxRunning, 1)
  const sorted = [...passes].sort((a, b) => a.start - b.start)
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(
      sorted[i]!.start >= sorted[i - 1]!.end,
      `pass ${String(i)} starts after the last ends`,
    )
  }
  // Still at most 5 checks in all (a normal pass started when a check was due counts as it).
  const quick = secs(passes, 'quick')
  assert.ok(quick.length <= 5 && quick.length >= 3, JSON.stringify(quick))
  assert.deepEqual(
    secs(passes, 'normal'),
    Array.from({ length: 12 }, (_, i) => i * 300),
  )
})

void test('a repeat horn or the game_end while a series is scheduled does not start a second series', async () => {
  const { passes, logs } = await simulate({
    events: [horn(1001, 3), horn(1100, 4), { id: 'obs-end', type: 'game_end', storedAt: 1250 }],
    endAt: 3600,
  }).run()
  assert.equal(secs(passes, 'quick').length, 5)
  assert.equal(logs.filter((l) => l.includes('quick checks start')).length, 1)
  assert.equal(logs.filter((l) => l.includes('(series-running)')).length, 2)
})

void test('triggers: period >= 3 horns and game_end start a series; earlier horns do not', async () => {
  for (const [ev, expected] of [
    [horn(1001, 1), 0],
    [horn(1001, 2), 0],
    [{ id: 'p', type: 'period_end', period: null, storedAt: 1001 }, 0],
    [horn(1001, 4), 5],
    [{ id: 'e', type: 'game_end', storedAt: 1001 }, 5],
  ] as [Ev, number][]) {
    const { passes } = await simulate({ events: [ev], endAt: 3600 }).run()
    assert.equal(secs(passes, 'quick').length, expected, JSON.stringify(ev))
  }
  assert.equal(isQuickCheckTrigger({ type: 'period_end', period: 3 }), true)
  assert.equal(isQuickCheckTrigger({ type: 'period_end', period: 2 }), false)
  assert.equal(isQuickCheckTrigger({ type: 'game_end', period: null }), true)
})

void test('the game_end after the game was found starts nothing (game already in)', async () => {
  const { passes, logs } = await simulate({
    events: [horn(1001), { id: 'obs-end', type: 'game_end', storedAt: 1300 }],
    gameAvailableAt: 1060,
    gamePlayedAt: 1000,
    endAt: 3600,
  }).run()
  assert.equal(secs(passes, 'quick').length, 2)
  assert.ok(logs.some((l) => l.includes('obs-end: no new series (game-already-in)')))
  // After a restart (no memory of the find), the database check still skips it.
  const again = await simulate({
    events: [{ id: 'obs-end', type: 'game_end', storedAt: 1300 }],
    storedGamePlayedAt: 1000,
    endAt: 3600,
  }).run()
  assert.equal(secs(again.passes, 'quick').length, 0)
})

void test('stale events start nothing', async () => {
  // Sent 20 minutes after its own time.
  const late = await simulate({ events: [horn(2000, 3, { at: 800 })], endAt: 3600 }).run()
  assert.equal(secs(late.passes, 'quick').length, 0)
  assert.ok(late.logs.some((l) => l.includes('(stale)')))
})

void test('the event names the title and match type: the checks ask for just that', async () => {
  const { passes } = await simulate({
    events: [horn(1001, 3, { gameTitle: 'nhl27', matchType: 'gameType5' })],
    endAt: 1100,
  }).run()
  const q = passes.find((p) => p.kind === 'quick')!
  assert.deepEqual(q.request, { titleSlug: 'nhl27', matchType: 'gameType5' })
})

void test('without the live_events table the normal loop runs as before and logs rarely', async () => {
  const { passes, logs } = await simulate({ readTriggersFails: true, endAt: 3600 }).run()
  assert.equal(secs(passes, 'quick').length, 0)
  assert.equal(secs(passes, 'normal').length, 12)
  const errors = logs.filter((l) => l.includes('could not read live events'))
  assert.ok(errors.length >= 1 && errors.length <= 6, String(errors.length))
})

void test('cleanup: once an hour, events older than 30 days', async () => {
  const { cleanups } = await simulate({ endAt: 2 * 3600 + 10 }).run()
  assert.equal(cleanups.length, 3)
  assert.equal(cleanups[0]!.getTime(), T0 + 20 * S - 30 * 24 * 3600 * S)
})

void test('pure rules: applyTrigger and afterPass', () => {
  const now = T0 + 1000 * S
  const trig = (over: Partial<LiveEventTriggerRow> = {}): LiveEventTriggerRow => ({
    id: 'x',
    type: 'period_end',
    period: 3,
    gameTitle: null,
    matchType: null,
    at: new Date(now),
    receivedAt: new Date(now),
    ...over,
  })
  const ctx = { now, latestMatchId: 7, gameAlreadyIn: false, lastNewGameAt: null }
  const started = applyTrigger(null, trig(), ctx)
  assert.equal(started.reason, 'start')
  const s = started.series!
  assert.deepEqual(
    { checksDone: s.checksDone, nextAt: s.nextAt, baseline: s.baselineMatchId },
    { checksDone: 0, nextAt: now, baseline: 7 },
  )
  assert.equal(applyTrigger(s, trig({ id: 'y' }), ctx).reason, 'series-running')
  assert.equal(
    applyTrigger(null, trig(), { ...ctx, gameAlreadyIn: true }).reason,
    'game-already-in',
  )
  assert.equal(
    applyTrigger(null, trig(), { ...ctx, lastNewGameAt: now - 5 * MIN }).reason,
    'game-already-in',
  )
  assert.equal(
    applyTrigger(
      null,
      trig({ receivedAt: new Date(now - 16 * MIN), at: new Date(now - 16 * MIN) }),
      ctx,
    ).reason,
    'stale',
  )

  let cur: Series | null = s
  const nexts: number[] = []
  for (let i = 0; i < 5; i++) {
    const r = afterPass(cur!, { latestMatchId: 7, newGames: 0, counted: true })
    cur = r.series
    if (cur) nexts.push(cur.nextAt - now)
    else assert.equal(r.ended, 'checks-done')
  }
  assert.deepEqual(nexts, [MIN, 2 * MIN, 4 * MIN, 8 * MIN])
  assert.equal(afterPass(s, { latestMatchId: 8, newGames: 0, counted: false }).ended, 'new-game')
  assert.equal(afterPass(s, { latestMatchId: 7, newGames: 1, counted: true }).ended, 'new-game')
  assert.deepEqual(afterPass(s, { latestMatchId: 7, newGames: 0, counted: false }).series, s)
})
