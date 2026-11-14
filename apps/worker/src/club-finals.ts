/**
 * Club Finals rules (CF1). Pure: no database, no clock. The worker reads the 6v6 Club Finals
 * games of one title in time order and calls `deriveClubFinals`; `club-finals-sync.ts` stores the
 * result (migration 0083).
 *
 * The rules come from the club-room "Club Finals" panel (engine Lead, 2026-11-14), and the
 * replay test checks them against the engine's panel reads:
 *   - A round is first to 4 wins.
 *   - 4 losses in a round end the whole attempt: the panel goes back to round 1, 0-0 (RETRY).
 *   - Round 4 is the final.
 *   - A DNF or an OT loss counts as a loss (the 3-skater DNF of 2026-11-07 counts too).
 *
 * Not known yet (so never guessed): what happens after a win of round 4. Games after a won final
 * get no state; the caller reports them as "unplaced".
 *
 * Which games count: gameType10 with EA code 10 (6v6 Club Finals). Code 206 (3v3, also in
 * gameType10) does not count: with it left out, the games before the 2026-11-12 reset add up
 * to 13 wins and 5 losses, exactly the panel's best attempt. See `isClubFinalsGame`.
 */

export const WINS_TO_ADVANCE = 4
export const LOSSES_TO_ELIMINATE = 4
export const FINAL_ROUND = 4

export type FinalsResult = 'WIN' | 'LOSS' | 'OTL' | 'DNF'

export interface FinalsGameInput {
  matchId: number
  playedAt: Date
  result: FinalsResult
}

export interface FinalsGameState {
  matchId: number
  attempt: number
  round: number
  /** 1-based position of this game in its round (1 to 7). */
  gameInRound: number
  roundWinsBefore: number
  roundLossesBefore: number
  roundWinsAfter: number
  roundLossesAfter: number
  attemptWinsAfter: number
  attemptLossesAfter: number
  /** The game as the panel counts it: a win, or a loss (LOSS, OTL and DNF). */
  countedAs: 'win' | 'loss'
  /** This round's games up to and including this one, e.g. "WLLWW". */
  roundResults: string
  /** This game was the 4th win of round 1, 2 or 3. */
  roundWon: boolean
  /** This game was the 4th loss: the attempt ends here. */
  eliminated: boolean
  /** This game belongs to round 4, the final. */
  isFinal: boolean
  /** This game was the 4th win of round 4. */
  finalWon: boolean
}

export type AttemptStatus = 'active' | 'eliminated' | 'final_won'

export interface FinalsAttempt {
  attempt: number
  startedAt: Date
  endedAt: Date
  games: number
  wins: number
  losses: number
  /** The highest round this attempt played (1 to 4). */
  roundReached: number
  /** Rounds fully won (4 wins), the final included. */
  roundsWon: number
  status: AttemptStatus
  firstMatchId: number
  lastMatchId: number
}

export interface ClubFinalsDerivation {
  states: FinalsGameState[]
  attempts: FinalsAttempt[]
  /** Games after a won final: the state is not known, so none is derived. */
  unplacedMatchIds: number[]
}

/** Which matches are Club Finals games: 6v6 (`gameType10`, EA code 10). 3v3 (206) is not. */
export function isClubFinalsGame(match: {
  matchType: string
  eaGameTypeCode: number | null
}): boolean {
  return match.matchType === 'gameType10' && match.eaGameTypeCode === 10
}

