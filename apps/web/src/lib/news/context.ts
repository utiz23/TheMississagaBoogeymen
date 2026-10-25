// Team context for the news desk fact sheets (Part C2.2, spec §12.16): each
// game's result read against what came before — the streak, the last 10, the
// club's usual margin and win rate, the night so far, title milestones and
// season bests, and the head-to-head record (§12.15-2). Pure; the loader
// passes the title's earlier games (`listNewsNormGames`) and the sheet's own.
//
// Scope decisions (documented in contract.ts):
// - streak, result label, last-10 record, night notes, team notes and
//   head-to-head use the title's games in order, all modes (the same sequence
//   as the sheet's `record` and `streak`, so they never disagree);
// - margin and surprise are expectations, computed within the game's mode
//   (spec §12.17-1), from the title's earlier games of that mode.
import type {
  MarginLabel,
  NewsGameContext,
  NewsGameFacts,
  NewsHeadToHead,
  NewsRecord,
  NewsStreak,
  ResultLabel,
  SurpriseLabel,
} from '@eanhl/db/news'
import type { NewsNormGame } from '@eanhl/db/queries'
import { isEndedEarly } from './build-facts.ts'
import { ordinal, percentile } from './norms.ts'

/** One counted game of the title, as the context needs it (the sheet's games or earlier ones). */
export interface TitleGameInput {
  matchId: number
  night: string
  gameMode: '3s' | '6s' | null
  result: 'WIN' | 'LOSS' | 'OTL'
  scoreFor: number
  scoreAgainst: number
  opponentName: string
  /** Left out of the margin sample (a quit is not a margin); its result still counts. */
  endedEarly: boolean
}

type Result = TitleGameInput['result']

/** A sheet game as a context input. */
export function titleGameFromFacts(g: NewsGameFacts): TitleGameInput {
  return {
    matchId: g.matchId,
    night: g.night,
    gameMode: g.gameMode,
    result: g.result,
    scoreFor: g.scoreFor,
    scoreAgainst: g.scoreAgainst,
    opponentName: g.opponentName,
    endedEarly: g.endedEarly,
  }
}

/** An earlier game of the title from the database (ended early by the sheet's rule). */
export function titleGameFromRow(r: NewsNormGame): TitleGameInput {
  return {
    matchId: r.id,
    night: r.night,
    gameMode: r.gameMode,
    result: r.result,
    scoreFor: r.scoreFor,
    scoreAgainst: r.scoreAgainst,
    opponentName: r.opponentName.replace(/\s+/g, ' ').trim(),
    endedEarly: isEndedEarly({
      scoreFor: r.scoreFor,
      creditedGoals: r.creditedGoals,
      timeOnAttack: r.timeOnAttack,
      shots: { for: r.shotsFor, against: r.shotsAgainst },
    }),
  }
}

// ── Thresholds (spec §12.16: Claude's call, tuned on the NHL 26 games) ───────

/** A win that makes the win streak at least this long: rolling. */
export const ROLLING_MIN = 5
/** A loss that ends a win streak at least this long: blip. */
export const BLIP_MIN = 5
/** The 3rd (and 4th) loss in a row: slide. */
export const SLIDE_MIN = 3
/** The 5th loss in a row or later: panic. */
export const PANIC_STREAK = 5
/** At most this many wins in the last 10 (10 games played) on a loss: panic. */
export const PANIC_LAST10_WINS = 2
/** A win that ends a losing streak at least this long: turnaround. */
export const TURNAROUND_MIN = 3

/** A game decided by at most this many goals is close (an overtime game always is). */
export const CLOSE_MAX = 1
/** A blowout margin is above the club's 80th percentile of earlier margins in the mode ... */
const BLOWOUT_Q = 0.8
/** ... and at least this big. */
export const BLOWOUT_MIN = 4
/** With fewer than 10 earlier games of the mode: a blowout is at least this big. */
export const BLOWOUT_FALLBACK = 5

