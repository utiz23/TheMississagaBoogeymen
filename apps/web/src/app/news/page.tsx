import type { Metadata } from 'next'
import { listNewsFeed } from '@eanhl/db/queries'
import { LeadStory } from '@/components/news/lead-story'
import { MoreStories } from '@/components/news/more-stories'
import { TheWire } from '@/components/news/the-wire'
import { MemberLinks } from '@/components/ui/member-links'
import { loadFeedPage } from '@/lib/news/feed'
import { ARTICLE_PAGE_SIZE, POST_PAGE_SIZE, pageOf } from '@/lib/news/feed-shape'

export const metadata: Metadata = { title: 'Press Room — Club Stats' }

// A deleted story must vanish at once, so this page is never cached.
export const dynamic = 'force-dynamic'

export default async function NewsPage() {
  // The lead is the newest article; "More stories" starts right after it.
  // One extra row tells us whether there is a next page.
  const [articleRows, wire] = await Promise.all([
    listNewsFeed({ kind: 'article', beforeId: null, limit: ARTICLE_PAGE_SIZE + 2 }),
    loadFeedPage({ kind: 'post', before: null, pageSize: POST_PAGE_SIZE }),
  ])
  const lead = articleRows[0] ?? null
  const more = pageOf(articleRows.slice(1), ARTICLE_PAGE_SIZE)
  const empty = lead === null && wire.items.length === 0

  return (
    <MemberLinks>
      <div className="space-y-6">
        <header className="flex items-end justify-between gap-4 border-b-2 border-accent pb-3">
          <h1 className="font-condensed text-3xl font-black uppercase tracking-wide text-fg-1 sm:text-4xl">
            Press Room
          </h1>
          <p className="hidden text-right font-condensed text-xs uppercase tracking-widest text-fg-5 sm:block">
            The Boogeymen, as the media sees them
          </p>
        </header>

        {empty ? (
          <p className="py-12 text-center text-fg-3">
            The press room opens after the next game night.
          </p>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-8">
              {lead === null ? (
                <p className="text-fg-3">The first story comes after the next game night.</p>
              ) : (
                <LeadStory article={lead} />
              )}
              <MoreStories initialItems={more.items} initialBefore={more.nextBefore} />
            </div>
            <div className="min-w-0">
              <TheWire initialItems={wire.items} initialBefore={wire.nextBefore} />
            </div>
          </div>
        )}

        <p className="border-t border-border-subtle pt-3 text-xs text-fg-5">
          The reporters are made up. The scores and stats come from the real games.
        </p>
      </div>
    </MemberLinks>
  )
}
