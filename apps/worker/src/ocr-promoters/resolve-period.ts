/**
 * Period-resolution helpers shared by the action-tracker and events promoters.
 *
 * **Live capture layout.** Recordings are segmented as
 * `…/<sha>/pass2/seg-NNN-<screen_type>/00001.png` — the folder names a SCREEN,
 * not a period. `periodFromPath` therefore returns null for every current
 * capture; it only still recognises the retired `…/1st-Period-Events/`,
 * `…/2nd-Period-Events/`, `…/3rd-Period-Events/`, `…/OT-Events/` scheme, kept
 * so legacy re-ingests keep working. (Mirrors
 * `tools/game_ocr/scripts/inventory_consensus_match.py:period_from_path`.)
 *
 * **Why a path fallback existed at all.** When OCR mis-parses a period_label
 * (e.g. trailing garbage like "11.1" defeats the regex, leaving
 * period_number = -1) something has to supply the period or the row is dropped.
 * Under the old layout the folder was that something. Under seg-NNN it is not,
 * so the payload itself has to carry the answer.
 *
 * **Recovering the period from the payload.** The post-game Events screen is a
 * scrolling list whose rows are grouped under "1ST PERIOD" / "2ND PERIOD" /
 * "3RD PERIOD" header lines. `parse_post_game_events` seeds
 * `current_period_label = '?'` and only updates it when it passes a header
 * (parsers.py:2314-2325), so an unlabelled row is not noise — it is the
 * positional fact *"this row was rendered above the frame's first visible
 * header"*. Its period is therefore the one BEFORE that first header: the
 * group it belongs to had its header scrolled off the top of the window.
 *
 * That rule was validated against 160 unlabelled rows whose true period is
 * independently known, because a sibling frame of the same segment scrolled
 * differently and did capture their header: **159 correct**. The lone miss has
 * self-contradictory ground truth (the same event was read as 1ST in one frame
 * and 2ND in another). Note the rule is exact when the first header is "2ND"
 * (only the 1st period can precede it) and an inference when it is later, so
 * recovered rows are counted separately by the promoter rather than being
 * folded silently into the normal path.
 */

/** Screen labels for period numbers, matching what the Events screen renders. */
const PERIOD_LABELS: Record<number, string> = {
  1: '1ST',
  2: '2ND',
  3: '3RD',
  4: 'OT',
  5: 'OT2',
  6: 'OT3',
}

/** How a row's period was determined. Reported in promoter stats. */
export type PeriodBasis = 'payload' | 'preceding-header' | 'path' | 'unresolved'

export interface ResolvedPeriod {
  /** Resolved period, or a value < 1 when it could not be determined. */
  period: number
  basis: PeriodBasis
}

/** Canonical screen label for a period number, or null outside 1..6. */
export function canonicalPeriodLabel(period: number): string | null {
  return PERIOD_LABELS[period] ?? null
}

export function periodFromPath(sourcePath: string): number | null {
  const parts = sourcePath.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  const folder = (parts.length >= 2 ? (parts[parts.length - 2] ?? '') : '').toLowerCase()
  if (folder.includes('1st')) return 1
  if (folder.includes('2nd')) return 2
  if (folder.includes('3rd')) return 3
  if (folder.includes('ot')) return 4
  return null
}

/**
 * Period of the first row in the frame that carries one, in LIST order.
 *
 * List order — not the minimum — because the bound on an unlabelled row is the
 * header it was rendered above, which is the first one encountered. Returns
 * null when no row in the frame is labelled, in which case nothing bounds the
 * unlabelled rows and they must stay unresolved.
 */
export function firstLabeledPeriod(
  events: ReadonlyArray<{ period_number?: number | null }>,
): number | null {
  for (const ev of events) {
    const n = ev.period_number
    if (typeof n === 'number' && n >= 1) return n
  }
  return null
}

/**
 * Resolve the period for one post-game Events row.
 *
 * Precedence: the row's own parsed period → the period implied by the frame's
 * first header → the (legacy) folder name. Never defaults to a period it cannot
 * justify: an unresolvable row keeps a value < 1 so the caller still skips it
 * and counts it.
 */
export function resolveEventPeriod(
  eventPeriod: number,
  sourcePath: string,
  firstLabeled: number | null,
): ResolvedPeriod {
  if (eventPeriod >= 1) return { period: eventPeriod, basis: 'payload' }

  // Prefer the payload: a seg-NNN folder cannot identify a period, and even
  // under the legacy layout the frame's own headers are the finer-grained
  // evidence. `firstLabeled >= 2` is required because nothing precedes the 1st
  // period — an unlabelled row above a "1ST PERIOD" header is a contradiction
  // (misread header, or a row bleeding in from an adjacent screen), so it is
  // reported rather than guessed.
  if (firstLabeled !== null && firstLabeled >= 2) {
    return { period: firstLabeled - 1, basis: 'preceding-header' }
  }

  const fromPath = periodFromPath(sourcePath)
  if (fromPath !== null) return { period: fromPath, basis: 'path' }

  return { period: eventPeriod, basis: 'unresolved' }
}

/**
 * Legacy path-only resolver, still used by the action-tracker promoter, whose
 * screens carry a single period_label per frame rather than a scrolling list of
 * per-row headers. Behaviour intentionally unchanged.
 */
export function resolvePeriod(eventPeriod: number, sourcePath: string): number {
  if (eventPeriod >= 1) return eventPeriod
  return periodFromPath(sourcePath) ?? eventPeriod
}
