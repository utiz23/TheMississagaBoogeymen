// Team norms for the news desk fact sheets (Part C1.2, spec §12.10): what is
// normal for the club in a title, so a writer can tell news from habit. Pure;
// the loader reads the earlier games (`listNewsNormGames`) and the sheet's own.
import type {
  NewsGameFacts,
  NewsNormLabels,
  NewsNorms,
  NewsNormStat,
  NormLabel,
  NormLabelKey,
} from '@eanhl/db/news'
import type { NewsNormGame } from '@eanhl/db/queries'
import { isEndedEarly, passPctOf } from './build-facts.ts'

/** Norms appear from the 10th counted game of a title; each stat and label needs 10 games with its numbers. */
export const MIN_NORM_GAMES = 10
/** Outside this percentile band of the club's own games a number is unusual. */
const LOW_Q = 0.2
const HIGH_Q = 0.8

/** One counted game's numbers as the match page shows them, both sides. */
export interface NormGameInput {
  endedEarly: boolean
  hitsFor: number
  hitsAgainst: number
  shotsFor: number
  shotsAgainst: number
  timeOnAttack: number | null
  timeOnAttackAgainst: number | null
  /** Pass % one decimal (the page's Pass % row); null without attempts. */
  passPct: number | null
  passPctAgainst: number | null
  ppGoals: number | null
  ppOpportunities: number | null
  ppGoalsAgainst: number | null
  ppOpportunitiesAgainst: number | null
}

/** An earlier game from the database as a norm input (pass % and the ended-early rule as on the sheet). */
export function normInputFromRow(r: NewsNormGame): NormGameInput {
  return {
    endedEarly: isEndedEarly({
      scoreFor: r.scoreFor,
      creditedGoals: r.creditedGoals,
      timeOnAttack: r.timeOnAttack,
      shots: { for: r.shotsFor, against: r.shotsAgainst },
    }),
    hitsFor: r.hitsFor,
    hitsAgainst: r.hitsAgainst,
    shotsFor: r.shotsFor,
    shotsAgainst: r.shotsAgainst,
    timeOnAttack: r.timeOnAttack,
    timeOnAttackAgainst: r.timeOnAttackAgainst,
    passPct: passPctOf(r.passCompletions, r.passAttempts),
    passPctAgainst: passPctOf(r.passCompletionsAgainst, r.passAttemptsAgainst),
    ppGoals: r.ppGoals,
    ppOpportunities: r.ppOpportunities,
    ppGoalsAgainst: r.ppGoalsAgainst,
    ppOpportunitiesAgainst: r.ppOpportunitiesAgainst,
  }
}

const round1 = (n: number): number => Math.round(n * 10) / 10
const mean = (v: readonly number[]): number => v.reduce((a, b) => a + b, 0) / v.length

/** The q-quantile of ascending `sorted` values, linear between neighbours. */
export function percentile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const a = sorted[lo]!
  const b = sorted[hi]!
  return round1e9(a + (b - a) * (pos - lo))
}

/** Removes float noise (2.8000000000000003 -> 2.8) without changing real values. */
const round1e9 = (n: number): number => Math.round(n * 1e9) / 1e9

type Pair = [ours: number, theirs: number]

/** Average both sides and the % of games the club had more; null under 10 pairs. */
function normOf(pairs: readonly Pair[]): NewsNormStat | null {
  if (pairs.length < MIN_NORM_GAMES) return null
  return {
    ours: round1(mean(pairs.map((p) => p[0]))),
    theirs: round1(mean(pairs.map((p) => p[1]))),
    leadPct: round1((pairs.filter((p) => p[0] > p[1]).length / pairs.length) * 100),
  }
}

function pairs(
  games: readonly NormGameInput[],
  pick: (g: NormGameInput) => [number | null, number | null],
): Pair[] {
  return games.flatMap((g) => {
    const [a, b] = pick(g)
    return a === null || b === null ? [] : [[a, b] as Pair]
  })
}

