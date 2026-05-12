import type { MatchResult } from '@eanhl/db'

interface ResultStyle {
  /** Tailwind classes for the chip/pill container — bg + border + text. */
  container: string
  /** Full-word label rendered by ResultPill at any size. */
  label: string
}

// Color values mirror preview/components-pills.html in the design bundle.
// Notably DNF uses the BGM accent-red border on a neutral grey body — a clear
// "something happened" signal that's visually distinct from a regular LOSS.
const STYLES: Record<MatchResult, ResultStyle> = {
  WIN: {
    container:
      'bg-[rgba(16,185,129,0.10)] border-[rgba(16,185,129,0.40)] text-[#10b981]',
    label: 'WIN',
  },
  LOSS: {
    container:
      'bg-[rgba(232,65,49,0.10)] border-[rgba(232,65,49,0.40)] text-[#ef6a5e]',
    label: 'LOSS',
  },
  OTL: {
    container:
      'bg-[rgba(245,158,11,0.10)] border-[rgba(245,158,11,0.40)] text-[#fbbf24]',
    label: 'OT LOSS',
  },
  DNF: {
    container:
      'bg-[rgba(58,56,57,0.40)] border-[rgba(232,65,49,0.50)] text-[#9a9798]',
    label: 'DNF',
  },
}

export function getResultStyle(result: MatchResult): ResultStyle {
  return STYLES[result]
}
