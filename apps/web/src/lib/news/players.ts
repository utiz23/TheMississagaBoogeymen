// Player facts for the news desk fact sheets (Part C2, spec §12.15/§12.16/
// §12.17): each named line read against the player's own games — norms and
// labels, season and career highs, form, season firsts and coming milestones.
// Pure; the loader passes each named player's game rows of every title up to
// the sheet's last game (`listNewsPlayerGames`), oldest first.
//
// Scope decisions (documented in contract.ts):
// - norms, labels and form: this title, the game's mode, the same position
//   (F/D; from the stored EA position, the loadout override is not stored per
//   row), counted games, games that ended early left out;
// - bests: the same mode (season = this title, career = every title with box
//   scores);
// - firsts and approaching: title-wide, every row (DNF too), like the title
//   totals and the milestones.
import {
  PLAYER_NORM_MIN_GAMES,
  PLAYER_NORM_STATS,
  emptyPlayerExtras,
  nextMilestone,
  type NewsApproaching,
  type NewsGameFacts,
  type NewsPlayerLine,
  type NewsPlayerNorm,
  type NewsPosition,
  type PlayerBest,
  type PlayerFirst,
  type PlayerForm,
  type PlayerLabel,
  type PlayerNormStat,
} from '@eanhl/db/news'
import type { NewsPlayerGame } from '@eanhl/db/queries'
import { isEndedEarly, newsPosition } from './build-facts.ts'
import { percentile } from './norms.ts'

/** One game of a named player, any title. */
export interface PlayerGameInput {
  matchId: number
  gameTitleId: number
  night: string
  /** ISO timestamp. */
  playedAt: string
  gameMode: '3s' | '6s' | null
  result: 'WIN' | 'LOSS' | 'OTL' | 'DNF'
  goals: number
  assists: number
  shots: number
  hits: number
  position: NewsPosition
  endedEarly: boolean
}

/** A database row as an input (F/D/G and the ended-early rule as on the sheet). */
export function playerGameFromRow(r: NewsPlayerGame): PlayerGameInput {
  return {
    matchId: r.matchId,
    gameTitleId: r.gameTitleId,
    night: r.night,
    playedAt: r.playedAt,
    gameMode: r.gameMode,
    result: r.result,
    goals: r.goals,
    assists: r.assists,
    shots: r.shots,
    hits: r.hits,
    position: newsPosition(r.position, r.isGoalie),
    endedEarly: isEndedEarly({
      scoreFor: r.scoreFor,
      creditedGoals: r.creditedGoals,
      timeOnAttack: r.timeOnAttack,
      shots: { for: r.shotsFor, against: r.shotsAgainst },
    }),
  }
}

// ── Thresholds (spec §12.16: Claude's call) ─────────────────────────────────

const LOW_Q = 0.2
const HIGH_Q = 0.8
/** A season high needs this many earlier games of the title in the mode. */
export const SEASON_HIGH_MIN_GAMES = 5
/** A career high needs this many earlier games in the mode, every title. */
export const CAREER_HIGH_MIN_GAMES = 20
/** A high needs at least this value. */
export const HIGH_MIN_VALUE: Record<PlayerNormStat, number> = {
  goals: 2,
  assists: 2,
  points: 3,
  shots: 5,
  hits: 5,
}
/** Form: the last this many counted games of the title in the mode, this one included. */
export const FORM_GAMES = 5
/** Heating up: last-5 points per game at least this times the season's ... */
export const FORM_UP_RATIO = 1.5
/** ... and at least this much more; cooling off: at most half and this much less. */
export const FORM_MIN_DIFF = 0.6
export const FORM_DOWN_RATIO = 0.5
/** A coming milestone: at most this many away after the game. */
export const APPROACHING_MAX = 3
export const HAT_TRICK = 3

const round1 = (n: number): number => Math.round(n * 10) / 10
const mean = (v: readonly number[]): number =>
  v.length === 0 ? 0 : v.reduce((a, b) => a + b, 0) / v.length
const counted = (g: PlayerGameInput) => g.result !== 'DNF'
const statOf = (
  g: Pick<PlayerGameInput, 'goals' | 'assists' | 'shots' | 'hits'>,
  k: PlayerNormStat,
) => (k === 'points' ? g.goals + g.assists : g[k])

