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
import type { CardViewModel } from '@/components/cards/card-model'
import {
  applyLoadoutOverrides,
  buildAllTeamScores,
  lineupsForMatch,
  starsForMatch,
  wentToOvertime,
} from '@/lib/match-recap'
import { ladderFor, type LineupPositionKey } from '@/lib/lineup-shape'
import { discordDisplayOrder, lineupSlots, normalizeLineupTag } from '@/lib/lineup-slots'
import { buildDiscordGameResult } from './game-result'
import { cardForGame, emptySlotLabel } from './game-card'

export interface LineupImageSlot {
  position: LineupPositionKey
  card: CardViewModel | null
  label: string
}

/**
 * Everything the Discord post needs for one game. Stars and lineup come from
 * the same functions the match page uses; each lineup card is the player's
 * normal card carrying this game's numbers (cardForGame). Throws on a DB
 * failure — the discord service retries.
 */
export async function loadDiscordGameResult(
  matchId: number,
): Promise<{ result: DiscordGameResult; lineup: LineupImageSlot[]; columns: 2 | 3 } | null> {
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

  // Game scores for every BGM player, exactly as the match page ranks them.
  const scores = buildAllTeamScores(
    match,
    applyLoadoutOverrides(playerStats, lineups.bgm),
    applyLoadoutOverrides(opponentPlayerStats, lineups.opponent),
  ).filter((e) => e.side === 'bgm')
  const scoreFor = (playerId: number | null, gamertag: string) =>
    scores.find((e) =>
      playerId !== null
        ? e.playerId === playerId
        : normalizeLineupTag(e.gamertag) === normalizeLineupTag(gamertag),
    )?.score ?? null
  const starRankFor = (playerId: number | null, gamertag: string) => {
    const i = stars.findIndex(
      (s) =>
        s.side === 'bgm' &&
        (playerId !== null
          ? s.playerId === playerId
          : normalizeLineupTag(s.gamertag) === normalizeLineupTag(gamertag)),
    )
    return i === -1 ? null : i + 1
  }

  const { variant, bgm } = lineupsForMatch(match, playerStats, opponentPlayerStats, lineups)
  const slots = lineupSlots(bgm, variant, ladderFor(match.gameMode), playerStats)
  const memberSlotIds = slots.flatMap((s) =>
    s.stat?.playerId != null && memberIds.has(s.stat.playerId) ? [s.stat.playerId] : [],
  )
  const [roster, carryOvers, summaries] =
    memberSlotIds.length === 0
      ? [[], [], new Map()]
      : await Promise.all([
          getEARoster(match.gameTitleId),
          getRosterCarryOvers(match.gameTitleId),
          getCardProgressForPlayers(memberSlotIds),
        ])
  const rosterById = new Map([...roster, ...carryOvers].map((r) => [r.playerId, r]))

  const byPosition = new Map(slots.map((s) => [s.position, s]))
  const lineup: LineupImageSlot[] =
    match.result === 'DNF'
      ? []
      : discordDisplayOrder(match.gameMode).map((position) => {
          // EA's box score doesn't split defence into left/right; the page shows D.
          const shown =
            variant === 'boxScore' && (position === 'LD' || position === 'RD') ? 'D' : position
          const slot = byPosition.get(position)
          const stat = slot?.stat ?? null
          if (!stat) {
            return {
              position,
              card: null,
              label: emptySlotLabel(shown, slot?.row?.gamertagSnapshot ?? null),
            }
          }
          const isMember = stat.playerId !== null && memberIds.has(stat.playerId)
          const card = cardForGame({
            position,
            stat,
            identity: isMember ? (rosterById.get(stat.playerId!) ?? null) : null,
            summary: isMember ? summaries.get(stat.playerId!) : undefined,
            jerseyNumber: slot?.row?.playerNumber ?? null,
            score: scoreFor(stat.playerId, stat.gamertag),
            starRank: starRankFor(stat.playerId, stat.gamertag),
            positionLabel: shown === position ? null : shown,
          })
          return { position, card, label: position }
        })

  const title = titles.find((t) => t.id === match.gameTitleId)
  const result = buildDiscordGameResult({
    match,
    gameTitleName: title?.name ?? '',
    overtime,
    stars,
    memberIds,
    lineupCardCount: lineup.filter((s) => s.card !== null).length,
  })
  return { result, lineup, columns: match.gameMode === '3s' ? 2 : 3 }
}
