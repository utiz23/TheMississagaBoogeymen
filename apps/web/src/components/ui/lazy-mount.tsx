'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Renders its children only once the placeholder comes within `rootMargin` of
 * the viewport (page weight: the player page's Action Map and Badges are long
 * and sit well below the fold). Until then a sized, empty placeholder holds
 * the space, so nothing jumps. Without IntersectionObserver it renders at once.
 */
export function LazyMount({
  children,
  minHeight,
  label,
  rootMargin = '800px 0px',
}: {
  children: ReactNode
  /** Placeholder height in px, close to the section's usual height. */
  minHeight: number
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
        if (entries.some((e) => e.isIntersecting)) {
          setShow(true)
          io.disconnect()
        }
      },
      { rootMargin },
    )
    io.observe(el)
    return () => {
      io.disconnect()
    }
  }, [show, rootMargin])
  if (show) return <>{children}</>
  return <div ref={ref} style={{ minHeight }} aria-busy="true" aria-label={label} />
}
