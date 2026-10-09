'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type SessionState =
  | { status: 'loading' }
  | { status: 'out' }
  | { status: 'in'; name: string; image: string | null }

/**
 * The nav's member control: LOG IN when signed out, the member's Discord
 * picture when signed in (the card silhouette when they have none, or it
 * won't load). Only the signed-in member's own picture is ever loaded. It reads the session from the browser after load, so the root
 * layout never touches `headers()` and every page stays as cacheable as before.
 * The box keeps its size while loading, so nothing shifts.
 */
export function NavAccount({
  variant,
  onNavigate,
}: {
  variant: 'bar' | 'drawer'
  onNavigate?: () => void
}) {
  const [session, setSession] = useState<SessionState>({ status: 'loading' })

  useEffect(() => {
    let live = true
    fetch('/api/auth/get-session', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: unknown) => {
        if (!live) return
        const user =
          body !== null && typeof body === 'object' && 'user' in body
            ? (body as { user?: { name?: unknown; image?: unknown } }).user
            : undefined
        setSession(
          typeof user?.name === 'string'
            ? {
                status: 'in',
                name: user.name,
                image: typeof user.image === 'string' ? user.image : null,
              }
            : { status: 'out' },
        )
      })
      .catch(() => {
        if (live) setSession({ status: 'out' })
      })
    return () => {
      live = false
    }
  }, [])

  const signedIn = session.status === 'in'
  const href = signedIn ? '/account' : '/login'
  const hidden = session.status === 'loading' ? 'invisible' : ''

  if (variant === 'drawer') {
    return (
      <Link
        href={href}
        onClick={() => onNavigate?.()}
        className={`${hidden} rounded-xs bg-accent p-[13px] text-center font-condensed text-sm font-extrabold uppercase tracking-[0.15em] text-white transition-[filter] hover:brightness-110`}
      >
        {signedIn ? 'Your account' : 'Log in'}
      </Link>
    )
  }

  if (signedIn) {
    return (
      <Link
        href={href}
        aria-label={`Your account (${session.name})`}
        title={session.name}
        className="hidden h-[38px] w-[38px] items-center justify-center overflow-hidden rounded-xs border border-accent-line bg-surface-raised transition-[filter] hover:brightness-110 nav:inline-flex"
      >
        <MemberPicture image={session.image} />
      </Link>
    )
  }

  return (
    <Link
      href={href}
      className={`${hidden} hidden rounded-xs bg-accent px-5 py-[9px] font-condensed text-[13px] font-extrabold uppercase tracking-[0.15em] text-white transition-[filter] hover:brightness-110 nav:inline-flex`}
    >
      Log in
    </Link>
  )
}

/** The Discord picture, or the player-card silhouette (also if the picture fails). */
function MemberPicture({ image }: { image: string | null }) {
  const [failed, setFailed] = useState(false)
  if (image !== null && !failed) {
    return (
      // A plain <img>: one 64px picture from Discord's CDN, no optimisation proxy.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`${image}?size=64`}
        alt=""
        width={38}
        height={38}
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
        onError={() => {
          setFailed(true)
        }}
      />
    )
  }
  // The player card's silhouette (card-front.tsx).
  return (
    <svg
      viewBox="0 0 100 110"
      fill="currentColor"
      preserveAspectRatio="xMidYMax meet"
      aria-hidden
      className="mt-[6px] h-[32px] w-[30px] text-fg-5"
    >
      <circle cx="50" cy="32" r="21" />
      <path d="M 8 110 Q 8 66 50 66 Q 92 66 92 110 Z" />
    </svg>
  )
}
