import type { Metadata } from 'next'
import {
  listAccountInvites,
  listAccountUsers,
  listClaimablePlayers,
} from '@eanhl/db/queries'
import {
  assignClaim,
  createInvite,
  revokeInvite,
  setUserDisabled,
} from '@/app/account-actions'
import { requireAdmin } from '@/lib/auth'

export const metadata: Metadata = { title: 'Account Admin - Club Stats' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function AccountAdminPage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdmin()
  const params = await searchParams
  const inviteUrl = typeof params.invite === 'string' ? params.invite : null
  const error = typeof params.error === 'string' ? params.error : null
  const [users, invites, players] = await Promise.all([
    listAccountUsers(),
    listAccountInvites(),
    listClaimablePlayers(),
  ])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-condensed text-2xl font-semibold uppercase tracking-widest text-zinc-50">
          Account Admin
        </h1>
        <p className="text-sm text-zinc-500">Invite-only accounts and player claims.</p>
      </div>

      {inviteUrl && (
        <div className="border border-emerald-500/40 bg-emerald-500/10 px-4 py-3">
          <div className="font-condensed text-xs font-bold uppercase tracking-widest text-emerald-400">
            Invite Link
          </div>
          <p className="mt-1 break-all text-sm text-zinc-200">{inviteUrl}</p>
        </div>
      )}
      {error && (
        <div className="border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          {error}
        </div>
      )}

      <section className="broadcast-panel p-5">
        <h2 className="font-condensed text-sm font-bold uppercase tracking-widest text-zinc-200">
          Create Invite
        </h2>
        <form action={createInvite} className="mt-4 grid gap-3 md:grid-cols-[1.4fr_1fr_0.7fr_0.7fr_auto]">
          <input
            name="email"
            type="email"
            required
            placeholder="player@email"
            className="border border-zinc-700 bg-background px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
          />
          <select
            name="playerId"
            required
            className="border border-zinc-700 bg-background px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
          >
            <option value="">Player</option>
            {players.map((player) => (
              <option key={player.id} value={player.id} disabled={player.isClaimed}>
                {player.gamertag}{player.isClaimed ? ' (claimed)' : ''}
              </option>
            ))}
          </select>
          <select
            name="role"
            defaultValue="user"
            className="border border-zinc-700 bg-background px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
          >
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
          <input
            name="expiresInDays"
            type="number"
            min={1}
            defaultValue={7}
            className="border border-zinc-700 bg-background px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
          />
          <button className="border border-accent bg-accent/10 px-4 py-2 font-condensed text-xs font-bold uppercase tracking-widest text-accent hover:bg-accent/20">
            Create
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="font-condensed text-sm font-bold uppercase tracking-widest text-zinc-200">
          Users
        </h2>
        <div className="divide-y divide-zinc-800 overflow-hidden border border-zinc-800">
          {users.map((user) => (
            <div key={user.id} className="grid gap-3 bg-surface p-4 lg:grid-cols-[1fr_1fr_auto_auto] lg:items-center">
              <div>
                <div className="font-condensed text-sm font-bold uppercase text-zinc-100">
                  {user.name}
                </div>
                <div className="text-xs text-zinc-500">{user.email}</div>
              </div>
              <form action={assignClaim} className="flex gap-2">
                <input type="hidden" name="userId" value={user.id} />
                <select
                  name="playerId"
                  defaultValue={user.playerId ?? ''}
                  className="min-w-0 flex-1 border border-zinc-700 bg-background px-2 py-1.5 text-xs text-zinc-100"
                >
                  <option value="">Unassigned</option>
                  {players.map((player) => (
                    <option
                      key={player.id}
                      value={player.id}
                      disabled={player.isClaimed && player.id !== user.playerId}
                    >
                      {player.gamertag}
                    </option>
                  ))}
                </select>
                <button className="border border-zinc-700 px-2 py-1.5 font-condensed text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                  Assign
                </button>
              </form>
              <div className="font-condensed text-xs font-bold uppercase tracking-widest text-zinc-500">
                {user.role}{user.disabledAt ? ' · disabled' : ''}
              </div>
              <form action={setUserDisabled}>
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="disabled" value={user.disabledAt ? 'false' : 'true'} />
                <button className="border border-zinc-700 px-3 py-1.5 font-condensed text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                  {user.disabledAt ? 'Enable' : 'Disable'}
                </button>
              </form>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-condensed text-sm font-bold uppercase tracking-widest text-zinc-200">
          Invites
        </h2>
        <div className="divide-y divide-zinc-800 overflow-hidden border border-zinc-800">
          {invites.map((invite) => (
            <div key={invite.id} className="grid gap-3 bg-surface p-4 md:grid-cols-[1fr_auto_auto] md:items-center">
              <div>
                <div className="text-sm text-zinc-200">{invite.email}</div>
                <div className="text-xs text-zinc-500">
                  {invite.claimedPlayerGamertag} · expires {invite.expiresAt.toISOString().slice(0, 10)}
                </div>
              </div>
              <InviteStatus invite={invite} />
              <form action={revokeInvite}>
                <input type="hidden" name="inviteId" value={invite.id} />
                <button
                  disabled={invite.acceptedAt !== null || invite.revokedAt !== null}
                  className="border border-zinc-700 px-3 py-1.5 font-condensed text-[10px] font-bold uppercase tracking-widest text-zinc-400 disabled:opacity-40"
                >
                  Revoke
                </button>
              </form>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function InviteStatus({
  invite,
}: {
  invite: { acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }
}) {
  const label =
    invite.acceptedAt !== null
      ? 'Accepted'
      : invite.revokedAt !== null
        ? 'Revoked'
        : invite.expiresAt <= new Date()
          ? 'Expired'
          : 'Open'
  return (
    <span className="font-condensed text-xs font-bold uppercase tracking-widest text-zinc-500">
      {label}
    </span>
  )
}
