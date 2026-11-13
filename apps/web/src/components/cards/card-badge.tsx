import { BADGE_FAMILIES, BADGE_GROUPS } from '@eanhl/db/cards'
import type { BadgeLevelRef } from '@eanhl/db/cards'
import { Badge, resolveBadgeSkin } from '../badges/badge'
import { badgeCaption, badgeVisual } from '../badges/badge-board'

/**
 * A badge with its label underneath, as the card's footer slot and back-face
 * showcase draw it (Badge.dc.html: frame single, label below, glow on).
 */
export function CardBadge({
  badge,
  size,
  labelSize,
  labelColor,
  labelTracking = '0.16em',
}: {
  badge: BadgeLevelRef
  size: number
  labelSize: number
  labelColor?: string | undefined
  /** Label letter-spacing; the back face uses the prototype's tighter 0.06em so names fit. */
  labelTracking?: string
}) {
  const family = BADGE_FAMILIES.find((f) => f.id === badge.familyId)
  if (family === undefined) return null
  const shape = BADGE_GROUPS.find((g) => g.id === family.group)?.shape ?? 'hex'
  const look = badgeVisual(badge.level)
  return (
    <div
      title={`${family.name} · Level ${String(badge.level)}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      <Badge familyId={family.id} shape={shape} theme={look.theme} frame="single" size={size} />
      <span
        style={{
          fontSize: `${String(labelSize)}px`,
          fontWeight: 800,
          letterSpacing: labelTracking,
          color: labelColor ?? resolveBadgeSkin(look.theme).label,
          whiteSpace: 'nowrap',
          lineHeight: 1,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {badgeCaption(family.short, badge.level)}
      </span>
    </div>
  )
}
