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
/** The wins (and the losses) that end a round: 4. A threshold, never a computed value. */
const ROUND_LIMIT = 4

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
  roundWinsAfter: number
  roundLossesAfter: number
  roundResults: string
}

export interface SeriesCell {
  letter: 'W' | 'L' | null
  /** The game this box stands for, when the data has it. */
  matchId: number | null
  current: boolean
}

export interface SeriesPanelView {
  before: { wins: number; losses: number }
  after: { wins: number; losses: number }
  cells: SeriesCell[]
}

/**
 * The round as it stood at one game. `roundGames` are the round's games in time order, up to and
 * including the game shown. The score before is the stored score after the game before it; a
 * round's first game starts from 0–0 by the rules. Null when the game is not in the list.
 */
export function seriesPanelView(
  roundGames: readonly FinalsRoundGame[],
  matchId: number,
): SeriesPanelView | null {
  const index = roundGames.findIndex((g) => g.matchId === matchId)
  const game = roundGames[index]
  if (index < 0 || game === undefined) return null
  const previous = roundGames[index - 1]
  const cells: SeriesCell[] = Array.from({ length: FINALS_BOX_COUNT }, (_, i) => {
    const c = game.roundResults[i]
    const letter = c === 'W' || c === 'L' ? c : null
    const g = roundGames[i]
    return { letter, matchId: letter === null ? null : (g?.matchId ?? null), current: i === index }
  })
  return {
    before:
      previous === undefined
        ? { wins: 0, losses: 0 }
        : { wins: previous.roundWinsAfter, losses: previous.roundLossesAfter },
    after: { wins: game.roundWinsAfter, losses: game.roundLossesAfter },
    cells,
  }
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

// ── Home page: playoff mode ──────────────────────────────────────────────────

export interface FinalsSituation {
  text: string
  /** `danger` = an elimination game is next; `chance` = a win moves the run on. */
  tone: 'danger' | 'chance' | 'done'
}

interface SituationGame {
  roundWon: boolean
  finalWon: boolean
  eliminated: boolean
  roundWinsAfter: number
  roundLossesAfter: number
}

/**
 * One line about the stakes of the next game, from the last game's stored state. A win or a loss
 * count is only compared with the rule limit of 4 (3 = one game away). Null when nothing is
 * special or nothing is known.
 */
export function clubFinalsSituation(
  panelRound: number,
  lastGame: SituationGame | null,
): FinalsSituation | null {
  if (lastGame === null || lastGame.eliminated || lastGame.finalWon) return null
  if (lastGame.roundWon) {
    return {
      tone: 'done',
      text:
        panelRound === FINALS_ROUND_COUNT
          ? 'Round won. On to the final'
          : `Round won. On to round ${String(panelRound)}`,
    }
  }
  const oneWin = lastGame.roundWinsAfter === ROUND_LIMIT - 1
  const oneLoss = lastGame.roundLossesAfter === ROUND_LIMIT - 1
  if (oneWin && oneLoss) return { tone: 'danger', text: 'Win or go home' }
  if (oneWin) {
    return {
      tone: 'chance',
      text:
        panelRound === FINALS_ROUND_COUNT
          ? 'One win from the title'
          : panelRound === FINALS_ROUND_COUNT - 1
            ? 'One win from the final'
            : 'One win from the next round',
    }
  }
  if (oneLoss) return { tone: 'danger', text: 'One loss from elimination' }
  return null
}

// ── Attempt wording (home card and record strip) ─────────────────────────────

export interface AttemptLike {
  attempt: number
  status: 'active' | 'eliminated' | 'final_won'
  wins: number
  losses: number
  roundReached: number
}

/** "Reached round 2", "In the final", "Won the final". */
export function clubFinalsReached(a: Pick<AttemptLike, 'roundReached' | 'status'>): string {
  if (a.status === 'final_won') return 'Won the final'
  if (a.roundReached === FINALS_ROUND_COUNT) {
    return a.status === 'active' ? 'In the final' : 'Reached the final'
  }
  return `Reached round ${String(a.roundReached)}`
}

/** A run is alive when the newest attempt is still active and its panel state is stored. */
export function clubFinalsRunAlive(
  attempts: readonly Pick<AttemptLike, 'status'>[],
  panel: unknown,
): boolean {
  return attempts[attempts.length - 1]?.status === 'active' && panel !== null && panel !== undefined
}

export interface FinalsRecordLine {
  /** "13–5 · Reached the final", from the stored best attempt. Null = unknown. */
  best: string | null
  /** "Attempt 4 · Round 2 · 3–1", only while an attempt runs. */
  current: string | null
}

/** The Club Finals line of the record strip. Null when no attempt is derived. */
export function clubFinalsRecordLine(
  attempts: readonly AttemptLike[],
  panel: { round: number; attemptWins: number; attemptLosses: number } | null,
  best: AttemptLike | null,
): FinalsRecordLine | null {
  const last = attempts[attempts.length - 1]
  if (last === undefined) return null
  const running = last.status === 'active' && panel !== null
  return {
    best:
      best === null
        ? null
        : `${String(best.wins)}–${String(best.losses)} · ${clubFinalsReached(best)}`,
    current: running
      ? `Attempt ${String(last.attempt)} · ${roundName(panel.round, panel.round === FINALS_ROUND_COUNT)} · ${String(panel.attemptWins)}–${String(panel.attemptLosses)}`
      : null,
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
