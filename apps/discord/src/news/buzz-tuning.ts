/**
 * Buzz tuning on current-contract sheets (C3a.7): reads the job files of a
 * backfill directory (`<dir>/jobs/*.json` or a dir of job files), takes every
 * game sheet, and prints the share of games per buzz level against the
 * targets, posts and articles per game, and the score quantiles that would
 * hit the target shares. Counts only, no names. No database, no network.
 *
 *   node apps/discord/src/news/buzz-tuning.ts .superpowers/backfill-nhl26-tune/jobs [--games 249,250]
 *
 * `--games` also prints the level, score and reasons of those matches.
 *
 * Edit `BUZZ_WEIGHTS` / `BUZZ_CUTOFFS` in packages/db/src/news/buzz.ts, rebuild
 * @eanhl/db and run again. Job files of an older contract are counted as
 * unreadable (the C2 tuning script `apps/web/scripts/news-tuning.ts --buzz`
 * recomputes the labels for those).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  BUZZ_LEVELS,
  BUZZ_TARGET_SHARE,
  parseNewsFactsResponse,
  planBuzz,
  type NewsGameFacts,
  type BuzzLevel,
  type NewsFacts,
} from '@eanhl/db/news'

export interface BuzzDistribution {
  games: number
  levels: Record<BuzzLevel, number>
  postsPerGame: number
  articlesPerGame: number
  /** The score at the 50th, 80th and 95th percentile: the cut-offs for the target shares. */
  quantiles: { normal: number; big: number; huge: number }
}

/** The distribution over the game sheets' games (each match once). */
export function buzzDistribution(sheets: readonly NewsFacts[]): BuzzDistribution {
  const seen = new Set<number>()
  const levels = Object.fromEntries(BUZZ_LEVELS.map((l) => [l, 0])) as Record<BuzzLevel, number>
  const scores: number[] = []
  let posts = 0
  let articles = 0
  for (const facts of sheets) {
    if (facts.kind !== 'game') continue
    for (const g of facts.games) {
      if (seen.has(g.matchId)) continue
      seen.add(g.matchId)
      const plan = planBuzz(g, facts)
      levels[plan.level]++
      scores.push(plan.score)
      posts += plan.posts
      articles += plan.articles.length
    }
  }
  const n = seen.size
  const sorted = [...scores].sort((a, b) => a - b)
  const q = (share: number) =>
    sorted.length === 0
      ? 0
      : sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]!
  return {
    games: n,
    levels,
    postsPerGame: n === 0 ? 0 : posts / n,
    articlesPerGame: n === 0 ? 0 : articles / n,
    quantiles: { normal: q(0.5), big: q(0.8), huge: q(0.95) },
  }
}

export function formatDistribution(d: BuzzDistribution, unreadable: number): string[] {
  const lines = [
    `buzz over ${String(d.games)} games (${String(unreadable)} job file(s) unreadable)`,
  ]
  for (const level of BUZZ_LEVELS) {
    const k = d.levels[level]
    const pct = d.games === 0 ? 0 : (k / d.games) * 100
    lines.push(
      `  ${level.padEnd(8)} ${String(k).padStart(4)}  ${pct.toFixed(1).padStart(5)}%  (target ${(BUZZ_TARGET_SHARE[level] * 100).toFixed(0)}%)`,
    )
  }
  lines.push(
    `  posts per game ${d.postsPerGame.toFixed(2)}; game articles per game ${d.articlesPerGame.toFixed(2)}`,
    `  cut-offs for the targets: normal ~${String(d.quantiles.normal)}, big ~${String(d.quantiles.big)}, huge ~${String(d.quantiles.huge)}`,
  )
  return lines
}

/** One line per asked match: level, posts, score and the reasons (no names). */
export function gameLines(sheets: readonly NewsFacts[], ids: readonly number[]): string[] {
  const out: string[] = []
  for (const id of ids) {
    const facts = sheets.find((f) => f.kind === 'game' && f.games.some((g) => g.matchId === id))
    const g: NewsGameFacts | undefined = facts?.games.find((x) => x.matchId === id)
    if (facts === undefined || g === undefined) {
      out.push(`  g${String(id)}: not found`)
      continue
    }
    const p = planBuzz(g, facts)
    const reasons = p.reasons.map((r) => (r.startsWith('player ') ? 'player' : r))
    out.push(
      `  g${String(id)} ${g.gameMode ?? '-'} ${String(g.scoreFor)}-${String(g.scoreAgainst)} ${g.result}${g.overtime ? ' OT' : ''}: ${p.level} (${String(p.posts)} posts, ${String(p.articles.length)} articles), score ${String(p.score)} — ${reasons.join(', ')}`,
    )
  }
  return out
}

function main(dir: string, ids: readonly number[]): void {
  const sheets: NewsFacts[] = []
  let unreadable = 0
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try {
      const job = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { sheet?: unknown }
      sheets.push(parseNewsFactsResponse(job.sheet).facts)
    } catch {
      unreadable++
    }
  }
  for (const line of formatDistribution(buzzDistribution(sheets), unreadable)) console.log(line)
  for (const line of gameLines(sheets, ids)) console.log(line)
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--games')
  const ids =
    at < 0 ? [] : (process.argv[at + 1] ?? '').split(',').map(Number).filter(Number.isSafeInteger)
  main(process.argv[2] ?? '.superpowers/backfill-nhl26-tune/jobs', ids)
}