/**
 * Power play: all goals over all opportunities per side (a per-game mean of
 * percentages means little with 0-2 chances a game). The lead compares each
 * game's PP %, a side without a chance at 0%. Null under 10 games with all
 * four numbers, or when a side had no chance at all.
 */
function ppNorm(games: readonly NormGameInput[]): NewsNormStat | null {
  const rows = games.flatMap((g) =>
    g.ppGoals === null ||
    g.ppOpportunities === null ||
    g.ppGoalsAgainst === null ||
    g.ppOpportunitiesAgainst === null
      ? []
      : [[g.ppGoals, g.ppOpportunities, g.ppGoalsAgainst, g.ppOpportunitiesAgainst] as const],
  )
  if (rows.length < MIN_NORM_GAMES) return null
  const sum = (i: 0 | 1 | 2 | 3) => rows.reduce((n, r) => n + r[i], 0)
  if (sum(1) === 0 || sum(3) === 0) return null
  const pct = (goals: number, chances: number) => (chances > 0 ? goals / chances : 0)
  return {
    ours: round1((sum(0) / sum(1)) * 100),
    theirs: round1((sum(2) / sum(3)) * 100),
    leadPct: round1(
      (rows.filter((r) => pct(r[0], r[1]) > pct(r[2], r[3])).length / rows.length) * 100,
    ),
  }
}

/** The norms from the earlier games (callers leave out games that ended early); null under 10 games. */
export function buildNorms(sample: readonly NormGameInput[]): NewsNorms | null {
  if (sample.length < MIN_NORM_GAMES) return null
  return {
    sampleGames: sample.length,
    hits: normOf(pairs(sample, (g) => [g.hitsFor, g.hitsAgainst])),
    shots: normOf(pairs(sample, (g) => [g.shotsFor, g.shotsAgainst])),
    timeOnAttack: normOf(pairs(sample, (g) => [g.timeOnAttack, g.timeOnAttackAgainst])),
    passPct: normOf(pairs(sample, (g) => [g.passPct, g.passPctAgainst])),
    ppPct: ppNorm(sample),
  }
}

const LABEL_VALUE: Record<NormLabelKey, (g: NormGameInput) => number | null> = {
  hitsFor: (g) => g.hitsFor,
  hitsAgainst: (g) => g.hitsAgainst,
  shotsFor: (g) => g.shotsFor,
  shotsAgainst: (g) => g.shotsAgainst,
  timeOnAttack: (g) => g.timeOnAttack,
  passPct: (g) => g.passPct,
}

/**
 * Each number of the game against the club's own earlier games: below the
 * 20th percentile "unusually low", above the 80th "unusually high", else
 * "typical". Null when the game lacks the number or fewer than 10 earlier
 * games have it.
 */
export function normLabels(game: NormGameInput, sample: readonly NormGameInput[]): NewsNormLabels {
  const label = (key: NormLabelKey): NormLabel | null => {
    const value = LABEL_VALUE[key](game)
    if (value === null) return null
    const values = sample
      .map(LABEL_VALUE[key])
      .filter((v): v is number => v !== null)
      .sort((a, b) => a - b)
    if (values.length < MIN_NORM_GAMES) return null
    if (value < percentile(values, LOW_Q)) return 'unusually low'
    if (value > percentile(values, HIGH_Q)) return 'unusually high'
    return 'typical'
  }
  return {
    hitsFor: label('hitsFor'),
    hitsAgainst: label('hitsAgainst'),
    shotsFor: label('shotsFor'),
    shotsAgainst: label('shotsAgainst'),
    timeOnAttack: label('timeOnAttack'),
    passPct: label('passPct'),
  }
}

type Side = 'us' | 'them' | 'tie'

/**
 * The three patterns (spec §12.10) and their words, by the side that had
 * more. The club is always named, so a pattern never reads the wrong way round.
 */
