import { NextResponse } from 'next/server'
import { INTERNAL_TOKEN_HEADER, isInternalTokenValid } from '@/lib/discord/internal-token'
import { isNightKey } from '@/lib/news/build-facts'
import { loadNightFacts } from '@/lib/news/load-facts'

export const dynamic = 'force-dynamic'

const notFound = () => new NextResponse('Not Found', { status: 404 })

/** News fact sheet for one night (YYYY-MM-DD). Internal: 404 without the service token. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ night: string }> },
): Promise<Response> {
  if (
    !isInternalTokenValid(
      request.headers.get(INTERNAL_TOKEN_HEADER),
      process.env['DISCORD_INTERNAL_TOKEN'],
    )
  ) {
    return notFound()
  }
  const { night } = await params
  if (!isNightKey(night)) return notFound()
  const sheet = await loadNightFacts(night)
  if (!sheet) return notFound()
  return NextResponse.json(sheet, { headers: { 'cache-control': 'no-store' } })
}
