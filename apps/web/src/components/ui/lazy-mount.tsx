'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

/**
 * Renders its children once the placeholder comes within `rootMargin` of the
 * viewport, or once the browser is idle after load, whichever is first (page
 * weight: the player page's Action Map and Badges are long and sit well below
 * the fold, so they stay out of the server HTML; the idle mount still lets
 * find-in-page and screen readers reach them). Until then a sized, empty
 * placeholder holds the space, so nothing jumps. Without
 * IntersectionObserver it renders at once.
 */
export function LazyMount({
  children,
  minHeight,
  minHeightSmall,
  label,
  rootMargin = '800px 0px',
}: {
  children: ReactNode
  /** Placeholder height in px, close to the section's usual height. */
  minHeight: number
  /** Placeholder height at the Small tier (≤720px) and below, when it differs. */
  minHeightSmall?: number
  /** What is loading, for assistive tech. */
  label: string
  rootMargin?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (show) return
    const el = ref.current
    if (el === null) return
    if (!('IntersectionObserver' in window)) {
      setShow(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShow(true)
      },
      { rootMargin },
    )
    io.observe(el)
    const mount = () => {
      setShow(true)
    }
    // Safari has no requestIdleCallback: fall back to a short timer.
    let cancelIdle: () => void
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(mount, { timeout: 4000 })
      cancelIdle = () => {
        window.cancelIdleCallback(id)
      }
    } else {
      const id = setTimeout(mount, 2000)
      cancelIdle = () => {
        clearTimeout(id)
      }
    }
    return () => {
      io.disconnect()
      cancelIdle()
    }
  }, [show, rootMargin])
  if (show) return <>{children}</>
  return (
    <div
      ref={ref}
      role="region"
      aria-busy="true"
      aria-label={label}
      className="min-h-[var(--lm-h)] max-[720px]:min-h-[var(--lm-h-s)]"
      style={
        {
          '--lm-h': `${String(minHeight)}px`,
          '--lm-h-s': `${String(minHeightSmall ?? minHeight)}px`,
        } as CSSProperties
      }
    />
  )
}
