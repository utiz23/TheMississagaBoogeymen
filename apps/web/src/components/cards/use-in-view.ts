'use client'

import { useEffect, useState, type RefObject } from 'react'

/**
 * True while the element is on screen (with a margin). Unlike MotionReveal it
 * keeps tracking, so card effects stop when the card scrolls away.
 */
export function useInView(ref: RefObject<Element | null>, rootMargin = '200px'): boolean {
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (el === null) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        setInView(entries.some((e) => e.isIntersecting))
      },
      { rootMargin },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [ref, rootMargin])
  return inView
}
