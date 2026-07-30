'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { delayVar, prefersReducedMotion, REDUCED_MOTION_QUERY, runCountUp } from '@/lib/motion'

/**
 * Game sheet motion components (Phase 12).
 *
 * Two client primitives that the CSS motion layer cannot cover on its own:
 * a scroll trigger, and value count-ups. Both are usable from server
 * components — they are leaves, so wrapping a module in one does not make the
 * module a client component.
 */

/* -------------------------------------------------------------------------
 * MotionReveal — arm a module's entrance when it scrolls into view.
 *
 * The staged children carry their ordinary `gs-*` animation classes. This
 * wrapper holds those animations at their first frame until the module is
 * near the viewport, then releases them.
 *
 * FAIL-OPEN, deliberately. Three separate things could leave a module armed
 * never, and each would hide real content:
 *
 *   1. JS disabled or the bundle fails — the pause rule in globals.css is
 *      gated on `html.gs-js`, which only this module sets, so no JS means
 *      nothing is ever paused and every entrance simply runs at mount.
 *   2. No IntersectionObserver (old browser) — armed immediately.
 *   3. The observer never fires (element inside a collapsed/hidden ancestor,
 *      or a browser bug) — the timeout below arms it anyway.
 *
 * Content visibility must not depend on an animation succeeding.
 * ---------------------------------------------------------------------- */

const ARM_FALLBACK_MS = 3000

// Marks that the pause rule is safe to apply. Runs when the client chunk
// evaluates; guarded because 'use client' modules are also evaluated on the
// server during SSR.
if (typeof document !== 'undefined') {
  document.documentElement.classList.add('gs-js')
}

export function MotionReveal({
  children,
  className,
  /** Arm this far before the module reaches the viewport. */
  rootMargin = '0px 0px -12% 0px',
  style,
}: {
  children: ReactNode
  className?: string
  rootMargin?: string
  style?: CSSProperties
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (armed) return

    const node = ref.current
    if (!node || typeof IntersectionObserver !== 'function') {
      setArmed(true)
      return
    }

    const timer = window.setTimeout(() => {
      setArmed(true)
    }, ARM_FALLBACK_MS)

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setArmed(true)
      },
      { rootMargin },
    )
    observer.observe(node)

    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [armed, rootMargin])

  return (
    <div
      ref={ref}
      data-gs-stage=""
      data-gs-armed={armed ? '' : undefined}
      className={className}
      style={style}
    >
      {children}
    </div>
  )
}

/* -------------------------------------------------------------------------
 * CountUp — tick a number up to its value as its bar/column lands.
 *
 * Renders `children` (the server-rendered resting text) as its initial HTML,
 * so the SSR output, the no-JS output and the reduced-motion output are all
 * already the correct final value. The count only ever runs as a client-side
 * embellishment on top of a correct static number, and its last frame is that
 * same string rather than a re-derivation of it — otherwise a value the caller
 * formatted specially (a `—`, a clock, a capped rate) would change shape as it
 * landed.
 * ---------------------------------------------------------------------- */

export function CountUp({
  value,
  decimals = 0,
  durationMs = 620,
  delayMs = 0,
  from = 0,
  className,
  children,
}: {
  /** Numeric target. Non-finite values skip the count entirely. */
  value: number
  decimals?: number
  durationMs?: number
  delayMs?: number
  from?: number
  className?: string
  /** Resting text — what SSR renders and what the final frame restores. */
  children: string
}) {
  const [text, setText] = useState(children)
  const finalText = children

  useEffect(() => {
    if (!Number.isFinite(value) || prefersReducedMotion()) {
      setText(finalText)
      return
    }

    return runCountUp({
      from,
      to: value,
      decimals,
      durationMs,
      delayMs,
      finalText,
      onFrame: setText,
    })
  }, [value, decimals, durationMs, delayMs, from, finalText])

  return <span className={className}>{text}</span>
}

/* -------------------------------------------------------------------------
 * useReducedMotion — live, not a one-shot read.
 *
 * Starts `true` so the first client render matches SSR (which cannot know the
 * preference) and so the safe answer is the one that survives a hydration
 * mismatch. Callers use it to decide whether to run a WAAPI animation at all.
 * ---------------------------------------------------------------------- */

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(true)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') {
      setReduced(false)
      return
    }

    const query = window.matchMedia(REDUCED_MOTION_QUERY)
    const sync = () => {
      setReduced(query.matches)
    }
    sync()
    query.addEventListener('change', sync)
    return () => {
      query.removeEventListener('change', sync)
    }
  }, [])

  return reduced
}

export { delayVar }
