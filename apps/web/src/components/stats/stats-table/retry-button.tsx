'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Re-requests the current page from OUR server (`router.refresh()`), which
 * re-runs the server queries. It never calls EA. A transient failure therefore
 * recovers on the next successful render without a full page reload.
 */
export function RetryButton({ label = 'Retry' }: { label?: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        startTransition(() => {
          router.refresh()
        })
      }}
      className="border border-accent px-3 py-1.5 font-condensed text-xs font-semibold uppercase tracking-widest text-accent transition-colors hover:bg-accent-soft disabled:opacity-50"
    >
      {pending ? 'Retrying…' : label}
    </button>
  )
}
