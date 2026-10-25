import Link from 'next/link'
import { REPORTERS } from '@eanhl/db/news'
import { KICKERS } from '@/lib/news/display'
import type { FeedItem } from '@/lib/news/feed-shape'
import { Kicker } from './kicker'
import { ReporterAvatar } from './reporter-avatar'

/** One wide row of "More stories": avatar, kicker, headline, dek; date and byline right (phones: below). */
export function StoryRow({ item }: { item: FeedItem }) {
  const reporter = REPORTERS[item.reporter]
  const byline = `${reporter.name}, ${reporter.outlet}`
  const row = (
    <>
      <ReporterAvatar reporter={item.reporter} />
      <div className="min-w-0 flex-1 space-y-1">
        <Kicker>{KICKERS[item.reporter]}</Kicker>
        <h3 className="font-condensed text-xl font-bold leading-snug text-fg-1">{item.headline}</h3>
        {item.dek !== null && <p className="text-sm text-fg-3">{item.dek}</p>}
        <p className="text-xs text-fg-5 sm:hidden">
          {byline} · {item.dateLabel}
        </p>
      </div>
      <div className="hidden w-44 shrink-0 text-right sm:block">
        <p className="font-condensed text-sm font-bold uppercase tracking-wider text-fg-2">
          {item.dateLabel}
        </p>
        <p className="text-xs text-fg-5">{byline}</p>
      </div>
    </>
  )
  const cls = 'flex items-start gap-4 py-4 hover:bg-surface sm:items-center'
  return (
    <article>
      {item.slug === null ? (
        <div className={cls}>{row}</div>
      ) : (
        <Link prefetch href={`/news/${item.slug}`} className={cls}>
          {row}
        </Link>
      )}
    </article>
  )
}
