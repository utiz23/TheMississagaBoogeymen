import type { DiscordGameResult } from '@eanhl/db/discord'
import {
  getCardProgressForPlayers,
  getClubMemberIds,
  getEARoster,
  getMatchById,
  getMatchLineups,
  getMatchPeriodSummaries,
  getOpponentPlayerMatchStats,
  getPlayerMatchStats,
  getRosterCarryOvers,
  listAllGameTitles,
} from '@eanhl/db/queries'
import { cardFromRosterRow } from '@/components/cards/card-adapters'
import { starsForMatch, wentToOvertime } from '@/lib/match-recap'
import { buildDiscordGameResult } from './game-result'

type CardViewModel = ReturnType<typeof cardFromRosterRow>

/**
 * Everything the Discord post needs for one game. Stars come from the same
 * starsForMatch the match page uses; cards are built exactly like the home
 * carousel's (EA roster + carry-overs, newest season card, equipped theme).
 * Throws on a DB failure — the caller (the discord service) retries.
 */
export async function loadDiscordGameResult(
  matchId: number,
): Promise<{ result: DiscordGameResult; cards: CardViewModel[] } | null> {
  const match = await getMatchById(matchId)
  if (!match) return null

  const [playerStats, opponentPlayerStats, lineups, periodSummaries, titles, memberIdList] =
    await Promise.all([
      getPlayerMatchStats(match.id),
      getOpponentPlayerMatchStats(match.id),
      getMatchLineups(match.id),
      getMatchPeriodSummaries(match.id),
      listAllGameTitles(),
      getClubMemberIds(),
    ])

  const stars = starsForMatch(match, playerStats, opponentPlayerStats, lineups)
  const overtime = wentToOvertime(
    match,
    periodSummaries,
    [...playerStats, ...opponentPlayerStats].map((p) => p.toiSeconds),
  )
  const memberIds = new Set(memberIdList)
  const memberStarIds =
    match.result === 'DNF'
      ? []
      : stars.flatMap((s) =>
          s.side === 'bgm' && s.playerId !== null && memberIds.has(s.playerId) ? [s.playerId] : [],
        )

  const cards = await loadCards(match.gameTitleId, memberStarIds)
  const cardIds = new Set(cards.map((c) => c.front.playerId))
  const title = titles.find((t) => t.id === match.gameTitleId)

  const result = buildDiscordGameResult({
    match,
    gameTitleName: title?.name ?? '',
    overtime,
    stars,
    memberIds,
    cardPlayerIds: cardIds,
  })
  // Cards in star order (result.cardPlayerIds is already ordered).
  const byId = new Map(cards.map((c) => [c.front.playerId, c]))
  return {
    result,
    cards: result.cardPlayerIds.flatMap((id) => {
      const c = byId.get(id)
      return c ? [c] : []
    }),
  }
}

async function loadCards(gameTitleId: number, playerIds: number[]): Promise<CardViewModel[]> {
  if (playerIds.length === 0) return []
  const [roster, carryOvers, summaries] = await Promise.all([
    getEARoster(gameTitleId),
    getRosterCarryOvers(gameTitleId),
    getCardProgressForPlayers(playerIds),
  ])
  const rows = new Map([...roster, ...carryOvers].map((r) => [r.playerId, r]))
  return playerIds.flatMap((id) => {
    const row = rows.get(id)
    return row ? [cardFromRosterRow(row, summaries.get(id))] : []
  })
}
