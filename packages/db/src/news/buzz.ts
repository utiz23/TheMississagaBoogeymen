import type { NewsFacts, NewsGameFacts, NewsGoal } from './contract.js'

/**
 * Buzz (C3a.7, spec §12.14 and §12.18-1/2): how many reporters post about a
 * game and which articles it gets. Pure and seeded (the same game always
 * gets the same plan). The score is built from the sheet's labels (C2), a
 * 6s game weighs more than a 3s game, a new club record makes a game
 * historic, and a game that ended early stays quiet.
 *
 * Every weight and cut-off is a constant here so tuning is one edit:
 * `apps/web/scripts/news-tuning.ts --buzz <jobs dir>` (the C2 tuning script)
 * prints the share per level on the backfill sheets, and
 * `apps/discord/src/news/buzz-tuning.ts <jobs dir>` does the same on
 * current-contract job sheets and suggests cut-offs for the target shares.
 */

export const BUZZ_LEVELS = ['quiet', 'normal', 'big', 'huge', 'historic'] as const
export type BuzzLevel = (typeof BUZZ_LEVELS)[number]

/** Target share of games per level (spec §12.14; mean ≈ 2.1 posts a game). */
export const BUZZ_TARGET_SHARE: Readonly<Record<BuzzLevel, number>> = {
  quiet: 0.5,
  normal: 0.3,
  big: 0.15,
  huge: 0.04,
  historic: 0.01,
}

/** Score weights (Claude's call; tune here). */
export const BUZZ_WEIGHTS = {
  overtime: 2,
  blowout: 3,
  close: 1,
  /** Both teams' goals together at least `manyGoals`. */
  manyGoalsTotal: 10,
  manyGoals: 1,
  /** Won after trailing by 2 or more (goal timeline). */
  comeback: 2,
  /** The winning goal in the last 2 minutes of the 3rd period (goal timeline). */
  lateWinner: 1,
  /** A 2+ goal lead the opponent tied or passed (buzz fix 2). */
  leadBlown: 2,
  /** A game-tying goal in the last 2 minutes of the 3rd, either side. */
  lateEqualizer: 2,
  /** The club won after blowing a lead. */
  winAfterBlown: 1,
  hatTrick: 3,
  fivePoints: 3,
  /** At most this much from one player's line ... */
  playerMax: 4,
  /** ... and from all player lines of the game together. */
  playersMax: 5,
  bigForHim: 0.5,
  careerHigh: 2,
  seasonHigh: 0.5,
  firstHatTrick: 1,
  firstGoal: 0.5,
  clubDebut: 1,
  /** A run at a round count (`STREAK_ROUND`: 5, 10, 15, ...) or any run or slump that ended. */
  streak: 0.5,
  milestone: 2,
  milestoneMax: 4,
  seasonBestNote: 2,
  titleMilestoneNote: 2,
  longestStreakNote: 1,
  result: { rolling: 1, blip: 2, slide: 1, panic: 3, turnaround: 2, normal: 0 },
  surprise: { expected: 0, upset: 2, 'big upset': 3 },
  aiMeltdown: 2,
  aiSteal: 2,
  shutout: 2,
  threadClosed: 1,
  threadMax: 2,
  revenge: 1,
  patternBroken: 0.5,
  patternMax: 1,
} as const

/** "Late": the last this many seconds of the 3rd period. */
export const LATE_SECONDS = 120

/** A player run adds buzz at every this many games (5, 10, 15, ...). */
export const STREAK_ROUND = 5

/** 6s weighs more than 3s (spec §12.18-2). */
export const BUZZ_MODE_FACTOR: Readonly<Record<'3s' | '6s' | 'none', number>> = {
  '6s': 1.25,
  '3s': 0.8,
  none: 1,
}

/** The lowest score of each level (a new club record is always historic). */
export const BUZZ_CUTOFFS = { normal: 4, big: 8, huge: 11.5 } as const

/** Posts per level, as weighted choices (spec §12.14). */
export const BUZZ_POSTS: Readonly<Record<BuzzLevel, readonly (readonly [number, number])[]>> = {
  quiet: [[1, 1]],
  normal: [[2, 1]],
  big: [
    [3, 0.5],
    [4, 0.3],
    [5, 0.2],
  ],
  huge: [
    [6, 0.5],
    [7, 0.3],
    [8, 0.2],
  ],
  historic: [[9, 1]],
}

/** The articles a big game gets on top of the night recap (spec §12.18-1). */
export const GAME_ARTICLE_KINDS = ['game', 'spotlight', 'column'] as const
export type GameArticleKind = (typeof GAME_ARTICLE_KINDS)[number]

