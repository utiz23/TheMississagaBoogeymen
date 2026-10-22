import type { CSSProperties, ReactNode } from 'react'
import './archetype-pill.css'
import './chassis-pill.css'

/**
 * Generic 38px pill on the archetype flagship chassis (`.arc` in
 * archetype-pill.css): clipped top-left corner, tinted border + gradient,
 * diagonal hatch, 38px icon slot, heavy uppercase label, optional right stamp.
 * The hero position, nationality and platform pills all use it, so they sit
 * next to `ArchetypePillFlagship` as one family (Hero Pills design).
 */
interface ChassisPillProps {
  /** Tint as an `r, g, b` triplet (or a var() that resolves to one). */
  rgb: string
  /** Label accent + glyph colour. Defaults to the tint itself. */
  accent?: string
  icon: ReactNode
  /**
   * How the icon sits in its slot: `glyph` (18px, tinted), `glyph-lg` (22px,
   * tinted), `fill` (covers the slot edge to edge, e.g. a flag), `white`
   * (white glyph with a tinted glow), `muted` (untinted placeholder).
   */
  iconMode?: 'glyph' | 'glyph-lg' | 'fill' | 'white' | 'muted'
  /** Plain part of the label; `label` follows it in the accent colour. */
  prefix?: string
  label: string
  stamp?: string | null
  title?: string
  className?: string
}

export function ChassisPill({
  rgb,
  accent,
  icon,
  iconMode = 'glyph',
  prefix = '',
  label,
  stamp = null,
  title,
  className,
}: ChassisPillProps) {
  const style = {
    ['--c-rgb' as string]: rgb,
    ['--c' as string]: accent ?? `rgb(${rgb})`,
  } as CSSProperties
  return (
    <span
      className={['arc', 'chp', `ico-${iconMode}`, className].filter(Boolean).join(' ')}
      style={style}
      title={title}
    >
      <span className="ico">{icon}</span>
      <span className="body">
        <span className="name">
          {prefix}
          <b>{label}</b>
        </span>
      </span>
      {stamp !== null && <span className="stamp">{stamp}</span>}
    </span>
  )
}
