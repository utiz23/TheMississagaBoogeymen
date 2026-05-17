import type { PlayerScoreEntry, TopPerformerWithDelta } from '@/lib/match-recap'
import { SectionHeader } from '@/components/ui/section-header'
import { abbreviateTeamName } from '@/lib/format'
import { StarCard } from './star-card'
import { ShowAllPlayerScores } from './show-all-player-scores'

interface TopPerformersProps {
  performers: TopPerformerWithDelta[]
  allTeamScores: PlayerScoreEntry[]
  opponentLabel: string
}

export function TopPerformers({ performers, allTeamScores, opponentLabel }: TopPerformersProps) {
  if (performers.length === 0 && allTeamScores.length === 0) return null

  const opponentAbbrev = abbreviateTeamName(opponentLabel)

  return (
    <section className="space-y-3">
      <SectionHeader label="Top Performers" subtitle="Computed from player stats" />

      {performers.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {performers.map((p, i) => {
            const rank = (i + 1) as 1 | 2 | 3
            const key =
              p.side === 'bgm'
                ? `bgm:${p.playerId?.toString() ?? i.toString()}`
                : `opp:${p.eaPlayerId ?? p.gamertag}`
            return <StarCard key={key} rank={rank} performer={p} opponentLabel={opponentAbbrev} />
          })}
        </div>
      ) : null}

      <ShowAllPlayerScores entries={allTeamScores} opponentLabel={opponentAbbrev} />
    </section>
  )
}
