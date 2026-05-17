/**
 * Period-resolution helpers shared by the action-tracker and events promoters.
 *
 * The recordings are organised on disk as `…/1st-Period-Events/`,
 * `…/2nd-Period-Events/`, `…/3rd-Period-Events/`, `…/OT-Events/`. When OCR
 * mis-parses the period_label (e.g. picks up extra garbage like "11.1" at the
 * end and the regex bails out, leaving period_number = -1), the folder name
 * is the authoritative fallback. Mirrors the same fallback used in
 * `tools/game_ocr/scripts/inventory_consensus_match.py:period_from_path`.
 */

export function periodFromPath(sourcePath: string): number | null {
  const parts = sourcePath.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
  const folder = (parts.length >= 2 ? (parts[parts.length - 2] ?? '') : '').toLowerCase()
  if (folder.includes('1st')) return 1
  if (folder.includes('2nd')) return 2
  if (folder.includes('3rd')) return 3
  if (folder.includes('ot')) return 4
  return null
}

export function resolvePeriod(eventPeriod: number, sourcePath: string): number {
  if (eventPeriod >= 1) return eventPeriod
  return periodFromPath(sourcePath) ?? eventPeriod
}
