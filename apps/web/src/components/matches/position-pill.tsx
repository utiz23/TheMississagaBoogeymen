// Color-coded position pill used on the scoresheet, Top Performer cards, and
// goalie spotlight. Single source of color truth: lib/position-colors.ts.
// Palette documented in docs/specs/position-colors.md.

import { colorForPosition } from '@/lib/position-colors'

interface PositionPillProps {
  label: string
  position: string | null
  isGoalie: boolean
  /**
   * @deprecated Kept for call-site compatibility; color is now position-derived
   * only. Will be removed in a follow-up cleanup once all call sites stop
   * passing it.
   */
  side?: 'bgm' | 'opp'
  /**
   * @deprecated Same as `side` — L/R defensemen now share a per-position color
   * regardless of which side they line up on.
   */
  defenseSide?: 'left' | 'right' | null
  onLight?: boolean
  /**
   * 'muted' keeps the position colour on the border + tint but sets the LABEL
   * in fg-1. Used on the game sheet (Phase 10): the raw palette runs 2.5–2.6:1
   * on dark (#c0061c C, #2659cf RW), and six saturated pills in one lineup read
   * as a rainbow. Elsewhere the pill keeps its documented coloured label.
   */
  tone?: 'color' | 'muted'
}

export function PositionPill({
  label,
  position,
  isGoalie,
  onLight = false,
  tone = 'color',
}: PositionPillProps) {
  const colorKey = isGoalie ? 'goalie' : position
  const color = colorForPosition(colorKey)

  return (
    <span
      className="inline-flex items-center justify-center rounded-sm border px-1.5 py-0.5 font-condensed text-[10px] font-bold uppercase tracking-widest tabular"
      style={{
        borderColor: onLight ? color : `color-mix(in srgb, ${color} 40%, transparent)`,
        backgroundColor: onLight
          ? 'rgba(8,8,10,0.84)'
          : `color-mix(in srgb, ${color} 10%, transparent)`,
        color: tone === 'muted' ? 'var(--color-fg-1)' : color,
      }}
    >
      {label}
    </span>
  )
}
