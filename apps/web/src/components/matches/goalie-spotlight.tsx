import Link from 'next/link'
import type { GoalieSpotlight } from '@/lib/match-recap'
import { PositionPill } from './position-pill'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'

interface GoalieSpotlightProps {
  goalies: GoalieSpotlight[]
}

export function GoalieSpotlightSection({ goalies }: GoalieSpotlightProps) {
  if (goalies.length === 0) return null

  return (
    <section className="space-y-3">
      <SectionHeader label="Goalie" />
      <div className="grid gap-3 sm:grid-cols-2">
        {goalies.map((g) => (
          <GoalieCard key={g.playerId} goalie={g} />
        ))}
      </div>
    </section>
  )
}

function GoalieCard({ goalie }: { goalie: GoalieSpotlight }) {
  const advancedRows: { label: string; value: string }[] = []
  if (goalie.breakawayShots !== null && goalie.breakawayShots > 0) {
    advancedRows.push({
      label: 'Breakaways',
      value: `${(goalie.breakawaySaves ?? 0).toString()}/${goalie.breakawayShots.toString()}`,
    })
  }
  if (goalie.penShots !== null && goalie.penShots > 0) {
    advancedRows.push({
      label: 'Pen. Shots',
      value: `${(goalie.penSaves ?? 0).toString()}/${goalie.penShots.toString()}`,
    })
  }
  if (goalie.despSaves !== null && goalie.despSaves > 0) {
    advancedRows.push({ label: 'Desp. Saves', value: goalie.despSaves.toString() })
  }
  if (goalie.pokechecks !== null && goalie.pokechecks > 0) {
    advancedRows.push({ label: 'Pokechecks', value: goalie.pokechecks.toString() })
  }

  return (
    <Link href={`/roster/${goalie.playerId.toString()}`} className="group block">
      <Panel hoverable className="p-4">
        <div className="flex items-center gap-2">
          <PositionPill label="G" position="goalie" isGoalie={true} />
          <span className="truncate font-condensed text-sm font-bold uppercase tracking-wide text-zinc-100 group-hover:text-zinc-50">
            {goalie.gamertag}
          </span>
        </div>

        {/* Headline stat row */}
        <div className="mt-4 grid grid-cols-4 gap-2">
          <Stat label="SV%" value={goalie.savePctFormatted} featured />
          <Stat label="SV" value={goalie.saves.toString()} />
          <Stat label="GA" value={goalie.goalsAgainst.toString()} />
          <Stat label="SA" value={goalie.shotsAgainst.toString()} />
        </div>

        {advancedRows.length > 0 ? (
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 border-t border-zinc-800/60 pt-3">
            {advancedRows.map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-2">
                <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                  {r.label}
                </span>
                <span className="font-condensed text-sm font-semibold tabular-nums text-zinc-300">
                  {r.value}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </Panel>
    </Link>
  )
}

function Stat({
  label,
  value,
  featured = false,
}: {
  label: string
  value: string
  featured?: boolean
}) {
  return (
    <div className="flex flex-col items-center gap-0.5 border border-zinc-800/80 bg-zinc-950/30 py-2">
      <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
        {label}
      </span>
      <span
        className={`font-condensed font-black tabular-nums leading-none ${
          featured ? 'text-xl text-accent' : 'text-lg text-zinc-100'
        }`}
      >
        {value}
      </span>
    </div>
  )
}
