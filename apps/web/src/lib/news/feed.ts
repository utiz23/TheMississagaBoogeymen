import { listNewsFeed } from '@eanhl/db/queries'
import { pageOf, type FeedPage } from './feed-shape.ts'

/** One page of the public feed (test and deleted items are filtered in SQL). */
export async function loadFeedPage(args: {
  kind: 'article' | 'post'
  before: number | null
  pageSize: number
}): Promise<FeedPage> {
  const rows = await listNewsFeed({
    kind: args.kind,
    beforeId: args.before,
    limit: args.pageSize + 1,
  })
  return pageOf(rows, args.pageSize)
}
