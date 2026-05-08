interface StatCardProps {
  label: string
  value: string
  /** Small line below the value — e.g. "Win %" or "per game". */
  sublabel?: string
  /**
   * Applies a red left-accent border and red value color.
   * Use sparingly to highlight 1-2 key stats per section.
   */
  featured?: boolean
}

/**
 * Compact stat display card: label / large value / optional sublabel.
 *
 * Designed for 2–6-column grids. Reusable across /stats and / (home).
 * The `featured` flag applies the accent left-bar treatment borrowed from
 * the Broadcast Strip design direction.
 */
export function StatCard({ label, value, sublabel, featured = false }: StatCardProps) {
  return (
    <div
      className={['broadcast-panel px-4 py-4', featured ? 'border-l-2 border-l-accent' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <div className="font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
        {label}
      </div>
      <div
        className={[
          'mt-1 font-condensed text-2xl font-bold tabular-nums leading-none',
          featured ? 'text-accent' : 'text-zinc-100',
        ].join(' ')}
      >
        {value}
      </div>
      {sublabel !== undefined && (
        <div className="mt-1 font-condensed text-[11px] uppercase tracking-wider text-zinc-600">
          {sublabel}
        </div>
      )}
    </div>
  )
}
