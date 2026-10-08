'use client'

import { useEffect, useState } from 'react'
import { nextStrikeDelay } from './strike-schedule'

/**
 * Storm's strike cycle (strike-schedule.ts): rain for 6–16 s (first wait
 * 1.5–4 s), then a lightning strike for 1–2 s, repeat. Runs only while `active` (motion on and
 * on screen) and holds still while the tab is hidden.
 */
export function useStormStrike(active: boolean): boolean {
  const [strike, setStrike] = useState(false)
  useEffect(() => {
    if (!active) return
    let striking = false
    let first = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      const ms = nextStrikeDelay({ striking, first })
      first = false
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
