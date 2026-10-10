import type { Metadata } from 'next'
import Link from 'next/link'
import { listPinCandidates, listPinnedPlayers } from '@eanhl/db/queries'
import {
  AUTH_BUTTON_PRIMARY,
  AUTH_BUTTON_SECONDARY,
  AuthNotice,
} from '@/components/auth/auth-panel'
import {
  ADMIN_FIELD,
  ADMIN_LABEL,
  ADMIN_SMALL_BUTTON,
  AdminHeading,
  AdminSection,
} from '@/components/admin/admin-section'
import { requireAdmin } from '@/lib/auth'
import { pinPlayerAction, signOutEveryoneAction, unpinPlayerAction } from './actions'

export const metadata: Metadata = { title: 'Admin' }
export const dynamic = 'force-dynamic'

const TOOLS = [
  {
    href: '/admin/accounts',
    label: 'Member accounts',
    note: 'Invite teammates, disable accounts.',
  },
  {
    href: '/admin/cards',
    label: 'Mythic cards',
    note: 'Award or clear Tier 6 mythic themes.',
  },
  {
    href: '/admin/titles',
    label: 'Game titles',
    note: 'Collection, default and order (view only).',
  },
] as const

/** Admin hub (release C1 of the admin-tools plan). */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ signout?: string }>
}) {
  await requireAdmin()
  const [{ signout }, pinned, candidates] = await Promise.all([
    searchParams,
    listPinnedPlayers(),
    listPinCandidates(),
  ])
  const ended = signout !== undefined && /^\d+$/.test(signout) ? Number(signout) : null

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6">
      <AdminHeading title="Admin tools" back={false} />

      <AdminSection title="Tools">
        <ul className="grid gap-3 sm:grid-cols-2">
          {TOOLS.map((t) => (
            <li key={t.href}>
              <Link
                prefetch
                href={t.href}
                className="flex h-full flex-col gap-1 border border-border px-4 py-3 transition-colors hover:border-accent-line"
              >
                <span className="font-condensed text-sm font-bold uppercase tracking-[0.12em] text-fg-1">
                  {t.label}
                </span>
                <span className="text-sm text-fg-4">{t.note}</span>
              </Link>
            </li>
          ))}
        </ul>
      </AdminSection>

      <section id="roster-pins" className="scroll-mt-24">
        <AdminSection
          title="Pinned to the roster"
          description="A pinned player counts as a team member even without EA stats: they get a player page and appear on the roster and home carousel."
        >
          {pinned.length === 0 ? (
            <p className="text-sm text-fg-4">Nobody is pinned.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-subtle border-y border-border-subtle">
              {pinned.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <Link
                    prefetch
                    href={`/roster/${String(p.id)}`}
                    className="text-sm text-fg-1 hover:underline"
                  >
                    {p.gamertag}
                  </Link>
                  <form action={unpinPlayerAction}>
                    <input type="hidden" name="playerId" value={p.id} />
                    <button type="submit" className={ADMIN_SMALL_BUTTON}>
                      Unpin
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          {candidates.length > 0 && (
            <form action={pinPlayerAction} className="flex flex-wrap items-end gap-3">
              <label className="flex min-w-[220px] flex-1 flex-col gap-1.5">
                <span className={ADMIN_LABEL}>Pin a player</span>
                <select name="playerId" required defaultValue="" className={ADMIN_FIELD}>
                  <option value="" disabled>
                    Choose…
                  </option>
                  {candidates.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.gamertag}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={`${AUTH_BUTTON_PRIMARY} py-2.5`}>
                Pin
              </button>
            </form>
          )}
        </AdminSection>
      </section>

      <section id="sessions" className="scroll-mt-24">
        <AdminSection
          title="Sign everyone out"
          description="Ends every member's sign-in on every device, except yours. Use it if a link or device may have fallen into the wrong hands. Members just sign in again with Discord."
        >
          {ended !== null && (
            <AuthNotice tone="info">
              Done — {ended === 1 ? '1 sign-in' : `${String(ended)} sign-ins`} ended.
            </AuthNotice>
          )}
          {signout === 'unconfirmed' && (
            <AuthNotice tone="error">Tick the box to confirm first.</AuthNotice>
          )}
          <form action={signOutEveryoneAction} className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-fg-2">
              <input
                type="checkbox"
                name="confirm"
                value="yes"
                className="h-4 w-4 accent-[#e84131]"
              />
              Yes, sign everyone else out
            </label>
            <button type="submit" className={AUTH_BUTTON_SECONDARY}>
              Sign everyone out
            </button>
          </form>
        </AdminSection>
      </section>
    </div>
  )
}
