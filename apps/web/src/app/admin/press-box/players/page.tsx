import Link from 'next/link'
import { listDossierIndex } from '@eanhl/db/queries'
import { DossierIndexTable } from '@/components/press-box/dossier'
import { requireAdmin } from '@/lib/auth'
import { NOTICE_TEXT, noticeFromQuery } from '../box-actions'

/** Press Box player dossiers, the index (design 3.2): every member and every bench person who talked to the press. Admin only. */
export default async function PressBoxPlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>
}) {
  await requireAdmin()
  const now = new Date()
  const [q, rows] = await Promise.all([searchParams, listDossierIndex(now)])
  const notice = noticeFromQuery(q.notice)
  const members = rows.filter((r) => r.role === 'player').length
  return (
    <div className="flex flex-col gap-5">
      {notice !== null && (
        <p role="status" className="border border-border px-4 py-3 text-sm text-fg-2">
          {NOTICE_TEXT[notice]}
        </p>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="font-condensed text-2xl font-bold uppercase tracking-[0.12em] text-fg-1">
          Player dossiers
        </h2>
        <p className="text-xs text-fg-4">
          {members} members, {rows.length - members} bench or coach · press level, how many
          reporters have a relationship, usable and joke answers, last scrum or interview, profile
          age ·{' '}
          <Link prefetch href="/admin/press-box/relationships" className="hover:text-fg-1">
            relationships board →
          </Link>
        </p>
      </div>
      <DossierIndexTable rows={rows} now={now} />
    </div>
  )
}
