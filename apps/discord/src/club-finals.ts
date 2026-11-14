/**
 * Club Finals in Discord (CF2): the words, the weight and the writer facts for one game.
 *
 * Every number here is a value the worker stored (CF1: migration 0083, read through
 * `getClubFinalsBadge`). Nothing in this file works out a round, a game number or a series score.
 * The only comparisons are with the rule limits (4 wins or 4 losses end a round; 7 = the last
 * game of a round), the same thresholds the site uses (apps/web/src/lib/club-finals-view.ts).
 *
 * Words are the site's words: "Club Finals", "Attempt", "Round N · Game N", "Series", "THE FINAL",
 * "Round won", "Eliminated". No before-and-after score: the series score is the one after the game.
 *
 * The type is a structural subset of CF1's `ClubFinalsBadge`, so this file has no runtime import.
 */
import type { BuzzLevel, BuzzPlan, NewsGameFacts } from '@eanhl/db/news'
import { BUZZ_LEVELS, BUZZ_POSTS, mulberry32, weightedPick } from '@eanhl/db/news'

export interface ClubFinalsFacts {
  attempt: number
  round: number
  gameInRound: number
  roundWinsAfter: number
  roundLossesAfter: number
  attemptWinsAfter: number
  attemptLossesAfter: number
  isFinal: boolean
  roundWon: boolean
  eliminated: boolean
  finalWon: boolean
}

/** Rule limits of the mode (club-room panel): the 4th win or the 4th loss ends a round. */
const ROUND_LIMIT = 4
/** A round has at most 7 games: the 7th game decides it. */
const LAST_GAME_OF_ROUND = 7
const FINAL_ROUND = 4

/** "Round 2" or "The Final". */
function roundName(b: Pick<ClubFinalsFacts, 'round' | 'isFinal'>): string {
  return b.isFinal ? 'The Final' : `Round ${String(b.round)}`
}

/** "4–1": the round record after the game (the Boogeymen's wins first). */
function series(b: Pick<ClubFinalsFacts, 'roundWinsAfter' | 'roundLossesAfter'>): string {
  return `${String(b.roundWinsAfter)}–${String(b.roundLossesAfter)}`
}

/** "13–9": the whole attempt's record after the game. */
function run(b: Pick<ClubFinalsFacts, 'attemptWinsAfter' | 'attemptLossesAfter'>): string {
  return `${String(b.attemptWinsAfter)}–${String(b.attemptLossesAfter)}`
}

/** The one mark a game earns, strongest first (the site's order). */
export type FinalsMark = 'final_won' | 'eliminated' | 'round_won'

export function finalsMark(
  b: Pick<ClubFinalsFacts, 'finalWon' | 'roundWon' | 'eliminated'>,
): FinalsMark | null {
  if (b.finalWon) return 'final_won'
  if (b.roundWon) return 'round_won'
  if (b.eliminated) return 'eliminated'
  return null
}

/** The 7th game of a round that ended it (4–3 either way). */
export function finalsDecider(
  b: Pick<ClubFinalsFacts, 'gameInRound' | 'roundWon' | 'eliminated' | 'finalWon'>,
): boolean {
  return b.gameInRound === LAST_GAME_OF_ROUND && (b.roundWon || b.eliminated || b.finalWon)
}

// ── The game post line ───────────────────────────────────────────────────────

/**
 * The line of the game post: "**Club Finals** · Attempt 3 · Round 1 · Game 5 · Series 4–1 ·
 * **ROUND WON**". A game of the final reads "**Club Finals · THE FINAL** · Attempt 1 · Game 5 ·
 * Series 1–4 · **ELIMINATED** · run ends 13–9". Plain digits and words only: nothing to escape.
 */
export function finalsPostLine(b: ClubFinalsFacts): string {
  const head = b.isFinal ? '**Club Finals · THE FINAL**' : '**Club Finals**'
  const parts = [
    head,
    `Attempt ${String(b.attempt)}`,
    ...(b.isFinal ? [] : [`Round ${String(b.round)}`]),
    `Game ${String(b.gameInRound)}`,
    `Series ${series(b)}`,
  ]
  const mark = finalsMark(b)
  if (mark === 'final_won') parts.push('**FINAL WON**')
  else if (mark === 'round_won') parts.push('**ROUND WON**')
  else if (mark === 'eliminated') parts.push('**ELIMINATED**', `run ends ${run(b)}`)
  return parts.join(' · ')
}

// ── How much the desk writes ─────────────────────────────────────────────────

