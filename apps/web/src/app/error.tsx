'use client'

import Link from 'next/link'
import { RouteStatus, routeStatusLinkClass } from '@/components/ui/route-status'

/**
 * Page-level error boundary. `error.message` is deliberately never rendered:
 * in production it is replaced by a generic string anyway, and showing it in
 * development builds would leak internals. The digest is an opaque reference
 * that matches the server log line.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <RouteStatus
      code="Error"
      title="Something went wrong"
      message="This page couldn't load. Try again in a moment."
    >
      <button type="button" onClick={reset} className={routeStatusLinkClass}>
        Try again
      </button>
      <Link href="/" className={routeStatusLinkClass}>
        Back to home
      </Link>
      {error.digest ? (
        <span className="font-condensed text-[10px] uppercase tracking-[0.2em] text-fg-4">
          Ref {error.digest}
        </span>
      ) : null}
    </RouteStatus>
  )
}
