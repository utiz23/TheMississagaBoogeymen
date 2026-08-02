/**
 * Action Tracker plot-in schedule — the rink cascade's timing arithmetic.
 *
 * Extracted from `action-tracker/rink.tsx` so it can be unit-tested: the
 * component is a client module full of JSX, this is pure arithmetic. Sibling of
 * `marker-layout.ts`, the rink's other pure helper.
 *
 * THE BUG THIS SHAPE EXISTS TO PREVENT. The schedule used to return `null` for
 * every marker past a fixed 24-marker limit, and `rink.tsx` renders a
 * null-delay marker with no `gs-marker-drop` class at all. That keyframe's 0%
 * frame (`opacity: 0`, fill mode `both`) is the ONLY thing holding a marker
 * invisible before its delay elapses — so every over-limit marker painted at
 * full opacity on the *first* frame, before the cascade started and before the
 * panel was even armed (`animation-play-state: paused` cannot pause an element
 * that has no animation). On a dense match that was most of the ice: match 1093
 * had 92 of its 116 markers already sitting there while 24 dropped in.
 *
 * The cap now compresses the STEP rather than dropping markers out of the
 * cascade. Every marker animates, and the last one still lands inside
 * `PLOT_BUDGET_MS`, so the ~2s guardrail is unchanged.
 */

import { staggerDelay } from './motion.ts'

/** Beat before the first marker lands. */
export const PLOT_START_MS = 520
/** Widest gap between two landings — used until density forces compression. */
export const PLOT_MAX_STEP_MS = 95
/** Total time the cascade may occupy, whatever the marker count. */
export const PLOT_BUDGET_MS = 2280
/** When the cascade is over and markers may render with no drop class at all. */
export const PLOT_TOTAL_MS = PLOT_START_MS + PLOT_BUDGET_MS + 450

/**
 * Gap between consecutive landings, compressed so the LAST marker still lands
 * inside the budget.
 *
 * Denominator is `count - 1` because the gaps sit *between* markers: marker 0
 * lands at delay 0, so N markers have N-1 gaps and the last one lands at
 * exactly `PLOT_BUDGET_MS`. Sparse matches never compress — they keep the full
 * 95ms and simply finish early.
 */
export function plotStep(count: number): number {
  if (count <= 1) return PLOT_MAX_STEP_MS
  return Math.min(PLOT_MAX_STEP_MS, PLOT_BUDGET_MS / (count - 1))
}

/**
 * Delay for the marker at `index`, or `null` when it must render with no drop
 * animation at all.
 *
 * `null` means exactly ONE thing: the cascade is already over (`plotDone`), so
 * a marker returning from a re-widened filter fades back on the opacity
 * transition instead of re-plotting. It must never mean "this marker is beyond
 * some budget" — see the header.
 */
export function plotDelay(index: number, plotDone: boolean, stepMs: number): number | null {
  if (plotDone) return null
  return PLOT_START_MS + staggerDelay(index, stepMs, PLOT_BUDGET_MS)
}
