/**
 * The worker loop with quick checks at the horn (live events E1; operator 2026-11-14: do not load
 * the EA API).
 *
 * The normal pass runs every POLL_INTERVAL_MS (5 minutes), unchanged. Between passes the loop
 * reads new live events every 5 s. A stored `period_end` with period 3 or later (the horn), or a
 * `game_end`, starts a SERIES of quick checks (match lists only, `quick-check.ts`) at once and at
 * +1, +2, +4 and +8 minutes: 5 checks at most. The series stops early when a new club game of an
 * active title is stored (by a quick check or by a normal pass).
 *
 * - One ingestion at a time: normal passes and quick checks run in this one loop, never in
 *   parallel. A check that falls due during a normal pass waits for it, and a normal pass that
 *   starts when a check is due counts as that check (it reads the same match lists).
 * - One series at a time: a repeat horn (or the game_end) while a series is scheduled does not
 *   start a second one.
 * - A trigger is skipped when its game is already in (a club game of an active title ended at most
 *   10 minutes before the event, or a new game appeared in the 15 minutes before it), or when it is
 *   stale (stored more than 15 minutes after its own `at`, or stored more than 15 minutes ago).
 * - EA stays the truth: events only make a check come sooner. They never write match data.
 * - Without the live_events table (migration 0079 not applied) the loop logs it at most every
 *   10 minutes and runs the normal passes as before.
 * - Once an hour, events older than 30 days are deleted.
 *
 * The decisions are pure functions and the loop gets the database, the clock and sleep injected,
 * so the tests need no database.
 */

import type { LiveEventCursor, LiveEventTriggerRow } from '@eanhl/db/queries'
import type { QuickCheckRequest, QuickCheckResult } from './quick-check.js'

/** When the checks run, from the series start: at once, +1, +2, +4, +8 minutes. */
export const QUICK_CHECK_OFFSETS_MS: readonly number[] = [0, 60_000, 120_000, 240_000, 480_000]
export const EVENT_CHECK_MS = 5_000
export const GAME_IN_SLACK_MS = 10 * 60_000
export const RECENT_GAME_MS = 15 * 60_000
export const STALE_EVENT_MS = 15 * 60_000
export const CLEANUP_EVERY_MS = 60 * 60_000
export const RETENTION_MS = 30 * 24 * 60 * 60_000
const READ_ERROR_LOG_EVERY_MS = 10 * 60_000

export interface Series {
  /** The event that started it. */
  triggerId: string
  /** Epoch ms; the check offsets count from here. */
  startedAt: number
  /** The newest club game when it started; a larger id is the new game. */
  baselineMatchId: number | null
  /** What the quick checks read (from the event). */
  request: QuickCheckRequest
  /** Checks done so far (0-5). */
  checksDone: number
  /** Epoch ms when the next check is due. */
  nextAt: number
}

/** The horn in period 3 or later, or the game's end. Earlier horns are intermissions. */
export function isQuickCheckTrigger(t: Pick<LiveEventTriggerRow, 'type' | 'period'>): boolean {
  if (t.type === 'game_end') return true
  return t.type === 'period_end' && t.period !== null && t.period >= 3
}

export interface TriggerContext {
  now: number
  /** The newest club game right now (null: none or unknown). */
  latestMatchId: number | null
  /** A club game of an active title ended at or after (event time - 10 minutes). */
  gameAlreadyIn: boolean
  /** When the loop last saw a new club game appear (epoch ms), if ever. */
  lastNewGameAt: number | null
}

export type TriggerReason =
  | 'start'
  | 'not-a-trigger'
  | 'stale'
  | 'series-running'
  | 'game-already-in'

/** What one stored event does: start a series, or nothing (and why). */
export function applyTrigger(
  series: Series | null,
  trigger: LiveEventTriggerRow,
  ctx: TriggerContext,
): { series: Series | null; reason: TriggerReason } {
  if (!isQuickCheckTrigger(trigger)) return { series, reason: 'not-a-trigger' }
  const received = trigger.receivedAt.getTime()
  if (received - trigger.at.getTime() > STALE_EVENT_MS || ctx.now - received > STALE_EVENT_MS) {
    return { series, reason: 'stale' }
  }
  if (series !== null) return { series, reason: 'series-running' }
  const foundRecently = ctx.lastNewGameAt !== null && received - ctx.lastNewGameAt <= RECENT_GAME_MS
  if (ctx.gameAlreadyIn || foundRecently) return { series, reason: 'game-already-in' }
  return {
    series: {
      triggerId: trigger.id,
      startedAt: ctx.now,
      baselineMatchId: ctx.latestMatchId,
      request: { titleSlug: trigger.gameTitle, matchType: trigger.matchType },
      checksDone: 0,
      nextAt: ctx.now,
    },
    reason: 'start',
  }
}

