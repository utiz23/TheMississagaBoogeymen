'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import Link from 'next/link'

/**
 * Only team members, present and past, have player pages (operator,
 * 2026-10-09). A page that can show guests (game sheets, stats, leaders)
 * wraps its content in MemberLinksProvider with the member ids; PlayerLink
 * then links members and renders guests as plain text. Outside a provider
 * every id links (member-only lists such as the depth chart).
 */
const MemberIds = createContext<ReadonlySet<number> | null>(null)

export function MemberLinksProvider({ ids, children }: { ids: number[]; children: ReactNode }) {
  const set = useMemo(() => new Set(ids), [ids])
  return <MemberIds.Provider value={set}>{children}</MemberIds.Provider>
}

/** Whether a player id gets a player-page link here. */
export function useHasPlayerPage(): (playerId: number) => boolean {
  const ids = useContext(MemberIds)
  return (playerId) => ids === null || ids.has(playerId)
}

export function PlayerLink({
  playerId,
  className,
  guestClassName,
  title,
  children,
  fallback,
  ...events
}: {
  playerId: number
  className?: string
  /** Class for the guest's plain-text version; defaults to `className`. */
  guestClassName?: string
  title?: string
  children: ReactNode
  /** What a guest gets instead of the link; defaults to the children as text. */
  fallback?: ReactNode
  onMouseEnter?: () => void
  onFocus?: () => void
  onBlur?: () => void
  'aria-live'?: 'polite' | 'off' | 'assertive'
}) {
  const hasPage = useHasPlayerPage()
  if (!hasPage(playerId)) {
    if (fallback !== undefined) return <>{fallback}</>
    return (
      <span className={guestClassName ?? className} title={title} {...events}>
        {children}
      </span>
    )
  }
  return (
    <Link
      prefetch
      href={`/roster/${String(playerId)}`}
      className={className}
      title={title}
      {...events}
    >
      {children}
    </Link>
  )
}
