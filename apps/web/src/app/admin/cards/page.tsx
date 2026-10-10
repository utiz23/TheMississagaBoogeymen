import type { Metadata } from 'next'
import Link from 'next/link'
import { CARD_THEME_NAMES, MYTHIC_THEMES } from '@eanhl/db/cards'
import {
  listInvitablePlayers,
  listMythicCards,
  listTitlesForAdmin,
  loadCardTitles,
} from '@eanhl/db/queries'
import {
  ADMIN_FIELD,
  ADMIN_LABEL,
  ADMIN_SMALL_BUTTON,
  ADMIN_TD,
  ADMIN_TH,
  AdminHeading,
  AdminSection,
} from '@/components/admin/admin-section'
import { AUTH_BUTTON_PRIMARY, AuthNotice } from '@/components/auth/auth-panel'
import { requireAdmin } from '@/lib/auth'
import { formatClubDateTime } from '@/lib/format'
import { awardMythicAction, clearMythicAction } from './actions'

export const metadata: Metadata = { title: 'Mythic cards' }
export const dynamic = 'force-dynamic'

const RESULTS: Readonly<Record<string, { tone: 'info' | 'error'; text: string }>> = {
  awarded: { tone: 'info', text: 'Mythic awarded — the card is Tier 6 now.' },
  cleared: { tone: 'info', text: 'Mythic cleared — the card is back to its stats tier.' },
  nothing: { tone: 'error', text: 'That card had no mythic to clear.' },
  invalid: { tone: 'error', text: 'Pick a team member, a season and a mythic theme.' },
}

/** Award and clear Tier 6 mythic cards (admin tools C2). */
export default async function AdminCardsPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>
}) {
  await requireAdmin()
  const [{ result }, mythics, cardTitles, titles, members] = await Promise.all([
    searchParams,
    listMythicCards(),
    loadCardTitles(),
    listTitlesForAdmin(),
    listInvitablePlayers(),
  ])
  const notice = result === undefined ? undefined : RESULTS[result]
  // Default season: the site's default title when it has cards, else the newest.
  const defaultId = titles.find((t) => t.isDefault)?.id
  const seasons = [...cardTitles].reverse()
  const preselect = seasons.find((t) => t.id === defaultId)?.id ?? seasons[0]?.id

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6">
      <AdminHeading title="Mythic cards" />
      {notice && <AuthNotice tone={notice.tone}>{notice.text}</AuthNotice>}

      <AdminSection
        title="Award a mythic"
        description="Tier 6 is awarded by the club, not earned. The player's card for that season becomes Tier 6 in the chosen mythic theme (stats can't take it away); awarding again swaps the theme."
      >
        {seasons.length === 0 ? (
          <p className="text-sm text-fg-4">No season has player cards yet.</p>
        ) : (
          <form
            action={awardMythicAction}
            className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end"
          >
            <label className="flex flex-col gap-1.5">
              <span className={ADMIN_LABEL}>Player</span>
              <select name="playerId" required defaultValue="" className={ADMIN_FIELD}>
                <option value="" disabled>
                  Choose…
                </option>
                {members.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.gamertag}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ADMIN_LABEL}>Season</span>
              <select name="gameTitleId" required defaultValue={preselect} className={ADMIN_FIELD}>
                {seasons.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={ADMIN_LABEL}>Mythic</span>
              <select name="theme" required defaultValue="" className={ADMIN_FIELD}>
                <option value="" disabled>
                  Choose…
                </option>
                {MYTHIC_THEMES.map((k) => (
                  <option key={k} value={k}>
                    {CARD_THEME_NAMES[k]}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={`${AUTH_BUTTON_PRIMARY} py-2.5`}>
              Award
            </button>
          </form>
        )}
      </AdminSection>

      <AdminSection title="Mythic cards awarded">
        {mythics.length === 0 ? (
          <p className="text-sm text-fg-4">None yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr>
                  <th className={ADMIN_TH}>Player</th>
                  <th className={ADMIN_TH}>Season</th>
                  <th className={ADMIN_TH}>Mythic</th>
                  <th className={ADMIN_TH}>Since</th>
                  <th className={ADMIN_TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {mythics.map((m) => (
                  <tr key={`${String(m.playerId)}-${String(m.gameTitleId)}`}>
                    <td className={ADMIN_TD}>
                      <Link
                        prefetch
                        href={`/roster/${String(m.playerId)}`}
                        className="text-fg-1 hover:underline"
                      >
                        {m.gamertag}
                      </Link>
                    </td>
                    <td className={ADMIN_TD}>{m.titleName}</td>
                    <td className={ADMIN_TD}>{CARD_THEME_NAMES[m.theme]}</td>
                    <td className={ADMIN_TD}>{formatClubDateTime(m.since)}</td>
                    <td className={`${ADMIN_TD} text-right`}>
                      {/* No-JS confirm: Clear sits behind a disclosure. */}
                      <details className="inline-block text-left">
                        <summary className={`${ADMIN_SMALL_BUTTON} cursor-pointer list-none`}>
                          Clear…
                        </summary>
                        <form action={clearMythicAction} className="mt-2 flex items-center gap-2">
                          <input type="hidden" name="playerId" value={m.playerId} />
                          <input type="hidden" name="gameTitleId" value={m.gameTitleId} />
                          <button type="submit" className={ADMIN_SMALL_BUTTON}>
                            Yes, back to stats tier
                          </button>
                        </form>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSection>
    </div>
  )
}