export type SeriesEnd = 'new-game' | 'checks-done'

/**
 * After a pass. `counted`: the pass was a check of this series (a quick check, or a normal pass
 * that started when a check was due). A new club game ends the series; so does the 5th check.
 */
export function afterPass(
  series: Series,
  ctx: { latestMatchId: number | null; newGames: number; counted: boolean },
): { series: Series | null; ended: SeriesEnd | null } {
  const newGame =
    ctx.newGames > 0 ||
    (ctx.latestMatchId !== null &&
      series.baselineMatchId !== null &&
      ctx.latestMatchId > series.baselineMatchId)
  if (newGame) return { series: null, ended: 'new-game' }
  if (!ctx.counted) return { series, ended: null }
  const checksDone = series.checksDone + 1
  const offset = QUICK_CHECK_OFFSETS_MS[checksDone]
  if (offset === undefined) return { series: null, ended: 'checks-done' }
  return { series: { ...series, checksDone, nextAt: series.startedAt + offset }, ended: null }
}

export interface LoopDeps {
  /** One normal pass (`runIngestionCycle`). Errors are caught and logged here. */
  runNormalPass: () => Promise<void>
  /** Runs after every normal pass (the heartbeat). Errors are caught. */
  afterNormalPass?: () => Promise<void>
  /** One quick check (`runQuickMatchCheck`). */
  runQuickCheck: (request: QuickCheckRequest) => Promise<QuickCheckResult>
  readTriggers: (cursor: LiveEventCursor) => Promise<LiveEventTriggerRow[]>
  latestMatchId: () => Promise<number | null>
  gameEndedSince: (since: Date) => Promise<boolean>
  cleanup: (cutoff: Date) => Promise<number>
  normalIntervalMs: number
  now: () => number
  sleep: (ms: number) => Promise<void>
  log: (line: string) => void
  /** Tests stop the loop with this; production never stops. */
  shouldStop?: () => boolean
  /**
   * Called at the start and the end of every step (normal pass, quick check, event read, database
   * reads, cleanup, sleep). The watchdog (`watchdog.ts`) restarts the worker when this stops.
   */
  onProgress?: (step: string) => void
}

export class LiveCheckLoop {
  series: Series | null = null
  private cursor: LiveEventCursor
  private knownLatest: number | null = null
  private lastNewGameAt: number | null = null
  private lastCleanup = Number.NEGATIVE_INFINITY
  private lastReadErrorLog = Number.NEGATIVE_INFINITY
  private readonly deps: LoopDeps

  constructor(deps: LoopDeps) {
    this.deps = deps
    // On start, events of the last 15 minutes still count (a restart soon after a horn).
    this.cursor = { receivedAt: new Date(deps.now() - STALE_EVENT_MS), id: '' }
  }

  private mark(step: string): void {
    this.deps.onProgress?.(step)
  }

  private stopped(): boolean {
    return this.deps.shouldStop?.() === true
  }

  async run(): Promise<void> {
    const d = this.deps
    let nextNormalAt = d.now()
    while (!this.stopped()) {
      this.mark('loop')
      const now = d.now()
      if (now >= nextNormalAt) {
        const counted = this.series !== null && this.series.nextAt <= now
        await this.normalPass()
        await this.settle({ newGames: 0, counted })
        await this.maybeCleanup()
        const elapsed = d.now() - now
        nextNormalAt = now + d.normalIntervalMs
        const delay = nextNormalAt - d.now()
        d.log(
          delay > 0
            ? `[worker] Cycle done in ${String(elapsed)}ms. Next cycle in ${String(delay)}ms`
            : `[worker] Cycle overran interval by ${String(-delay)}ms. Starting next cycle immediately.`,
        )
        continue
      }
      if (this.series !== null && now >= this.series.nextAt) {
        await this.quickCheck(this.series)
        continue
      }
      await this.pollTriggers()
      if (this.series !== null && this.series.nextAt <= d.now()) continue
      const wakeAt = Math.min(nextNormalAt, this.series?.nextAt ?? Number.POSITIVE_INFINITY)
      const remaining = wakeAt - d.now()
      if (remaining > 0) {
        this.mark('sleep')
        await d.sleep(Math.min(EVENT_CHECK_MS, remaining))
        this.mark('sleep done')
      }
    }
  }