/**
 * The lowest news level of a Club Finals game. Any game of the final, a won final and a 7th game
 * that decided a round: huge (the game story plus a spotlight or a column: the feature-length
 * piece). A round won or an elimination: big (a game story, 3 to 5 posts, the scrum pings).
 * Every other Club Finals game: normal (a recap and one more post).
 */
export function finalsFloor(b: ClubFinalsFacts): BuzzLevel {
  if (b.isFinal || b.finalWon || finalsDecider(b)) return 'huge'
  if (b.roundWon || b.eliminated) return 'big'
  return 'normal'
}

/**
 * A "big moment" of the press: the scrum opens (the picked player is pinged) whatever the game's
 * own buzz. A round won, an elimination, every game of the final and a round decided in its last
 * game. Same set as the `big` floor and above.
 */
export function isFinalsBigMoment(b: ClubFinalsFacts): boolean {
  return finalsFloor(b) !== 'normal'
}

const LEVEL_ORDER: readonly BuzzLevel[] = BUZZ_LEVELS

/** The posts and articles of a level, drawn like `planBuzz` does (seeded from the match id). */
export function planForLevel(
  matchId: number,
  level: BuzzLevel,
): Pick<BuzzPlan, 'posts' | 'articles'> {
  const rng = mulberry32(matchId)
  const posts = weightedPick(BUZZ_POSTS[level], rng)
  const pick = rng()
  const articles: BuzzPlan['articles'] =
    level === 'big'
      ? ['game']
      : level === 'huge'
        ? ['game', pick < 0.5 ? 'spotlight' : 'column']
        : level === 'historic'
          ? pick < 0.5
            ? ['game', 'spotlight', 'column']
            : ['game', 'spotlight']
          : []
  return { posts, articles }
}

/**
 * The game's plan with the Club Finals floor applied. A game with no Club Finals state, a game that
 * already weighs at least the floor, and a game that ended early (it stays quiet, spec §12.12-3)
 * keep their own plan. Otherwise the level goes up to the floor and posts and articles are drawn
 * again for it. Pure and seeded: the same game always gives the same plan.
 */
export function applyFinalsFloor(
  plan: BuzzPlan,
  game: Pick<NewsGameFacts, 'matchId' | 'endedEarly'>,
  finals: ClubFinalsFacts | null,
): BuzzPlan {
  if (finals === null || game.endedEarly) return plan
  const floor = finalsFloor(finals)
  if (LEVEL_ORDER.indexOf(plan.level) >= LEVEL_ORDER.indexOf(floor)) return plan
  return {
    ...plan,
    level: floor,
    ...planForLevel(game.matchId, floor),
    reasons: [...plan.reasons, `Club Finals ${floor}`],
  }
}

// ── Facts for the writers ────────────────────────────────────────────────────

/** What the next game means, from the stored record after this game. Null when nothing is special. */
export function finalsStakes(b: ClubFinalsFacts): string | null {
  if (b.eliminated || b.finalWon) return null
  if (b.roundWon)
    return `Next: ${b.round + 1 === FINAL_ROUND ? 'the final' : `Round ${String(b.round + 1)}`}, Game 1.`
  const oneWin = b.roundWinsAfter === ROUND_LIMIT - 1
  const oneLoss = b.roundLossesAfter === ROUND_LIMIT - 1
  if (oneWin && oneLoss) return 'Next game: win or go home.'
  if (oneWin) {
    return b.round === FINAL_ROUND
      ? 'Next game: one win from the title.'
      : b.round === FINAL_ROUND - 1
        ? 'Next game: one win from the final.'
        : 'Next game: one win from the next round.'
  }
  if (oneLoss) return 'Next game: one loss from elimination.'
  return null
}

const wins = (n: number): string => `${String(n)} ${n === 1 ? 'win' : 'wins'}`
const losses = (n: number): string => `${String(n)} ${n === 1 ? 'loss' : 'losses'}`

/** The facts of one game as writer lines. `opponent` names the game on a night sheet (several games). */
export function finalsFactLines(b: ClubFinalsFacts, opponent: string | null = null): string[] {
  const where = `Game ${String(b.gameInRound)} of ${roundName(b)} in Attempt ${String(b.attempt)} of the Club Finals`
  const lines = [
    `${opponent === null ? '' : `The game against ${opponent}: `}${where}. Series after this game: ${wins(b.roundWinsAfter)} and ${losses(b.roundLossesAfter)} for the Boogeymen (${series(b)}).`,
  ]
  const mark = finalsMark(b)
  if (mark === 'final_won') {
    lines.push(
      `The Boogeymen won the final (4 wins in Round 4). The attempt stands at ${wins(b.attemptWinsAfter)} and ${losses(b.attemptLossesAfter)}.`,
    )
  } else if (mark === 'round_won') {
    lines.push(`The Boogeymen won the round (their 4th win).`)
  } else if (mark === 'eliminated') {
    lines.push(
      `The Boogeymen were eliminated (their 4th loss in the round ends the whole attempt). The attempt ended at ${wins(b.attemptWinsAfter)} and ${losses(b.attemptLossesAfter)}.`,
    )
  }
  if (finalsDecider(b)) lines.push('It was the 7th game of the round: it decided the round.')
  const stakes = finalsStakes(b)
  if (stakes !== null) lines.push(stakes)
  return lines
}

