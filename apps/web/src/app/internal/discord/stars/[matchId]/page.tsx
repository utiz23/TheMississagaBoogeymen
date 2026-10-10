import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { PlayerCard } from '@/components/cards/player-card'
import { INTERNAL_TOKEN_HEADER, isInternalTokenValid } from '@/lib/discord/internal-token'
import { loadDiscordGameResult } from '@/lib/discord/load-game-result'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

/**
 * The member stars' cards side by side, for the discord service to
 * screenshot (#discord-stars only). Pinned over the site chrome so the
 * element screenshot never catches the nav. Internal: 404 without the token.
 */
export default async function DiscordStarsPage({
  params,
}: {
  params: Promise<{ matchId: string }>
}) {
  const h = await headers()
  if (!isInternalTokenValid(h.get(INTERNAL_TOKEN_HEADER), process.env['DISCORD_INTERNAL_TOKEN'])) {
    notFound()
  }
  const { matchId } = await params
  const id = Number.parseInt(matchId, 10)
  if (!Number.isSafeInteger(id) || id <= 0) notFound()
  const loaded = await loadDiscordGameResult(id)
  if (!loaded || loaded.cards.length === 0) notFound()

  // A full-viewport backdrop over the site chrome: the footer sits right
  // under the strip, and without it the screenshot caught its top edge.
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        background: 'var(--color-background)',
      }}
    >
      <div id="discord-stars" style={{ display: 'inline-flex', gap: 16, padding: 16 }}>
        {loaded.cards.map((card) => (
          <PlayerCard key={card.front.playerId} card={card} context="list" />
        ))}
      </div>
    </div>
  )
}
