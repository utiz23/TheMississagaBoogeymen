import type { MatchResult } from '@eanhl/db'
import { getResultStyle } from '@/lib/result-colors'

interface ResultPillProps {
  result: MatchResult
  /**
   * Variant size. `sm` is the 24px-tall chip used inside dense rows
   * (game lists, recent-form strips); `md` is the 42px-tall pill used
   * in heroes and featured contexts.
   */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Result pill — the W/L/OT/DNF marker. Letter glyph at sm, full word
 * at md. Color via getResultStyle: emerald (WIN), rose (LOSS), amber
 * (OTL), zinc (DNF).
 */
export function ResultPill({ result, size = 'sm', className = '' }: ResultPillProps) {
  const style = getResultStyle(result)
  const sizeClasses =
    size === 'md'
      ? 'h-[42px] min-w-[88px] px-4 text-sm tracking-[0.22em]'
      : 'h-6 min-w-[32px] px-2 text-[11px] tracking-[0.20em]'
  const text = size === 'md' ? style.label : style.glyph
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full border font-condensed font-bold uppercase ${sizeClasses} ${style.container} ${className}`}
    >
      {text}
    </span>
  )
}
