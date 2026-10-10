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
  /** Members whose card loaded and can be drawn. */
  cardPlayerIds: ReadonlySet<number>
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
  const cardPlayerIds = stars.flatMap((s) =>
    s.kind === 'member' && s.playerId !== null && input.cardPlayerIds.has(s.playerId)
      ? [s.playerId]
      : [],
  )
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
    cardPlayerIds,
  }
}
