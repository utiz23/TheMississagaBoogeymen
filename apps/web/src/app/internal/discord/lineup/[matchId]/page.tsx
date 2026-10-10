import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { PlayerCardCompact } from '@/components/cards/player-card-compact'
import { INTERNAL_TOKEN_HEADER, isInternalTokenValid } from '@/lib/discord/internal-token'
import { loadDiscordGameResult } from '@/lib/discord/load-game-result'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

/**
 * BGM's lineup for one game — every player on their compact card with this
 * game's stats (game score + star tag captioned underneath), two rows (6s: LW C RW / LD G RD · 3s: W C / D G) — for the discord
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
          gridTemplateColumns: `repeat(${String(loaded.columns)}, ${String(CARD_W)}px)`,
          gap: 12,
          padding: 12,
        }}
      >
        {loaded.lineup.map((slot) => (
          <div key={slot.position} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {slot.card ? (
              <PlayerCardCompact card={slot.card.front} size="medium" />
            ) : (
              <div
                style={{
                  width: CARD_W,
                  height: CARD_H,
                  border: '1px dashed var(--color-border)',
                  borderRadius: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  color: 'var(--color-fg-4, #7a7778)',
                  letterSpacing: '0.15em',
                  fontWeight: 700,
                  fontSize: 13,
                }}
              >
                {slot.label}
              </div>
            )}
            <div
              style={{
                height: 18,
                textAlign: 'center',
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: '0.04em',
                color: 'var(--color-fg-2, #d6d3d4)',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {slot.card ? caption(slot.card.front.record, slot.card.front.winPct) : ''}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Compact "medium" card size (player-card-compact.css). */
const CARD_W = 176
const CARD_H = 252

/** "GS 17.53 · ⭐ 2nd" — the compact card has no slot for the game score or star. */
function caption(gameScore: string, star: string): string {
  return [gameScore, star].filter((x) => x !== '').join(' · ')
}
