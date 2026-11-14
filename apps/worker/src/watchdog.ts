/**
 * Worker watchdog (task worker-loop-watchdog, 2026-11-14).
 *
 * The worker has one loop (`live-checks.ts`). If one of its steps never ends (a hung EA call, a
 * hung database socket), game collection and the heartbeat stop, and nothing restarts the worker:
 * `restart: unless-stopped` restarts only a process that exits. EA keeps about 5 recent games, so
 * games can be lost.
 *
 * The loop calls `progress(step)` at the start and the end of every step. A timer OUTSIDE the loop
 * calls `check()`. With no progress for `limitMs` (WORKER_WATCHDOG_MS, default 15 minutes), the
 * watchdog logs one line and calls `exit(1)`; Docker then starts a fresh worker. The longest real
 * pass on the live worker is about 19 s (288 passes in 24 h), so 15 minutes never stops a healthy
 * pass. The clock, the timer and the exit are injected: tests never call the real `process.exit`.
 */

export const DEFAULT_WATCHDOG_MS = 15 * 60_000
export const WATCHDOG_CHECK_EVERY_MS = 30_000

export interface WatchdogDeps {
  /** Longest time without progress. */
  limitMs: number
  /** How often the timer looks. */
  checkEveryMs: number
  now: () => number
  exit: (code: number) => void
  log: (line: string) => void
  /** Default: the global `setInterval`. */
  setInterval?: (fn: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
}

/** A positive whole number of ms from an env value, else the fallback. */
export function parsePositiveMs(raw: string | undefined, fallback: number): number {
  const parsed = parseInt(raw ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export class Watchdog {
  private lastProgressAt: number
  private lastStep = 'start'
  private fired = false
  private handle: unknown = null
  private readonly deps: WatchdogDeps

  constructor(deps: WatchdogDeps) {
    this.deps = deps
    this.lastProgressAt = deps.now()
  }

  /** The loop made progress (a step began or ended). */
  progress(step: string): void {
    this.lastProgressAt = this.deps.now()
    this.lastStep = step
  }

  /** Exits (once) when there was no progress for `limitMs`. */
  check(): void {
    if (this.fired) return
    const idle = this.deps.now() - this.lastProgressAt
    if (idle < this.deps.limitMs) return
    this.fired = true
    this.deps.log(
      `[watchdog] no loop progress for ${String(Math.floor(idle / 60_000))} min; ` +
        `exiting so Docker restarts the worker (last step: ${this.lastStep})`,
    )
    this.deps.exit(1)
  }

  start(): void {
    const set = this.deps.setInterval ?? ((fn, ms) => setInterval(fn, ms))
    this.handle = set(() => {
      this.check()
    }, this.deps.checkEveryMs)
  }

  stop(): void {
    if (this.handle === null) return
    const clear = this.deps.clearInterval ?? ((h) => clearInterval(h as NodeJS.Timeout))
    clear(this.handle)
    this.handle = null
  }
}
