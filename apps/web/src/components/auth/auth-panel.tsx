import type { ReactNode } from 'react'

/**
 * The card the member pages (/login, /invite, /account) sit in — the 404 page's
 * broadcast panel at a narrower width.
 */
export function AuthPanel({
  label,
  title,
  children,
}: {
  /** Small caps line above the title. */
  label: string
  title: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center py-6">
      <section aria-labelledby="auth-title" className="broadcast-panel-strong w-full max-w-[520px]">
        <span aria-hidden="true" className="ticker-strip ticker-strip-thin block" />
        <div className="flex flex-col gap-5 px-6 py-6">
          <div className="flex flex-col gap-1.5">
            <p className="font-condensed text-[11px] font-semibold uppercase tracking-[0.22em] text-fg-4">
              {label}
            </p>
            <h1
              id="auth-title"
              className="font-condensed text-3xl font-black uppercase leading-none tracking-[0.04em] text-fg-1"
            >
              {title}
            </h1>
          </div>
          {children}
        </div>
      </section>
    </div>
  )
}

export const AUTH_BUTTON =
  'inline-flex items-center justify-center gap-2 border px-[18px] py-2.5 font-condensed text-xs font-bold uppercase tracking-[0.18em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60'

export const AUTH_BUTTON_PRIMARY = `${AUTH_BUTTON} border-accent-line bg-accent-soft text-accent-readable hover:bg-[rgba(232,65,49,0.18)]`

export const AUTH_BUTTON_SECONDARY = `${AUTH_BUTTON} border-border text-fg-3 hover:border-fg-5 hover:text-fg-1`

/** A one-line notice inside the panel (error or info). */
export function AuthNotice({ tone, children }: { tone: 'error' | 'info'; children: ReactNode }) {
  return (
    <p
      role={tone === 'error' ? 'alert' : undefined}
      className={`border-l-2 px-3 py-2 text-sm ${
        tone === 'error' ? 'border-accent bg-accent-soft text-fg-2' : 'border-border text-fg-3'
      }`}
    >
      {children}
    </p>
  )
}
