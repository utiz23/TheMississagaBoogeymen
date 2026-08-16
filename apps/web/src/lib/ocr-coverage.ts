/**
 * OCR coverage tiers for the games-list pill.
 *
 * A match carries up to three INDEPENDENT OCR streams, each promoted by its
 * own pipeline and each able to land without the others:
 *
 *   loadouts — pre-game loadout snapshots (gates the LOADOUTS tab)
 *   periods  — reviewed OCR per-period box score rows
 *   events   — reviewed OCR action-tracker events (timeline, shot map, faceoffs)
 *
 * The tier is the COUNT of streams present, not a weighting of them: the pill
 * answers "how much of this match was captured", and a viewer cannot act on a
 * ranking between streams. Presence is measured against what the match page
 * actually publishes — see getOcrCoverageForMatches, which admits each stream
 * on the same rule its own enrichment query uses, so the pill can never
 * promise data the page then withholds:
 *
 *   loadouts — existence only, no review gate (matches getMatchLineups, which
 *              treats review status as row-selection precedence, not admission)
 *   periods  — at least one of the three independent stat families (goals /
 *              shots / faceoffs) is reviewed (matches getMatchPeriodSummaries'
 *              per-family row-retention rule, migration 0056)
 *   events   — the whole row's `review_status` is reviewed (matches
 *              getMatchEvents; match_events was never split into families)
 */

export type OcrCoverageTier = 'full' | 'partial' | 'minimal' | 'none'

export interface OcrCoverageStreams {
  loadouts: boolean
  periods: boolean
  events: boolean
}

export interface OcrCoverageStyle {
  /** Pill text. */
  label: string
  /** Status-dot colour — the only colour-bearing element of the pill. */
  dot: string
  /** Tailwind classes for the pill body. */
  container: string
  /** `title` attribute — the only place the N-of-3 count is stated. */
  title: string
}

export function ocrCoverageStreamCount(streams: OcrCoverageStreams): number {
  return Number(streams.loadouts) + Number(streams.periods) + Number(streams.events)
}

export function ocrCoverageTier(streams: OcrCoverageStreams): OcrCoverageTier {
  switch (ocrCoverageStreamCount(streams)) {
    case 3:
      return 'full'
    case 2:
      return 'partial'
    case 1:
      return 'minimal'
    default:
      return 'none'
  }
}

/**
 * Pill presentation per tier, or `null` for `none` — a match with no OCR at
 * all renders no pill rather than an empty-state one, so the marker reads as
 * "this match has capture" instead of adding a row to every card.
 *
 * The colour lives in a DOT on a neutral zinc body rather than in a filled
 * pill. The score card's chip cluster already spends filled green and filled
 * red on Dominated / Outshot, and the result pill beside it spends emerald and
 * rose on WIN / LOSS — a filled red OCR pill would read as a verdict on the
 * game, which is the opposite of what it means. The dot keeps the requested
 * red/orange/green semantics while staying metadata.
 */
const STYLES: Record<Exclude<OcrCoverageTier, 'none'>, OcrCoverageStyle> = {
  full: {
    label: 'Full OCR',
    dot: 'bg-[#22c55e]',
    container: 'border-[rgba(34,197,94,0.35)] bg-[rgba(34,197,94,0.07)] text-[#a7b3ab]',
    title: 'Full OCR capture — 3 of 3 streams (loadouts, periods, events)',
  },
  partial: {
    label: 'Partial OCR',
    dot: 'bg-[#f59e0b]',
    container: 'border-[rgba(245,158,11,0.35)] bg-[rgba(245,158,11,0.07)] text-[#b5aea0]',
    title: 'Partial OCR capture — 2 of 3 streams (loadouts, periods, events)',
  },
  minimal: {
    label: 'Minimal OCR',
    dot: 'bg-[#ef4444]',
    container: 'border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.07)] text-[#b5a5a3]',
    title: 'Minimal OCR capture — 1 of 3 streams (loadouts, periods, events)',
  },
}

export function getOcrCoverageStyle(tier: OcrCoverageTier): OcrCoverageStyle | null {
  return tier === 'none' ? null : STYLES[tier]
}
