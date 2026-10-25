import type { NewsItemRow } from '@eanhl/db/queries'
import type { ReporterId } from '@eanhl/db/news'
import { dayKeyLabel, postTimeLabel } from './display.ts'

/** Page sizes of the feed (also used by the first page of /news). */
export const ARTICLE_PAGE_SIZE = 10
export const POST_PAGE_SIZE = 20

/**
 * What the pages and the `/news/feed` route send about one item. Dates are
 * already formatted in the club zone, so the browser formats nothing
 * (no hydration mismatch). Articles carry no body; posts carry their text.
 */
export interface FeedItem {
  id: number
  kind: 'article' | 'post'
  reporter: ReporterId
  slug: string | null
  headline: string | null
  dek: string | null
  /** Post text; null for articles. */
  body: string | null
  mentions: { name: string; playerId: number }[]
  replyTo: number | null
  dateLabel: string
}

export interface FeedPage {
  items: FeedItem[]
  /** Pass as `before` to get the next page; null when there is no more. */
  nextBefore: number | null
}

function articleDateLabel(row: NewsItemRow): string {
  if (row.night !== null) return dayKeyLabel(row.night)
  if (row.weekStart !== null) return `Week of ${dayKeyLabel(row.weekStart)}`
  return dayKeyLabel(row.createdAt.toISOString().slice(0, 10))
}

export function toFeedItem(row: NewsItemRow): FeedItem {
  const isPost = row.kind === 'post'
  return {
    id: row.id,
    kind: row.kind,
    reporter: row.reporter,
    slug: row.slug,
    headline: row.headline,
    dek: row.dek,
    body: isPost ? row.body : null,
    mentions: isPost ? row.mentions : [],
    replyTo: row.replyTo,
    dateLabel: isPost ? postTimeLabel(row.createdAt) : articleDateLabel(row),
  }
}

/**
 * Turn the rows of a query that asked for `pageSize + 1` into a page: the
 * extra row only proves there is more, and is not shown.
 */
export function pageOf(rows: NewsItemRow[], pageSize: number): FeedPage {
  const hasMore = rows.length > pageSize
  const shown = hasMore ? rows.slice(0, pageSize) : rows
  const last = shown[shown.length - 1]
  return {
    items: shown.map(toFeedItem),
    nextBefore: hasMore && last !== undefined ? last.id : null,
  }
}

export type FeedParams =
  | { ok: true; kind: 'article' | 'post'; before: number | null }
  | { ok: false }

/** Read `?kind=article|post&before=<id>`; anything else is a bad request. */
export function parseFeedParams(params: URLSearchParams): FeedParams {
  const kind = params.get('kind')
  if (kind !== 'article' && kind !== 'post') return { ok: false }
  const raw = params.get('before')
  if (raw === null) return { ok: true, kind, before: null }
  if (!/^[1-9]\d{0,14}$/.test(raw)) return { ok: false }
  return { ok: true, kind, before: Number(raw) }
}

export interface WireThread {
  post: FeedItem
  replies: FeedItem[]
}

/**
 * Group posts (newest first) for The Wire. A reply whose parent is in the list
 * goes under it, oldest reply first. A reply whose parent is not loaded stays
 * on its own at its place in the list.
 */
export function groupWire(posts: FeedItem[]): WireThread[] {
  const ids = new Set(posts.map((p) => p.id))
  const repliesOf = new Map<number, FeedItem[]>()
  for (const p of posts) {
    if (p.replyTo !== null && ids.has(p.replyTo)) {
      const list = repliesOf.get(p.replyTo) ?? []
      list.push(p)
      repliesOf.set(p.replyTo, list)
    }
  }
  const threads: WireThread[] = []
  for (const p of posts) {
    if (p.replyTo !== null && ids.has(p.replyTo)) continue
    const replies = (repliesOf.get(p.id) ?? []).sort((a, b) => a.id - b.id)
    threads.push({ post: p, replies })
  }
  return threads
}
