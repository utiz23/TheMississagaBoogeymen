import { Panel } from '@/components/ui/panel'
import { RetryButton } from '@/components/stats/stats-table/retry-button'

/**
 * Shown in place of a section whose query FAILED. Deliberately distinct from an
 * empty state: it says the data was not received, and offers Retry (a refresh
 * of this page against our own server; no EA request).
 */
export function SectionError({ title, message }: { title: string; message?: string }) {
  return (
    <Panel className="flex flex-col items-start gap-3 px-4 py-6">
      <div role="alert" className="flex flex-col items-start gap-3">
        <p className="font-condensed text-sm font-bold uppercase tracking-[0.12em] text-rose-400">
          {title}
        </p>
        <p className="text-sm text-zinc-500">
          {message ?? 'The data was not received. This is not an empty or zero-stat result.'}
        </p>
        <RetryButton />
      </div>
    </Panel>
  )
}
