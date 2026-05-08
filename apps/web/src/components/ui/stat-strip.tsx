import type { ReactNode } from 'react'

export interface StatStripItem {
  label: string
  value: ReactNode
  /** Tint the value rose-400. Use for the headline column (WIN, Win%). */
  accent?: boolean
  /** Render the value dimmer (zinc-500). Use for muted columns (OTL when low). */
  dim?: boolean
}

interface StatStripProps {
  items: StatStripItem[]
  /** Optional provenance tag rendered below the strip (e.g. "EA official", "local · 6s only"). */
  provenance?: string
  /** Spacing variant. `default` = gap-x-6 gap-y-2. `tight` = gap-x-4 gap-y-1. */
  density?: 'default' | 'tight'
  className?: string
}

/**
 * Inline label/value pair runs — record strips, hero stat lines, game
 * cards, etc. Tabular numerals globally; condensed-bold values with
 * tiny dim-uppercase labels. Optional provenance row at the bottom
 * with a small accent-red dot.
 */
export function StatStrip({
  items,
  provenance,
  density = 'default',
  className = '',
}: StatStripProps) {
  const gapX = density === 'tight' ? 'gap-x-4' : 'gap-x-6'
  const gapY = density === 'tight' ? 'gap-y-1' : 'gap-y-2'
  return (
    <div className={`flex flex-col ${className}`}>
      <dl className={`tabular flex flex-wrap ${gapX} ${gapY}`}>
        {items.map((item) => {
          const valueColor = item.accent
            ? 'text-rose-400'
            : item.dim
              ? 'text-zinc-500'
              : 'text-zinc-100'
          return (
            <div key={item.label} className="flex flex-col">
              <dt className="font-condensed text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                {item.label}
              </dt>
              <dd
                className={`font-condensed text-2xl font-bold leading-none ${valueColor}`}
              >
                {item.value}
              </dd>
            </div>
          )
        })}
      </dl>
      {provenance ? (
        <p className="mt-3 flex items-center gap-2 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
          {provenance}
        </p>
      ) : null}
    </div>
  )
}
