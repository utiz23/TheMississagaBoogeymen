/**
 * Club Finals wording for the site (CF3). Format helpers only: every number shown is a value the
 * worker stored (migration 0083, read through CF1's queries). Nothing here works out a round, a
 * game number or a series score. Where CF1 stored nothing, the helpers return null ("unknown") and
 * the page shows nothing.
 *
 * Types are structural subsets of CF1's query types, so this file has no runtime import and the
 * unit tests need no database.
 */

/** Rule constants of the mode, as the club-room panel shows them. */
export const FINALS_ROUND_COUNT = 4
export const FINALS_BOX_COUNT = 7

export interface FinalsBadgeLike {
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

/** "Round 2" or "The Final". */
export function roundName(round: number, isFinal: boolean): string {
  return isFinal ? 'The Final' : `Round ${String(round)}`
}

/** "Club Finals · Round 4 · Game 5". */
export function clubFinalsLabel(badge: Pick<FinalsBadgeLike, 'round' | 'gameInRound'>): string {
  return `Club Finals · Round ${String(badge.round)} · Game ${String(badge.gameInRound)}`
}

/** "R4 · G5": the chip on a game card. */
export function clubFinalsShortLabel(
  badge: Pick<FinalsBadgeLike, 'round' | 'gameInRound'>,
): string {
  return `R${String(badge.round)} · G${String(badge.gameInRound)}`
}

/** The round chip of a game card: "R4 · G5", or "Final · G5" in the final. */
export function clubFinalsCardLabel(
  badge: Pick<FinalsBadgeLike, 'round' | 'gameInRound' | 'isFinal'>,
): string {
  return badge.isFinal ? `Final · G${String(badge.gameInRound)}` : clubFinalsShortLabel(badge)
}

/** Round record after the game, e.g. "1–4". */
export function clubFinalsSeriesScore(
  badge: Pick<FinalsBadgeLike, 'roundWinsAfter' | 'roundLossesAfter'>,
): string {
  return `${String(badge.roundWinsAfter)}–${String(badge.roundLossesAfter)}`
}

/** Run record after the game, e.g. "13–5". */
export function clubFinalsRunScore(
  badge: Pick<FinalsBadgeLike, 'attemptWinsAfter' | 'attemptLossesAfter'>,
): string {
  return `${String(badge.attemptWinsAfter)}–${String(badge.attemptLossesAfter)}`
}

/** "Attempt 4 · Round 2": the header over a block of games. */
export function clubFinalsRoundHeader(
  badge: Pick<FinalsBadgeLike, 'attempt' | 'round' | 'isFinal'>,
): string {
  return `Attempt ${String(badge.attempt)} · ${roundName(badge.round, badge.isFinal)}`
}

/** Games of one round of one attempt share this key (the games list starts a header on a change). */
export function clubFinalsRoundKey(badge: Pick<FinalsBadgeLike, 'attempt' | 'round'>): string {
  return `${String(badge.attempt)}:${String(badge.round)}`
}

export type FinalsOutcome = 'final_won' | 'round_won' | 'eliminated'

/** The one mark a game earns, strongest first. Null for a game that only moved the series. */
export function clubFinalsOutcome(
  badge: Pick<FinalsBadgeLike, 'finalWon' | 'roundWon' | 'eliminated'>,
): FinalsOutcome | null {
  if (badge.finalWon) return 'final_won'
  if (badge.roundWon) return 'round_won'
  if (badge.eliminated) return 'eliminated'
  return null
}

/** Short mark text for a card. */
export function clubFinalsOutcomeText(outcome: FinalsOutcome): string {
  return outcome === 'final_won'
    ? 'Final won'
    : outcome === 'round_won'
      ? 'Round won'
      : 'Eliminated'
}

/** The banner over the game sheet: a kicker and a title. THE FINAL is the strongest version. */
export function clubFinalsBanner(
  badge: Pick<FinalsBadgeLike, 'round' | 'gameInRound' | 'isFinal'>,
): { kicker: string; title: string; final: boolean } {
  return {
    kicker: 'Club Finals',
    title: `${roundName(badge.round, badge.isFinal)} · Game ${String(badge.gameInRound)}`,
    final: badge.isFinal,
  }
}

// ── Series panel (game page) ─────────────────────────────────────────────────

export interface FinalsRoundGame {
  matchId: number
  roundResults: string
}

export interface SeriesCell {
  letter: 'W' | 'L' | null
  /** The game this box stands for, when the data has it. */
  matchId: number | null
  current: boolean
}

export interface SeriesPanelView {
  cells: SeriesCell[]
}

/**
 * The round as it stood at one game. `roundGames` are the round's games in time order, up to and
 * including the game shown: the 7 boxes come from the stored results string of that game. Null
 * when the game is not in the list.
 */
export function seriesPanelView(
  roundGames: readonly FinalsRoundGame[],
  matchId: number,
): SeriesPanelView | null {
  const index = roundGames.findIndex((g) => g.matchId === matchId)
  const game = roundGames[index]
  if (index < 0 || game === undefined) return null
  const cells: SeriesCell[] = Array.from({ length: FINALS_BOX_COUNT }, (_, i) => {
    const c = game.roundResults[i]
    const letter = c === 'W' || c === 'L' ? c : null
    const g = roundGames[i]
    return { letter, matchId: letter === null ? null : (g?.matchId ?? null), current: i === index }
  })
  return { cells }
}

interface AttemptGames {
  attempt: number
  gameRows: readonly (FinalsRoundGame & { round: number })[]
}

/**
 * The games of one round of one attempt (time order, as stored) up to and including `matchId`.
 * Empty when the game is not found there.
 */
export function finalsRoundGamesUpTo(
  attempts: readonly AttemptGames[],
  attempt: number,
  round: number,
  matchId: number,
): FinalsRoundGame[] {
  const rows = attempts.find((a) => a.attempt === attempt)?.gameRows ?? []
  const inRound = rows.filter((g) => g.round === round)
  const index = inRound.findIndex((g) => g.matchId === matchId)
  return index < 0 ? [] : inRound.slice(0, index + 1)
}

// ── Context line (game page footer) ──────────────────────────────────────────

export interface FinalsPanelLike {
  round: number
  boxes: string
  retry: boolean
}

export interface FinalsContextLine {
  kind: FinalsOutcome | 'next'
  title: string
  detail: string | null
}

/**
 * What comes after this game. `panel` is the stored state after it (CF1's `panelViewFromGame`).
 * For a game inside a round the next game is the first empty box of the panel; the page does not
 * keep a counter.
 */
export function clubFinalsContextLine(
  badge: FinalsBadgeLike,
  panel: FinalsPanelLike | null,
): FinalsContextLine {
  const outcome = clubFinalsOutcome(badge)
  if (outcome === 'final_won') {
    return {
      kind: outcome,
      title: 'Won the final',
      detail: 'What comes next is not known yet.',
    }
  }
  if (outcome === 'round_won') {
    return {
      kind: outcome,
      title: 'Won the round',
      detail:
        panel === null
          ? null
          : `Next: ${roundName(panel.round, panel.round === FINALS_ROUND_COUNT)}, Game 1`,
    }
  }
  if (outcome === 'eliminated') {
    return {
      kind: outcome,
      title: `Eliminated, run ends ${clubFinalsRunScore(badge)}`,
      detail: panel?.retry === true ? 'Next: a new run starts at Round 1' : null,
    }
  }
  const nextBox = panel === null ? -1 : panel.boxes.length
  return {
    kind: 'next',
    title: nextBox >= 0 ? `Next: Game ${String(nextBox + 1)}` : 'Round goes on',
    detail: `${roundName(badge.round, badge.isFinal)}, series ${clubFinalsSeriesScore(badge)}`,
  }
}

// ── Games list filter ────────────────────────────────────────────────────────

export interface FinalsGameRef {
  matchId: number
  round: number
}

/** Match ids of the derived Club Finals games, optionally of one round. */
export function clubFinalsMatchIds(
  attempts: readonly { gameRows: readonly FinalsGameRef[] }[],
  round: number | null,
): number[] {
  const ids: number[] = []
  for (const a of attempts) {
    for (const g of a.gameRows) {
      if (round === null || g.round === round) ids.push(g.matchId)
    }
  }
  return ids
}

/** The `round` query value: 1 to 4, anything else is "all rounds". */
export function parseFinalsRound(raw: string | string[] | undefined): number | null {
  if (typeof raw !== 'string') return null
  const n = Number.parseInt(raw, 10)
  return Number.isInteger(n) && n >= 1 && n <= FINALS_ROUND_COUNT ? n : null
}