const PATTERNS: {
  side: (g: NormGameInput) => Side | null
  phrase: Record<'us' | 'them', string>
}[] = [
  {
    side: (g) => compare(g.hitsFor, g.hitsAgainst),
    phrase: { us: 'the Boogeymen out-hit the opponent', them: 'the Boogeymen were out-hit' },
  },
  {
    side: (g) => compare(g.shotsFor, g.shotsAgainst),
    phrase: { us: 'the Boogeymen out-shot the opponent', them: 'the Boogeymen were out-shot' },
  },
  {
    side: (g) => compare(g.timeOnAttack, g.timeOnAttackAgainst),
    phrase: {
      us: 'the Boogeymen had more time on attack',
      them: 'the Boogeymen had less time on attack',
    },
  },
]

/** A broken pattern is news only after at least this many games without it. */
const MIN_PATTERN_GAP = 3

function compare(ours: number | null, theirs: number | null): Side | null {
  if (ours === null || theirs === null) return null
  return ours > theirs ? 'us' : ours < theirs ? 'them' : 'tie'
}

/** 1st, 2nd, 3rd, 4th, ..., 11th-13th, 21st. */
export function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${String(n)}th`
  const suffix = ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'
  return `${String(n)}${suffix}`
}

/**
 * The usual patterns held or broken in this game, each naming the club.
 * Usual = the side that had more in most of the earlier games (`sample`); an
 * even split is no pattern. Held: "<phrase> as usual". Broken (the other
 * side had more):
 * - never before in the earlier games: "<phrase> for the first time this title";
 * - after a gap of at least 3 games: "<phrase> for the first time in N games"
 *   (N = this game and the games since it last happened); a shorter gap is no
 *   pattern;
 * - the game before broke it too: "<phrase> for the Nth game in a row".
 * A tie or an unknown number is no pattern; an earlier tie counts as "not it".
 * `previous` = the earlier games, oldest first (no game that ended early).
 */
export function gamePatterns(
  game: NormGameInput,
  previous: readonly NormGameInput[],
  sample: readonly NormGameInput[],
): string[] {
  const out: string[] = []
  for (const p of PATTERNS) {
    const side = p.side(game)
    if (side === null || side === 'tie') continue
    const sides = sample.map(p.side)
    const us = sides.filter((s) => s === 'us').length
    const them = sides.filter((s) => s === 'them').length
    if (us === them) continue
    const usual = us > them ? 'us' : 'them'
    const phrase = p.phrase[side]
    if (side === usual) {
      out.push(`${phrase} as usual`)
      continue
    }
    const known = previous
      .map(p.side)
      .filter((s): s is Side => s !== null)
      .reverse() // newest first
    const since = known.findIndex((s) => s === side)
    if (since === -1) {
      out.push(`${phrase} for the first time this title`)
    } else if (since === 0) {
      const streak = known.findIndex((s) => s !== side)
      const inRow = (streak === -1 ? known.length : streak) + 1
      out.push(`${phrase} for the ${ordinal(inRow)} game in a row`)
    } else if (since >= MIN_PATTERN_GAP) {
      out.push(`${phrase} for the first time in ${String(since + 1)} games`)
    }
  }
  return out
}

/**
 * The sheet's norms and each game's labels and patterns. `inputs[i]` is
 * `games[i]`'s numbers; `history` = the title's counted games before the
 * sheet's first game, oldest first. Games that ended early are left out of
 * the norms and get no labels or patterns; a later game of the sheet sees
 * the earlier ones for its patterns (the norms do not).
 */
export function applyNorms(
  games: readonly NewsGameFacts[],
  inputs: readonly NormGameInput[],
  history: readonly NormGameInput[],
): { norms: NewsNorms | null; games: NewsGameFacts[] } {
  const sample = history.filter((h) => !h.endedEarly)
  const norms = buildNorms(sample)
  if (norms === null)
    return { norms, games: games.map((g) => ({ ...g, labels: null, patterns: [] })) }
  const previous = [...sample]
  const out = games.map((g, i) => {
    const input = inputs[i]
    if (g.endedEarly || input === undefined || input.endedEarly) {
      return { ...g, labels: null, patterns: [] }
    }
    const withNorms = {
      ...g,
      labels: normLabels(input, sample),
      patterns: gamePatterns(input, previous, sample),
    }
    previous.push(input)
    return withNorms
  })
  return { norms, games: out }
}
