import { BrandedLoader } from '@/components/loading/branded-loader'

export default function GamesLoading() {
  return (
    <div data-route-loading className="space-y-1">
      <BrandedLoader compact />

      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-12 animate-pulse rounded-none bg-surface border-l-4 border-transparent"
        />
      ))}
    </div>
  )
}