/** Seeded PRNG (mulberry32): the same seed always gives the same draws. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One weighted choice. */
export function weightedPick<T>(choices: readonly (readonly [T, number])[], rng: () => number): T {
  const total = choices.reduce((n, [, w]) => n + w, 0)
  let r = rng() * total
  for (const [v, w] of choices) {
    r -= w
    if (r < 0) return v
  }
  return choices[choices.length - 1]![0]
}

const clockSeconds = (clock: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(clock)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** Seconds left in the period when a goal came, or null (elapsed clocks of a 20-minute period). */
function secondsLeft(goal: NewsGoal, meaning: NewsGameFacts['clockMeaning']): number | null {
  const s = clockSeconds(goal.clock)
  if (s === null) return null
  return meaning === 'remaining' ? s : 20 * 60 - s
}

/** The last 2 minutes of the 3rd period. */
const isLate = (goal: NewsGoal, meaning: NewsGameFacts['clockMeaning']): boolean => {
  if (goal.period !== '3rd') return false
  const left = secondsLeft(goal, meaning)
  return left !== null && left <= LATE_SECONDS
}

/**
 * Timeline hooks (buzz fix 2): a comeback from 2+ down and a late winner (a
 * win); a lead of 2+ blown (the opponent tied or went ahead after it), a
 * game-tying goal in the last 2 minutes of the 3rd (either side), and a win
 * after a blown lead.
 */
export function timelineHooks(
  g: Pick<NewsGameFacts, 'result' | 'scoreAgainst' | 'goals' | 'clockMeaning'>,
): {
  comeback: boolean
  lateWinner: boolean
  leadBlown: boolean
  lateEqualizer: boolean
  winAfterBlown: boolean
} {
  const goals: readonly NewsGoal[] = g.goals ?? []
  let gf = 0
  let ga = 0
  let worst = 0
  let best = 0
  let leadBlown = false
  let lateEqualizer = false
  let winner: NewsGoal | null = null
  for (const goal of goals) {
    if (goal.side === 'for') gf++
    else ga++
    worst = Math.min(worst, gf - ga)
    best = Math.max(best, gf - ga)
    if (best >= 2 && gf - ga <= 0) leadBlown = true
    if (gf === ga && isLate(goal, g.clockMeaning)) lateEqualizer = true
    if (g.result === 'WIN' && goal.side === 'for' && gf === g.scoreAgainst + 1) winner = goal
  }
  const win = g.result === 'WIN' && goals.length > 0
  return {
    comeback: win && worst <= -2,
    lateWinner: win && winner !== null && isLate(winner, g.clockMeaning),
    leadBlown,
    lateEqualizer,
    winAfterBlown: win && leadBlown,
  }
}

/** The buzz score of one game of the sheet, with the reasons (for tuning). */
export function buzzScore(
  g: NewsGameFacts,
  facts: Pick<NewsFacts, 'milestones' | 'threads'>,
): { score: number; reasons: string[] } {
  const W = BUZZ_WEIGHTS
  if (g.endedEarly) return { score: 0, reasons: ['ended early'] }
  let raw = 0
  const reasons: string[] = []
  const add = (w: number, why: string) => {
    if (w === 0) return
    raw += w
    reasons.push(why)
  }
  if (g.overtime) add(W.overtime, 'overtime')
  const c = g.context
  if (c !== null) {
    if (c.margin === 'blowout') add(W.blowout, 'blowout')
    if (c.margin === 'close') add(W.close, 'close')
    add(W.result[c.result], `result ${c.result}`)
    add(W.surprise[c.surprise], c.surprise)
  }
  if (g.scoreFor + g.scoreAgainst >= W.manyGoalsTotal) add(W.manyGoals, 'many goals')
  const hooks = timelineHooks(g)
  if (hooks.comeback) add(W.comeback, 'comeback')
  if (hooks.lateWinner) add(W.lateWinner, 'late winner')
  if (hooks.leadBlown) add(W.leadBlown, 'lead blown')
  if (hooks.lateEqualizer) add(W.lateEqualizer, 'late equalizer')
  if (hooks.winAfterBlown) add(W.winAfterBlown, 'won after a blown lead')
  let playersTotal = 0
  for (const p of g.players) {
    let w = 0
    if (p.goals >= 3) w += W.hatTrick
    if (p.points >= 5) w += W.fivePoints
    const labels = p.norm?.labels
    if (
      labels !== undefined &&
      (labels.goals === 'big for him' || labels.points === 'big for him')
    ) {
      w += W.bigForHim
    }
    if (p.bests.some((b) => b.startsWith('career high'))) w += W.careerHigh
    else if (p.bests.length > 0) w += W.seasonHigh
    if (p.firsts.includes('first hat trick of the season')) w += W.firstHatTrick
    else if (p.firsts.includes('first goal of the season')) w += W.firstGoal
    if (p.debut === 'club') w += W.clubDebut
    if (
      p.streaks.some(
        (s) =>
          // Only at a round count or when it ends (buzz fix 1): a long run is
          // not news in every game it goes on.
          (s.status === 'extended' && s.kind !== 'noGoal' && s.games % STREAK_ROUND === 0) ||
          s.status === 'ended',
      )
    ) {
      w += W.streak
    }
    playersTotal += Math.min(W.playerMax, w)
    if (w > 0) reasons.push(`player ${p.name}`)
  }
  raw += Math.min(W.playersMax, playersTotal)
  const players = new Set(g.players.map((p) => p.playerId))
  const milestones = facts.milestones.filter((m) => players.has(m.playerId)).length
  add(Math.min(W.milestoneMax, milestones * W.milestone), 'milestones')
  for (const n of g.teamNotes) {
    if (/^(biggest|worst|most goals)/.test(n)) add(W.seasonBestNote, `note ${n}`)
    else if (/ of the title$/.test(n)) add(W.titleMilestoneNote, `note ${n}`)
    else if (/^longest/.test(n)) add(W.longestStreakNote, `note ${n}`)
  }
  if (g.aiGoalie?.label === 'meltdown') add(W.aiMeltdown, 'AI goalie meltdown')
  if (g.aiGoalie?.label === 'steal') add(W.aiSteal, 'AI goalie steal')
  if (g.result === 'WIN' && g.scoreAgainst === 0) add(W.shutout, 'shutout')
  const closed = facts.threads.filter((t) => t.status === 'closed-tonight').length
  add(Math.min(W.threadMax, closed * W.threadClosed), 'threads closed')
  if (g.result === 'WIN' && g.headToHead !== null && g.headToHead.lastMeeting.result !== 'WIN') {
    add(W.revenge, 'revenge')
  }
  const broken = g.patterns.filter((p) => !p.endsWith('as usual')).length
  add(Math.min(W.patternMax, broken * W.patternBroken), 'patterns broken')
  const factor = BUZZ_MODE_FACTOR[g.gameMode ?? 'none']
  return { score: Math.round(raw * factor * 100) / 100, reasons }
}

/** The level of a score; a new club record is historic, a game that ended early quiet. */
export function buzzLevel(
  score: number,
  g: Pick<NewsGameFacts, 'newRecords' | 'endedEarly'>,
): BuzzLevel {
  if (g.endedEarly) return 'quiet'
  if (g.newRecords.length > 0) return 'historic'
  if (score >= BUZZ_CUTOFFS.huge) return 'huge'
  if (score >= BUZZ_CUTOFFS.big) return 'big'
  if (score >= BUZZ_CUTOFFS.normal) return 'normal'
  return 'quiet'
}

export interface BuzzPlan {
  level: BuzzLevel
  score: number
  reasons: string[]
  /** Posts about the game: the recap first, then the extras. */
  posts: number
  /** Articles about the game on top of the night recap. */
  articles: GameArticleKind[]
}

/**
 * The game's plan: level, post count and articles, seeded from the match id.
 * Big ⇒ a game story; huge ⇒ a game story and a spotlight or a column;
 * historic ⇒ a game story, a spotlight and (half the time) a column.
 */
export function planBuzz(
  g: NewsGameFacts,
  facts: Pick<NewsFacts, 'milestones' | 'threads'>,
): BuzzPlan {
  const { score, reasons } = buzzScore(g, facts)
  const level = buzzLevel(score, g)
  const rng = mulberry32(g.matchId)
  const posts = weightedPick(BUZZ_POSTS[level], rng)
  const pick = rng()
  const articles: GameArticleKind[] =
    level === 'big'
      ? ['game']
      : level === 'huge'
        ? ['game', pick < 0.5 ? 'spotlight' : 'column']
        : level === 'historic'
          ? pick < 0.5
            ? ['game', 'spotlight', 'column']
            : ['game', 'spotlight']
          : []
  return { level, score, reasons, posts, articles }
}

/** The expected posts per game of the targets (≈ 2.0; spec says about 2.1). */
export function expectedPostsPerGame(): number {
  return BUZZ_LEVELS.reduce((sum, level) => {
    const choices = BUZZ_POSTS[level]
    const total = choices.reduce((n, [, w]) => n + w, 0)
    const mean = choices.reduce((n, [v, w]) => n + (v * w) / total, 0)
    return sum + BUZZ_TARGET_SHARE[level] * mean
  }, 0)
}
