/**
 * Shared OCR provenance footer — the `Captured / Sources / Confidence` box
 * rendered at the bottom of the Lineup & Loadouts and Action Tracker sections.
 *
 * Presentational only: callers compute the headline metric, badges, and source
 * labels and pass them in. The two sections deliberately label `Confidence`
 * differently (a blended completeness score for lineups, a position-extrapolation
 * proxy for the Action Tracker); the distinction lives in `headlineTooltip`.
 */

export interface ProvenanceBadge {
  label: string
  tone: 'ok' | 'warn'
  tooltip?: string
}

export interface OcrProvenanceFooterProps {
  capturedAt: { earliest: Date; latest: Date } | null
  /** Column label for the timestamp range: "Captured" (lineup) | "Extracted" (action tracker). */
  capturedLabel: string
  /** Pre-formatted, de-duplicated source-screen labels. */
  sources: string[]
  headline: { value: string; word: string; tone: 'ok' | 'neutral' | 'warn' }
  /** Tooltip on the `Confidence` label — the honesty/wording-audit copy. */
  headlineTooltip: string
  badges: ProvenanceBadge[]
}

export function OcrProvenanceFooter({
  capturedAt,
  capturedLabel,
  sources,
  headline,
  headlineTooltip,
  badges,
}: OcrProvenanceFooterProps) {
  if (capturedAt === null) return null
  const { earliest, latest } = capturedAt
  const sameInstant = earliest.getTime() === latest.getTime()
  const capturedValue = sameInstant
    ? formatProvenanceTimestamp(earliest)
    : `${formatProvenanceTimestamp(earliest)} → ${formatProvenanceTimestamp(latest)}`
  const sourcesValue = sources.length > 0 ? sources.join(' + ') : '—'
  const headlineTone =
    headline.tone === 'ok'
      ? 'text-[var(--color-win)]'
      : headline.tone === 'warn'
        ? 'text-[var(--color-otl)]'
        : 'text-[var(--color-fg-2)]'

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <FootKV k={capturedLabel} v={capturedValue} />
      <FootKV k="Sources" v={sourcesValue} />
      <div className="flex flex-col gap-[2px]">
        <span
          className="cursor-help font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-6)]"
          title={headlineTooltip}
        >
          Confidence
        </span>
        <span className={`font-condensed text-[11px] font-bold tracking-[0.04em] ${headlineTone}`}>
          {headline.word} · {headline.value}
        </span>
      </div>
      {badges.length > 0 ? (
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {badges.map((b) => (
            <SrcBadge key={b.label} label={b.label} tone={b.tone} tooltip={b.tooltip} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function FootKV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-6)]">
        {k}
      </span>
      <span className="font-condensed text-[11px] font-bold tracking-[0.04em] text-[var(--color-fg-3)]">
        {v}
      </span>
    </div>
  )
}

function SrcBadge({
  label,
  tone,
  tooltip,
}: {
  label: string
  tone: 'ok' | 'warn'
  tooltip?: string | undefined
}) {
  const cls =
    tone === 'ok'
      ? 'border-[var(--color-win-border)] bg-[var(--color-win-bg)] text-[var(--color-win)]'
      : 'border-[var(--color-otl-border)] bg-[var(--color-otl-bg)] text-[var(--color-otl)]'
  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-1.5 border px-2 py-[2px] font-condensed text-[9.5px] font-bold uppercase tracking-[0.18em] ${cls}`}
    >
      {label}
    </span>
  )
}

function formatProvenanceTimestamp(d: Date): string {
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** `0.84 → "84%"`, `null → "—"`. */
export function formatProvenancePercent(n: number | null): string {
  if (n === null) return '—'
  return `${String(Math.round(n * 100))}%`
}

/** Shared High/Solid/Partial/Low wording for a 0..1 score. */
export function confidenceWord(score: number): string {
  if (score >= 0.9) return 'High'
  if (score >= 0.7) return 'Solid'
  if (score >= 0.5) return 'Partial'
  return 'Low'
}

/** Shared tone mapping for a 0..1 score (ok ≥ 0.9, warn < 0.6, neutral between). */
export function confidenceTone(score: number): 'ok' | 'neutral' | 'warn' {
  if (score >= 0.9) return 'ok'
  if (score >= 0.6) return 'neutral'
  return 'warn'
}
