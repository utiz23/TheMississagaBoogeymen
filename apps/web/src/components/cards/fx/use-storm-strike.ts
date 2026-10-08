'use client'

import { useEffect, useState } from 'react'

/**
 * Storm's strike cycle (PlayerCard.dc.html stormLoop): rain for 6–16 s, then a
 * lightning strike for 1–2 s, repeat. Runs only while `active` (motion on and
 * on screen) and holds still while the tab is hidden.
 */
export function useStormStrike(active: boolean): boolean {
  const [strike, setStrike] = useState(false)
  useEffect(() => {
    if (!active) return
    let striking = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      const ms = striking ? 1000 + Math.random() * 1000 : 6000 + Math.random() * 10000
      timer = setTimeout(() => {
        if (!document.hidden || striking) {
          striking = !striking
          setStrike(striking)
        }
        schedule()
      }, ms)
    }
    schedule()
    return () => {
      clearTimeout(timer)
      setStrike(false)
    }
  }, [active])
  return active && strike
}
