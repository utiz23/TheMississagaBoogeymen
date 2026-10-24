import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { PlayerCardCompact } from '@/components/cards/player-card-compact'
import { INTERNAL_TOKEN_HEADER, isInternalTokenValid } from '@/lib/discord/internal-token'
import { loadDiscordCardUpdates } from '@/lib/discord/load-card-updates'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

/**
 * One batch of card changes — each changed teammate's current compact card,
 * their changes captioned underneath, up to 3 per row — for the discord
 * service to screenshot (#discord-card-updates only). A full-viewport
 * backdrop covers the site chrome. Internal: 404 without the token.
 */
export default async function DiscordCardUpdatesPage({
  params,
}: {
  params: Promise<{ batchEventId: string }>
}) {
  const h = await headers()
  if (!isInternalTokenValid(h.get(INTERNAL_TOKEN_HEADER), process.env['DISCORD_INTERNAL_TOKEN'])) {
    notFound()
  }
  const { batchEventId } = await params
  const id = Number.parseInt(batchEventId, 10)
  if (!Number.isSafeInteger(id) || id <= 0) notFound()
  const loaded = await loadDiscordCardUpdates(id)
  if (!loaded || loaded.cards.length === 0) notFound()

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483647,
        background: 'var(--color-background)',
      }}
    >
      <div
        id="discord-card-updates"
        style={{
          display: 'inline-grid',
          gridTemplateColumns: `repeat(${String(Math.min(3, loaded.cards.length))}, ${String(CARD_W)}px)`,
          gap: 12,
          padding: 12,
        }}
      >
        {loaded.cards.map((c) => (
          <div key={c.playerId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <PlayerCardCompact card={c.card.front} size="medium" />
            <div
              style={{
                width: CARD_W,
                textAlign: 'center',
                fontSize: 13,
                fontWeight: 700,
                lineHeight: 1.3,
                color: 'var(--color-fg-2, #d6d3d4)',
              }}
            >
              {c.caption}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Compact "medium" card width (player-card-compact.css). */
const CARD_W = 176
