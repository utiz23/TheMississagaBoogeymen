import type { MatchResult } from '@eanhl/db'
import { getResultStyle } from '@/lib/result-colors'

interface ResultPillProps {
  result: MatchResult
  /**
   * Variant size. `sm` is the compact pill used inside dense rows
   * (game lists, recent-form strips); `md` is the larger pill used
   * in heroes and featured contexts. Both render the full word
   * ("WIN" / "LOSS" / "OT LOSS" / "DNF") per the design-system
   * spec's deferred-decisions adjustment.
   */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Result pill — the WIN / LOSS / OT LOSS / DNF marker. Color via
 * getResultStyle: emerald (WIN), rose (LOSS), amber (OTL), zinc (DNF).
 */
export function ResultPill({ result, size = 'sm', className = '' }: ResultPillProps) {
  const style = getResultStyle(result)
  const sizeClasses =
    size === 'md'
      ? 'h-[42px] min-w-[88px] px-4 text-sm tracking-[0.22em]'
      : 'h-6 px-2.5 text-[10px] tracking-[0.18em]'
  return (
    <span
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-full border font-condensed font-bold uppercase ${sizeClasses} ${style.container} ${className}`}
    >
      {style.label}
    </span>
  )
}
