// Line chemistry for the news desk fact sheets (Part C2.6, spec §12.17-4):
// the title record of the named pairs who played a game together. Same pair
// rule as the stats page's chemistry (`getPlayerPairs`: both players in the
// club's rows of a match, title-scoped, at least `CHEMISTRY_PAIR_MIN_GP`
// games), but computed from the named players' rows up to this game, so a
// backfilled sheet never sees later games. Pure.
import type { NewsGameFacts, NewsPairRecord } from '@eanhl/db/news'
import type { PlayerGameInput } from './players.ts'

/** = `CHEMISTRY_PAIR_MIN_GP` of the stats page (not imported: that module loads the database client). */
export const PAIR_MIN_GAMES = 5
/** At most this many pairs per game, most games first. */
export const MAX_PAIRS = 3

/**
 * The pairs of a game: every two named lines (ordered by player id), their
 * counted games of the title together up to and including this one (DNF
 * games left out: W-L-OTL only), at least 5; most games first, then most
 * wins, then names; at most 3.
 */
export function gameChemistry(
  game: Pick<NewsGameFacts, 'matchId' | 'players'>,
  history: ReadonlyMap<number, readonly PlayerGameInput[]>,
  gameTitleId: number,
): NewsPairRecord[] {
  const upTo = (rows: readonly PlayerGameInput[]) => {
    const i = rows.findIndex((g) => g.matchId === game.matchId)
    return (i >= 0 ? rows.slice(0, i + 1) : rows).filter(
      (g) => g.gameTitleId === gameTitleId && g.result !== 'DNF',
    )
  }
  const lines = [...game.players].sort((a, b) => a.playerId - b.playerId)
  const out: NewsPairRecord[] = []
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const a = lines[i]!
      const b = lines[j]!
      if (a.playerId === b.playerId) continue
      const withB = new Set(upTo(history.get(b.playerId) ?? []).map((g) => g.matchId))
      const together = upTo(history.get(a.playerId) ?? []).filter((g) => withB.has(g.matchId))
      if (together.length < PAIR_MIN_GAMES) continue
      out.push({
        pair: [a.name, b.name],
        games: together.length,
        wins: together.filter((g) => g.result === 'WIN').length,
        losses: together.filter((g) => g.result === 'LOSS').length,
        otl: together.filter((g) => g.result === 'OTL').length,
      })
    }
  }
  return out
    .sort(
      (x, y) =>
        y.games - x.games || y.wins - x.wins || x.pair.join(' ').localeCompare(y.pair.join(' ')),
    )
    .slice(0, MAX_PAIRS)
}

/** Every game with its chemistry. */
export function applyChemistry(
  games: readonly NewsGameFacts[],
  history: ReadonlyMap<number, readonly PlayerGameInput[]>,
  gameTitleId: number,
): NewsGameFacts[] {
  return games.map((g) => ({ ...g, chemistry: gameChemistry(g, history, gameTitleId) }))
}
