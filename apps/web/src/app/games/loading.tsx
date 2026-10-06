import { BrandedLoader } from '@/components/loading/branded-loader'

/** Mirrors the Scores page: header, filter toolbar, form strip, then ScoreCard grids by date. */
export default function GamesLoading() {
  return (
    <div data-route-loading className="space-y-6">
      <BrandedLoader compact />

      {/* Header */}
      <div className="flex items-baseline gap-3">
        <div className="h-7 w-24 animate-pulse bg-zinc-800" />
        <div className="h-4 w-16 animate-pulse bg-zinc-800" />
      </div>

      {/* Filter toolbar — wraps taller on narrow screens */}
      <div className="h-[260px] animate-pulse border border-zinc-800 bg-surface md:h-[184px] xl:h-[156px]" />

      {/* Form strip + trend bullets */}
      <div className="h-[113px] space-y-2 md:h-[66px]">
        <div className="h-6 w-80 max-w-full animate-pulse bg-zinc-800/60" />
        <div className="h-4 w-64 max-w-full animate-pulse bg-zinc-800/40" />
      </div>

      {/* Pagination */}
      <div className="h-8" />

      {/* Date groups of ScoreCards */}
      {[3, 2].map((count, group) => (
        <section key={group} className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-4 w-20 animate-pulse bg-zinc-800" />
            <div className="h-px flex-1 bg-zinc-800" />
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: count }).map((_, i) => (
              <div key={i} className="h-[277px] animate-pulse border border-zinc-800 bg-surface">
                <div className="h-1 w-full bg-zinc-800" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
