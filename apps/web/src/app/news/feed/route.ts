import { NextResponse } from 'next/server'
import { loadFeedPage } from '@/lib/news/feed'
import { ARTICLE_PAGE_SIZE, POST_PAGE_SIZE, parseFeedParams } from '@/lib/news/feed-shape'

export const dynamic = 'force-dynamic'

/**
 * Next page of the public news feed: `?kind=article|post&before=<id>`.
 * Articles and posts come 10 at a time. Bad parameters get 400.
 */
export async function GET(request: Request): Promise<Response> {
  const params = parseFeedParams(new URL(request.url).searchParams)
  if (!params.ok) {
    return NextResponse.json(
      { error: 'kind must be article or post; before must be a positive whole number' },
      { status: 400, headers: { 'cache-control': 'no-store' } },
    )
  }
  const page = await loadFeedPage({
    kind: params.kind,
    before: params.before,
    pageSize: params.kind === 'article' ? ARTICLE_PAGE_SIZE : POST_PAGE_SIZE,
  })
  return NextResponse.json(page, { headers: { 'cache-control': 'no-store' } })
}
