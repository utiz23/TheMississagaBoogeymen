import { ChassisPill } from '@/components/ui/chassis-pill'
import { PositionIcon, type PositionGlyph } from '@/components/ui/position-icons'
import {
  NationalityFlag,
  PlatformIcon,
  nationalityKey,
  platformKey,
} from '@/components/player-meta-icons'
import { POSITION_META, rgbForPosition, type LongPositionKey } from '@/lib/position-colors'

/**
 * Profile-hero pills on the shared chassis (Hero Pills design). The archetype
 * pill is `ArchetypePillFlagship`; these are the position, nationality,
 * platform and stat-derived role pills that sit beside it.
 */

const NEUTRAL_RGB = '154, 151, 152'

const POSITION_PILL: Partial<
  Record<LongPositionKey, { label: string; glyph: PositionGlyph; flip: boolean }>
> = {
  center: { label: 'Center', glyph: 'center', flip: false },
  leftWing: { label: 'Left Wing', glyph: 'wing', flip: true },
  rightWing: { label: 'Right Wing', glyph: 'wing', flip: false },
  wing: { label: 'Wing', glyph: 'wing', flip: true },
  leftDefenseMen: { label: 'Left Defense', glyph: 'defense', flip: true },
  rightDefenseMen: { label: 'Right Defense', glyph: 'defense', flip: false },
  // EA only reports "defenseMen" without a side: generic D, LD colour + glyph.
  defenseMen: { label: 'Defense', glyph: 'defense', flip: true },
  goalie: { label: 'Goalie', glyph: 'goalie', flip: false },
}

/**
 * Position pill — label, glyph and stamp (C / LW / RW / LD / RD / D / G) in
 * the shared `--pos-*` colour. Unknown values fall back to a neutral pill
 * with the raw text. Carries `pos` so the ≤720px tier can keep only this pill.
 */
export function PositionPill({
  position,
  fallbackLabel,
}: {
  position: string
  fallbackLabel: string
}) {
  const meta = POSITION_PILL[position as LongPositionKey]
  if (meta === undefined) {
    return (
      <ChassisPill
        className="pos"
        rgb={NEUTRAL_RGB}
        accent="#ebebeb"
        icon={<span className="pos-dot" aria-hidden />}
        label={fallbackLabel}
        title={fallbackLabel}
      />
    )
  }
  const shared = POSITION_META[position as LongPositionKey]
  return (
    <ChassisPill
      className="pos"
      rgb={rgbForPosition(position)}
      accent={shared.colorVar}
      iconMode="glyph-lg"
      icon={<PositionIcon glyph={meta.glyph} flip={meta.flip} />}
      label={meta.label}
      stamp={shared.tag}
      title={meta.label}
    />
  )
}

/**
 * Nationality pill. USA = "Union navy", Canada = "Ice white" (design options
 * 1b / 1e): the flag fills the icon slot. Anything else gets the neutral
 * chassis with the placeholder flag and the raw nationality text.
 */
export function NationalityPill({ nationality }: { nationality: string }) {
  const key = nationalityKey(nationality)
  if (key === 'us') {
    return (
      <ChassisPill
        rgb="96, 94, 168"
        accent="#a9a7e6"
        iconMode="fill"
        icon={<NationalityFlag code={nationality} fill />}
        label="USA"
        title="United States"
      />
    )
  }
  if (key === 'ca') {
    return (
      <ChassisPill
        rgb="220, 220, 222"
        accent="#ffffff"
        iconMode="fill"
        icon={<NationalityFlag code={nationality} fill />}
        label="CAN"
        title="Canada"
      />
    )
  }
  return (
    <ChassisPill
      rgb={NEUTRAL_RGB}
      accent="#ebebeb"
      iconMode="muted"
      icon={<NationalityFlag code={nationality} />}
      label={nationality}
      title={nationality}
    />
  )
}

const PLATFORM_PILL = {
  xbox: { rgb: '16, 124, 16', accent: '#5dc21e', stamp: 'XBX', name: 'Xbox' },
  playstation: { rgb: '0, 112, 209', accent: '#4da3ff', stamp: 'PSN', name: 'PlayStation' },
} as const

/** Platform pill — the EA gamertag with the platform mark in white. */
export function PlatformPill({
  platform,
  gamertag,
}: {
  platform: string | null
  gamertag: string
}) {
  const key = platformKey(platform)
  if (key === null) {
    return (
      <ChassisPill
        rgb={NEUTRAL_RGB}
        accent="#ebebeb"
        iconMode="muted"
        icon={<PlatformIcon platform={null} />}
        label={gamertag}
        title={`Gamertag · ${gamertag}`}
      />
    )
  }
  const meta = PLATFORM_PILL[key]
  return (
    <ChassisPill
      rgb={meta.rgb}
      accent={meta.accent}
      iconMode="white"
      icon={<PlatformIcon platform={platform} mono />}
      label={gamertag}
      stamp={meta.stamp}
      title={`${meta.name} gamertag · ${gamertag}`}
    />
  )
}

/** Stat-derived role (shown only when no archetype is set) — brand-red chassis. */
export function DerivedRolePill({ label }: { label: string }) {
  return (
    <ChassisPill
      rgb="232, 65, 49"
      accent="#ff8a7a"
      icon={<span className="pos-dot" aria-hidden />}
      label={label}
      title={`${label} · derived from this season's stats`}
    />
  )
}
