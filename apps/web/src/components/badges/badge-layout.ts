/**
 * Pure geometry for one badge, ported from Badge.dc.html (frames single /
 * double / heavy, optional inner hairline and gloss; no markers or labels —
 * the Player Badges design uses none). Type-only imports keep this file
 * runnable under `node --test` without a bundler.
 */
import type { BadgeShape } from './badge-shapes'
import type { BadgeSkin } from './badge-skins'
import type { BadgeFrame } from './badge-board'

export interface BadgeLayer {
  inset: number
  background: string
}

export interface BadgeLayout {
  width: number
  height: number
  clip: string
  layers: BadgeLayer[]
  bevel: boolean
  filter: string
  iconSize: number
  iconColor: string
  iconInset: number
  iconPadBottom: number
  iconPadTop: number
}

export function computeBadgeLayout(
  shape: BadgeShape,
  skin: BadgeSkin,
  frame: BadgeFrame,
  size: number,
): BadgeLayout {
  const width = size
  const height = width * shape.ar
  const s = width / 38
  const rim = skin.inset * s * (frame === 'heavy' ? 2.4 : 1)
  let gap = skin.fill
  let ring = skin.fill
  let i2 = rim
  let i3 = rim
  if (frame === 'double') {
    const g = Math.max(1.5, 1.3 * s)
    gap = skin.gap ?? '#070606'
    ring = skin.outer
    i2 = rim + g
    i3 = i2 + Math.max(1, rim * 0.8)
  }
  const layers: BadgeLayer[] = [
    { inset: 0, background: skin.outer },
    { inset: rim, background: gap },
    { inset: i2, background: ring },
    { inset: i3, background: skin.inner ?? skin.fill },
  ]
  if (skin.inner !== undefined) {
    layers.push({ inset: i3 + Math.max(1, s * 0.9), background: skin.fill })
  }
  return {
    width,
    height,
    clip: shape.clip,
    layers,
    bevel: skin.gloss === true,
    filter: skin.filter,
    iconSize: width * shape.ic,
    iconColor: skin.icon,
    iconInset: i3,
    iconPadBottom: height * shape.pad,
    iconPadTop: height * shape.padTop,
  }
}
