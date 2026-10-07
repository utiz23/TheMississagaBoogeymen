import type { CSSProperties } from 'react'
import type { BadgeFamilyId, BadgeShapeId, CardThemeKey } from '@eanhl/db/cards'
import { BADGE_SHAPES } from './badge-shapes'
import { BADGE_BASE_SKIN, BADGE_SKINS, type BadgeSkin } from './badge-skins'
import { computeBadgeLayout } from './badge-layout'
import { BADGE_GLYPHS } from './badge-glyphs'
import type { BadgeFrame } from './badge-board'
import './badge.css'

const BEVEL =
  'linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0.04) 46%, transparent 50%, rgba(0,0,0,0.28))'

const px = (n: number): string => `${String(Math.round(n * 10) / 10)}px`

/** Player Badges merges each theme's default skin onto the base tier (Badge.dc.html). */
export function resolveBadgeSkin(theme: CardThemeKey): BadgeSkin {
  return { ...BADGE_BASE_SKIN, ...BADGE_SKINS[theme] }
}

interface BadgeProps {
  familyId: BadgeFamilyId
  shape: BadgeShapeId
  theme: CardThemeKey
  frame: BadgeFrame
  /** Width in px; height follows the shape's aspect ratio. */
  size: number
  title?: string
}

export function Badge({ familyId, shape, theme, frame, size, title }: BadgeProps) {
  const layout = computeBadgeLayout(BADGE_SHAPES[shape], resolveBadgeSkin(theme), frame, size)
  const Icon = BADGE_GLYPHS[familyId]
  const clip: CSSProperties = { clipPath: layout.clip, WebkitClipPath: layout.clip }
  return (
    <span
      className="bdg"
      title={title}
      style={{ width: px(layout.width), height: px(layout.height), filter: layout.filter }}
    >
      {layout.layers.map((layer, i) => (
        <span
          key={i}
          className="bdg-layer"
          style={{ ...clip, inset: px(layer.inset), background: layer.background }}
        />
      ))}
      {layout.bevel && (
        <span className="bdg-layer" style={{ ...clip, inset: 0, background: BEVEL }} />
      )}
      <span
        className="bdg-icon"
        style={{
          inset: px(layout.iconInset),
          paddingBottom: px(layout.iconPadBottom),
          paddingTop: px(layout.iconPadTop),
        }}
      >
        <Icon aria-hidden size={layout.iconSize} color={layout.iconColor} strokeWidth={2} />
      </span>
    </span>
  )
}
