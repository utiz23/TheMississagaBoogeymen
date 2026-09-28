import Image from 'next/image'

/**
 * Brand motif for route loading.tsx boundaries: crest breathe + masked
 * highlight sweep, a top ticker, and a static glow. Composed ABOVE each
 * route's existing skeleton, never in place of it — the skeletons carry
 * real layout-shift protection this component doesn't replicate.
 *
 * Deliberately shows no percentage, status phase, or numeric progress: a
 * single Suspense fallback has no real multi-stage signal to attach such
 * claims to, so the only text is a generic, honest "Loading" announcement.
 * `compact` drops the crest block for routes whose skeleton is already
 * visually dense, keeping only the ticker + glow.
 */
export function BrandedLoader({ compact = false }: { compact?: boolean } = {}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={compact ? 'bl-root bl-compact' : 'bl-root'}
    >
      <span className="sr-only">Loading</span>
      <div className="bl-glow" aria-hidden="true" />
      <div className="bl-ticker" aria-hidden="true">
        <div className="bl-ticker-fill" />
      </div>
      {!compact && (
        <div className="bl-crest-wrap" aria-hidden="true">
          <Image
            src="/images/bgm-logo.png"
            alt=""
            width={224}
            height={190}
            priority
            className="bl-crest h-auto w-full"
          />
          <div className="bl-crest-sweep" />
        </div>
      )}
    </div>
  )
}
