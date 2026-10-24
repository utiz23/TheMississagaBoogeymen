import { NextResponse } from 'next/server'
import { INTERNAL_TOKEN_HEADER, isInternalTokenValid } from '@/lib/discord/internal-token'
import { loadDiscordUnlock } from '@/lib/discord/load-unlock'

export const dynamic = 'force-dynamic'

const notFound = () => new NextResponse('Not Found', { status: 404 })

/**
 * Discord message data for one unlock. 404 without the service token, and
 * when the unlock doesn't count any more (the poster then skips it).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  if (
    !isInternalTokenValid(
      request.headers.get(INTERNAL_TOKEN_HEADER),
      process.env['DISCORD_INTERNAL_TOKEN'],
    )
  ) {
    return notFound()
  }
  const { eventId } = await params
  const id = Number.parseInt(eventId, 10)
  if (!Number.isSafeInteger(id) || id <= 0) return notFound()
  const loaded = await loadDiscordUnlock(id)
  if (!loaded) return notFound()
  return NextResponse.json(loaded.data, { headers: { 'cache-control': 'no-store' } })
}
