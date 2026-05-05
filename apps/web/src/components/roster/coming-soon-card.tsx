import type { ReactNode } from 'react'

interface Props {
  title: string
  description: string
  icon?: ReactNode
}

export function ComingSoonCard({ title, description, icon }: Props) {
  return (
    <section
      className="space-y-3 rounded border border-dashed border-zinc-700/60 bg-zinc-900/30 p-6"
      aria-label={`${title} (coming soon)`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-condensed text-sm font-bold uppercase tracking-[0.2em] text-zinc-400">
          {title}
        </h2>
        <span className="rounded border border-zinc-700 bg-zinc-800/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
          Coming soon
        </span>
      </div>
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
        {icon !== undefined ? (
          <div className="text-zinc-700" aria-hidden>
            {icon}
          </div>
        ) : null}
        <p className="max-w-md text-xs text-zinc-500">{description}</p>
      </div>
    </section>
  )
}
