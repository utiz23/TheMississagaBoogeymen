const isNum = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v)

/**
 * Numeric comparator that keeps unavailable values (null, NaN, ±Infinity) LAST
 * in both directions. Returns 0 for two unavailable values.
 */
export function compareNullsLast(
  a: number | null | undefined,
  b: number | null | undefined,
  asc: boolean,
): number {
  const aOk = isNum(a)
  const bOk = isNum(b)
  if (!aOk && !bOk) return 0
  if (!aOk) return 1
  if (!bOk) return -1
  return asc ? a - b : b - a
}

/** Sort a copy of `rows`; ties broken by name so ordering is stable and deterministic. */
export function sortRows<R>(
  rows: readonly R[],
  getValue: (row: R) => number | null,
  getName: (row: R) => string,
  asc: boolean,
): R[] {
  return rows.slice().sort((x, y) => {
    const c = compareNullsLast(getValue(x), getValue(y), asc)
    return c !== 0 ? c : getName(x).localeCompare(getName(y))
  })
}

export interface SortState {
  key: string | null
  /** null = use the metric's default direction. */
  asc: boolean | null
}

/** Header click: same column flips direction, a new column starts at its default. */
export function nextSort(activeKey: string, activeAsc: boolean, clickedKey: string): SortState {
  return clickedKey === activeKey
    ? { key: clickedKey, asc: !activeAsc }
    : { key: clickedKey, asc: null }
}
