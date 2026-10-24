import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { BADGE_FAMILIES, BADGE_GROUPS } from '@eanhl/db/cards'
import { Badge } from '@/components/badges/badge'
import { badgeVisual } from '@/components/badges/badge-board'
import { PlayerCard } from '@/components/cards/player-card'
import { INTERNAL_TOKEN_HEADER, isInternalTokenValid } from '@/lib/discord/internal-token'
import { loadDiscordUnlock } from '@/lib/discord/load-unlock'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { robots: { index: false, follow: false } }

/**
 * One unlock's graphic on a transparent page, for the discord service to
 * screenshot (#discord-unlock only, omitBackground): the badge as the badge
 * board draws it (120 px, its theme and frame), or the full card. The site
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
  if (!loaded || loaded.data.graphic === 'none') notFound()

  let graphic: React.ReactNode
  if (loaded.badge) {
    const family = BADGE_FAMILIES.find((f) => f.id === loaded.badge?.familyId)
    if (!family) notFound()
    const look = badgeVisual(loaded.badge.level)
    const shape = BADGE_GROUPS.find((g) => g.id === family.group)?.shape ?? 'hex'
    graphic = (
      <Badge familyId={family.id} shape={shape} theme={look.theme} frame={look.frame} size={120} />
    )
  } else if (loaded.card) {
    graphic = <PlayerCard card={loaded.card} context="list" />
  } else {
    notFound()
  }

  return (
    <>
      <style>{`html, body { background: transparent !important; } header, footer, nav { display: none !important; }`}</style>
      <div style={{ position: 'fixed', top: 0, left: 0, zIndex: 2147483647 }}>
        <div id="discord-unlock" style={{ display: 'inline-flex', padding: loaded.badge ? 16 : 0 }}>
          {graphic}
        </div>
      </div>
    </>
  )
}
