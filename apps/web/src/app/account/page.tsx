import type { Metadata } from 'next'
import Link from 'next/link'
import {
  AUTH_BUTTON_PRIMARY,
  AUTH_BUTTON_SECONDARY,
  AuthNotice,
  AuthPanel,
} from '@/components/auth/auth-panel'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { requireUser } from '@/lib/auth'

export const metadata: Metadata = { title: 'Your account' }
/** Per member, per request — never prerendered (auth settings exist only at runtime). */
export const dynamic = 'force-dynamic'

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>
}) {
  const viewer = await requireUser()
  const { welcome } = await searchParams

  return (
    <AuthPanel label={viewer.role === 'admin' ? 'Member · Admin' : 'Member'} title={viewer.name}>
      {welcome === '1' && <AuthNotice tone="info">Welcome aboard — you’re signed in.</AuthNotice>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="font-condensed text-xs font-semibold uppercase tracking-[0.18em] text-fg-4">
          Player
        </dt>
        <dd className="text-fg-1">{viewer.gamertag}</dd>
        <dt className="font-condensed text-xs font-semibold uppercase tracking-[0.18em] text-fg-4">
          Signed in with
        </dt>
        <dd className="text-fg-2">Discord</dd>
      </dl>
      <div className="flex flex-wrap gap-3">
        {viewer.playerId !== null && (
          <Link
            prefetch
            href={`/roster/${String(viewer.playerId)}`}
            className={AUTH_BUTTON_PRIMARY}
          >
            Your player card
          </Link>
        )}
        {viewer.role === 'admin' && (
          <Link prefetch href="/admin" className={AUTH_BUTTON_SECONDARY}>
            Admin tools
          </Link>
        )}
        <SignOutButton />
      </div>
    </AuthPanel>
  )
}