/** The line's own numbers (shots/hits null when the game ended early). */
function lineStat(line: NewsPlayerLine, k: PlayerNormStat): number | null {
  if (k === 'points') return line.points
  return line[k]
}

/** One stat against the sample: above the 80th percentile big, under the 20th quiet (never on shots for D/G). */
export function playerLabel(
  value: number,
  sample: readonly number[],
  stat: PlayerNormStat,
  position: NewsPosition,
): PlayerLabel {
  const sorted = [...sample].sort((a, b) => a - b)
  if (value > percentile(sorted, HIGH_Q)) return 'big for him'
  if (value < percentile(sorted, LOW_Q) && !(stat === 'shots' && position !== 'F')) {
    return 'quiet for him'
  }
  return 'typical'
}

/**
 * The line's norm from `prior` (the player's earlier games, oldest first);
 * null below 10 sample games, for a goalie line or a game that ended early.
 */
export function playerNorm(
  line: NewsPlayerLine,
  game: Pick<NewsGameFacts, 'gameMode' | 'endedEarly'>,
  gameTitleId: number,
  prior: readonly PlayerGameInput[],
): NewsPlayerNorm | null {
  if (line.position === 'G' || game.endedEarly || game.gameMode === null) return null
  const sample = prior.filter(
    (g) =>
      g.gameTitleId === gameTitleId &&
      g.gameMode === game.gameMode &&
      g.position === line.position &&
      counted(g) &&
      !g.endedEarly,
  )
  if (sample.length < PLAYER_NORM_MIN_GAMES) return null
  const last10 = sample.slice(-10)
  const avg = (games: readonly PlayerGameInput[], k: PlayerNormStat) =>
    round1(mean(games.map((g) => statOf(g, k))))
  const perGame = Object.fromEntries(PLAYER_NORM_STATS.map((k) => [k, avg(sample, k)])) as Record<
    PlayerNormStat,
    number
  >
  const labels = Object.fromEntries(
    PLAYER_NORM_STATS.map((k) => [
      k,
      playerLabel(
        lineStat(line, k) ?? 0,
        sample.map((g) => statOf(g, k)),
        k,
        line.position,
      ),
    ]),
  ) as Record<PlayerNormStat, PlayerLabel>
  return {
    games: sample.length,
    perGame,
    last10: {
      goals: avg(last10, 'goals'),
      assists: avg(last10, 'assists'),
      points: avg(last10, 'points'),
    },
    labels,
  }
}

/** Season and career highs this game set (strictly above every earlier counted game of the mode). */
export function playerBests(
  line: NewsPlayerLine,
  game: Pick<NewsGameFacts, 'gameMode' | 'endedEarly'>,
  gameTitleId: number,
  prior: readonly PlayerGameInput[],
): PlayerBest[] {
  if (line.position === 'G' || game.gameMode === null) return []
  const out: PlayerBest[] = []
  const mode = prior.filter((g) => g.gameMode === game.gameMode && counted(g))
  for (const k of PLAYER_NORM_STATS) {
    const v = lineStat(line, k)
    if (v === null || v < HIGH_MIN_VALUE[k]) continue
    // Shots and hits of games that ended early are not on the sheet: not a high to beat.
    const usable = k === 'shots' || k === 'hits' ? mode.filter((g) => !g.endedEarly) : mode
    const above = (games: readonly PlayerGameInput[]) => games.every((g) => statOf(g, k) < v)
    if (usable.length >= CAREER_HIGH_MIN_GAMES && above(usable)) {
      out.push(`career high ${k}` as PlayerBest)
      continue
    }
    const season = usable.filter((g) => g.gameTitleId === gameTitleId)
    if (season.length >= SEASON_HIGH_MIN_GAMES && above(season)) {
      out.push(`season high ${k}` as PlayerBest)
    }
  }
  return out
}

