export default function GameDetailLoading() {
  return (
    <div className="space-y-8">
      {/* Back link skeleton */}
      <div className="h-4 w-16 animate-pulse bg-zinc-800" />

      {/* Hero skeleton */}
      <div className="h-28 animate-pulse border border-zinc-800 border-l-4 border-l-accent bg-surface" />

      {/* Comparison strip skeleton */}
      <div className="h-40 animate-pulse border border-zinc-800 bg-surface" />

      {/* Player table skeleton */}
      <div className="space-y-px">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse bg-surface border border-zinc-800/40" />
        ))}
      </div>
    </div>
  )
}
