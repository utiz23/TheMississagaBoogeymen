import type { getPlayerMatchStats } from '@eanhl/db/queries'

type PlayerStat = Awaited<ReturnType<typeof getPlayerMatchStats>>[number]

interface PlayerStatsTableProps {
  playerStats: PlayerStat[]
}

/** "—" cell for stats that don't apply to this row's player type. */
const DASH = <span className="text-zinc-600">—</span>

function statCell(value: number | null | undefined, isApplicable: boolean): React.ReactNode {
  if (!isApplicable || value === null || value === undefined) return DASH
  return value.toString()
}

function PlusMinusCell({ value, isApplicable }: { value: number; isApplicable: boolean }) {
  if (!isApplicable) return DASH
  const color = value > 0 ? 'text-emerald-400' : value < 0 ? 'text-rose-400' : 'text-zinc-400'
  const label = value > 0 ? `+${value.toString()}` : value.toString()
  return <span className={color}>{label}</span>
}

function PlayerRow({ stat }: { stat: PlayerStat }) {
  const isSkater = !stat.isGoalie
  const isGoalie = stat.isGoalie

  return (
    <tr className="border-b border-zinc-800/60 hover:bg-surface-raised transition-colors group">
      {/* Player name */}
      <td className="py-2.5 pl-4 pr-2 text-sm font-medium text-zinc-200 group-hover:text-zinc-50 max-w-[10rem] truncate">
        {stat.gamertag}
      </td>

      {/* Position */}
      <td className="px-2 py-2.5 text-xs text-zinc-500 whitespace-nowrap">
        {stat.position ?? (isGoalie ? 'G' : '—')}
      </td>

      {/* Skater offensive stats */}
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {statCell(stat.goals, isSkater)}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {statCell(stat.assists, isSkater)}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular">
        <PlusMinusCell value={stat.plusMinus} isApplicable={isSkater} />
      </td>

      {/* Skater activity */}
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {statCell(stat.shots, isSkater)}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {statCell(stat.hits, isSkater)}
      </td>

      {/* PIM — applies to both */}
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {stat.pim.toString()}
      </td>

      {/* TA / GV — skaters only, hidden on mobile */}
      <td className="hidden sm:table-cell px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {statCell(stat.takeaways, isSkater)}
      </td>
      <td className="hidden sm:table-cell px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {statCell(stat.giveaways, isSkater)}
      </td>

      {/* Goalie stats — SV, GA, SA */}
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {statCell(stat.saves, isGoalie)}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {statCell(stat.goalsAgainst, isGoalie)}
      </td>
      <td className="pr-4 pl-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {statCell(stat.shotsAgainst, isGoalie)}
      </td>
    </tr>
  )
}

/**
 * Single unified table of player stats for one match.
 *
 * Skaters appear first (sorted by goals), goalies at the bottom
 * separated by a subtle divider row. Goalie-specific columns (SV, GA, SA)
 * show "—" for skaters; skater columns show "—" for goalies.
 *
 * This is the honest representation of the schema: both player types
 * coexist in the same table with nullable columns for the non-applicable side.
 */
export function PlayerStatsTable({ playerStats }: PlayerStatsTableProps) {
  const goalieStartIndex = playerStats.findIndex((p) => p.isGoalie)
  const hasGoalies = goalieStartIndex !== -1

  const skaters = hasGoalies ? playerStats.slice(0, goalieStartIndex) : playerStats
  const goalies = hasGoalies ? playerStats.slice(goalieStartIndex) : []

  return (
    <div className="overflow-x-auto border border-zinc-800 bg-surface">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="py-2 pl-4 pr-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Player
            </th>
            <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Pos
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              G
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              A
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              +/-
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              SOG
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Hits
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              PIM
            </th>
            <th className="hidden sm:table-cell px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              TA
            </th>
            <th className="hidden sm:table-cell px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              GV
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              SV
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              GA
            </th>
            <th className="pr-4 pl-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              SA
            </th>
          </tr>
        </thead>

        <tbody>
          {/* Skater rows */}
          {skaters.map((stat) => (
            <PlayerRow key={stat.id} stat={stat} />
          ))}

          {/* Goalie section divider */}
          {hasGoalies && (
            <tr className="border-t border-b border-zinc-800 bg-zinc-900/40">
              <td
                colSpan={13}
                className="py-1 pl-4 text-[10px] font-semibold uppercase tracking-widest text-zinc-600"
              >
                Goalie
              </td>
            </tr>
          )}

          {/* Goalie rows */}
          {goalies.map((stat) => (
            <PlayerRow key={stat.id} stat={stat} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
