import type { Metadata } from 'next'
import { listClubAwards, listInvitablePlayers, listTitlesForAdmin } from '@eanhl/db/queries'
import type { ClubAwardRecord } from '@eanhl/db/queries'
import {
  ADMIN_FIELD,
  ADMIN_LABEL,
  ADMIN_SMALL_BUTTON,
  AdminHeading,
  AdminSection,
} from '@/components/admin/admin-section'
import { AUTH_BUTTON_PRIMARY, AuthNotice } from '@/components/auth/auth-panel'
import { requireAdmin } from '@/lib/auth'
import { BANNER_MODES, REASON_MAX, TROPHIES } from '@/lib/award-edit'
import { createAwardAction, deleteAwardAction, updateAwardAction } from './actions'

export const metadata: Metadata = { title: 'Trophy case' }
export const dynamic = 'force-dynamic'

const RESULTS: Readonly<Record<string, string>> = {
  added: 'Award added.',
  saved: 'Award saved.',
  deleted: 'Award deleted.',
}

type Title = { id: number; name: string }
type Member = { id: number; gamertag: string }

function awardLabel(a: ClubAwardRecord): string {
  if (a.kind === 'banner') return BANNER_MODES.find((m) => m.value === a.mode)?.label ?? a.mode
  return TROPHIES.find((t) => t.value === a.trophy)?.label ?? a.trophy
}

