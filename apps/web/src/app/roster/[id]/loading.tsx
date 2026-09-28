import { BrandedLoader } from '@/components/loading/branded-loader'

export default function Loading() {
  return (
    <div data-route-loading className="space-y-8">
      <BrandedLoader />

      {/* Back link placeholder */}
      <div className="h-4 w-16 rounded bg-zinc-800 animate-pulse" />

      {/* Header card */}
      <div className="border border-zinc-800 border-l-4 border-l-accent bg-surface px-6 py-5">
        <div className="h-10 w-48 rounded bg-zinc-800 animate-pulse" />
      </div>

      {/* Career stats */}
      <div className="space-y-3">
        <div className="h-4 w-24 rounded bg-zinc-800 animate-pulse" />
        <div className="h-24 border border-zinc-800 bg-surface animate-pulse" />
      </div>
    </div>
  )
}
