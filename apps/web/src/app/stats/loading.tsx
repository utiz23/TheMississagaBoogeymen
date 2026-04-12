export default function StatsLoading() {
  return (
    <div className="space-y-8">
      {/* Header skeleton */}
      <div className="flex items-baseline gap-3">
        <div className="h-7 w-16 animate-pulse bg-zinc-800" />
        <div className="h-4 w-16 animate-pulse bg-zinc-800" />
      </div>

      {/* Record card skeleton */}
      <div>
        <div className="mb-3 h-4 w-16 animate-pulse bg-zinc-800" />
        <div className="h-24 animate-pulse border border-zinc-800 border-l-4 border-l-accent bg-surface" />
      </div>

      {/* Stat cards grid skeleton */}
      <div>
        <div className="mb-3 h-4 w-28 animate-pulse bg-zinc-800" />
        <div className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse border border-zinc-800 bg-surface" />
          ))}
        </div>
      </div>

      {/* Recent games skeleton */}
      <div>
        <div className="mb-3 h-4 w-24 animate-pulse bg-zinc-800" />
        <div className="border border-zinc-800 bg-surface">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-11 animate-pulse border-b border-zinc-800/40 bg-surface last:border-0"
            />
          ))}
        </div>
      </div>
    </div>
  )
}
