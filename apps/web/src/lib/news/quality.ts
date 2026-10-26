import { REPORTER_IDS, SIGNATURE_WORDS, type ReporterId } from '@eanhl/db/news'

/** One real item of the last 30 days, as the quality dashboard reads it. */
export interface QualityRow {
  reporter: ReporterId
  kind: 'post' | 'article'
  /** WIN, LOSS or OTL for a game post; null for everything else. */
  result: string | null
  body: string
  mentions: { name: string }[]
  zeroCalled: string[]
  takesUsed: number[]
}

export interface CountRow {
  name: string
  count: number
}

export interface QualityReport {
  items: number
  winPosts: { total: number; withCaveat: number; share: number | null }
  signatureUses: { reporter: ReporterId; word: string; count: number }[]
  mentionsPerPlayer: CountRow[]
  zeroCallsPerPlayer: CountRow[]
  takesPerPlayer: CountRow[]
  reporterMix: { reporter: ReporterId; posts: number; articles: number; share: number }[]
}

/** Words that hedge a win ("won, but ..."): the dashboard shows how often win posts carry one. */
export const CAVEAT_WORDS = [
  'but',
  'however',
  'although',
  'though',
  'yet',
  'still',
  'despite',
  'except',
  'unless',
  'only',
  'admittedly',
  'mind you',
  'even so',
] as const

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const wordRe = (w: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(w)}(?![\\p{L}\\p{N}_])`, 'giu')
const CAVEAT_RE = new RegExp(CAVEAT_WORDS.map((w) => wordRe(w).source).join('|'), 'iu')

export function hasCaveat(text: string): boolean {
  return CAVEAT_RE.test(text)
}

function tally(names: string[]): CountRow[] {
  const counts = new Map<string, number>()
  for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/**
 * The quality dashboard's numbers for the items of the last 30 days (spec §12.18-6).
 * Pure: `takePlayers` maps a take id to its player's name (admin only data).
 */
export function qualityReport(
  rows: readonly QualityRow[],
  takePlayers: ReadonlyMap<number, string>,
): QualityReport {
  const winPosts = rows.filter((r) => r.kind === 'post' && r.result === 'WIN')
  const withCaveat = winPosts.filter((r) => hasCaveat(r.body)).length

  const signatureUses: QualityReport['signatureUses'] = []
  for (const id of REPORTER_IDS) {
    const text = rows
      .filter((r) => r.reporter === id)
      .map((r) => r.body)
      .join('\n')
    for (const word of SIGNATURE_WORDS[id]) {
      const count = [...text.matchAll(wordRe(word))].length
      if (count > 0) signatureUses.push({ reporter: id, word, count })
    }
  }
  signatureUses.sort((a, b) => b.count - a.count || a.word.localeCompare(b.word))

  return {
    items: rows.length,
    winPosts: {
      total: winPosts.length,
      withCaveat,
      share: winPosts.length === 0 ? null : withCaveat / winPosts.length,
    },
    signatureUses,
    mentionsPerPlayer: tally(rows.flatMap((r) => r.mentions.map((m) => m.name))),
    zeroCallsPerPlayer: tally(rows.flatMap((r) => r.zeroCalled)),
    takesPerPlayer: tally(
      rows.flatMap((r) => r.takesUsed.map((id) => takePlayers.get(id) ?? 'unknown take')),
    ),
    reporterMix: REPORTER_IDS.map((id) => {
      const mine = rows.filter((r) => r.reporter === id)
      return {
        reporter: id,
        posts: mine.filter((r) => r.kind === 'post').length,
        articles: mine.filter((r) => r.kind === 'article').length,
        share: rows.length === 0 ? 0 : mine.length / rows.length,
      }
    }),
  }
}