/** Expected win rate (mean of the title rate and the last-10 rate, in the mode) for a loss to be an upset. */
export const LOSS_UPSET_P = 0.8
/** Expected win rate at or below which a win is an upset. */
export const WIN_UPSET_P = 0.3
/** Margins, win rates and percentiles need this many earlier games of the mode. */
export const MIN_CONTEXT_GAMES = 10

/** Season bests (most goals, biggest win, worst loss) need this many earlier games of the title ... */
export const MIN_BEST_GAMES = 10
/** ... and the biggest win / worst loss this many earlier wins / losses. */
export const MIN_BEST_KIND = 3
/** A longest-streak note needs a streak of at least this many games. */
export const LONGEST_STREAK_MIN = 4
/** Team milestones: every 50th win, every 250th goal, these game counts. */
export const WIN_MILESTONE_STEP = 50
export const GOAL_MILESTONE_STEP = 250
export const GAME_MILESTONES = [100, 250, 500, 750, 1000] as const

const isWin = (r: Result) => r === 'WIN'

/** The run at the newest end (results oldest first); an overtime loss is a loss. */
export function streakOf(results: readonly Result[]): NewsStreak | null {
  const last = results[results.length - 1]
  if (last === undefined) return null
  const kind = isWin(last) ? 'W' : 'L'
  let count = 0
  for (let i = results.length - 1; i >= 0 && isWin(results[i]!) === (kind === 'W'); i--) count++
  return { kind, count }
}

function recordOf(results: readonly Result[]): NewsRecord {
  return {
    wins: results.filter((r) => r === 'WIN').length,
    losses: results.filter((r) => r === 'LOSS').length,
    otl: results.filter((r) => r === 'OTL').length,
  }
}

/**
 * The result label (spec §12.16): a win ending a losing streak of 3+ is a
 * turnaround, a win making the win streak 5+ is rolling; a loss ending a win
 * streak of 5+ is a blip, the 5th+ loss in a row or 2-8 or worse in the last
 * 10 is panic, the 3rd or 4th loss in a row a slide; else normal.
 */
export function resultLabel(
  result: Result,
  before: NewsStreak | null,
  after: NewsStreak | null,
  last10: NewsRecord,
): ResultLabel {
  if (isWin(result)) {
    if (before?.kind === 'L' && before.count >= TURNAROUND_MIN) return 'turnaround'
    if (after?.kind === 'W' && after.count >= ROLLING_MIN) return 'rolling'
    return 'normal'
  }
  if (before?.kind === 'W' && before.count >= BLIP_MIN) return 'blip'
  const played = last10.wins + last10.losses + last10.otl
  if (after?.kind === 'L' && after.count >= PANIC_STREAK) return 'panic'
  if (played >= 10 && last10.wins <= PANIC_LAST10_WINS) return 'panic'
  if (after?.kind === 'L' && after.count >= SLIDE_MIN) return 'slide'
  return 'normal'
}

/**
 * The margin against the club's usual margin: one goal (or a tie after OT3)
 * is close; a blowout is above the 80th percentile of the earlier margins of
 * the mode and at least 4 goals (5 goals with fewer than 10 earlier games);
 * else comfortable. `sample` = the earlier games' absolute margins.
 */
export function marginLabel(
  scoreFor: number,
  scoreAgainst: number,
  sample: readonly number[],
): MarginLabel {
  const d = Math.abs(scoreFor - scoreAgainst)
  if (d <= CLOSE_MAX) return 'close'
  if (sample.length < MIN_CONTEXT_GAMES) return d >= BLOWOUT_FALLBACK ? 'blowout' : 'comfortable'
  const sorted = [...sample].sort((a, b) => a - b)
  return d > percentile(sorted, BLOWOUT_Q) && d >= BLOWOUT_MIN ? 'blowout' : 'comfortable'
}

/**
 * How surprising the result is from the club's win rate in the mode: the
 * expectation is the mean of the title win rate and the last-10 win rate
 * (earlier games of the mode; an overtime loss is not a win). A loss at an
 * expectation of 0.8+ is an upset, a win at 0.3 or less is one; a big upset
 * is such a result by a blowout. Fewer than 10 earlier games: expected.
 */
