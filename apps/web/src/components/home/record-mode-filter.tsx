import Link from 'next/link'
import type { GameMode } from '@eanhl/db'

const RECORD_MODE_LABELS: { mode: GameMode | null; label: string }[] = [
  { mode: null, label: 'All' },
  { mode: '6s', label: '6s' },
  { mode: '3s', label: '3s' },
]

function recordModeHref(mode: GameMode | null, titleSlug: string | undefined): string {
  const qs = new URLSearchParams()
  if (titleSlug) qs.set('title', titleSlug)
  if (mode !== null) qs.set('mode', mode)
  const s = qs.toString()
  return `/${s ? `?${s}` : ''}`
}

interface RecordModeFilterProps {
  titleSlug: string | undefined
  activeMode: GameMode | null
}

/**
 * Segmented pill filter — All / 6s / 3s. Drives the page's `?mode=` param,
 * which in turn filters the roster, leaders, and club-record aggregates.
 * Active pill: accent border + accent/10 fill + accent text.
 */
export function RecordModeFilter({ titleSlug, activeMode }: RecordModeFilterProps) {
  return (
    <div className="flex gap-1">
      {RECORD_MODE_LABELS.map(({ mode, label }) => {
        const isActive = mode === activeMode
        return (
          <Link
            key={label}
            href={recordModeHref(mode, titleSlug)}
            className={[
              'rounded border px-3 py-1 font-condensed text-xs font-semibold uppercase tracking-wider transition-colors',
              isActive
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-zinc-700 bg-transparent text-zinc-500 hover:border-zinc-500 hover:text-zinc-300',
            ].join(' ')}
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}
