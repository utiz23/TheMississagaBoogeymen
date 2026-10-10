import type { Metadata } from 'next'
import { listTitlesForAdmin } from '@eanhl/db/queries'
import { ADMIN_TD, ADMIN_TH, AdminHeading, AdminSection } from '@/components/admin/admin-section'
import { requireAdmin } from '@/lib/auth'

export const metadata: Metadata = { title: 'Game titles' }
export const dynamic = 'force-dynamic'

/**
 * Read-only view of each game title's controls (admin-tools plan, C1). These
 * stay a written procedure: re-enabling NHL 26 collection would ingest another
 * club's games, and a wrong club name makes the worker refuse every match.
 */
export default async function AdminTitlesPage() {
  await requireAdmin()
  const titles = await listTitlesForAdmin()

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6">
      <AdminHeading title="Game titles" />
      <AdminSection
        title="Settings (view only)"
        description={
          <>
            <p>
              <strong className="text-fg-1">Collecting</strong> = the worker fetches new games for
              that title. <strong className="text-fg-1">Default</strong> = what visitors see first.
              Changes are made by hand on the server (see <code>HANDOFF.md</code>), never here.
            </p>
            <p className="mt-2 text-accent-readable">
              Never turn collection back on for NHL 26: club 19224 belongs to another club there
              since 2026-09-07.
            </p>
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr>
                <th className={ADMIN_TH}>Title</th>
                <th className={ADMIN_TH}>Collecting</th>
                <th className={ADMIN_TH}>Default</th>
                <th className={ADMIN_TH}>Order</th>
                <th className={ADMIN_TH}>EA club name</th>
                <th className={`${ADMIN_TH} text-right`}>Games</th>
              </tr>
            </thead>
            <tbody>
              {titles.map((t) => (
                <tr key={t.id}>
                  <td className={ADMIN_TD}>
                    <span className="text-fg-1">{t.name}</span>{' '}
                    <span className="text-fg-5">({t.slug})</span>
                  </td>
                  <td className={ADMIN_TD}>{t.isActive ? 'Yes' : 'No'}</td>
                  <td className={ADMIN_TD}>{t.isDefault ? 'Yes' : '—'}</td>
                  <td className={ADMIN_TD}>{t.releaseOrder ?? '—'}</td>
                  <td className={ADMIN_TD}>{t.eaClubName ?? '—'}</td>
                  <td className={`${ADMIN_TD} text-right tabular-nums`}>{t.matches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminSection>
    </div>
  )
}