export function surpriseLabel(
  result: Result,
  margin: MarginLabel,
  prior: readonly TitleGameInput[],
): SurpriseLabel {
  if (prior.length < MIN_CONTEXT_GAMES) return 'expected'
  const rate = (games: readonly TitleGameInput[]) =>
    games.filter((g) => isWin(g.result)).length / games.length
  const p = (rate(prior) + rate(prior.slice(-10))) / 2
  const upset = isWin(result) ? p <= WIN_UPSET_P : p >= LOSS_UPSET_P
  if (!upset) return 'expected'
  return margin === 'blowout' ? 'big upset' : 'upset'
}

/**
 * The night so far, at this game: "2nd win of the night" / "3rd loss of the
 * night" (from the 2nd of that result), with ", no loss yet" / ", no win yet"
 * when every game so far had that result. When the sheet holds the whole
 * night (night and week sheets) its last game adds "swept the night" or "lost
 * every game of the night" (2+ games). `earlier` = the night's earlier results.
 */
export function nightNotes(
  result: Result,
  earlier: readonly Result[],
  lastOfCompleteNight: boolean,
): string[] {
  const all = [...earlier, result]
  if (all.length < 2) return []
  const wins = all.filter(isWin).length
  const losses = all.length - wins
  const out: string[] = []
  if (isWin(result) && wins >= 2) {
    out.push(`${ordinal(wins)} win of the night${losses === 0 ? ', no loss yet' : ''}`)
  } else if (!isWin(result) && losses >= 2) {
    out.push(`${ordinal(losses)} loss of the night${wins === 0 ? ', no win yet' : ''}`)
  }
  if (lastOfCompleteNight) {
    if (losses === 0) out.push('swept the night')
    else if (wins === 0) out.push('lost every game of the night')
  }
  return out
}

/** The longest run of `kind` in the results. */
function longestRun(results: readonly Result[], kind: 'W' | 'L'): number {
  let best = 0
  let run = 0
  for (const r of results) {
    run = isWin(r) === (kind === 'W') ? run + 1 : 0
    best = Math.max(best, run)
  }
  return best
}

/**
 * Title milestones and season bests at this game (title-wide, `prior` = the
 * title's earlier counted games, oldest first): "50th win of the title" (every
 * 50th), "100th game of the title" (100/250/500/750/1000), "250th goal of the
 * title" (every 250th crossed); "longest win streak of the season: N" /
 * "longest losing streak of the season: N" (4+ and longer than any earlier
 * run); per game mode, from the 11th game of the mode (C2 fix M2) "most goals
 * in a 6s game this season: N", "biggest 6s win of the season: 11-2", "worst
 * 6s loss of the season: 8-1" (strictly more than
 * every earlier game; the last two after 3+ earlier wins / losses). Scores
 * winner first.
 */
export function teamNotes(game: TitleGameInput, prior: readonly TitleGameInput[]): string[] {
  const out: string[] = []
  const results = [...prior.map((g) => g.result), game.result]
  const wins = results.filter(isWin).length
  if (isWin(game.result) && wins % WIN_MILESTONE_STEP === 0) {
    out.push(`${ordinal(wins)} win of the title`)
  }
  if ((GAME_MILESTONES as readonly number[]).includes(results.length)) {
    out.push(`${ordinal(results.length)} game of the title`)
  }
  const goalsBefore = prior.reduce((n, g) => n + g.scoreFor, 0)
  const goalsAfter = goalsBefore + game.scoreFor
  const step = Math.floor(goalsAfter / GOAL_MILESTONE_STEP)
  if (step > Math.floor(goalsBefore / GOAL_MILESTONE_STEP) && step > 0) {
    out.push(`${ordinal(step * GOAL_MILESTONE_STEP)} goal of the title`)
  }
  const after = streakOf(results)
  if (after !== null && after.count >= LONGEST_STREAK_MIN) {
    const earlier = longestRun(
      prior.map((g) => g.result),
      after.kind,
    )
    if (after.count > earlier) {
      out.push(
        `longest ${after.kind === 'W' ? 'win' : 'losing'} streak of the season: ${String(after.count)}`,
      )
    }
  }
  // Season bests per mode (C2 fix M2): a 3s score is not a 6s score.
  const mode = game.gameMode
  const sameMode = mode === null ? [] : prior.filter((g) => g.gameMode === mode)
  if (mode !== null && sameMode.length >= MIN_BEST_GAMES) {
    if (game.scoreFor > Math.max(...sameMode.map((g) => g.scoreFor))) {
      out.push(`most goals in a ${mode} game this season: ${String(game.scoreFor)}`)
    }
    const margin = (g: TitleGameInput) => Math.abs(g.scoreFor - g.scoreAgainst)
    const same = sameMode.filter((g) => isWin(g.result) === isWin(game.result))
    if (same.length >= MIN_BEST_KIND && margin(game) > Math.max(...same.map(margin))) {
      const hi = Math.max(game.scoreFor, game.scoreAgainst)
      const lo = Math.min(game.scoreFor, game.scoreAgainst)
      out.push(
        `${isWin(game.result) ? `biggest ${mode} win` : `worst ${mode} loss`} of the season: ${String(hi)}-${String(lo)}`,
      )
    }
  }
  return out
}

