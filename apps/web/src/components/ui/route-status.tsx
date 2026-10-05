import type { ReactNode } from 'react'
import { Panel } from '@/components/ui/panel'

export const routeStatusLinkClass =
  'font-condensed text-xs font-semibold uppercase tracking-widest text-fg-3 transition-colors hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/**
 * Branded full-width status block for the not-found and error pages. Shows only
 * the copy it is given — never an error message, stack or internal path.
 */
export function RouteStatus({
  code,
  title,
  message,
  children,
}: {
  code: string
  title: string
  message: string
  children?: ReactNode
}) {
  return (
    <Panel className="mx-auto flex max-w-xl flex-col items-start gap-4 border-l-4 border-l-accent px-6 py-10">
      <p className="font-condensed text-xs font-semibold uppercase tracking-[0.22em] text-accent-readable">
        {code}
      </p>
      <h1 className="font-condensed text-3xl font-black uppercase tracking-wide text-fg-1">
        {title}
      </h1>
      <p className="text-sm text-fg-3">{message}</p>
      {children ? <div className="flex flex-wrap items-center gap-6 pt-2">{children}</div> : null}
    </Panel>
  )
}
