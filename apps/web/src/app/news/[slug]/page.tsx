import { cache } from 'react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getNewsArticle } from '@eanhl/db/queries'
import { REPORTERS } from '@eanhl/db/news'
import {
  KICKERS,
  dayKeyLabelWithWeekday,
  readMinutes,
  scoreChips,
  splitParagraphs,
} from '@/lib/news/display'
import { Kicker } from '@/components/news/kicker'
import { NewsText } from '@/components/news/news-text'
import { ReporterAvatar } from '@/components/news/reporter-avatar'
import { ScoreChips } from '@/components/news/score-chips'
import { MemberLinks } from '@/components/ui/member-links'

// A deleted story must vanish at once, so this page is never cached.
export const dynamic = 'force-dynamic'

const loadArticle = cache((slug: string) => getNewsArticle(slug))

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const article = await loadArticle(slug)
  if (article === null) return { title: 'Press Room — Club Stats' }
  return {
    title: `${article.headline ?? 'Story'} — Press Room`,
    description: article.dek ?? undefined,
  }
}

export default async function NewsArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = await loadArticle(slug)
  if (article === null) notFound()

  const reporter = REPORTERS[article.reporter]
  const paragraphs = splitParagraphs(article.body)
  const when = article.night !== null ? ` · ${dayKeyLabelWithWeekday(article.night)}` : ''

  return (
    <MemberLinks>
      <article className="mx-auto max-w-3xl space-y-4">
        <Link
          prefetch
          href="/news"
          className="font-condensed text-xs font-bold uppercase tracking-widest text-fg-4 hover:text-fg-1"
        >
          ← Press Room
        </Link>
        <Kicker>
          {KICKERS[article.reporter]}
          {when}
        </Kicker>
        <h1 className="break-words font-condensed text-3xl font-black leading-tight text-fg-1 sm:text-5xl">
          {article.headline}
        </h1>
        {article.dek !== null && <p className="break-words text-lg text-fg-2">{article.dek}</p>}
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
        <div className="space-y-4 border-t border-border-subtle pt-4 text-fg-2">
          {paragraphs.map((p, i) => (
            <p key={i} className="break-words leading-relaxed">
              <NewsText text={p} mentions={article.mentions} />
            </p>
          ))}
        </div>
        <p className="border-t border-border-subtle pt-3 text-xs text-fg-5">
          {reporter.name} is made up. The scores and stats come from the real games.
        </p>
      </article>
    </MemberLinks>
  )
}
