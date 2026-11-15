import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'
import {
  CharacterEditor,
  LockedRules,
  PreviewPanel,
  RecordStrip,
  ReporterHeader,
  ReporterRail,
} from '@/components/press-box/reporters'
import { NOTICE_TEXT, noticeFromQuery } from '../../box-actions'
import { loadReporterPage } from '../../reporters-reads'

/**
 * One reporter (design section 3.5): record, character editor, locked rules, sample line. Admin
 * only (the layout and this page both check). The record is counts only.
 */
export default async function PressBoxReporterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ notice?: string }>
}) {
  await requireAdmin()
  const [{ id }, { notice: noticeRaw }] = await Promise.all([params, searchParams])
  const page = await loadReporterPage(id, new Date())
  if (page === null) notFound()
  const notice = noticeFromQuery(noticeRaw)
  const noticeOk = notice?.startsWith('rp_ok_') === true

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-fg-4">
        <Link prefetch href="/admin/press-box/reporters" className="hover:text-fg-1">
          ← All reporters
        </Link>
      </p>
      {notice !== null && (
        <p
          role={noticeOk ? 'status' : 'alert'}
          className={`border px-4 py-3 text-sm ${noticeOk ? 'border-border text-fg-2' : 'border-accent-line text-accent-readable'}`}
        >
          {NOTICE_TEXT[notice]}
        </p>
      )}
      <div className="flex flex-col items-start gap-6 xl:flex-row">
        <ReporterRail rail={page.rail} current={page.id} />
        <main className="flex w-full min-w-0 flex-1 flex-col gap-6">
          <ReporterHeader page={page} />
          <RecordStrip record={page.record} />
          <CharacterEditor page={page} />
          <PreviewPanel page={page} />
          <LockedRules />
        </main>
      </div>
    </div>
  )
}
