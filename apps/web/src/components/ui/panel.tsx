import type { ReactNode } from 'react'

interface PanelProps {
  /** Surface fill. `default` = #18181b (--color-surface), `raised` = #1f1f22 (--color-surface-raised). */
  tone?: 'default' | 'raised'
  /** Adds hover state: border lightens, surface steps up to raised. Default false. */
  hoverable?: boolean
  className?: string
  children?: ReactNode
}

/**
 * Sharp 1px border panel — the workhorse container of the broadcast-strip
 * design system. No corner radius, no drop shadow.
 */
export function Panel({
  tone = 'default',
  hoverable = false,
  className = '',
  children,
}: PanelProps) {
  const surface = tone === 'raised' ? 'bg-surface-raised' : 'bg-surface'
  const hover = hoverable
    ? 'transition-[border-color,background-color] hover:border-zinc-700 hover:bg-surface-raised'
    : ''
  return (
    <div className={`rounded-none border border-zinc-800 ${surface} ${hover} ${className}`}>
      {children}
    </div>
  )
}
