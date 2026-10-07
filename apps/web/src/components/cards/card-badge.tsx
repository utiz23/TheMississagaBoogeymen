import { BADGE_FAMILIES, BADGE_GROUPS } from '@eanhl/db/cards'
import type { BadgeLevelRef } from '@eanhl/db/cards'
import { Badge, resolveBadgeSkin } from '../badges/badge'
import { badgeVisual } from '../badges/badge-board'

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'] as const

/**
 * A badge with its label underneath, as the card's footer slot and back-face
 * showcase draw it (Badge.dc.html: frame single, label below, glow on).
 */
export function CardBadge({
  badge,
  size,
  labelSize,
  labelColor,
}: {
  badge: BadgeLevelRef
  size: number
  labelSize: number
  labelColor?: string | undefined
}) {
  const family = BADGE_FAMILIES.find((f) => f.id === badge.familyId)
  if (family === undefined) return null
  const shape = BADGE_GROUPS.find((g) => g.id === family.group)?.shape ?? 'hex'
  const look = badgeVisual(badge.level)
  const roman = ROMAN[Math.min(6, Math.max(1, Math.ceil(badge.level / 5))) - 1] ?? 'I'
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
          letterSpacing: '0.16em',
          color: labelColor ?? resolveBadgeSkin(look.theme).label,
          whiteSpace: 'nowrap',
          lineHeight: 1,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {family.short} {roman}
      </span>
    </div>
  )
}