/** An opponent name compared with spacing and case ignored. */
export const sameOpponent = (a: string, b: string): boolean =>
  a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase()

/** The earlier meetings with this opponent in the title (spec §12.15-2); null when none. */
export function headToHead(
  opponentName: string,
  prior: readonly TitleGameInput[],
): NewsHeadToHead | null {
  const met = prior.filter((g) => sameOpponent(g.opponentName, opponentName))
  const last = met[met.length - 1]
  if (last === undefined) return null
  return {
    ...recordOf(met.map((g) => g.result)),
    lastMeeting: {
      result: last.result,
      scoreFor: last.scoreFor,
      scoreAgainst: last.scoreAgainst,
      night: last.night,
    },
  }
}

/** One game's context from the title's earlier games (oldest first). */
export function gameContext(
  game: TitleGameInput,
  prior: readonly TitleGameInput[],
  lastOfCompleteNight: boolean,
): NewsGameContext {
  const before = prior.map((g) => g.result)
  const results = [...before, game.result]
  const last10 = recordOf(results.slice(-10))
  const sameMode = prior.filter((g) => game.gameMode !== null && g.gameMode === game.gameMode)
  const margins = sameMode
    .filter((g) => !g.endedEarly)
    .map((g) => Math.abs(g.scoreFor - g.scoreAgainst))
  const margin = marginLabel(game.scoreFor, game.scoreAgainst, margins)
  const streakBefore = streakOf(before)
  const streakAfter = streakOf(results)
  return {
    result: resultLabel(game.result, streakBefore, streakAfter, last10),
    streakBefore,
    streakAfter,
    last10,
    margin,
    surprise: game.gameMode === null ? 'expected' : surpriseLabel(game.result, margin, sameMode),
    night: nightNotes(
      game.result,
      prior.filter((g) => g.night === game.night).map((g) => g.result),
      lastOfCompleteNight,
    ),
  }
}

/**
 * Context, team notes and head-to-head for each sheet game. `inputs[i]` is
 * `games[i]`; `history` = the title's counted games before the sheet's first
 * game, oldest first. A later sheet game sees the earlier ones.
 * `nightComplete`: the sheet holds every game of its nights (night and week
 * sheets), so the last game of a night knows the night is over.
 */
export function applyContext(
  games: readonly NewsGameFacts[],
  inputs: readonly TitleGameInput[],
  history: readonly TitleGameInput[],
  opts: { nightComplete: boolean },
): NewsGameFacts[] {
  const prior = [...history]
  return games.map((g, i) => {
    const input = inputs[i]
    if (input === undefined) return g
    const next = inputs[i + 1]
    const lastOfNight = opts.nightComplete && (next === undefined || next.night !== input.night)
    const out: NewsGameFacts = {
      ...g,
      context: gameContext(input, prior, lastOfNight),
      teamNotes: teamNotes(input, prior),
      headToHead: headToHead(input.opponentName, prior),
    }
    prior.push(input)
    return out
  })
}
