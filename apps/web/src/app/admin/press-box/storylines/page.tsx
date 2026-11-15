import { requireAdmin } from '@/lib/auth'
import {
  PinnedPanel,
  StorylinesPanel,
  TakesEditor,
  TrendsPanel,
} from '@/components/press-box/storylines'
import { NOTICE_TEXT, noticeFromQuery } from '../box-actions'
import { loadStorylinesPage } from '../storylines-data'

/**
 * Press Box storylines and trends (design section 3.4): open storylines with each reporter's
 * stance, pin / unpin / close / new, trends from the data, the pinned angle the writers get and
 * the takes editor (moved here from /admin/news). Admin only; every change is checked and logged.
 */
export default async function PressBoxStorylinesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>
}) {
  await requireAdmin()
  const now = new Date()
  const [{ notice: noticeRaw }, d] = await Promise.all([searchParams, loadStorylinesPage(now)])
  const notice = noticeFromQuery(noticeRaw)
  const noticeOk = notice?.startsWith('sl_ok_') === true

  return (
    <div className="flex flex-col gap-5">
      {notice !== null && (
        <p
          role={noticeOk ? 'status' : 'alert'}
          className={`border px-4 py-3 text-sm ${noticeOk ? 'border-border text-fg-2' : 'border-accent-line text-accent-readable'}`}
        >
          {NOTICE_TEXT[notice]}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-condensed text-2xl font-bold uppercase tracking-[0.12em] text-fg-1">
          Storylines and trends
        </h2>
        <p className="text-xs text-fg-4">
          Reporter threads come from the stances the writers took. Pin one and the writers get it as
          a suggested angle. Every change is in the log on the Overview.
        </p>
      </div>
      <div className="flex flex-col items-start gap-6 xl:flex-row">
        <main className="flex w-full min-w-0 flex-1 flex-col gap-6">
          <StorylinesPanel
            open={d.board.open}
            closedCount={d.board.closedCount}
            ready={d.board.tableReady}
          />
          <TakesEditor takes={d.takes} roster={d.roster} />
        </main>
        <aside className="flex w-full flex-col gap-6 xl:w-[360px] xl:shrink-0">
          <TrendsPanel trends={d.trends} />
          <PinnedPanel pinned={d.pinned} />
        </aside>
      </div>
    </div>
  )
}
