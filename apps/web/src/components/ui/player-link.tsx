'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import Link from 'next/link'

/**
 * Only team members, present and past, have player pages (operator,
 * 2026-10-09). A page that can show guests (game sheets, stats, leaders)
 * wraps its content in MemberLinksProvider with each member's page path;
 * PlayerLink then links members to `/roster/<gamertag slug>` and renders guests
 * as plain text. Outside a provider every id links, by number — the player
 * page redirects that to the slug (member-only lists such as the depth chart).
 */
const MemberPaths = createContext<ReadonlyMap<number, string> | null>(null)

export function MemberLinksProvider({
  paths,
  children,
}: {
  /** [player id, page path] for every member (player-route.ts `memberPaths`). */
  paths: [number, string][]
  children: ReactNode
}) {
  const map = useMemo(() => new Map(paths), [paths])
  return <MemberPaths.Provider value={map}>{children}</MemberPaths.Provider>
}

/** Whether a player id gets a player-page link here. */
export function useHasPlayerPage(): (playerId: number) => boolean {
  const paths = useContext(MemberPaths)
  return (playerId) => paths === null || paths.has(playerId)
}

/** A player's page path: the gamertag slug inside a provider, else the id. */
export function usePlayerHref(): (playerId: number) => string {
  const paths = useContext(MemberPaths)
  return (playerId) => paths?.get(playerId) ?? `/roster/${String(playerId)}`
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
  const playerHref = usePlayerHref()
  if (!hasPage(playerId)) {
    if (fallback !== undefined) return <>{fallback}</>
    return (
      <span className={guestClassName ?? className} title={title} {...events}>
        {children}
      </span>
    )
  }
  return (
    <Link prefetch href={playerHref(playerId)} className={className} title={title} {...events}>
      {children}
    </Link>
  )
}
