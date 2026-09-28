import { formatValue, perGame, type FormatId } from './format.ts'

/**
 * Row-specific annotation for a cell — used by career TOI/GAA coverage, but
 * generic: any metric can attach one. `srText` is always present so the
 * information is never conveyed by a mouse-only tooltip alone; `marker` is
 * the short visible glyph (e.g. "*") appended to the cell text.
 */
export interface CellAnnotation {
  marker?: string
  srText: string
}

export interface Metric<R> {
  key: string
  label: string
  /** Tooltip / stat-key text. */
  full: string
  /** Numeric value used for sorting and per-game division. */
  value: (row: R) => number | null
  format: FormatId
  /** Exact display text for supplied strings (FO%, SV%, GAA …) so stored precision is kept. */
  text?: (row: R) => string
  /** Eligible for the Per GP toggle; digits or a time format for the per-game value. */
  perGame?: { format: FormatId }
  /** Smaller sorts higher by default. */
  sortAsc?: boolean
  /** Only available when EA expanded data is present (Active title + All mode). */
  expanded?: boolean
  /** Optional per-row coverage/annotation for this cell (e.g. career TOI/GAA coverage). */
  annotate?: (row: R, perGameMode: boolean) => CellAnnotation | undefined
}

export type MetricMap<R> = Record<string, Metric<R>>

export interface Cell {
  value: number | null
  text: string
  annotation?: CellAnnotation
}

/** Resolve a metric's sortable value and display text for one row. */
export function resolveCell<R extends { gamesPlayed: number | null }>(
  metric: Metric<R>,
  row: R,
  perGameMode: boolean,
): Cell {
  const annotation = metric.annotate?.(row, perGameMode)
  if (perGameMode && metric.perGame) {
    const v = perGame(metric.value(row), row.gamesPlayed)
    return {
      value: v,
      text: formatValue(metric.perGame.format, v),
      ...(annotation ? { annotation } : {}),
    }
  }
  const v = metric.value(row)
  return {
    value: v,
    text: metric.text ? metric.text(row) : formatValue(metric.format, v),
    ...(annotation ? { annotation } : {}),
  }
}

/** Header label; Per GP appends "/GP" to eligible metrics only. */
export function metricLabel<R>(metric: Metric<R>, perGameMode: boolean): string {
  return perGameMode && metric.perGame ? `${metric.label}/GP` : metric.label
}