export function deriveClubFinals(input: readonly FinalsGameInput[]): ClubFinalsDerivation {
  const games = [...input].sort(
    (a, b) => a.playedAt.getTime() - b.playedAt.getTime() || a.matchId - b.matchId,
  )
  const states: FinalsGameState[] = []
  const attempts: FinalsAttempt[] = []
  const unplacedMatchIds: number[] = []

  let attempt = 1
  let round = 1
  let results = ''
  let attemptWins = 0
  let attemptLosses = 0
  let current: FinalsAttempt | null = null
  // After a won final the state is unknown: every later game is unplaced.
  let afterWonFinal = false

  for (const game of games) {
    if (afterWonFinal) {
      unplacedMatchIds.push(game.matchId)
      continue
    }
    const won = game.result === 'WIN'
    const roundWinsBefore = countChar(results, 'W')
    const roundLossesBefore = countChar(results, 'L')
    results += won ? 'W' : 'L'
    const roundWinsAfter = roundWinsBefore + (won ? 1 : 0)
    const roundLossesAfter = roundLossesBefore + (won ? 0 : 1)
    if (won) attemptWins += 1
    else attemptLosses += 1

    const eliminated = roundLossesAfter >= LOSSES_TO_ELIMINATE
    const fourthWin = roundWinsAfter >= WINS_TO_ADVANCE
    const isFinal = round === FINAL_ROUND
    const finalWon = fourthWin && isFinal
    const roundWon = fourthWin && !isFinal

    states.push({
      matchId: game.matchId,
      attempt,
      round,
      gameInRound: roundWinsBefore + roundLossesBefore + 1,
      roundWinsBefore,
      roundLossesBefore,
      roundWinsAfter,
      roundLossesAfter,
      attemptWinsAfter: attemptWins,
      attemptLossesAfter: attemptLosses,
      countedAs: won ? 'win' : 'loss',
      roundResults: results,
      roundWon,
      eliminated,
      isFinal,
      finalWon,
    })

    if (current === null) {
      current = {
        attempt,
        startedAt: game.playedAt,
        endedAt: game.playedAt,
        games: 0,
        wins: 0,
        losses: 0,
        roundReached: round,
        roundsWon: 0,
        status: 'active',
        firstMatchId: game.matchId,
        lastMatchId: game.matchId,
      }
      attempts.push(current)
    }
    current.endedAt = game.playedAt
    current.lastMatchId = game.matchId
    current.games += 1
    current.wins = attemptWins
    current.losses = attemptLosses
    current.roundReached = round
    if (fourthWin) current.roundsWon += 1

    if (eliminated) {
      current.status = 'eliminated'
      current = null
      attempt += 1
      round = 1
      results = ''
      attemptWins = 0
      attemptLosses = 0
    } else if (finalWon) {
      current.status = 'final_won'
      current = null
      afterWonFinal = true
    } else if (roundWon) {
      round += 1
      results = ''
    }
  }
  return { states, attempts, unplacedMatchIds }
}

function countChar(text: string, char: string): number {
  let n = 0
  for (const c of text) if (c === char) n += 1
  return n
}

/**
 * What the club-room panel shows right after a game (between games): the check against the
 * engine's panel reads. An end of the attempt shows round 1, 0-0, RETRY; a won round shows the
 * next round with empty boxes and the attempt record carried over.
 */
export interface PanelView {
  round: number
  /** Round boxes, one letter per game played in the shown round ("" = all empty). */
  boxes: string
  attemptWins: number
  attemptLosses: number
  retry: boolean
}

export function panelViewAfter(state: FinalsGameState): PanelView {
  if (state.eliminated) {
    return { round: 1, boxes: '', attemptWins: 0, attemptLosses: 0, retry: true }
  }
  if (state.roundWon) {
    return {
      round: state.round + 1,
      boxes: '',
      attemptWins: state.attemptWinsAfter,
      attemptLosses: state.attemptLossesAfter,
      retry: false,
    }
  }
  return {
    round: state.round,
    boxes: state.roundResults,
    attemptWins: state.attemptWinsAfter,
    attemptLosses: state.attemptLossesAfter,
    retry: false,
  }
}

/** The state before any game of a title: attempt 1, round 1, 0-0. */
export const FRESH_PANEL_VIEW: PanelView = {
  round: 1,
  boxes: '',
  attemptWins: 0,
  attemptLosses: 0,
  retry: false,
}

/** Best attempt: furthest round first, then most wins, then fewest losses. */
export function bestAttempt(attempts: readonly FinalsAttempt[]): FinalsAttempt | null {
  let best: FinalsAttempt | null = null
  for (const a of attempts) {
    if (best === null) {
      best = a
      continue
    }
    if (
      a.roundReached > best.roundReached ||
      (a.roundReached === best.roundReached &&
        (a.wins > best.wins || (a.wins === best.wins && a.losses < best.losses)))
    ) {
      best = a
    }
  }
  return best
}
