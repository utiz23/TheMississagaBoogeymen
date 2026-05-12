import type { Metadata } from 'next'
import {
  getAccountInviteByToken,
  hasAccountUsers,
  isInviteUsable,
  listClaimablePlayers,
} from '@eanhl/db/queries'
import { acceptInvite, bootstrapAdmin, signInWithPassword } from '@/app/account-actions'

export const metadata: Metadata = { title: 'Login - Club Stats' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function errorText(code: string | undefined): string | null {
  if (!code) return null
  if (code === 'missing') return 'Email and password are required.'
  if (code === 'invalid') return 'Invalid email or password.'
  if (code === 'invite_unusable') return 'Invite link is expired, revoked, or already accepted.'
  if (code === 'email_exists') return 'An account already exists for that email. Sign in instead.'
  if (code === 'invalid_invite_form') return 'Name and an 8+ character password are required.'
  if (code === 'accept_failed') return 'Invite could not be accepted. The player may already be claimed.'
  if (code === 'bootstrap_closed') return 'Bootstrap is closed. Sign in or ask an admin for an invite.'
  if (code === 'bootstrap_invalid') return 'Bootstrap requires email, name, player, and an 8+ character password.'
  if (code === 'bootstrap_failed') return 'Bootstrap admin could not be created.'
  return 'Unable to complete login.'
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const token = typeof params.token === 'string' ? params.token : null
  const error = typeof params.error === 'string' ? errorText(params.error) : null
  const [hasUsers, invite, players] = await Promise.all([
    hasAccountUsers(),
    token ? getAccountInviteByToken(token) : Promise.resolve(null),
    listClaimablePlayers(),
  ])
  const usableInvite = invite !== null && isInviteUsable(invite)

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="space-y-1">
        <h1 className="font-condensed text-2xl font-semibold uppercase tracking-widest text-zinc-50">
          Account Login
        </h1>
        <p className="text-sm text-zinc-500">
          Invite-only access for private player performance tracking.
        </p>
      </div>

      {error && (
        <div className="border border-accent/40 bg-accent/10 px-4 py-3 text-sm text-accent">
          {error}
        </div>
      )}

      {!hasUsers ? (
        <section className="broadcast-panel space-y-4 p-5">
          <div className="space-y-1">
            <h2 className="font-condensed text-sm font-bold uppercase tracking-widest text-zinc-200">
              Bootstrap Admin
            </h2>
            <p className="text-sm text-zinc-500">
              First account only. After this, all accounts require admin invites.
            </p>
          </div>
          <form action={bootstrapAdmin} className="space-y-3">
            <input
              name="email"
              type="email"
              required
              placeholder="admin@email"
              className="w-full border border-zinc-700 bg-background px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
            />
            <input
              name="name"
              required
              placeholder="Display name"
              className="w-full border border-zinc-700 bg-background px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
            />
            <select
              name="playerId"
              required
              className="w-full border border-zinc-700 bg-background px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
            >
              <option value="">Linked player</option>
              {players.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.gamertag}
                </option>
              ))}
            </select>
            <input
              name="password"
              type="password"
              minLength={8}
              required
              placeholder="Password"
              className="w-full border border-zinc-700 bg-background px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
            />
            <button className="w-full border border-accent bg-accent/10 px-4 py-2 font-condensed text-xs font-bold uppercase tracking-widest text-accent transition-colors hover:bg-accent/20">
              Create Admin
            </button>
          </form>
        </section>
      ) : token !== null ? (
        <section className="broadcast-panel space-y-4 p-5">
          <div className="space-y-1">
            <h2 className="font-condensed text-sm font-bold uppercase tracking-widest text-zinc-200">
              Accept Invite
            </h2>
            {usableInvite ? (
              <p className="text-sm text-zinc-500">
                {invite.email} · linked to{' '}
                <span className="font-semibold text-zinc-300">{invite.claimedPlayerGamertag}</span>
              </p>
            ) : (
              <p className="text-sm text-zinc-500">This invite is not usable.</p>
            )}
          </div>

          {usableInvite && (
            <form action={acceptInvite} className="space-y-3">
              <input type="hidden" name="token" value={token} />
              <label className="block space-y-1">
                <span className="font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Display Name
                </span>
                <input
                  name="name"
                  required
                  className="w-full border border-zinc-700 bg-background px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
                />
              </label>
              <label className="block space-y-1">
                <span className="font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                  Password
                </span>
                <input
                  name="password"
                  type="password"
                  minLength={8}
                  required
                  className="w-full border border-zinc-700 bg-background px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
                />
              </label>
              <button className="w-full border border-accent bg-accent/10 px-4 py-2 font-condensed text-xs font-bold uppercase tracking-widest text-accent transition-colors hover:bg-accent/20">
                Create Account
              </button>
            </form>
          )}
        </section>
      ) : (
        <section className="broadcast-panel space-y-4 p-5">
          <h2 className="font-condensed text-sm font-bold uppercase tracking-widest text-zinc-200">
            Sign In
          </h2>
          <form action={signInWithPassword} className="space-y-3">
            <label className="block space-y-1">
              <span className="font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Email
              </span>
              <input
                name="email"
                type="email"
                required
                className="w-full border border-zinc-700 bg-background px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
              />
            </label>
            <label className="block space-y-1">
              <span className="font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
                Password
              </span>
              <input
                name="password"
                type="password"
                required
                className="w-full border border-zinc-700 bg-background px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
              />
            </label>
            <button className="w-full border border-accent bg-accent/10 px-4 py-2 font-condensed text-xs font-bold uppercase tracking-widest text-accent transition-colors hover:bg-accent/20">
              Sign In
            </button>
          </form>
        </section>
      )}
    </div>
  )
}
