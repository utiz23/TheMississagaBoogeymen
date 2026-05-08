import type { ReactNode } from 'react'

interface BroadcastPanelProps {
  /** Decoration intensity. `default` = full glow + ticker. `soft` = dimmed glow + ticker. */
  intensity?: 'default' | 'soft'
  /** Render the 1px red top ticker. Default true. */
  ticker?: boolean
  className?: string
  children?: ReactNode
}

/**
 * The broadcast-strip surface — Panel with a 1px red top ticker and a
 * soft red radial glow at the top. Used for hero scoreboards, leaders
 * panels, featured leader rows, and any element that wants a TV-broadcast
 * accent. The radial glow comes from the existing .broadcast-panel /
 * .broadcast-panel-soft CSS classes in globals.css.
 */
export function BroadcastPanel({
  intensity = 'default',
  ticker = true,
  className = '',
  children,
}: BroadcastPanelProps) {
  const surfaceClass = intensity === 'soft' ? 'broadcast-panel-soft' : 'broadcast-panel'
  return (
    <div className={`relative overflow-hidden rounded-none ${surfaceClass} ${className}`}>
      {ticker ? (
        <div
          aria-hidden
          className="h-[3px] w-full bg-gradient-to-r from-rose-900 via-accent to-rose-900"
        />
      ) : null}
      {children}
    </div>
  )
}
