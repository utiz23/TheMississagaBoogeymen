import type { PlayerScoreEntry, TopPerformerWithDelta } from '@/lib/match-recap'
import { performerKey } from '@/lib/match-recap'
import { abbreviateTeamName } from '@/lib/format'
import { PerformerScoreList } from './show-all-player-scores'

// Rail module — the performer ladder. The section owns nothing but its chrome:
// the ranked list (and its show-all / expand state) lives in the client child.
// `performers` is `allTeamScores.slice(0, 3)` with season deltas attached, so
// the only thing this component takes from it is those deltas, keyed by player
// identity rather than by list position.

interface TopPerformersProps {
  performers: TopPerformerWithDelta[]
  allTeamScores: PlayerScoreEntry[]
  opponentLabel: string
}

export function TopPerformers({ performers, allTeamScores, opponentLabel }: TopPerformersProps) {
  if (allTeamScores.length === 0) return null

  const deltas: Record<string, number> = {}
  for (const p of performers) {
    if (p.vsSeasonAvg !== null) deltas[performerKey(p)] = p.vsSeasonAvg
  }

  return (
    <section>
      <div className="border border-border bg-surface">
        <div className="flex flex-col gap-0.5 px-3.5 pb-2.5 pt-3">
          <h2 className="font-condensed text-[11px] font-extrabold uppercase tracking-[0.18em] text-fg-3">
            <span aria-hidden className="pr-1 text-accent">
              ▰
            </span>
            Top Performers
          </h2>
          <p className="font-condensed text-[10px] uppercase tracking-[0.12em] text-fg-3">
            Game-score model · tap a row
          </p>
        </div>

        <PerformerScoreList
          entries={allTeamScores}
          deltas={deltas}
          opponentLabel={abbreviateTeamName(opponentLabel)}
        />
      </div>
    </section>
  )
}
