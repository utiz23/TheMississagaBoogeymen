import type { ReporterId } from './reporters.js'

/**
 * The weekly feature kinds (spec §12.3), in rotation order. `rink` is the
 * occasional Father Rink column (his frequency limit still applies). Stored in
 * `news_items.feature_kind` (migration 0071).
 */
export const FEATURE_KINDS = ['trend', 'spotlight', 'notes', 'bigpicture', 'rink'] as const
export type FeatureKind = (typeof FEATURE_KINDS)[number]

/** Who writes each kind of weekly feature. */
export const FEATURE_REPORTER: Readonly<Record<FeatureKind, ReporterId>> = {
  trend: 'quill',
  spotlight: 'voss',
  notes: 'pettibone',
  bigpicture: 'bergstrom',
  rink: 'rink',
}
