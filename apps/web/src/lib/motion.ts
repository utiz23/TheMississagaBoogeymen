/**
 * Game sheet motion helpers (Phase 12).
 *
 * The page's motion vocabulary is CSS (see the `.game-sheet` motion layer in
 * `app/globals.css`). This module covers only the two cues CSS cannot express
 * — value count-ups and the DtW needle sweep — plus the shared reduced-motion
 * and in-view plumbing they need.
 *
 * No motion dependency, by design: everything here is `Element.animate`
 * (WAAPI), `matchMedia` and `IntersectionObserver`.
 */

import type { CSSProperties } from 'react'

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** SSR-safe: no `window` means no animation, which is the correct default. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia(REDUCED_MOTION_QUERY).matches
}

/** The page's house easing — matches the CSS layer's entrance curve. */
export const GS_EASE = 'cubic-bezier(0.16, 0.84, 0.3, 1)'

/* -------------------------------------------------------------------------
 * Shared module timings.
 *
 * These live HERE, in a plain module, rather than beside the components that
 * use them, because several are read from both sides of the server/client
 * boundary. A constant exported from a `'use client'` file and imported into a
 * Server Component does not arrive as its value — it arrives as a client
 * reference — so `DELAY + 50` silently becomes `NaN`, which makes the custom
 * property invalid and drops the whole `animation` shorthand to `none`. The
 * cue then just doesn't run, with no error anywhere.
 * ---------------------------------------------------------------------- */

/** DtW: the front crosses the arc in this long; needle and counts ride it. */
export const DTW_SWEEP_MS = 900
export const DTW_SWEEP_DELAY_MS = 150
/** DtW: when the needle and both percentages come to rest. */
export const DTW_LANDS_MS = DTW_SWEEP_DELAY_MS + DTW_SWEEP_MS

/**
 * Format a count-up frame.
 *
 * Counting is per-frame string production, so it has to make the same
 * decisions the server-rendered value did, or the number visibly changes shape
 * as it lands. `decimals` is fixed for the whole run (never "1" → "1.0"), and
 * the caller passes the resting string so the final frame is byte-identical to
 * what SSR emitted rather than a re-derivation of it.
 */
export function countFrame(from: number, to: number, t: number, decimals: number): string {
  const value = from + (to - from) * t
  return value.toFixed(decimals)
}

/**
 * Ease-out cubic. Matches the visual character of the CSS entrance curve
 * closely enough that a count-up landing beside a CSS bar reads as one event.
 */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

export interface CountUpOptions {
  from?: number
  to: number
  decimals: number
  durationMs: number
  delayMs?: number
  /** Resting text, painted on the final frame so it matches SSR exactly. */
  finalText: string
  onFrame: (text: string) => void
}

/**
 * Drive a count-up with rAF. Returns a cancel function.
 *
 * rAF rather than WAAPI because WAAPI animates properties, not text content;
 * the alternative (a CSS counter with @property) can't do the `finalText`
 * guarantee above.
 */
export function runCountUp(options: CountUpOptions): () => void {
  const { from = 0, to, decimals, durationMs, delayMs = 0, finalText, onFrame } = options

  let frame = 0
  let cancelled = false
  let start: number | null = null

  const step = (now: number) => {
    if (cancelled) return
    start ??= now

    const elapsed = now - start - delayMs
    if (elapsed < 0) {
      frame = requestAnimationFrame(step)
      return
    }

    const t = durationMs <= 0 ? 1 : Math.min(1, elapsed / durationMs)
    if (t >= 1) {
      onFrame(finalText)
      return
    }

    onFrame(countFrame(from, to, easeOutCubic(t), decimals))
    frame = requestAnimationFrame(step)
  }

  frame = requestAnimationFrame(step)

  return () => {
    cancelled = true
    cancelAnimationFrame(frame)
  }
}

/**
 * Sweep an SVG needle from `fromDeg` to `toDeg`.
 *
 * The pivot is the element's own `transform-origin` (set in the caller's
 * style, alongside `transform-box: view-box`) rather than a parameter here —
 * CSS rotation about a point needs both, and splitting them across two places
 * is how they drift apart.
 *
 * WAAPI rather than rAF because this is a pure transform animation the browser
 * can run off the main thread. `fill: 'both'` holds the landing angle.
 */
export function sweepNeedle(
  el: SVGElement,
  fromDeg: number,
  toDeg: number,
  durationMs: number,
  delayMs: number,
): Animation | null {
  if (typeof el.animate !== 'function') return null

  return el.animate(
    [{ transform: `rotate(${String(fromDeg)}deg)` }, { transform: `rotate(${String(toDeg)}deg)` }],
    {
      duration: durationMs,
      delay: delayMs,
      // No overshoot — the DtW spec is explicit that the needle decelerates into
      // its reading and never settles elastically.
      easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      fill: 'both',
    },
  )
}

/**
 * Per-item stagger delay, capped.
 *
 * Every cascade on this page is over a list whose length is data-driven (95
 * tracker events, 11 performer rows), so an uncapped `index * step` would put
 * the tail minutes away. The caps in the motion specs — entrance ≤ 1.3s, plot-in
 * ≤ ~2s — are enforced here rather than trusted to the data.
 */
export function staggerDelay(index: number, stepMs: number, capMs: number): number {
  return Math.min(index * stepMs, capMs)
}

/**
 * `--gs-delay` inline style for the CSS layer's stagger hook.
 *
 * Typed as CSSProperties (custom properties are legal there at runtime but not
 * in React's type) so call sites can spread it into `style` without each one
 * repeating the cast.
 */
export function delayVar(ms: number): CSSProperties {
  return cssVars({ '--gs-delay': `${(ms / 1000).toFixed(3)}s` })
}

/** `--gs-duration` alone, for a cue that keeps the default delay. */
export function durationVar(ms: number): CSSProperties {
  return cssVars({ '--gs-duration': `${(ms / 1000).toFixed(3)}s` })
}

/** As delayVar, for the cues that also drive their own duration. */
export function delayDurationVars(delayMs: number, durationMs: number): CSSProperties {
  return cssVars({
    '--gs-delay': `${(delayMs / 1000).toFixed(3)}s`,
    '--gs-duration': `${(durationMs / 1000).toFixed(3)}s`,
  })
}

/**
 * Custom properties in a `style` prop. Legal at runtime, absent from React's
 * CSSProperties type; this is the one place that cast lives.
 */
export function cssVars(vars: Record<string, string>): CSSProperties {
  return vars as CSSProperties
}
