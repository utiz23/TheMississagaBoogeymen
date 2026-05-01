import type { ClubSeasonRank } from '@eanhl/db'

interface SeasonRankWidgetProps {
  rank: ClubSeasonRank
}

function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="font-condensed text-lg font-bold tabular text-zinc-100">{value}</span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">
        {label}
      </span>
    </div>
  )
}

function ThresholdRow({
  label,
  threshold,
  current,
}: {
  label: string
  threshold: number | null
  current: number | null
}) {
  if (threshold === null) return null
  const delta = current !== null ? threshold - current : null
  const met = delta !== null && delta <= 0
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-zinc-500">{label}</span>
      <span
        className={`font-condensed text-sm font-semibold tabular ${met ? 'text-accent' : 'text-zinc-300'}`}
      >
        {threshold}
        {delta !== null && !met && (
          <span className="ml-1 text-xs font-normal text-zinc-600">
            ({delta > 0 ? `+${String(delta)}` : String(delta)})
          </span>
        )}
        {met && <span className="ml-1 text-xs font-normal text-emerald-500">✓</span>}
      </span>
    </div>
  )
}

export function SeasonRankWidget({ rank }: SeasonRankWidgetProps) {
  const divLabel =
    rank.divisionName ??
    (rank.currentDivision !== null
      ? `Division ${String(rank.currentDivision)}`
      : 'Unknown Division')
  const currentPoints = rank.points

  const hasSeasonRecord = rank.wins !== null || rank.losses !== null || rank.otl !== null
  const hasThresholds =
    rank.pointsForPromotion !== null ||
    rank.pointsToHoldDivision !== null ||
    rank.pointsToTitle !== null

  return (
    <div className="broadcast-panel space-y-4 px-5 py-4">
      {/* Division header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="font-condensed text-lg font-bold uppercase tracking-wide text-zinc-100">
            {divLabel}
          </p>
          {currentPoints !== null && (
            <p className="text-sm text-zinc-400">
              <span className="font-condensed font-semibold tabular text-zinc-200">
                {currentPoints}
              </span>{' '}
              pts
              {rank.projectedPoints !== null && (
                <span className="ml-2 text-zinc-600">/ {rank.projectedPoints} proj.</span>
              )}
            </p>
          )}
        </div>
        <span className="text-xs text-zinc-600">Season</span>
      </div>

      {/* Season W-L-OTL — clearly labelled as season, not all-time */}
      {hasSeasonRecord && (
        <div className="flex items-center gap-5">
          <StatPill label="W" value={String(rank.wins ?? '—')} />
          <StatPill label="L" value={String(rank.losses ?? '—')} />
          <StatPill label="OTL" value={String(rank.otl ?? '—')} />
          {rank.gamesPlayed !== null && (
            <span className="ml-auto text-xs text-zinc-600">{rank.gamesPlayed} GP</span>
          )}
        </div>
      )}

      {/* Division thresholds */}
      {hasThresholds && (
        <div className="border-t border-zinc-800/60 pt-3 space-y-1.5">
          <ThresholdRow label="Title" threshold={rank.pointsToTitle} current={currentPoints} />
          <ThresholdRow
            label="Promotion"
            threshold={rank.pointsForPromotion}
            current={currentPoints}
          />
          <ThresholdRow
            label="Hold division"
            threshold={rank.pointsToHoldDivision}
            current={currentPoints}
          />
        </div>
      )}
    </div>
  )
}
