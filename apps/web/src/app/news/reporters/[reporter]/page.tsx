import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { listReporterArticles } from '@eanhl/db/queries'
import { reporterBySlug } from '@eanhl/db/news'
import { ReporterAvatar } from '@/components/news/reporter-avatar'
import { StoryRow } from '@/components/news/story-row'
import { toFeedItem } from '@/lib/news/feed-shape'

// A deleted story must vanish at once, so this page is never cached.
export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ reporter: string }>
}): Promise<Metadata> {
  const { reporter: slug } = await params
  const reporter = reporterBySlug(slug)
  return { title: `${reporter?.name ?? 'Reporter'} — Press Room` }
}

export default async function ReporterPage({ params }: { params: Promise<{ reporter: string }> }) {
  const { reporter: slug } = await params
  const reporter = reporterBySlug(slug)
  if (reporter === null) notFound()

  const articles = (await listReporterArticles(reporter.id)).map(toFeedItem)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        prefetch
        href="/news"
        className="font-condensed text-xs font-bold uppercase tracking-widest text-fg-4 hover:text-fg-1"
      >
        ← Press Room
      </Link>
      <header className="flex items-start gap-4 border-b-2 border-accent pb-4">
        <ReporterAvatar reporter={reporter.id} size="lg" />
        <div className="min-w-0 space-y-2">
          <h1 className="font-condensed text-3xl font-black uppercase tracking-wide text-fg-1 sm:text-4xl">
            {reporter.name}
          </h1>
          <p className="font-condensed text-xs font-bold uppercase tracking-[0.22em] text-accent-readable">
            {reporter.outlet}
          </p>
          <p className="text-fg-2">{reporter.bio}</p>
        </div>
      </header>

      <section className="space-y-3">
        <p className="font-condensed text-xs font-semibold uppercase tracking-[0.28em] text-fg-4">
          Stories
        </p>
        {articles.length === 0 ? (
          <p className="text-fg-3">No stories yet.</p>
        ) : (
          <div className="divide-y divide-border-subtle border-y border-border-subtle">
            {articles.map((item) => (
              <StoryRow key={item.id} item={item} />
            ))}
          </div>
        )}
      </section>
      <p className="border-t border-border-subtle pt-3 text-xs text-fg-5">
        {reporter.name} is made up. The scores and stats come from the real games.
      </p>
    </div>
  )
}
