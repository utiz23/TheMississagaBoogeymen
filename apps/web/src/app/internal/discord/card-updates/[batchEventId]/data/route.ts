import { NextResponse } from 'next/server'
import { INTERNAL_TOKEN_HEADER, isInternalTokenValid } from '@/lib/discord/internal-token'
import { loadDiscordCardUpdates } from '@/lib/discord/load-card-updates'

export const dynamic = 'force-dynamic'

const notFound = () => new NextResponse('Not Found', { status: 404 })

/** Discord card-update data for one batch. Internal: 404 without the service token. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ batchEventId: string }> },
): Promise<Response> {
  if (
    !isInternalTokenValid(
      request.headers.get(INTERNAL_TOKEN_HEADER),
      process.env['DISCORD_INTERNAL_TOKEN'],
    )
  ) {
    return notFound()
  }
  const { batchEventId } = await params
  const id = Number.parseInt(batchEventId, 10)
  if (!Number.isSafeInteger(id) || id <= 0) return notFound()
  const loaded = await loadDiscordCardUpdates(id)
  if (!loaded) return notFound()
  return NextResponse.json(loaded.data, { headers: { 'cache-control': 'no-store' } })
}
