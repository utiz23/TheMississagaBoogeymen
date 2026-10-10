import type { ReactNode } from 'react'
import Link from 'next/link'
import { AUTH_BUTTON_SECONDARY } from '@/components/auth/auth-panel'

/** A panel on the admin pages (broadcast panel with a ticker strip). */
export function AdminSection({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children?: ReactNode
}) {
  return (
    <section className="broadcast-panel-strong">
      <span aria-hidden="true" className="ticker-strip ticker-strip-thin block" />
      <div className="flex flex-col gap-4 px-5 py-5">
        <h2 className="font-condensed text-lg font-black uppercase tracking-[0.06em] text-fg-1">
          {title}
        </h2>
        {description !== undefined && <div className="text-sm text-fg-3">{description}</div>}
        {children}
      </div>
    </section>
  )
}

/** Page heading for the admin pages; sub-pages link back to the hub. */
export function AdminHeading({ title, back = true }: { title: string; back?: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="font-condensed text-[11px] font-semibold uppercase tracking-[0.22em] text-fg-4">
        {back ? (
          <Link prefetch href="/admin" className="hover:text-fg-1">
            ← Admin tools
          </Link>
        ) : (
          'Admin'
        )}
      </p>
      <h1 className="font-condensed text-3xl font-black uppercase leading-none tracking-[0.04em] text-fg-1">
        {title}
      </h1>
    </div>
  )
}

export const ADMIN_TH =
  'px-3 py-2 text-left font-condensed text-xs font-semibold uppercase tracking-[0.18em] text-fg-4'
export const ADMIN_TD = 'border-t border-border-subtle px-3 py-2 text-sm text-fg-2'
export const ADMIN_SMALL_BUTTON = `${AUTH_BUTTON_SECONDARY} px-3 py-1.5`
export const ADMIN_FIELD =
  'w-full border border-border bg-surface px-3 py-2 text-sm text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
export const ADMIN_LABEL =
  'font-condensed text-xs font-semibold uppercase tracking-[0.18em] text-fg-4'
