import { requireAdmin } from '@/lib/auth'
import { ReportersGrid } from '@/components/press-box/reporters'
import { NOTICE_TEXT, noticeFromQuery } from '../box-actions'
import { loadReportersList } from '../reporters-reads'

/**
 * Press Box reporters (design section 3.5): the nine reporters with the on/off state, whether the
 * character was edited (and its version), posts this month and feuds. Open one to edit the
 * character. Admin only.
 */
export default async function PressBoxReportersPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>
}) {
  await requireAdmin()
  const [{ notice: noticeRaw }, d] = await Promise.all([
    searchParams,
    loadReportersList(new Date()),
  ])
  const notice = noticeFromQuery(noticeRaw)

  return (
    <div className="flex flex-col gap-5">
      {notice !== null && (
        <p role="alert" className="border border-border px-4 py-3 text-sm text-fg-2">
          {NOTICE_TEXT[notice]}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-condensed text-2xl font-bold uppercase tracking-[0.12em] text-fg-1">
          Reporters
        </h2>
        <p className="text-xs text-fg-4">
          Each reporter&rsquo;s character is code. Edits on a reporter&rsquo;s page are saved over
          the code and the writers read them. The on/off switch is the one of the news desk.
        </p>
      </div>
      <ReportersGrid rows={d.rows} ready={d.ready} />
    </div>
  )
}
