/** USD per 1M tokens. Cached 2026-10-06 from the claude-api skill. */
interface PriceRow {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const OPUS_5_5: PriceRow = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }

const PRICES: Readonly<Record<string, PriceRow>> = {
  'claude-opus-5-5': OPUS_5_5,
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
}

export interface Usage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

/** Cost of one API call in USD. An unknown model is priced as Opus 5.5 (the dearest row, so the limit errs safe). */
export function costUsd(model: string, usage: Usage): number {
  const p = PRICES[model] ?? OPUS_5_5
  return (
    (usage.input_tokens * p.input +
      usage.output_tokens * p.output +
      (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite) /
    1_000_000
  )
}
