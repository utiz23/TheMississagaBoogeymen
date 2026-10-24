'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOutAndReload } from '@/components/auth/sign-out-button'
import { NavMenu, navMenuItemClass } from './nav-menu'
import { isActive } from './nav-links'

/** What `/api/me` answers (app/api/me/route.ts). */
type MeBody = {
  name: string
  image: string | null
  role: 'user' | 'admin'
  playerId: number
} | null

type SessionState =
  | { status: 'loading' }
  | { status: 'out' }
  | ({ status: 'in' } & NonNullable<MeBody>)

function parseMe(body: unknown): SessionState {
  if (body === null || typeof body !== 'object') return { status: 'out' }
  const me = body as Record<string, unknown>
  if (typeof me.name !== 'string' || typeof me.playerId !== 'number') {
    return { status: 'out' }
  }
  return {
    status: 'in',
    name: me.name,
    image: typeof me.image === 'string' ? me.image : null,
    role: me.role === 'admin' ? 'admin' : 'user',
    playerId: me.playerId,
  }
}

/**
 * The nav's member control: LOG IN when signed out, the member's Discord
 * picture when signed in (the card silhouette when they have none, or it
 * won't load). Only the signed-in member's own picture is ever loaded. It reads
 * the member from `/api/me` in the browser after load, so the root layout never
 * touches `headers()` and every page stays as cacheable as before. The box
 * keeps its size while loading, so nothing shifts.
 *
 * In the bar the picture opens the account menu: your account, your player
 * card, admin tools (admins only) and sign out. In the drawer it stays one
 * YOUR ACCOUNT button — the drawer has no room for a second menu.
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
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: unknown) => {
        if (live) setSession(parseMe(body))
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
      <NavMenu
        className="hidden nav:block"
        buttonLabel={`Account menu (${session.name})`}
        buttonTitle={session.name}
        buttonClassName="flex h-[38px] w-[38px] items-center justify-center overflow-hidden rounded-xs border border-accent-line bg-surface-raised transition-[filter] hover:brightness-110 aria-expanded:border-accent"
        button={<MemberPicture image={session.image} />}
      >
        <AccountMenuItems session={session} />
      </NavMenu>
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

function AccountMenuItems({ session }: { session: Extract<SessionState, { status: 'in' }> }) {
  const pathname = usePathname()
  const [signingOut, setSigningOut] = useState(false)
  const links = [
    { href: '/account', label: 'Your account' },
    { href: `/roster/${String(session.playerId)}`, label: 'Your player card' },
    ...(session.role === 'admin' ? [{ href: '/admin', label: 'Admin tools' }] : []),
  ]

  return (
    <>
      <p className="truncate px-4 pb-2 pt-1.5 text-xs text-fg-4">
        Signed in as <span className="text-fg-2">{session.name}</span>
      </p>
      {links.map(({ href, label }) => {
        const active = isActive(pathname, href)
        return (
          <Link
            prefetch
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={navMenuItemClass(active)}
          >
            {label}
          </Link>
        )
      })}
      <div aria-hidden className="mx-4 my-1.5 border-t border-border" />
      <button
        type="button"
        disabled={signingOut}
        onClick={() => {
          setSigningOut(true)
          void signOutAndReload()
        }}
        className={navMenuItemClass(false)}
      >
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </>
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
