import { NextResponse } from 'next/server'
import { INTERNAL_TOKEN_HEADER, isInternalTokenValid } from '@/lib/discord/internal-token'
import { loadDiscordGameResult } from '@/lib/discord/load-game-result'

export const dynamic = 'force-dynamic'

const notFound = () => new NextResponse('Not Found', { status: 404 })

/** Discord post data for one game. Internal: 404 without the service token. */
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
  const id = Number.parseInt(matchId, 10)
  if (!Number.isSafeInteger(id) || id <= 0) return notFound()
  const loaded = await loadDiscordGameResult(id)
  if (!loaded) return notFound()
  return NextResponse.json(loaded.result, { headers: { 'cache-control': 'no-store' } })
}
