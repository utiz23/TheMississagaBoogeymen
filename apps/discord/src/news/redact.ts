import type { NewsTake } from '@eanhl/db/news'

/**
 * Take texts are GM-only lore (spec §12.19): they must never reach a job's
 * error, a log line or a backfill status file (C3a fix I1). `redactTakes`
 * replaces every run of `REDACT_MIN_WORDS` or more consecutive words of an
 * offered take (case and punctuation ignored) with "take N".
 */
export const REDACT_MIN_WORDS = 4

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const wordsOf = (t: string): string[] => t.split(/[^\p{L}\p{N}']+/u).filter((w) => w !== '')

export function redactTakes(text: string, takes: readonly Pick<NewsTake, 'id' | 'take'>[]): string {
  let out = text
  for (const t of takes) {
    const words = wordsOf(t.take)
    if (words.length === 0) continue
    const n = Math.min(REDACT_MIN_WORDS, words.length)
    const spans: [number, number][] = []
    for (let i = 0; i + n <= words.length; i++) {
      const re = new RegExp(
        `(?<![\\p{L}\\p{N}])${words
          .slice(i, i + n)
          .map(escapeRegExp)
          .join("[^\\p{L}\\p{N}']+")}(?![\\p{L}\\p{N}])`,
        'giu',
      )
      for (const m of out.matchAll(re)) spans.push([m.index ?? 0, (m.index ?? 0) + m[0].length])
    }
    if (spans.length === 0) continue
    spans.sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = []
    for (const s of spans) {
      const last = merged[merged.length - 1]
      // Spans of one quoted run touch or overlap (separated by punctuation or a space at most).
      if (last !== undefined && s[0] <= last[1] + 2) last[1] = Math.max(last[1], s[1])
      else merged.push([...s])
    }
    for (const [a, b] of merged.reverse()) {
      out = `${out.slice(0, a)}take ${String(t.id)}${out.slice(b)}`
    }
  }
  return out
}
