// Bounded parallel map for the fact-sheet loader (C2 fix A): a week sheet
// loads 20-30 games, each a handful of queries; one at a time took ~1 s per
// game. Results keep the input order. The database pool has 10 connections,
// so a small limit keeps other requests served.

/** Map `items` with at most `limit` calls in flight; results in input order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!, i)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}

/**
 * A value cached for `ttlMs` (module level, so it lasts across requests of
 * one server process). A failed load is not cached.
 */
export function memoize<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now) {
  let cached: { at: number; value: Promise<T> } | null = null
  return (): Promise<T> => {
    if (cached !== null && now() - cached.at < ttlMs) return cached.value
    const value = load()
    cached = { at: now(), value }
    value.catch(() => {
      if (cached?.value === value) cached = null
    })
    return value
  }
}
