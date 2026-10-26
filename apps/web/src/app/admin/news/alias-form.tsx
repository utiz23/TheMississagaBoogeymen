'use client'

import { useActionState } from 'react'
import { ADMIN_FIELD, ADMIN_LABEL, ADMIN_SMALL_BUTTON } from '@/components/admin/admin-section'
import { ALIAS_MAX_CHARS, type AliasState } from '@/lib/news/alias-save'
import { addAliasAction } from './actions'

/** Add one nickname: the text and the player it points to. The message shows under the form. */
export function AliasForm({ players }: { players: readonly { playerId: number; name: string }[] }) {
  const [state, action, pending] = useActionState<AliasState, FormData>(addAliasAction, {
    status: 'idle',
  })
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className={ADMIN_LABEL}>Nickname</span>
          <input
            type="text"
            name="alias"
            required
            minLength={1}
            maxLength={ALIAS_MAX_CHARS}
            autoComplete="off"
            className={`${ADMIN_FIELD} w-56`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={ADMIN_LABEL}>Player</span>
          <select
            name="playerId"
            required
            defaultValue=""
            className={`${ADMIN_FIELD} min-w-[200px]`}
          >
            <option value="" disabled>
              Choose…
            </option>
            {players.map((p) => (
              <option key={p.playerId} value={p.playerId}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending} className={ADMIN_SMALL_BUTTON}>
          {pending ? 'Saving…' : 'Add nickname'}
        </button>
      </div>
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-accent-readable">
          {state.message}
        </p>
      )}
      {state.status === 'ok' && (
        <p role="status" className="text-sm text-fg-2">
          {state.message}
        </p>
      )}
    </form>
  )
}
