import type { MatchResult } from '@eanhl/db'

interface ResultBadgeProps {
  result: MatchResult
}

const CONFIG: Record<MatchResult, { label: string; className: string }> = {
  WIN: {
    label: 'W',
    className: 'bg-accent text-white',
  },
  LOSS: {
    label: 'L',
    className: 'bg-[#3f3f46] text-zinc-300',
  },
  OTL: {
    label: 'OTL',
    className: 'bg-[#78350f] text-amber-200',
  },
  DNF: {
    label: 'DNF',
    className: 'bg-[#27272a] text-zinc-500',
  },
}

export function ResultBadge({ result }: ResultBadgeProps) {
  const { label, className } = CONFIG[result]
  return (
    <span
      className={`inline-flex items-center justify-center min-w-[2.25rem] px-1.5 py-0.5 text-xs font-bold uppercase tracking-wide tabular ${className}`}
    >
      {label}
    </span>
  )
}
