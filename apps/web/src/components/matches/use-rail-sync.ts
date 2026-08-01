'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Height-sync the event timeline to the rail column.
 *
 * The game sheet is a 3/4 main column and a 1/4 rail. The timeline is the last
 * module in the main column, so the prototype sizes it to land its bottom edge
 * exactly on the rail's — the two columns end flush instead of one running
 * hundreds of pixels past the other. Measured, because both sides are
 * data-driven: the rail's height depends on how many modules a match has, and
 * the timeline's on how many events were captured.
 *
 * Two outcomes, both consumed by the caller:
 *
 *   natural <= available → FILL. The list is short; it stretches to the rail.
 *   natural >  available → CLIP. The list is long; it is cut to the rail and
 *                          a disclosure offers the rest.
 *
 * Deliberately inert below Tailwind's `lg`, where the grid is one column and
 * the rail stacks UNDER the main column — there is no shared bottom edge to
 * land on, and forcing a height there would only clip content for nothing.
 */

/** Set on the rail column in `app/games/[id]/page.tsx`. */
const RAIL_SELECTOR = '[data-gs-rail]'

/** Tailwind's `lg` breakpoint, where the grid becomes two columns. */
const WIDE_QUERY = '(min-width: 64rem)'

/** Floor, however short the rail is. A rail with one module can end above the
 *  timeline's own top, which would otherwise ask for a negative height. */
const MIN_AVAIL_PX = 140

/** Sub-pixel churn must not re-render, or a resize observer never settles. */
const EPSILON_PX = 0.6

/** Layout can land a frame late (font swap, image, a sibling module opening). */
const SETTLE_MS = 120

/**
 * Where a measurement came from, which decides how much it is trusted.
 *
 * `authoritative` — mount, viewport resize, reader toggle. Sets the fold
 * outright.
 * `drift` — a neighbouring module changed height on its own. May relax a
 * stretch, may never tighten a clip. See the guard in `measure`.
 */
type MeasureSource = 'authoritative' | 'drift'

export interface RailSyncBox {
  /** Height that lands the section's bottom on the rail's. */
  availPx: number
  /** The list's natural height at the caller's current disclosure state. */
  naturalPx: number
}

export interface RailSync {
  sectionRef: RefObject<HTMLElement | null>
  clipRef: RefObject<HTMLDivElement | null>
  listRef: RefObject<HTMLDivElement | null>
  /** null when the sync is off: too narrow, not measured yet, or disabled. */
  box: RailSyncBox | null
}

export function useRailSync({
  enabled,
  expanded,
}: {
  enabled: boolean
  /** Re-measures when it changes — the natural height depends on it. */
  expanded: boolean
}): RailSync {
  const sectionRef = useRef<HTMLElement | null>(null)
  const clipRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState<RailSyncBox | null>(null)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setBox(null)
      return
    }

    const wide = window.matchMedia(WIDE_QUERY)
    let frame = 0
    let settle = 0

    const measure = (source: MeasureSource) => {
      const section = sectionRef.current
      const clip = clipRef.current
      const list = listRef.current
      const rail = document.querySelector<HTMLElement>(RAIL_SELECTOR)

      if (!section || !clip || !list || !rail || !wide.matches) {
        setBox(null)
        return
      }

      // Take our own sizing off before reading, or the measurement just
      // reports back the height it applied last time and the mode latches.
      const kept = {
        minHeight: list.style.minHeight,
        justifyContent: list.style.justifyContent,
        height: clip.style.height,
        overflow: clip.style.overflow,
      }
      list.style.minHeight = '0px'
      list.style.justifyContent = 'flex-start'
      clip.style.height = 'auto'
      clip.style.overflow = 'visible'
      void list.offsetHeight

      // The rail's bottom is independent of the timeline's height — the grid is
      // `items-start`, so neither column stretches the other. That is what
      // makes this safe to run on the timeline's own resize without a loop.
      const target = rail.getBoundingClientRect().bottom - section.getBoundingClientRect().top
      // Everything in the section that is NOT the list: header, FINAL, note,
      // button, padding. Measured rather than hardcoded because all four come
      // and go with the match.
      const chrome = section.getBoundingClientRect().height - clip.getBoundingClientRect().height
      const naturalPx = list.getBoundingClientRect().height

      list.style.minHeight = kept.minHeight
      list.style.justifyContent = kept.justifyContent
      clip.style.height = kept.height
      clip.style.overflow = kept.overflow

      const availPx = Math.max(target - chrome, MIN_AVAIL_PX)

      // A DRIFT measure may only ever ADD space. The lineup module above this
      // one auto-walks, opening a row drawer roughly every nine seconds, which
      // moves this section's top by up to ~460px — permanently and for as long
      // as the page is open. Honouring that in the clip regime would re-cut the
      // fold every walk step, so goals would appear and vanish under a reader
      // who never touched anything. Stretching is safe (it only redistributes
      // whitespace), so drift is allowed to relax a fill and never to tighten
      // a clip. The clip's fold is set by AUTHORITATIVE measures alone: mount,
      // viewport resize, a rail-height change, or the reader's own toggle.
      if (source === 'drift' && availPx < naturalPx) return

      setBox((prev) =>
        prev &&
        Math.abs(prev.availPx - availPx) < EPSILON_PX &&
        Math.abs(prev.naturalPx - naturalPx) < EPSILON_PX
          ? prev
          : { availPx, naturalPx },
      )
    }

    const schedule = (source: MeasureSource) => () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        measure(source)
      })
    }

    const remeasure = schedule('authoritative')
    const redrift = schedule('drift')

    remeasure()
    settle = window.setTimeout(remeasure, SETTLE_MS)

    // The list is deliberately NOT observed: measuring mutates its inline
    // styles, which the observer would report as a resize, which would schedule
    // another measure, forever. Its height changes with `expanded`, already a
    // dependency here.
    //
    // Measuring is idempotent with respect to this section's OWN height — the
    // timeline is the last module in its column, so resizing it cannot move its
    // own top — which is what makes observing the column it lives in safe.
    // BOTH neighbours count as drift. The rail is no steadier than the column
    // above: its box score auto-rotates between GOALS/SHOTS/FO, and those
    // tables differ in height, so the rail's bottom edge moves on its own
    // roughly as often as the lineup's drawer does. Neither is a reader
    // action, so neither may re-cut the fold.
    const driftObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(redrift) : null
    const rail = document.querySelector<HTMLElement>(RAIL_SELECTOR)
    if (driftObserver) {
      if (rail) driftObserver.observe(rail)
      if (sectionRef.current?.parentElement) driftObserver.observe(sectionRef.current.parentElement)
    }

    window.addEventListener('resize', remeasure)
    wide.addEventListener('change', remeasure)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(settle)
      driftObserver?.disconnect()
      window.removeEventListener('resize', remeasure)
      wide.removeEventListener('change', remeasure)
    }
  }, [enabled, expanded])

  return { sectionRef, clipRef, listRef, box }
}
