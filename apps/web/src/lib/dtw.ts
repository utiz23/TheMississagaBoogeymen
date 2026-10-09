/**
 * Deserve-to-Win bands, shared by every DtW readout (home chip legend, game
 * cards) so a number's colour always means the same thing.
 */
export const DTW_BANDS = [
  { min: 75, color: '#38bdf8', label: '75+ Dominated' },
  { min: 55, color: '#10b981', label: '55–74 Good' },
  { min: 35, color: '#f59e0b', label: '35–54 Even' },
  { min: -Infinity, color: '#e84131', label: '0–34 Bad' },
] as const

export function dtwBandColor(raw: number): string {
  return DTW_BANDS.find((b) => raw >= b.min)?.color ?? '#e84131'
}
