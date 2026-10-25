import { NextResponse } from 'next/server'
import { INTERNAL_TOKEN_HEADER, isInternalTokenValid } from '@/lib/discord/internal-token'
import { loadGameFacts } from '@/lib/news/load-facts'

export const dynamic = 'force-dynamic'

const notFound = () => new NextResponse('Not Found', { status: 404 })

/** News fact sheet for one game. Internal: 404 without the service token. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ matchId: string }> },
): Promise<Response> {
  if (
    !isInternalTokenValid(
      request.headers.get(INTERNAL_TOKEN_HEADER),
      process.env['DISCORD_INTERNAL_TOKEN'],
    )
  ) {
    return notFound()
  }
  const { matchId } = await params
  if (!/^\d+$/.test(matchId)) return notFound()
  const id = Number.parseInt(matchId, 10)
  if (!Number.isSafeInteger(id) || id <= 0) return notFound()
  const sheet = await loadGameFacts(id)
  if (!sheet) return notFound()
  return NextResponse.json(sheet, { headers: { 'cache-control': 'no-store' } })
}
