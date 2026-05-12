import type { Metadata } from 'next'
import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { signOutCurrentUser } from '@/app/account-actions'

export const metadata: Metadata = { title: 'Account - Club Stats' }

export default async function AccountPage() {
  const user = await requireUser()

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="font-condensed text-2xl font-semibold uppercase tracking-widest text-zinc-50">
            Account
          </h1>
          <p className="text-sm text-zinc-500">Private account and linked player identity.</p>
        </div>
        <form action={signOutCurrentUser}>
          <button className="border border-zinc-700 px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-widest text-zinc-400 hover:border-zinc-500 hover:text-zinc-100">
            Sign Out
          </button>
        </form>
      </div>

      <section className="broadcast-panel divide-y divide-zinc-800/70">
        <AccountRow label="Email" value={user.email} />
        <AccountRow label="Display Name" value={user.name} />
        <AccountRow label="Role" value={user.role.toUpperCase()} />
        <AccountRow
          label="Linked Player"
          value={user.playerId !== null ? user.gamertag ?? `#${user.playerId.toString()}` : 'Unassigned'}
        />
      </section>

      <div className="flex gap-3">
        <Link
          href="/me"
          className="border border-accent bg-accent/10 px-4 py-2 font-condensed text-xs font-bold uppercase tracking-widest text-accent hover:bg-accent/20"
        >
          My Performance
        </Link>
        {user.role === 'admin' && (
          <Link
            href="/admin/accounts"
            className="border border-zinc-700 px-4 py-2 font-condensed text-xs font-bold uppercase tracking-widest text-zinc-400 hover:border-zinc-500 hover:text-zinc-100"
          >
            Manage Accounts
          </Link>
        )}
      </div>
    </div>
  )
}

function AccountRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4">
      <span className="font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        {label}
      </span>
      <span className="text-sm font-medium text-zinc-200">{value}</span>
    </div>
  )
}