/** Last 5 counted games of the title in the mode (this one included) against the season sample. */
export function playerForm(
  line: NewsPlayerLine,
  norm: NewsPlayerNorm | null,
  game: Pick<NewsGameFacts, 'gameMode'>,
  gameTitleId: number,
  prior: readonly PlayerGameInput[],
): PlayerForm | null {
  if (norm === null) return null
  const earlier = prior
    .filter((g) => g.gameTitleId === gameTitleId && g.gameMode === game.gameMode && counted(g))
    .slice(-(FORM_GAMES - 1))
  if (earlier.length < FORM_GAMES - 1) return null
  const last = mean([...earlier.map((g) => g.goals + g.assists), line.points])
  const season = norm.perGame.points
  if (last >= season * FORM_UP_RATIO && last - season >= FORM_MIN_DIFF) return 'heating up'
  if (last <= season * FORM_DOWN_RATIO && season - last >= FORM_MIN_DIFF) return 'cooling off'
  return null
}

/** Season firsts (title-wide, every earlier row of the title). */
export function playerFirsts(
  line: NewsPlayerLine,
  gameTitleId: number,
  prior: readonly PlayerGameInput[],
): PlayerFirst[] {
  const title = prior.filter((g) => g.gameTitleId === gameTitleId)
  const none = (f: (g: PlayerGameInput) => boolean) => !title.some(f)
  const out: PlayerFirst[] = []
  const firstGoal = line.goals > 0 && none((g) => g.goals > 0)
  const firstAssist = line.assists > 0 && none((g) => g.assists > 0)
  if (firstGoal) out.push('first goal of the season')
  if (firstAssist) out.push('first assist of the season')
  if (!firstGoal && !firstAssist && line.points > 0 && none((g) => g.goals + g.assists > 0)) {
    out.push('first point of the season')
  }
  if (line.goals >= HAT_TRICK && none((g) => g.goals >= HAT_TRICK)) {
    out.push('first hat trick of the season')
  }
  return out
}

/** Title totals after this game (every row of the title, DNF too) — the milestones' totals. */
export function titleTotalsAfter(
  line: Pick<NewsPlayerLine, 'goals' | 'assists'>,
  gameTitleId: number,
  prior: readonly PlayerGameInput[],
): { goals: number; assists: number; points: number; games: number } {
  const title = prior.filter((g) => g.gameTitleId === gameTitleId)
  const goals = title.reduce((n, g) => n + g.goals, line.goals)
  const assists = title.reduce((n, g) => n + g.assists, line.assists)
  return { goals, assists, points: goals + assists, games: title.length + 1 }
}

/** Title milestones 1-3 away after this game. */
export function playerApproaching(totals: {
  goals: number
  assists: number
  points: number
  games: number
}): NewsApproaching[] {
  const out: NewsApproaching[] = []
  for (const stat of ['points', 'goals', 'assists', 'games'] as const) {
    const next = nextMilestone(stat, totals[stat])
    if (next === null) continue
    const remaining = next - totals[stat]
    if (remaining >= 1 && remaining <= APPROACHING_MAX) out.push({ stat, value: next, remaining })
  }
  return out
}

/** The player's games strictly before this one (the row of this match and later ones dropped). */
export function priorGames(
  history: readonly PlayerGameInput[],
  game: Pick<NewsGameFacts, 'matchId' | 'playedAt'>,
): PlayerGameInput[] {
  const i = history.findIndex((g) => g.matchId === game.matchId)
  if (i >= 0) return history.slice(0, i)
  return history.filter((g) => g.playedAt < game.playedAt)
}

/**
 * Every named line of every game with its player facts. `history` = each
 * named player's games (every title, up to the sheet's last game, oldest
 * first); a player without rows keeps empty facts.
 */
export function applyPlayerFacts(
  games: readonly NewsGameFacts[],
  history: ReadonlyMap<number, readonly PlayerGameInput[]>,
  gameTitleId: number,
): NewsGameFacts[] {
  return games.map((game) => ({
    ...game,
    players: game.players.map((line): NewsPlayerLine => {
      const rows = history.get(line.playerId)
      if (rows === undefined) return { ...line, ...emptyPlayerExtras() }
      const prior = priorGames(rows, game)
      const norm = playerNorm(line, game, gameTitleId, prior)
      return {
        ...line,
        norm,
        bests: playerBests(line, game, gameTitleId, prior),
        form: playerForm(line, norm, game, gameTitleId, prior),
        firsts: playerFirsts(line, gameTitleId, prior),
        approaching: playerApproaching(titleTotalsAfter(line, gameTitleId, prior)),
      }
    }),
  }))
}
