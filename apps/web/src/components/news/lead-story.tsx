import Link from 'next/link'
import type { NewsItemRow } from '@eanhl/db/queries'
import { REPORTERS } from '@eanhl/db/news'
import {
  KICKERS,
  dayKeyLabelWithWeekday,
  readMinutes,
  scoreChips,
  splitParagraphs,
} from '@/lib/news/display'
import { Kicker } from './kicker'
import { NewsText } from './news-text'
import { ReporterAvatar } from './reporter-avatar'
import { ScoreChips } from './score-chips'

const LEAD_PARAGRAPHS = 3

/** The newest article, big: headline, dek, byline, the night's scores and the first paragraphs. */
export function LeadStory({ article }: { article: NewsItemRow }) {
  const reporter = REPORTERS[article.reporter]
  const paragraphs = splitParagraphs(article.body)
  const when = article.night !== null ? ` · ${dayKeyLabelWithWeekday(article.night)}` : ''
  const href = article.slug === null ? null : `/news/${article.slug}`
  const headline = (
    <h2 className="font-condensed text-3xl font-black leading-tight text-fg-1 sm:text-5xl">
      {article.headline}
    </h2>
  )
  return (
    <article className="space-y-4">
      <Kicker>
        {KICKERS[article.reporter]}
        {when}
      </Kicker>
      {href === null ? (
        headline
      ) : (
        <Link prefetch href={href} className="block hover:text-accent-readable">
          {headline}
        </Link>
      )}
      {article.dek !== null && <p className="text-lg text-fg-2">{article.dek}</p>}
      <div className="flex items-center gap-3">
        <ReporterAvatar reporter={article.reporter} />
        <p className="text-sm text-fg-3">
          <Link
            prefetch
            href={`/news/reporters/${reporter.slug}`}
            className="hover:text-fg-1 hover:underline"
          >
            {reporter.byline}
          </Link>{' '}
          · {readMinutes(article.body)} min read
        </p>
      </div>
      <ScoreChips chips={scoreChips(article.facts)} />
      <div className="space-y-3 border-t border-border-subtle pt-4 text-fg-2">
        {paragraphs.slice(0, LEAD_PARAGRAPHS).map((p, i) => (
          <p key={i}>
            <NewsText text={p} mentions={article.mentions} />
          </p>
        ))}
        {href !== null && (
          <p>
            <Link
              prefetch
              href={href}
              className="font-condensed text-sm font-bold uppercase tracking-widest text-accent-readable hover:underline"
            >
              Read the full story →
            </Link>
          </p>
        )}
      </div>
    </article>
  )
}