/** Players as checkboxes: the award's current players first, in their order. */
function PlayerPicker({
  members,
  selected,
}: {
  members: readonly Member[]
  selected: readonly number[]
}) {
  const first = selected.flatMap((id) => members.filter((m) => m.id === id))
  const rest = members.filter((m) => !selected.includes(m.id))
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className={`${ADMIN_LABEL} mb-1.5`}>Players (checked order = display order)</legend>
      <div className="grid max-h-48 grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto border border-border p-2 sm:grid-cols-3">
        {[...first, ...rest].map((m) => (
          <label key={m.id} className="flex items-center gap-2 text-sm text-fg-2">
            <input
              type="checkbox"
              name="playerIds"
              value={m.id}
              defaultChecked={selected.includes(m.id)}
              className="h-4 w-4 accent-[#e84131]"
            />
            {m.gamertag}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function TitleSelect({ titles, value }: { titles: readonly Title[]; value?: number }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className={ADMIN_LABEL}>Season</span>
      <select name="gameTitleId" required defaultValue={value ?? ''} className={ADMIN_FIELD}>
        <option value="" disabled>
          Choose…
        </option>
        {titles.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function TrophyFields({
  titles,
  members,
  award,
}: {
  titles: readonly Title[]
  members: readonly Member[]
  award?: Extract<ClubAwardRecord, { kind: 'trophy' }>
}) {
  return (
    <>
      <input type="hidden" name="kind" value="trophy" />
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5">
          <span className={ADMIN_LABEL}>Trophy</span>
          <select name="trophy" required defaultValue={award?.trophy ?? ''} className={ADMIN_FIELD}>
            <option value="" disabled>
              Choose…
            </option>
            {TROPHIES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <TitleSelect titles={titles} {...(award ? { value: award.gameTitleId } : {})} />
        <label className="flex flex-col gap-1.5">
          <span className={ADMIN_LABEL}>Decided by</span>
          <select
            name="source"
            required
            defaultValue={award?.source ?? 'vote'}
            className={ADMIN_FIELD}
          >
            <option value="vote">Club vote</option>
            <option value="stats">Archive stats (needs a reason)</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className={ADMIN_LABEL}>
          Reason (archive stats only · up to {REASON_MAX} characters)
        </span>
        <textarea
          name="reason"
          rows={2}
          maxLength={REASON_MAX}
          defaultValue={award?.reason ?? ''}
          className={`${ADMIN_FIELD} resize-y`}
        />
      </label>
      <PlayerPicker members={members} selected={award?.playerIds ?? []} />
    </>
  )
}

function BannerFields({
  titles,
  members,
  award,
}: {
  titles: readonly Title[]
  members: readonly Member[]
  award?: Extract<ClubAwardRecord, { kind: 'banner' }>
}) {
  return (
    <>
      <input type="hidden" name="kind" value="banner" />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={ADMIN_LABEL}>Championship</span>
          <select name="mode" required defaultValue={award?.mode ?? ''} className={ADMIN_FIELD}>
            <option value="" disabled>
              Choose…
            </option>
            {BANNER_MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <TitleSelect titles={titles} {...(award ? { value: award.gameTitleId } : {})} />
      </div>
      <PlayerPicker members={members} selected={award?.playerIds ?? []} />
    </>
  )
}

/** Trophy case editor (admin tools C3): club trophies and championship banners. */
export default async function AdminAwardsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string; error?: string }>
}) {
  await requireAdmin()
  const [{ result, error }, awards, titleRows, members] = await Promise.all([
    searchParams,
    listClubAwards(),
    listTitlesForAdmin(),
    listInvitablePlayers(),
  ])
  const titles: Title[] = titleRows.map((t) => ({ id: t.id, name: t.name }))
  const gamertag = new Map(members.map((m) => [m.id, m.gamertag]))
  const byTitle = titles
    .map((t) => ({ title: t, awards: awards.filter((a) => a.gameTitleId === t.id) }))
    .filter((g) => g.awards.length > 0)
  const info = result === undefined ? undefined : RESULTS[result]

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6">
      <AdminHeading title="Trophy case" />
      {info && <AuthNotice tone="info">{info}</AuthNotice>}
      {error && <AuthNotice tone="error">{error}</AuthNotice>}

      <AdminSection
        title="Add a trophy"
        description="Season-leader trophies are worked out from stats automatically; add the ones stats can't decide — a club vote, or a pick from the archive with the reason shown on the player's page."
      >
        <form action={createAwardAction} className="flex flex-col gap-4">
          <TrophyFields titles={titles} members={members} />
          <div>
            <button type="submit" className={`${AUTH_BUTTON_PRIMARY} py-2.5`}>
              Add trophy
            </button>
          </div>
        </form>
      </AdminSection>

      <AdminSection title="Add a championship banner">
        <form action={createAwardAction} className="flex flex-col gap-4">
          <BannerFields titles={titles} members={members} />
          <div>
            <button type="submit" className={`${AUTH_BUTTON_PRIMARY} py-2.5`}>
              Add banner
            </button>
          </div>
        </form>
      </AdminSection>

      <AdminSection title="Awards">
        {byTitle.length === 0 && <p className="text-sm text-fg-4">No awards yet.</p>}
        {byTitle.map(({ title, awards: list }) => (
          <div key={title.id} className="flex flex-col gap-2">
            <h3 className="font-condensed text-sm font-bold uppercase tracking-[0.14em] text-fg-3">
              {title.name}
            </h3>
            <ul className="flex flex-col divide-y divide-border-subtle border-y border-border-subtle">
              {list.map((a) => (
                <li key={a.id} className="flex flex-col gap-2 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <p className="text-sm text-fg-2">
                      <strong className="text-fg-1">{awardLabel(a)}</strong>
                      {a.kind === 'trophy' && (
                        <span className="text-fg-4">
                          {' '}
                          · {a.source === 'vote' ? 'club vote' : 'archive stats'}
                        </span>
                      )}
                      {' — '}
                      {a.playerIds.map((id) => gamertag.get(id) ?? `#${String(id)}`).join(', ')}
                    </p>
                    <div className="flex gap-2">
                      <details className="text-left">
                        <summary className={`${ADMIN_SMALL_BUTTON} cursor-pointer list-none`}>
                          Delete…
                        </summary>
                        <form action={deleteAwardAction} className="mt-2">
                          <input type="hidden" name="awardId" value={a.id} />
                          <button type="submit" className={ADMIN_SMALL_BUTTON}>
                            Yes, delete
                          </button>
                        </form>
                      </details>
                    </div>
                  </div>
                  {a.kind === 'trophy' && a.reason && (
                    <p className="text-xs text-fg-4">{a.reason}</p>
                  )}
                  <details>
                    <summary className={`${ADMIN_SMALL_BUTTON} w-fit cursor-pointer list-none`}>
                      Edit…
                    </summary>
                    <form
                      action={updateAwardAction}
                      className="mt-3 flex flex-col gap-4 border border-border-subtle p-3"
                    >
                      <input type="hidden" name="awardId" value={a.id} />
                      {a.kind === 'trophy' ? (
                        <TrophyFields titles={titles} members={members} award={a} />
                      ) : (
                        <BannerFields titles={titles} members={members} award={a} />
                      )}
                      <div>
                        <button type="submit" className={`${AUTH_BUTTON_PRIMARY} py-2.5`}>
                          Save
                        </button>
                      </div>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </AdminSection>
    </div>
  )
}