  private async normalPass(): Promise<void> {
    const d = this.deps
    this.mark('normal pass')
    try {
      await d.runNormalPass()
    } catch (err) {
      d.log(`[worker] Unhandled error in ingestion cycle: ${errorText(err)}`)
    }
    this.mark('normal pass done')
    if (d.afterNormalPass) {
      this.mark('after-cycle step')
      try {
        await d.afterNormalPass()
      } catch (err) {
        d.log(`[worker] after-cycle step failed: ${errorText(err)}`)
      }
      this.mark('after-cycle step done')
    }
  }

  private async quickCheck(series: Series): Promise<void> {
    const d = this.deps
    const n = series.checksDone + 1
    const total = QUICK_CHECK_OFFSETS_MS.length
    let newGames = 0
    this.mark('quick check')
    try {
      const r = await d.runQuickCheck(series.request)
      newGames = r.newGames
      d.log(
        `[live-events] quick check ${String(n)}/${String(total)} (${series.triggerId}): ` +
          `${String(r.calls)} match-list calls (${r.matchTypes.join(',')}; ${r.titles.join(',') || 'no active title'}), ` +
          `${String(r.newGames)} new games`,
      )
    } catch (err) {
      d.log(
        `[live-events] quick check ${String(n)}/${String(total)} (${series.triggerId}) failed: ${errorText(err)}`,
      )
    }
    this.mark('quick check done')
    await this.settle({ newGames, counted: true })
  }

  private async readLatest(): Promise<number | null> {
    this.mark('latest game read')
    try {
      return await this.deps.latestMatchId()
    } catch (err) {
      this.deps.log(`[live-events] could not read the latest club game: ${errorText(err)}`)
      return null
    } finally {
      this.mark('latest game read done')
    }
  }

  /** After any pass: notes a new club game, and moves or ends the series. */
  private async settle(ctx: { newGames: number; counted: boolean }): Promise<void> {
    const d = this.deps
    const latest = await this.readLatest()
    if (latest !== null) {
      if (this.knownLatest !== null && latest > this.knownLatest) this.lastNewGameAt = d.now()
      this.knownLatest = latest
    }
    if (ctx.newGames > 0) this.lastNewGameAt = d.now()
    if (this.series === null) return
    const next = afterPass(this.series, { latestMatchId: latest, ...ctx })
    if (next.ended !== null) {
      d.log(`[live-events] quick checks end (${next.ended}) for ${this.series.triggerId}`)
    }
    this.series = next.series
  }

  private async maybeCleanup(): Promise<void> {
    const d = this.deps
    const now = d.now()
    if (now - this.lastCleanup < CLEANUP_EVERY_MS) return
    this.lastCleanup = now
    this.mark('cleanup')
    try {
      const n = await d.cleanup(new Date(now - RETENTION_MS))
      if (n > 0) d.log(`[live-events] deleted ${String(n)} events older than 30 days`)
    } catch (err) {
      d.log(`[live-events] cleanup failed: ${errorText(err)}`)
    }
    this.mark('cleanup done')
  }

  /** Reads events stored since the last read; may start a series. */
  private async pollTriggers(): Promise<void> {
    const d = this.deps
    let rows: LiveEventTriggerRow[]
    this.mark('event read')
    try {
      rows = await d.readTriggers(this.cursor)
      this.mark('event read done')
    } catch (err) {
      this.mark('event read done')
      const now = d.now()
      if (now - this.lastReadErrorLog >= READ_ERROR_LOG_EVERY_MS) {
        this.lastReadErrorLog = now
        d.log(
          `[live-events] could not read live events (normal polling continues): ${errorText(err)}`,
        )
      }
      return
    }
    for (const row of rows) {
      this.cursor = { receivedAt: row.receivedAt, id: row.id }
      if (!isQuickCheckTrigger(row)) continue
      let gameAlreadyIn = false
      let latestMatchId: number | null = null
      if (this.series === null) {
        const eventTime = Math.min(row.at.getTime(), row.receivedAt.getTime())
        this.mark('game-in check')
        try {
          gameAlreadyIn = await d.gameEndedSince(new Date(eventTime - GAME_IN_SLACK_MS))
        } catch (err) {
          d.log(`[live-events] could not check for the game: ${errorText(err)}`)
        }
        this.mark('game-in check done')
        latestMatchId = await this.readLatest()
      }
      const outcome = applyTrigger(this.series, row, {
        now: d.now(),
        latestMatchId,
        gameAlreadyIn,
        lastNewGameAt: this.lastNewGameAt,
      })
      d.log(
        outcome.reason === 'start'
          ? `[live-events] quick checks start on ${row.type} ${row.id}`
          : `[live-events] ${row.type} ${row.id}: no new series (${outcome.reason})`,
      )
      this.series = outcome.series
    }
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
