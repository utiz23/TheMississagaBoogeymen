'use client'

import type { ReactNode, MouseEvent } from 'react'
import { useRef, useState } from 'react'

const MAX_TILT_DEG = 5

/**
 * Wraps the portrait monolith with mouse-aware 3D tilt.
 * The cursor-side depresses (goes into the screen) — gives the impression
 * the card is being pressed down at the cursor location.
 */
export function PortraitCard({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [transform, setTransform] = useState<string | undefined>(undefined)

  function handleMove(e: MouseEvent<HTMLDivElement>) {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const dx = (e.clientX - rect.left) / rect.width - 0.5 // -0.5..0.5
    const dy = (e.clientY - rect.top) / rect.height - 0.5
    // Inverted: cursor-side moves AWAY from viewer (depressed).
    const rotateX = (-dy * 2) * MAX_TILT_DEG // mouse low → bottom away
    const rotateY = (dx * 2) * MAX_TILT_DEG // mouse right → right away
    setTransform(
      `perspective(900px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg)`,
    )
  }

  function handleLeave() {
    setTransform(undefined)
  }

  return (
    <div
      ref={ref}
      className="ph-pc"
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      {...(transform !== undefined ? { style: { transform } } : {})}
    >
      {children}
    </div>
  )
}
