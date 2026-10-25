import type { Metadata } from 'next'
import Link from 'next/link'
import { REPORTERS } from '@eanhl/db/news'
import {
  getNewsEnabled,
  listAdminNewsItems,
  listMemberPressLevels,
  monthNewsSpendUsd,
} from '@eanhl/db/queries'
import {
  ADMIN_FIELD,
  ADMIN_SMALL_BUTTON,
  ADMIN_TD,
  ADMIN_TH,
  AdminHeading,
  AdminSection,
} from '@/components/admin/admin-section'
import { AUTH_BUTTON_PRIMARY } from '@/components/auth/auth-panel'
import { requireAdmin } from '@/lib/auth'
import { formatClubDateTime } from '@/lib/format'
import {
  adminItemHref,
  itemPreview,
  monthlyLimitUsd,
  pressLevelSetByLabel,
} from '@/lib/news/admin-display'
import { PRESS_LEVEL_OPTIONS } from '@/lib/profile-edit'
import { deleteNewsItemAction, setNewsEnabledAction, setPressLevelAction } from './actions'

export const metadata: Metadata = { title: 'News desk' }
export const dynamic = 'force-dynamic'

const BADGE =
  'ml-2 border px-1.5 py-0.5 font-condensed text-[10px] font-bold uppercase tracking-[0.14em]'

/** Admin: switch the news desk, see spending, read and delete items, set press levels. */
export default async function AdminNewsPage() {
  await requireAdmin()
  const now = new Date()
  const [enabled, spent, items, levels] = await Promise.all([
    getNewsEnabled(),
    monthNewsSpendUsd(now),
    listAdminNewsItems(50),
    listMemberPressLevels(),
  ])
  const limit = monthlyLimitUsd(process.env['NEWS_MONTHLY_LIMIT_USD'])
  const testWaiting = items.filter((i) => i.isTest && i.deletedAt === null).length

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6">
      <AdminHeading title="News desk" />

      <AdminSection
        title="News desk on/off"
        description="Off: the desk writes nothing new. Items already posted stay on the site. Switching on skips the games, nights and weeks of the last 3 days, so the desk never writes about the time it was off."
      >
        <div className="flex flex-wrap items-center gap-4">
          <p className="text-sm text-fg-2">
            The news desk is{' '}
            <strong className={enabled ? 'text-fg-1' : 'text-accent-readable'}>
              {enabled ? 'ON' : 'OFF'}
            </strong>
            .
          </p>
          <form action={setNewsEnabledAction.bind(null, !enabled)}>
            <button
              type="submit"
              className={enabled ? ADMIN_SMALL_BUTTON : `${AUTH_BUTTON_PRIMARY} py-2.5`}
            >
              {enabled ? 'Switch off' : 'Switch on'}
            </button>
          </form>
        </div>
      </AdminSection>

      <AdminSection title="This month">
        <p className="text-sm text-fg-2">
          Spent <strong className="text-fg-1">${spent.toFixed(2)}</strong> of ${limit.toFixed(2)}{' '}
          this month (UTC). The desk stops writing about 50 cents before the limit.
        </p>
        {testWaiting > 0 && (
          <p className="text-sm text-fg-2">
            Test items waiting: <strong className="text-fg-1">{testWaiting}</strong>. They disappear
            when the service goes live.
          </p>
        )}
      </AdminSection>

      <AdminSection
        title="Recent items"
        description="The newest 50, with test and deleted items. Open an item to read all of it. Deleting hides an item (and its replies) from the site now and removes the Discord message on the next pass. A deleted item stays in the database."
      >
        {items.length === 0 ? (
          <p className="text-sm text-fg-4">Nothing written yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr>
                  <th className={ADMIN_TH}>Time</th>
                  <th className={ADMIN_TH}>Reporter</th>
                  <th className={ADMIN_TH}>Kind</th>
                  <th className={ADMIN_TH}>Discord</th>
                  <th className={ADMIN_TH}>Text</th>
                  <th className={ADMIN_TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const deleted = item.deletedAt !== null
                  const preview = itemPreview(item)
                  return (
                    <tr key={item.id} className={deleted ? 'opacity-50' : undefined}>
                      <td className={`${ADMIN_TD} whitespace-nowrap`}>
                        {formatClubDateTime(item.createdAt)}
                      </td>
                      <td className={ADMIN_TD}>{REPORTERS[item.reporter].name}</td>
                      <td className={ADMIN_TD}>
                        {item.kind === 'article' ? 'Article' : 'Post'}
                        {item.isTest && (
                          <span className={`${BADGE} border-accent-line text-accent-readable`}>
                            Test
                          </span>
                        )}
                        {deleted && (
                          <span className={`${BADGE} border-border text-fg-4`}>Deleted</span>
                        )}
                      </td>
                      <td className={ADMIN_TD}>{item.discordStatus}</td>
                      <td className={`${ADMIN_TD} max-w-[320px]`}>
                        <Link
                          prefetch
                          href={adminItemHref(item.id)}
                          className="text-fg-1 hover:underline"
                        >
                          {preview}
                        </Link>
                      </td>
                      <td className={`${ADMIN_TD} text-right`}>
                        {!deleted && (
                          <details>
                            <summary
                              className={`${ADMIN_SMALL_BUTTON} cursor-pointer list-none`}
                              aria-label={`Delete item ${String(item.id)}`}
                            >
                              Delete
                            </summary>
                            <form
                              action={deleteNewsItemAction.bind(null, item.id)}
                              className="mt-2 flex flex-col items-end gap-2"
                            >
                              <span className="text-xs text-fg-3">
                                Hide this item from the site and remove it from Discord?
                              </span>
                              <button type="submit" className={ADMIN_SMALL_BUTTON}>
                                Yes, hide it
                              </button>
                            </form>
                          </details>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </AdminSection>

      <AdminSection
        title="Press levels"
        description="How reporters may treat each player. Everyone starts at Full press. Players change their own on EDIT PROFILE; you can set any level here."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr>
                <th className={ADMIN_TH}>Player</th>
                <th className={ADMIN_TH}>Level</th>
                <th className={ADMIN_TH}>Set by</th>
              </tr>
            </thead>
            <tbody>
              {levels.map((p) => (
                <tr key={p.playerId}>
                  <td className={ADMIN_TD}>{p.name ?? p.gamertag}</td>
                  <td className={ADMIN_TD}>
                    <form action={setPressLevelAction} className="flex items-center gap-2">
                      <input type="hidden" name="playerId" value={p.playerId} />
                      <select
                        name="pressLevel"
                        defaultValue={p.pressLevel}
                        aria-label={`Press level for ${p.name ?? p.gamertag}`}
                        className={`${ADMIN_FIELD} min-w-[260px]`}
                      >
                        {PRESS_LEVEL_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className={ADMIN_SMALL_BUTTON}>
                        Save
                      </button>
                    </form>
                  </td>
                  <td className={ADMIN_TD}>{pressLevelSetByLabel(p.setBy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminSection>
    </div>
  )
}
