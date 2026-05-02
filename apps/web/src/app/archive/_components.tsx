import Link from 'next/link'
import type { GameTitle, HistoricalGameMode } from '@eanhl/db'

function buildHref(
  pathname: string,
  params: Record<string, string | null | undefined>,
) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value)
  }
  const qs = query.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

export function ArchiveTitleSelector({
  pathname,
  titles,
  activeTitleSlug,
  activeMode,
}: {
  pathname: string
  titles: GameTitle[]
  activeTitleSlug: string
  activeMode: HistoricalGameMode
}) {
  if (titles.length === 0) return null

  return (
    <div className="flex items-center divide-x divide-zinc-700 overflow-hidden rounded-sm border border-zinc-700">
      {titles.map((title) => {
        const isActive = title.slug === activeTitleSlug
        return (
          <Link
            key={title.id}
            href={buildHref(pathname, { title: title.slug, mode: activeMode })}
            className={[
              'px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-wide transition-colors',
              isActive
                ? 'bg-accent text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
            ].join(' ')}
          >
            {title.name}
          </Link>
        )
      })}
    </div>
  )
}

export function ArchiveModeFilter({
  pathname,
  titleSlug,
  activeMode,
}: {
  pathname: string
  titleSlug: string
  activeMode: HistoricalGameMode
}) {
  const options: HistoricalGameMode[] = ['6s', '3s']

  return (
    <div className="inline-flex items-center divide-x divide-zinc-800 overflow-hidden rounded-sm border border-zinc-800">
      {options.map((mode) => {
        const isActive = mode === activeMode
        return (
          <Link
            key={mode}
            href={buildHref(pathname, { title: titleSlug, mode })}
            className={[
              'px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-wide transition-colors',
              isActive
                ? 'bg-accent text-white'
                : 'bg-surface text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
            ].join(' ')}
          >
            {mode}
          </Link>
        )
      })}
    </div>
  )
}

export function ArchiveEmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
      <p className="max-w-xl px-6 text-center text-sm text-zinc-500">{message}</p>
    </div>
  )
}
