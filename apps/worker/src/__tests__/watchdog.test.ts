/**
 * The worker watchdog (task worker-loop-watchdog, 2026-11-14): a loop step that never resolves must
 * end in an exit after the limit, so Docker restarts the worker. Fake clock, injected exit: the
 * tests never call the real process.exit and never touch a database or EA.
 *   pnpm --filter @eanhl/worker build
 *   node --test apps/worker/dist/__tests__/watchdog.test.js
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { LiveEventCursor, LiveEventTriggerRow } from '@eanhl/db/queries'
import { LiveCheckLoop } from '../live-checks.js'
import { DEFAULT_WATCHDOG_MS, Watchdog, parsePositiveMs, type WatchdogDeps } from '../watchdog.js'

const S = 1000
const MIN = 60 * S
const T0 = Date.parse('2026-11-14T03:00:00Z')
const LIMIT = 15 * MIN

function makeWatchdog(over: Partial<WatchdogDeps> = {}) {
  const clock = { t: T0 }
  const exits: number[] = []
  const logs: string[] = []
  const wd = new Watchdog({
    limitMs: LIMIT,
    checkEveryMs: 30 * S,
    now: () => clock.t,
    exit: (code) => {
      exits.push(code)
    },
    log: (l) => logs.push(l),
    ...over,
  })
  return { wd, clock, exits, logs }
}

const never = (): Promise<never> => new Promise<never>(() => undefined)

const horn: LiveEventTriggerRow = {
  id: 'obs-1-period_end',
  type: 'period_end',
  period: 3,
  gameTitle: null,
  matchType: null,
  at: new Date(T0 - 5 * S),
  receivedAt: new Date(T0 - 5 * S),
}

/**
 * A loop on a fake clock wired to a watchdog. `hang` names the step that never resolves. The
 * returned `fire` checks the watchdog after `advance` ms with no progress.
 */
function hangingLoop(hang: 'normal' | 'quick' | 'events' | 'latest' | 'heartbeat') {
  const w = makeWatchdog()
  const loop = new LiveCheckLoop({
    runNormalPass: () => (hang === 'normal' ? never() : Promise.resolve()),
    afterNormalPass: () => (hang === 'heartbeat' ? never() : Promise.resolve()),
    runQuickCheck: () =>
      hang === 'quick'
        ? never()
        : Promise.resolve({ calls: 1, newGames: 0, titles: [], matchTypes: [] }),
    readTriggers: (_c: LiveEventCursor) => {
      if (hang === 'events') return never()
      return Promise.resolve(w.clock.t === T0 ? [] : [])
    },
    latestMatchId: () => (hang === 'latest' ? never() : Promise.resolve(100)),
    gameEndedSince: () => Promise.resolve(false),
    cleanup: () => Promise.resolve(0),
    normalIntervalMs: 5 * MIN,
    now: () => w.clock.t,
    sleep: (ms) => {
      w.clock.t += ms
      return Promise.resolve()
    },
    log: () => undefined,
    onProgress: (step) => w.wd.progress(step),
  })
  return { ...w, loop }
}

void test('a normal pass that never resolves: the watchdog exits after the limit', async () => {
  const { loop, wd, clock, exits, logs } = hangingLoop('normal')
  void loop.run()
  await new Promise((r) => setImmediate(r))
  clock.t += LIMIT - S
  wd.check()
  assert.deepEqual(exits, [], 'not yet')
  clock.t += 2 * S
  wd.check()
  assert.deepEqual(exits, [1])
  assert.equal(logs.length, 1)
  assert.match(
    logs[0]!,
    /^\[watchdog\] no loop progress for 15 min; exiting so Docker restarts the worker/,
  )
  assert.match(logs[0]!, /normal pass/, 'names the last step')
})

void test('an after-pass step (heartbeat) that never resolves: the watchdog exits', async () => {
  const { loop, wd, clock, exits } = hangingLoop('heartbeat')
  void loop.run()
  await new Promise((r) => setImmediate(r))
  clock.t += LIMIT + S
  wd.check()
  assert.deepEqual(exits, [1])
})

void test('a database read after the pass that never resolves: the watchdog exits', async () => {
  const { loop, wd, clock, exits } = hangingLoop('latest')
  void loop.run()
  await new Promise((r) => setImmediate(r))
  clock.t += LIMIT + S
  wd.check()
  assert.deepEqual(exits, [1])
})

void test('the 5-second event read that never resolves: the watchdog exits', async () => {
  const { loop, wd, clock, exits, logs } = hangingLoop('events')
  void loop.run()
  await new Promise((r) => setImmediate(r))
  clock.t += LIMIT + S
  wd.check()
  assert.deepEqual(exits, [1])
  assert.match(logs[0]!, /event read/)
})

