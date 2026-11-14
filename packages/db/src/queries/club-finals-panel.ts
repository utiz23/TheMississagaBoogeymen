/**
 * The club-room "Club Finals" panel's state between games, from the last derived game (CF1).
 * Pure (no database): the same mapping as the worker's `panelViewAfter` in
 * apps/worker/src/club-finals.ts, which the worker's replay test checks against the engine's
 * panel reads.
 */

/** What the club-room panel shows between games. Same mapping as the worker's `panelViewAfter`. */
export interface ClubFinalsPanelView {
  round: number
  /** One letter per game played in the shown round: "" = all boxes empty. */
  boxes: string
  attemptWins: number
  attemptLosses: number
  retry: boolean
}

/** The columns of a derived game the panel mapping needs. */
export interface ClubFinalsPanelInput {
  round: number
  roundWon: boolean
  eliminated: boolean
  attemptWinsAfter: number
  attemptLossesAfter: number
  roundResults: string
}

export function panelViewFromGame(game: ClubFinalsPanelInput): ClubFinalsPanelView {
  if (game.eliminated) {
    return { round: 1, boxes: '', attemptWins: 0, attemptLosses: 0, retry: true }
  }
  if (game.roundWon) {
    return {
      round: game.round + 1,
      boxes: '',
      attemptWins: game.attemptWinsAfter,
      attemptLosses: game.attemptLossesAfter,
      retry: false,
    }
  }
  return {
    round: game.round,
    boxes: game.roundResults,
    attemptWins: game.attemptWinsAfter,
    attemptLosses: game.attemptLossesAfter,
    retry: false,
  }
}
