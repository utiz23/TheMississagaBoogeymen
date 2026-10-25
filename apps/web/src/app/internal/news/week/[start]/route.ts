import { NextResponse } from 'next/server'
import { INTERNAL_TOKEN_HEADER, isInternalTokenValid } from '@/lib/discord/internal-token'
import { isWeekStartKey } from '@/lib/news/build-facts'
import { loadWeekFacts } from '@/lib/news/load-facts'

export const dynamic = 'force-dynamic'

const notFound = () => new NextResponse('Not Found', { status: 404 })

/** News fact sheet for the week that starts on Monday `start` (YYYY-MM-DD). Internal: 404 without the service token. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ start: string }> },
): Promise<Response> {
  if (
    !isInternalTokenValid(
      request.headers.get(INTERNAL_TOKEN_HEADER),
      process.env['DISCORD_INTERNAL_TOKEN'],
    )
  ) {
    return notFound()
  }
  const { start } = await params
  if (!isWeekStartKey(start)) return notFound()
  const sheet = await loadWeekFacts(start)
  if (!sheet) return notFound()
  return NextResponse.json(sheet, { headers: { 'cache-control': 'no-store' } })
}
