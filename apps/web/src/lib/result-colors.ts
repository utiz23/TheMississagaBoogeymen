import type { MatchResult } from '@eanhl/db'

interface ResultStyle {
  /** Tailwind classes for the chip/pill container — bg + border + text. */
  container: string
  /** Full-word label rendered by ResultPill at any size. */
  label: string
}

const STYLES: Record<MatchResult, ResultStyle> = {
  WIN: {
    container: 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400',
    label: 'WIN',
  },
  LOSS: {
    container: 'bg-rose-500/10 border-rose-500/40 text-rose-400',
    label: 'LOSS',
  },
  OTL: {
    container: 'bg-amber-500/10 border-amber-500/40 text-amber-400',
    label: 'OT LOSS',
  },
  DNF: {
    container: 'bg-zinc-700/40 border-zinc-600/40 text-zinc-400',
    label: 'DNF',
  },
}

export function getResultStyle(result: MatchResult): ResultStyle {
  return STYLES[result]
}
