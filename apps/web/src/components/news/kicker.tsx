import type { ReactNode } from 'react'

export function Kicker({ children }: { children: ReactNode }) {
  return (
    <p className="font-condensed text-xs font-bold uppercase tracking-[0.22em] text-accent-readable">
      {children}
    </p>
  )
}
