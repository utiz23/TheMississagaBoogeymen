'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type SessionState = { status: 'loading' } | { status: 'out' } | { status: 'in'; name: string }

/**
 * The nav's member control: LOG IN when signed out, the member's initials when
 * signed in. It reads the session from the browser after load, so the root
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
        const name =
          body !== null && typeof body === 'object' && 'user' in body
            ? (body as { user?: { name?: unknown } }).user?.name
            : undefined
        setSession(typeof name === 'string' ? { status: 'in', name } : { status: 'out' })
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
        className="hidden h-[38px] w-[38px] items-center justify-center rounded-xs border border-accent-line bg-accent-soft font-condensed text-[13px] font-extrabold uppercase tracking-[0.06em] text-accent-readable transition-colors hover:bg-[rgba(232,65,49,0.18)] nav:inline-flex"
      >
        {initials(session.name)}
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

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters =
    parts.length >= 2 ? `${parts[0]![0]!}${parts[1]![0]!}` : (parts[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}
