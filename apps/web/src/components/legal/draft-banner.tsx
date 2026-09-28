import { DRAFT_BANNER_TEXT } from '@/lib/legal/legal-docs'

/**
 * The single, shared draft-status notice every draft-gated legal page
 * renders before its <h1> in reading order, so it is the first thing a
 * screen reader announces and the first thing a sighted reader sees. Its
 * visible text is `DRAFT_BANNER_TEXT` from the registry, not a local
 * literal, so it can never drift from what the tests look for.
 */
export function DraftBanner() {
  return (
    <div
      role="note"
      className="border border-accent-line bg-accent-soft px-4 py-3 font-condensed text-xs font-bold uppercase tracking-[0.14em] text-accent-readable"
    >
      {DRAFT_BANNER_TEXT}
    </div>
  )
}
