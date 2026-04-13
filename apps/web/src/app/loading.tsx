export default function HomeLoading() {
  return (
    <div className="space-y-8">
      {/* Header skeleton */}
      <div className="flex items-baseline gap-3">
        <div className="h-7 w-16 animate-pulse bg-zinc-800" />
        <div className="h-4 w-16 animate-pulse bg-zinc-800" />
      </div>

      {/* Record hero skeleton */}
      <div>
        <div className="mb-3 h-4 w-14 animate-pulse bg-zinc-800" />
        <div className="h-24 animate-pulse border border-l-4 border-zinc-800 border-l-accent bg-surface" />
      </div>

      {/* Last game card skeleton */}
      <div>
        <div className="mb-3 h-4 w-20 animate-pulse bg-zinc-800" />
        <div className="h-56 animate-pulse border border-zinc-800 bg-surface" />
      </div>

      {/* Top performers skeleton */}
      <div>
        <div className="mb-3 h-4 w-28 animate-pulse bg-zinc-800" />
        <div className="border border-zinc-800 bg-surface">
          <div className="h-9 animate-pulse border-b border-zinc-800 bg-zinc-800/30" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse border-b border-zinc-800/40 last:border-0" />
          ))}
        </div>
      </div>

      {/* Recent form skeleton */}
      <div>
        <div className="mb-3 h-4 w-24 animate-pulse bg-zinc-800" />
        <div className="border border-zinc-800 bg-surface">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-11 animate-pulse border-b border-zinc-800/40 last:border-0" />
          ))}
        </div>
      </div>
    </div>
  )
}
