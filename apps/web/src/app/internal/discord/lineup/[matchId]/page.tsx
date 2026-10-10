import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { PlayerCard } from '@/components/cards/player-card'
import { INTERNAL_TOKEN_HEADER, isInternalTokenValid } from '@/lib/discord/internal-token'
import { loadDiscordGameResult } from '@/lib/discord/load-game-result'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

/**
 * BGM's lineup for one game — every player on their card with this game's
 * stats, two rows (6s: LW C RW / LD G RD · 3s: W C / D G) — for the discord
 * service to screenshot (#discord-lineup only). A full-viewport backdrop
 * covers the site chrome. Internal: 404 without the token.
 */
export default async function DiscordLineupPage({
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
  if (!loaded || loaded.result.lineupCardCount === 0) notFound()

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
        id="discord-lineup"
        style={{
          display: 'inline-grid',
          gridTemplateColumns: `repeat(${String(loaded.columns)}, 264px)`,
          gap: 16,
          padding: 16,
        }}
      >
        {loaded.lineup.map((slot) =>
          slot.card ? (
            <PlayerCard key={slot.position} card={slot.card} context="list" />
          ) : (
            <div
              key={slot.position}
              style={{
                border: '1px dashed var(--color-border)',
                borderRadius: 16,
                minHeight: 421,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-fg-4, #7a7778)',
                letterSpacing: '0.2em',
                fontWeight: 700,
              }}
            >
              {slot.label}
            </div>
          ),
        )}
      </div>
    </div>
  )
}
