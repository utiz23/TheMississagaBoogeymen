'use client'

import { useState } from 'react'
import { REPORTERS } from '@eanhl/db/news'
import { groupWire, type FeedItem, type FeedPage } from '@/lib/news/feed-shape'
import { NewsText } from './news-text'
import { ReporterAvatar } from './reporter-avatar'

function WirePost({ post, replyTo }: { post: FeedItem; replyTo: FeedItem | null }) {
  const reporter = REPORTERS[post.reporter]
  return (
    <li
      className={`flex gap-3 bg-surface p-3 ${post.replyTo !== null ? 'ml-6 border-l-2 border-accent' : ''}`}
    >
      <ReporterAvatar reporter={post.reporter} size="sm" />
      <div className="min-w-0 space-y-1">
        <p className="text-xs">
          <b className="text-fg-1">{reporter.name}</b>{' '}
          <span className="text-fg-5">
            · {reporter.outlet} · {post.dateLabel}
          </span>
        </p>
        {post.replyTo !== null && (
          <p className="text-[11px] text-fg-5">
            {replyTo === null
              ? 'replying to an earlier post'
              : `replying to ${REPORTERS[replyTo.reporter].name}`}
          </p>
        )}
        <p className="break-words text-sm text-fg-2">
          <NewsText text={post.body ?? ''} mentions={post.mentions} />
        </p>
      </div>
    </li>
  )
}

/**
 * The Wire: the short posts, newest first, replies indented under the post
 * they answer. Shows what the server sent; "Show older posts" fetches more.
 */
export function TheWire({
  initialItems,
  initialBefore,
}: {
  initialItems: FeedItem[]
  initialBefore: number | null
}) {
  const [items, setItems] = useState(initialItems)
  const [before, setBefore] = useState(initialBefore)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  async function showOlder() {
    if (loading || before === null) return
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`/news/feed?kind=post&before=${String(before)}`)
      if (!res.ok) throw new Error(String(res.status))
      const page = (await res.json()) as FeedPage
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id))
        return [...prev, ...page.items.filter((i) => !seen.has(i.id))]
      })
      setBefore(page.nextBefore)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  const byId = new Map(items.map((i) => [i.id, i]))

  return (
    <aside className="space-y-3 lg:border-l lg:border-border-subtle lg:pl-6">
      <div className="flex items-center justify-between">
        <p className="font-condensed text-sm font-black uppercase tracking-[0.22em] text-fg-1">
          The Wire
        </p>
        <span className="font-condensed text-[10px] uppercase tracking-widest text-fg-5">
          also on Discord
        </span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-fg-5">No posts yet.</p>
      ) : (
        <ol className="space-y-2">
          {groupWire(items).flatMap((thread) => [
            <WirePost key={thread.post.id} post={thread.post} replyTo={null} />,
            ...thread.replies.map((r) => (
              <WirePost key={r.id} post={r} replyTo={byId.get(r.replyTo ?? -1) ?? null} />
            )),
          ])}
        </ol>
      )}
      {before !== null && (
        <div className="text-center">
          <button
            type="button"
            onClick={() => void showOlder()}
            disabled={loading}
            className="border border-border px-4 py-2 font-condensed text-xs font-bold uppercase tracking-widest text-fg-3 hover:bg-surface hover:text-fg-1 disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Show older posts'}
          </button>
          {failed && (
            <p role="alert" className="mt-2 text-xs text-loss">
              Could not load older posts. Try again.
            </p>
          )}
        </div>
      )}
    </aside>
  )
}
