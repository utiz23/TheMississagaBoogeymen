'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeedItem, FeedPage } from '@/lib/news/feed-shape'
import { StoryRow } from './story-row'

/**
 * "More stories": the rows the server sent, then more as the reader scrolls
 * (an IntersectionObserver on a sentinel under the list) or taps the button.
 * It stops when the server says there is no more (`nextBefore` null).
 */
export function MoreStories({
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
  const busy = useRef(false)
  const sentinel = useRef<HTMLDivElement | null>(null)

  const loadMore = useCallback(async () => {
    if (busy.current || before === null) return
    busy.current = true
    setLoading(true)
    setFailed(false)
    try {
      const res = await fetch(`/news/feed?kind=article&before=${String(before)}`)
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
      busy.current = false
      setLoading(false)
    }
  }, [before])

  useEffect(() => {
    const el = sentinel.current
    if (el === null || before === null || failed) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore()
      },
      { rootMargin: '400px 0px' },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [before, failed, loadMore])

  if (items.length === 0) return null

  return (
    <section className="space-y-3">
      <p className="font-condensed text-xs font-semibold uppercase tracking-[0.28em] text-fg-4">
        More stories
      </p>
      <div className="divide-y divide-border-subtle border-y border-border-subtle">
        {items.map((item) => (
          <StoryRow key={item.id} item={item} />
        ))}
      </div>
      {before !== null && (
        <div ref={sentinel} className="py-2 text-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loading}
            className="border border-border px-4 py-2 font-condensed text-xs font-bold uppercase tracking-widest text-fg-3 hover:bg-surface hover:text-fg-1 disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Load more stories'}
          </button>
          {failed && (
            <p role="alert" className="mt-2 text-xs text-loss">
              Could not load more stories. Try again.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
