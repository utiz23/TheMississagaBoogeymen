import type { DiscordGameResult, DiscordResult, DiscordStar } from '@eanhl/db/discord'
import type { TopPerformer } from '../match-recap.ts'
import { abbreviateTeamName } from '../format.ts'

export interface DiscordGameResultInput {
  match: {
    id: number
    result: DiscordResult
    scoreFor: number
    scoreAgainst: number
    opponentName: string
    gameMode: '3s' | '6s' | null
    playedAt: Date
  }
  gameTitleName: string
  overtime: boolean
  stars: Pick<TopPerformer, 'side' | 'playerId' | 'gamertag' | 'score' | 'statLine'>[]
  /** Team members, present and past (getClubMemberIds). */
  memberIds: ReadonlySet<number>
  /** Cards in the lineup image. */
  lineupCardCount: number
}

/** Pure: the Discord post's data for one game. DNF carries no stars. */
export function buildDiscordGameResult(input: DiscordGameResultInput): DiscordGameResult {
  const { match } = input
  const teamAbbrev = abbreviateTeamName(match.opponentName)
  const stars: DiscordStar[] =
    match.result === 'DNF'
      ? []
      : input.stars.map((s, i) => {
          const kind =
            s.side === 'opp'
              ? 'opponent'
              : s.playerId !== null && input.memberIds.has(s.playerId)
                ? 'member'
                : 'guest'
          return {
            rank: i + 1,
            gamertag: s.gamertag,
            kind,
            playerId: s.side === 'opp' ? null : s.playerId,
            score: s.score,
            statLine: s.statLine,
            teamAbbrev: s.side === 'opp' ? teamAbbrev : null,
          }
        })
  return {
    matchId: match.id,
    result: match.result,
    overtime: input.overtime,
    scoreFor: match.scoreFor,
    scoreAgainst: match.scoreAgainst,
    opponentName: match.opponentName,
    gameTitleName: input.gameTitleName,
    gameMode: match.gameMode,
    playedAt: match.playedAt.toISOString(),
    stars,
    lineupCardCount: match.result === 'DNF' ? 0 : input.lineupCardCount,
  }
}
