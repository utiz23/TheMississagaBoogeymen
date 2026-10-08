import type { ReactNode } from 'react'

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** A labelled row of toggles: rounded pills (`pill`) or a segmented bar. */
export function ToggleGroup({
  label,
  pill = false,
  children,
}: {
  label: string
  pill?: boolean
  children: ReactNode
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={
        pill
          ? 'flex flex-wrap items-center gap-1.5'
          : 'inline-flex border border-zinc-800 bg-surface'
      }
    >
      {children}
    </div>
  )
}

export function Toggle({
  pressed,
  pill = false,
  disabled = false,
  title,
  onClick,
  children,
}: {
  pressed: boolean
  pill?: boolean
  disabled?: boolean
  /** Hover text, e.g. why a disabled toggle is unavailable. */
  title?: string
  onClick: () => void
  children: ReactNode
}) {
  const base =
    'font-condensed font-bold uppercase transition-colors motion-reduce:transition-none ' +
    FOCUS_RING
  const cls = pill
    ? `${base} min-h-8 rounded-full border px-3 py-1 text-[11px] tracking-[0.18em] ${
        pressed
          ? 'border-[rgba(232,65,49,0.85)] bg-accent-soft text-accent'
          : 'border-zinc-800 bg-surface text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
      }`
    : `${base} min-h-9 px-3 py-1.5 text-[11px] tracking-[0.18em] ${
        pressed
          ? 'bg-surface-raised text-zinc-50 shadow-[inset_0_-2px_0_var(--color-accent)]'
          : 'bg-transparent text-fg-4 hover:text-zinc-200'
      }`
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`${cls}${disabled ? ' cursor-not-allowed opacity-40 hover:bg-surface hover:text-zinc-400' : ''}`}
    >
      {children}
    </button>
  )
}
