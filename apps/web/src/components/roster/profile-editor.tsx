'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import { saveProfileAction } from '@/app/roster/[id]/profile-actions'
import {
  ARCHETYPE_LABELS,
  BIO_MAX,
  NAME_MAX,
  NATIONALITIES,
  POSITIONS,
  ROLE_MAX,
  type ProfileField,
  type ProfileFormState,
} from '@/lib/profile-edit'

export interface ProfileEditorValues {
  playerName: string | null
  jerseyNumber: number | null
  nationality: string | null
  bio: string | null
  preferredPosition: string | null
  archetype: string | null
  clubRoleLabel: string | null
}

const FIELD =
  'w-full border border-border bg-surface px-3 py-2 text-sm text-fg-1 placeholder:text-fg-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent aria-[invalid=true]:border-accent'
const LABEL = 'font-condensed text-xs font-semibold uppercase tracking-[0.18em] text-fg-4'
const BUTTON =
  'inline-flex items-center justify-center gap-2 border px-[18px] py-2.5 font-condensed text-xs font-bold uppercase tracking-[0.18em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60'

/**
 * EDIT PROFILE: shown on a player's page to that player's own member and to
 * admins. A native <dialog> (Esc closes, focus stays inside). Admins get the
 * extra fields; the server re-checks who may change what either way.
 */
export function ProfileEditor({
  playerId,
  gamertag,
  isAdmin,
  values,
}: {
  playerId: number
  gamertag: string
  isAdmin: boolean
  values: ProfileEditorValues
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  // Remount the form on every open so it starts from the saved values.
  const [formKey, setFormKey] = useState(0)
  const save = useMemo(() => saveProfileAction.bind(null, playerId), [playerId])
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(save, {
    status: 'idle',
  })

  useEffect(() => {
    if (state.status !== 'saved') return
    dialogRef.current?.close()
    router.refresh()
  }, [state, router])

  const open = () => {
    setFormKey((k) => k + 1)
    dialogRef.current?.showModal()
  }
  const errors = state.status === 'error' ? state.errors : {}
  const invalid = (f: ProfileField) => (errors[f] === undefined ? undefined : true)

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-1.5 border border-border px-2.5 py-1 font-condensed text-[11px] font-bold uppercase tracking-[0.18em] text-fg-3 transition-colors hover:border-fg-5 hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Pencil size={12} aria-hidden />
        Edit profile
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={`profile-edit-${String(playerId)}`}
        className="m-auto w-[min(560px,calc(100vw-32px))] border border-border bg-surface-raised p-0 text-fg-1 backdrop:bg-black/70"
      >
        <form key={formKey} action={action} className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1">
            <p className={LABEL}>{isAdmin ? 'Admin · profile' : 'Your profile'}</p>
            <h2
              id={`profile-edit-${String(playerId)}`}
              className="font-condensed text-2xl font-black uppercase leading-none tracking-[0.04em]"
            >
              {gamertag}
            </h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_96px]">
            <Field label="Display name" error={errors.playerName}>
              <input
                name="playerName"
                defaultValue={values.playerName ?? ''}
                placeholder={gamertag}
                maxLength={NAME_MAX}
                aria-invalid={invalid('playerName')}
                className={FIELD}
              />
            </Field>
            <Field label="Jersey #" error={errors.jerseyNumber}>
              <input
                name="jerseyNumber"
                inputMode="numeric"
                pattern="[0-9]{1,2}"
                defaultValue={values.jerseyNumber ?? ''}
                maxLength={2}
                aria-invalid={invalid('jerseyNumber')}
                className={FIELD}
              />
            </Field>
          </div>

          <Field label="Nationality" error={errors.nationality}>
            <select
              name="nationality"
              defaultValue={values.nationality ?? ''}
              aria-invalid={invalid('nationality')}
              className={FIELD}
            >
              <option value="">None</option>
              {NATIONALITIES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Field>

          <Field label={`Bio · up to ${String(BIO_MAX)} characters`} error={errors.bio}>
            <textarea
              name="bio"
              rows={4}
              defaultValue={values.bio ?? ''}
              maxLength={BIO_MAX}
              aria-invalid={invalid('bio')}
              className={`${FIELD} resize-y`}
            />
          </Field>

          {isAdmin && (
            <fieldset className="flex flex-col gap-4 border-t border-border-subtle pt-4">
              <legend className={`${LABEL} pr-2`}>Admin only</legend>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Preferred position" error={errors.preferredPosition}>
                  <select
                    name="preferredPosition"
                    defaultValue={values.preferredPosition ?? ''}
                    aria-invalid={invalid('preferredPosition')}
                    className={FIELD}
                  >
                    <option value="">From games played</option>
                    {POSITIONS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Archetype" error={errors.archetype}>
                  <select
                    name="archetype"
                    defaultValue={values.archetype ?? ''}
                    aria-invalid={invalid('archetype')}
                    className={FIELD}
                  >
                    <option value="">From stats</option>
                    {Object.entries(ARCHETYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Club role (not shown on the site yet)" error={errors.clubRoleLabel}>
                <input
                  name="clubRoleLabel"
                  defaultValue={values.clubRoleLabel ?? ''}
                  placeholder="Captain, Assistant Captain…"
                  maxLength={ROLE_MAX}
                  aria-invalid={invalid('clubRoleLabel')}
                  className={FIELD}
                />
              </Field>
            </fieldset>
          )}

          {state.status === 'error' && (
            <p
              role="alert"
              className="border-l-2 border-accent bg-accent-soft px-3 py-2 text-sm text-fg-2"
            >
              {state.message}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className={`${BUTTON} border-border text-fg-3 hover:border-fg-5 hover:text-fg-1`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className={`${BUTTON} border-accent-line bg-accent-soft text-accent-readable hover:bg-[rgba(232,65,49,0.18)]`}
            >
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  )
}

function Field({
  label,
  error,
  children,
}: {
  label: string
  error: string | undefined
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={LABEL}>{label}</span>
      {children}
      {error !== undefined && <span className="text-xs text-accent-readable">{error}</span>}
    </label>
  )
}