void test('a quick check that never resolves: the watchdog exits', async () => {
  const w = makeWatchdog()
  const loop = new LiveCheckLoop({
    runNormalPass: () => Promise.resolve(),
    runQuickCheck: () => never(),
    readTriggers: () => Promise.resolve([{ ...horn, receivedAt: new Date(w.clock.t - S) }]),
    latestMatchId: () => Promise.resolve(100),
    gameEndedSince: () => Promise.resolve(false),
    cleanup: () => Promise.resolve(0),
    normalIntervalMs: 5 * MIN,
    now: () => w.clock.t,
    sleep: (ms) => {
      w.clock.t += ms
      return Promise.resolve()
    },
    log: () => undefined,
    onProgress: (step) => w.wd.progress(step),
  })
  void loop.run()
  await new Promise((r) => setImmediate(r))
  w.clock.t += LIMIT + S
  w.wd.check()
  assert.deepEqual(w.exits, [1])
  assert.match(w.logs[0]!, /quick check/)
})

void test('a healthy loop with steps just under the limit: no exit', async () => {
  const w = makeWatchdog()
  const justUnder = LIMIT - S
  let passes = 0
  const loop = new LiveCheckLoop({
    // Each step takes just under the limit, and the watchdog timer fires in the middle of it.
    runNormalPass: () => {
      passes++
      w.clock.t += justUnder
      w.wd.check()
      return Promise.resolve()
    },
    afterNormalPass: () => {
      w.clock.t += justUnder
      w.wd.check()
      return Promise.resolve()
    },
    runQuickCheck: () => Promise.resolve({ calls: 0, newGames: 0, titles: [], matchTypes: [] }),
    readTriggers: () => {
      w.clock.t += justUnder
      w.wd.check()
      return Promise.resolve([])
    },
    latestMatchId: () => {
      w.clock.t += justUnder
      w.wd.check()
      return Promise.resolve(100)
    },
    gameEndedSince: () => Promise.resolve(false),
    cleanup: () => Promise.resolve(0),
    normalIntervalMs: 5 * MIN,
    now: () => w.clock.t,
    sleep: (ms) => {
      w.clock.t += ms
      w.wd.check()
      return Promise.resolve()
    },
    log: () => undefined,
    onProgress: (step) => w.wd.progress(step),
    shouldStop: () => passes >= 3,
  })
  await loop.run()
  assert.equal(passes, 3)
  assert.deepEqual(w.exits, [])
  assert.deepEqual(w.logs, [])
})

void test('without onProgress the loop works as before (the hook is optional)', async () => {
  let t = T0
  let passes = 0
  const loop = new LiveCheckLoop({
    runNormalPass: () => {
      passes++
      return Promise.resolve()
    },
    runQuickCheck: () => Promise.resolve({ calls: 0, newGames: 0, titles: [], matchTypes: [] }),
    readTriggers: () => Promise.resolve([]),
    latestMatchId: () => Promise.resolve(1),
    gameEndedSince: () => Promise.resolve(false),
    cleanup: () => Promise.resolve(0),
    normalIntervalMs: 5 * MIN,
    now: () => t,
    sleep: (ms) => {
      t += ms
      return Promise.resolve()
    },
    log: () => undefined,
    shouldStop: () => passes >= 2,
  })
  await loop.run()
  assert.equal(passes, 2)
})

void test('the watchdog exits once only, even when checked again', () => {
  const { wd, clock, exits } = makeWatchdog()
  clock.t += LIMIT + S
  wd.check()
  clock.t += LIMIT
  wd.check()
  assert.deepEqual(exits, [1])
})

void test('progress resets the count, and the count starts when the watchdog is made', () => {
  const { wd, clock, exits } = makeWatchdog()
  clock.t += LIMIT - S
  wd.progress('x')
  clock.t += LIMIT - S
  wd.check()
  assert.deepEqual(exits, [])
  clock.t += 2 * S
  wd.check()
  assert.deepEqual(exits, [1])
})

void test('start() checks on the timer and stop() ends it', () => {
  let tick: (() => void) | null = null
  let cleared = false
  const { wd, clock, exits } = makeWatchdog({
    setInterval: (fn, ms) => {
      assert.equal(ms, 30 * S)
      tick = fn
      return 7
    },
    clearInterval: (h) => {
      assert.equal(h, 7)
      cleared = true
    },
  })
  wd.start()
  clock.t += LIMIT + S
  tick!()
  assert.deepEqual(exits, [1])
  wd.stop()
  assert.equal(cleared, true)
})

void test('settings: WORKER_WATCHDOG_MS default 15 minutes; bad values fall back', () => {
  assert.equal(DEFAULT_WATCHDOG_MS, 15 * MIN)
  assert.equal(parsePositiveMs(undefined, DEFAULT_WATCHDOG_MS), DEFAULT_WATCHDOG_MS)
  assert.equal(parsePositiveMs('60000', DEFAULT_WATCHDOG_MS), 60000)
  assert.equal(parsePositiveMs('abc', DEFAULT_WATCHDOG_MS), DEFAULT_WATCHDOG_MS)
  assert.equal(parsePositiveMs('0', DEFAULT_WATCHDOG_MS), DEFAULT_WATCHDOG_MS)
  assert.equal(parsePositiveMs('-5', DEFAULT_WATCHDOG_MS), DEFAULT_WATCHDOG_MS)
})
