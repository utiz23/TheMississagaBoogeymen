import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { PlayerCard } from '@/components/cards/player-card'
import { INTERNAL_TOKEN_HEADER, isInternalTokenValid } from '@/lib/discord/internal-token'
import { loadDiscordUnlock } from '@/lib/discord/load-unlock'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

/**
 * One unlock's graphic on a transparent page, for the discord service to
 * screenshot (#discord-unlock only, omitBackground): the full card. The site
 * chrome is hidden so nothing shows behind it. Internal: 404 without the token.
 */
export default async function DiscordUnlockPage({
  params,
}: {
  params: Promise<{ eventId: string }>
}) {
  const h = await headers()
  if (!isInternalTokenValid(h.get(INTERNAL_TOKEN_HEADER), process.env['DISCORD_INTERNAL_TOKEN'])) {
    notFound()
  }
  const { eventId } = await params
  const id = Number.parseInt(eventId, 10)
  if (!Number.isSafeInteger(id) || id <= 0) notFound()
  const loaded = await loadDiscordUnlock(id)
  if (!loaded || loaded.data.graphic === 'none' || !loaded.card) notFound()

  return (
    <>
      <style>{`html, body { background: transparent !important; } header, footer, nav { display: none !important; }`}</style>
      <div style={{ position: 'fixed', top: 0, left: 0, zIndex: 2147483647 }}>
        <div id="discord-unlock" style={{ display: 'inline-flex' }}>
          <PlayerCard card={loaded.card} context="list" />
        </div>
      </div>
    </>
  )
}
