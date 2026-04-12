export default function GamesLoading() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-12 animate-pulse rounded-none bg-surface border-l-4 border-transparent"
        />
      ))}
    </div>
  )
}
