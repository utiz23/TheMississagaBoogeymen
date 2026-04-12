export default function RosterLoading() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex items-baseline gap-3">
        <div className="h-7 w-24 animate-pulse bg-zinc-800" />
        <div className="h-4 w-16 animate-pulse bg-zinc-800" />
      </div>

      {/* Tab bar skeleton */}
      <div className="flex gap-0 border-b border-zinc-800">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-9 w-24 animate-pulse bg-zinc-800/40 mx-px" />
        ))}
      </div>

      {/* Table rows skeleton */}
      <div className="border border-zinc-800 bg-surface">
        <div className="h-9 animate-pulse border-b border-zinc-800 bg-zinc-800/30" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse border-b border-zinc-800/40 bg-surface" />
        ))}
      </div>
    </div>
  )
}
