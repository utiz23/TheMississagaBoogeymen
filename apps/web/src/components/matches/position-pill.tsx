// Color-coded position pill used on the scoresheet and Top Performer cards.
// Palette documented in docs/specs/position-colors.md.

const POSITION_STYLE = {
  bgm: {
    goalie: { border: '#a587cd66', bg: '#a587cd1a', text: '#a587cd' },
    center: { border: '#c3435366', bg: '#c343531a', text: '#c34353' },
    leftWing: { border: '#6ed56566', bg: '#6ed5651a', text: '#6ed565' },
    rightWing: { border: '#656cbe66', bg: '#656cbe1a', text: '#656cbe' },
    defenseLeft: { border: '#74f2df66', bg: '#74f2df1a', text: '#74f2df' },
    defenseRight: { border: '#ecef6d66', bg: '#ecef6d1a', text: '#ecef6d' },
    defenseMen: { border: '#74f2df66', bg: '#74f2df1a', text: '#74f2df' },
  },
  opp: {
    goalie: { border: '#e8aee966', bg: '#e8aee91a', text: '#e8aee9' },
    center: { border: '#cdbf6966', bg: '#cdbf691a', text: '#cdbf69' },
    leftWing: { border: '#a8508c66', bg: '#a8508c1a', text: '#a8508c' },
    rightWing: { border: '#5c695966', bg: '#5c69591a', text: '#5c6959' },
    defenseLeft: { border: '#db8b6766', bg: '#db8b671a', text: '#db8b67' },
    defenseRight: { border: '#d0d96366', bg: '#d0d9631a', text: '#d0d963' },
    defenseMen: { border: '#db8b6766', bg: '#db8b671a', text: '#db8b67' },
  },
} as const

const NEUTRAL_STYLE = { border: '#3f3f46', bg: 'rgba(39,39,42,0.40)', text: '#a1a1aa' }

interface PositionPillProps {
  label: string
  position: string | null
  isGoalie: boolean
  side?: 'bgm' | 'opp'
  defenseSide?: 'left' | 'right' | null
  onLight?: boolean
}

export function PositionPill({
  label,
  position,
  isGoalie,
  side = 'bgm',
  defenseSide = null,
  onLight = false,
}: PositionPillProps) {
  const palette = POSITION_STYLE[side]
  const style = (() => {
    if (isGoalie) return palette.goalie
    if (position === 'leftDefenseMen') return palette.defenseLeft
    if (position === 'rightDefenseMen') return palette.defenseRight
    if (position === 'defenseMen' && defenseSide === 'right') return palette.defenseRight
    if (position === 'defenseMen' && defenseSide === 'left') return palette.defenseLeft
    if (position !== null && position in palette) {
      return palette[position as keyof typeof palette]
    }
    return NEUTRAL_STYLE
  })()
  return (
    <span
      className="inline-flex items-center justify-center rounded-sm border px-1.5 py-0.5 font-condensed text-[10px] font-bold uppercase tracking-widest tabular"
      style={{
        borderColor: onLight ? style.text : style.border,
        backgroundColor: onLight ? 'rgba(8,8,10,0.84)' : style.bg,
        color: style.text,
      }}
    >
      {label}
    </span>
  )
}
