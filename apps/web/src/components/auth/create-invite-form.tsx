'use client'

import { useActionState, useState } from 'react'
import { createInviteAction } from '@/app/admin/accounts/actions'
import type { CreateInviteState } from '@/app/admin/accounts/invite-form'
import { AUTH_BUTTON_PRIMARY, AUTH_BUTTON_SECONDARY, AuthNotice } from './auth-panel'

const FIELD =
  'w-full border border-border bg-surface px-3 py-2 text-sm text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
const LABEL = 'font-condensed text-xs font-semibold uppercase tracking-[0.18em] text-fg-4'

/**
 * Create an invite: pick a player, a role and a lifetime. The link is shown
 * here once — only its hash is stored — so it comes with a copy button.
 */
export function CreateInviteForm({
  players,
}: {
  players: readonly { id: number; gamertag: string }[]
}) {
  const [state, action, pending] = useActionState<CreateInviteState, FormData>(createInviteAction, {
    status: 'idle',
  })
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Player</span>
          <select name="playerId" required defaultValue="" className={FIELD}>
            <option value="" disabled>
              Choose…
            </option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.gamertag}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Role</span>
          <select name="role" defaultValue="user" className={FIELD}>
            <option value="user">Member</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Link works</span>
          <select name="hours" defaultValue="168" className={FIELD}>
            <option value="24">1 day</option>
            <option value="168">7 days</option>
          </select>
        </label>
        <button type="submit" disabled={pending} className={`${AUTH_BUTTON_PRIMARY} py-2.5`}>
          {pending ? 'Creating…' : 'Create link'}
        </button>
      </form>

      {state.status === 'error' && <AuthNotice tone="error">{state.message}</AuthNotice>}
      {state.status === 'ok' && (
        <InviteLink
          key={state.url}
          url={state.url}
          gamertag={state.gamertag}
          expires={state.expires}
        />
      )}
    </div>
  )
}

function InviteLink({
  url,
  gamertag,
  expires,
}: {
  url: string
  gamertag: string
  expires: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex flex-col gap-2 border border-accent-line bg-accent-soft p-4">
      <p className="text-sm text-fg-2">
        Invite for <strong className="text-fg-1">{gamertag}</strong>, works once until {expires}.
        Send it to them on Discord — it won’t be shown again.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all bg-black/30 px-2 py-1.5 text-xs text-fg-1">
          {url}
        </code>
        <button
          type="button"
          className={AUTH_BUTTON_SECONDARY}
          onClick={() => {
            void navigator.clipboard.writeText(url).then(() => setCopied(true))
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
