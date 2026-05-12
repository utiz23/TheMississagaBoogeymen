import Link from 'next/link'
import type { GameTitle, GameMode } from '@eanhl/db'
import { Panel } from '@/components/ui/panel'

/** Mode value used by the unified mode filter. `null` means All. */
export type ModeValue = GameMode | null

/** Build a `?title=...&mode=...` URL, omitting null/empty values. */
export function buildTitleHref(
  pathname: string,
  params: { title?: string | null; mode?: ModeValue },
): string {
  const query = new URLSearchParams()
  if (params.title) query.set('title', params.title)
  if (params.mode) query.set('mode', params.mode)
  const qs = query.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

/**
 * Pill bar for switching between game titles.
 *
 * The list comes already-ordered from the resolver (active titles first,
 * then archive titles by year desc). Active titles get a small green
 * "LIVE" dot so users can see at a glance which one is the current
 * season; the currently-selected pill gets the accent background.
 */
export function TitleSelector({
  pathname,
  titles,
  activeTitleSlug,
  activeMode,
}: {
  pathname: string
  titles: GameTitle[]
  activeTitleSlug: string
  activeMode: ModeValue
}) {
  if (titles.length === 0) return null

  return (
    <div className="flex flex-wrap items-center divide-x divide-zinc-700 overflow-hidden border border-zinc-700">
      {titles.map((title) => {
        const isSelected = title.slug === activeTitleSlug
        return (
          <Link
            key={title.id}
            href={buildTitleHref(pathname, { title: title.slug, mode: activeMode })}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-widest transition-colors',
              isSelected
                ? 'bg-accent text-white'
                : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
            ].join(' ')}
          >
            {title.isActive && (
              <span
                aria-hidden
                className={[
                  'h-1.5 w-1.5 rounded-full',
                  isSelected ? 'bg-white' : 'bg-emerald-400',
                ].join(' ')}
              />
            )}
            <span>{title.name}</span>
          </Link>
        )
      })}
    </div>
  )
}

/**
 * Mode pills. Caller controls which modes are available:
 *   - active titles: ['all', '6s', '3s']
 *   - archive titles: ['6s', '3s']
 *
 * `'all'` corresponds to `mode=null` in the URL (the "no mode filter"
 * default). The other values map directly to the URL `mode` param.
 */
/**
 * Active-state styles per mode — colors mirror `preview/components-pills.html`
 * in the design bundle. 6s = violet, 3s = sky, All = transparent body with
 * BGM-accent border. Inactive buttons share a neutral zinc style so the active
 * mode's color reads as the dominant signal.
 */
const MODE_ACTIVE_CLASS: Record<'all' | GameMode, string> = {
  all: 'border-[rgba(232,65,49,0.85)] bg-transparent text-[#e84131]',
  '6s': 'border-[rgba(139,92,246,0.7)] bg-[rgba(124,58,237,0.22)] text-[#c4b5fd]',
  '3s': 'border-[rgba(56,189,248,0.7)] bg-[rgba(2,132,199,0.22)] text-[#7dd3fc]',
}

const MODE_INACTIVE_CLASS =
  'border-zinc-800 bg-surface text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'

export function ModeFilter({
  pathname,
  titleSlug,
  activeMode,
  modes,
}: {
  pathname: string
  titleSlug: string
  activeMode: ModeValue
  modes: ('all' | GameMode)[]
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      {modes.map((mode) => {
        const value: ModeValue = mode === 'all' ? null : mode
        const isSelected = value === activeMode
        return (
          <Link
            key={mode}
            href={buildTitleHref(pathname, { title: titleSlug, mode: value })}
            className={[
              'rounded-full border px-3 py-1 font-condensed text-[11px] font-bold uppercase tracking-[0.18em] transition-colors',
              isSelected ? MODE_ACTIVE_CLASS[mode] : MODE_INACTIVE_CLASS,
            ].join(' ')}
          >
            {mode === 'all' ? 'All' : mode}
          </Link>
        )
      })}
    </div>
  )
}

export function EmptyState({ message }: { message: string }) {
  return (
    <Panel className="flex min-h-[12rem] items-center justify-center">
      <p className="max-w-xl px-6 text-center font-condensed text-sm uppercase tracking-wider text-zinc-500">
        {message}
      </p>
    </Panel>
  )
}

/** Subtitle shown above the skater/goalie tables to clarify data origin. */
export function statsSourceLabel({
  isActive,
  gameMode,
}: {
  isActive: boolean
  gameMode: ModeValue
}): string {
  if (!isActive) return 'Archived season totals (reviewed historical import)'
  if (gameMode === null) return 'EA season totals'
  return `local tracked ${gameMode}`
}
