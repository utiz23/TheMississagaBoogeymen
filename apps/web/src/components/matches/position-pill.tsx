// Color-coded position pill used on the scoresheet and Top Performer cards.
// Goalie > position field check — handles rows where `position` may be null
// but `isGoalie` is true.

const POSITION_STYLE: Record<string, string> = {
  goalie: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  center: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
  leftWing: 'border-zinc-500/40 bg-zinc-700/30 text-zinc-300',
  rightWing: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  defenseMen: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
}

const NEUTRAL_STYLE = 'border-zinc-700/50 bg-zinc-800/40 text-zinc-400'

interface PositionPillProps {
  label: string
  position: string | null
  isGoalie: boolean
}

export function PositionPill({ label, position, isGoalie }: PositionPillProps) {
  const key = isGoalie ? 'goalie' : (position ?? '')
  const className = POSITION_STYLE[key] ?? NEUTRAL_STYLE
  return (
    <span
      className={`inline-flex items-center justify-center rounded-sm border px-1.5 py-0.5 font-condensed text-[10px] font-bold uppercase tracking-widest tabular ${className}`}
    >
      {label}
    </span>
  )
}