/** The rule sentence the writers get once per request. */
export const FINALS_RULES =
  'Club Finals rules: a round is first to 4 wins; 4 losses in a round end the whole attempt; the 4th round is the final; a DNF or an overtime loss counts as a loss.'

export const FINALS_START = 'CLUB FINALS (the club tracker; exact, true and not on the fact sheet)'
export const FINALS_END = 'END OF CLUB FINALS'

/**
 * The Club Finals block of a request, or null when no game has a state. `entries` come in game
 * order; a night sheet names each game by its opponent.
 */
export function finalsBlock(
  entries: readonly { opponent: string | null; facts: ClubFinalsFacts }[],
): string | null {
  if (entries.length === 0) return null
  const lines = [FINALS_START, FINALS_RULES]
  for (const e of entries) {
    for (const l of finalsFactLines(e.facts, e.opponent)) lines.push(`- ${l}`)
  }
  lines.push(
    'Say "Club Finals", "Attempt", "Round N", "Game N", "series", "the final", "round won" and "eliminated" exactly like this. Use only these numbers for rounds, games and the series. The numbers here may stand next to the one key number of a recap, but a sentence may hold at most 3 numbers in all: give the round, game and series their own sentence or clause. Never guess what comes after a won final.',
    FINALS_END,
  )
  return lines.join('\n')
}

/** The review's view: the same facts as true desk notes (no header, one note per line). */
export function finalsTrusted(
  entries: readonly { opponent: string | null; facts: ClubFinalsFacts }[],
): string[] {
  if (entries.length === 0) return []
  return [
    FINALS_RULES,
    ...entries.flatMap((e) =>
      finalsFactLines(e.facts, e.opponent).map((l) => `Club tracker: ${l}`),
    ),
  ]
}

/** Every number the Club Finals facts of these games state: allowed in the text (and the rules' 4 and 7). */
export function finalsNumbers(facts: readonly ClubFinalsFacts[]): Set<number> {
  const out = new Set<number>()
  if (facts.length === 0) return out
  out.add(ROUND_LIMIT)
  out.add(LAST_GAME_OF_ROUND)
  for (const b of facts) {
    out.add(b.attempt)
    out.add(b.round)
    out.add(b.round + 1)
    out.add(b.gameInRound)
    out.add(b.roundWinsAfter)
    out.add(b.roundLossesAfter)
    out.add(b.attemptWinsAfter)
    out.add(b.attemptLossesAfter)
  }
  return out
}

// ── Press: the moment ────────────────────────────────────────────────────────

export type FinalsMoment = 'final_won' | 'eliminated' | 'round_won' | 'decider' | 'final'

/** The one moment a scrum question is about, strongest first. Null for an ordinary Club Finals game. */
export function finalsMoment(b: ClubFinalsFacts): FinalsMoment | null {
  const mark = finalsMark(b)
  if (mark === 'final_won') return 'final_won'
  if (mark === 'eliminated') return 'eliminated'
  if (finalsDecider(b)) return 'decider'
  if (mark === 'round_won') return 'round_won'
  if (b.isFinal) return 'final'
  return null
}

/**
 * The tone line of a scrum request. Tone only: the hard lines, "Go easy" and the crude-quote
 * rules stay as they are and come first.
 */
export const MOMENT_TONE: Record<FinalsMoment, string> = {
  final_won:
    'Moment: the Boogeymen won the Club Finals final. This is the biggest moment of the run: ask big, proud, hockey-first questions about how the game was won.',
  eliminated:
    'Moment: this game ended the attempt (the Boogeymen were eliminated). Keep the tone serious. Ask what went wrong or what the team takes from it. Be direct about the hockey if the heat is hot, but no jokes about the loss.',
  decider:
    'Moment: this was the 7th and deciding game of the round. Everything rode on this one game: ask about the pressure and the key stretch of the game, from the sheet.',
  round_won:
    'Moment: the Boogeymen won the round. Lead with what won it, and look ahead to the next round.',
  final:
    'Moment: a game of the final, the biggest round of the Club Finals. Raise the stakes in the question; the series is on the line.',
}
