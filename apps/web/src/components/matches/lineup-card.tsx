import Link from 'next/link'
import type { LineupRow, MatchLineups } from '@eanhl/db/queries'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'

interface LineupCardProps {
  lineups: MatchLineups
  opponentLabel: string
}

const ROSTER_SIZE = 6

/**
 * Pre-game lineup card. Two columns: BGM (left) and opponent (right). Each
 * column lists up to 6 captured players plus ghost chips to fill the roster.
 *
 * Renders nothing when both sides are empty (no lobby OCR for this match).
 */
export function LineupCard({ lineups, opponentLabel }: LineupCardProps) {
  const bgm = lineups.bgm
  const opp = lineups.opponent
  if (bgm.length === 0 && opp.length === 0) return null

  return (
    <section className="space-y-3">
      <SectionHeader label="Lineups" subtitle="Captured from pre-game lobby — OCR-derived" />
      <Panel className="px-4 py-4">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <TeamColumn
            label="BGM"
            accentClass="text-[#ce202f]"
            ghostFillTo={ROSTER_SIZE}
            rows={bgm}
            side="home"
          />
          <TeamColumn
            label={opponentLabel}
            accentClass="text-[#7d8db0]"
            ghostFillTo={ROSTER_SIZE}
            rows={opp}
            side="away"
          />
        </div>
      </Panel>
    </section>
  )
}

function TeamColumn({
  label,
  accentClass,
  rows,
  ghostFillTo,
  side,
}: {
  label: string
  accentClass: string
  rows: LineupRow[]
  ghostFillTo: number
  side: 'home' | 'away'
}) {
  const ghostsNeeded = Math.max(0, ghostFillTo - rows.length)
  return (
    <div>
      <h3
        className={`mb-2 font-condensed text-xs font-bold uppercase tracking-widest ${accentClass}`}
      >
        {label}
      </h3>
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <PlayerChip key={row.snapshotId} row={row} side={side} />
        ))}
        {Array.from({ length: ghostsNeeded }).map((_, i) => (
          <GhostChip key={`ghost-${String(i)}`} />
        ))}
      </ul>
    </div>
  )
}

function PlayerChip({ row, side }: { row: LineupRow; side: 'home' | 'away' }) {
  const accentClass = side === 'home' ? 'text-[#ce202f]' : 'text-[#7d8db0]'
  const gamertag = row.player?.gamertag ?? row.gamertagSnapshot ?? '?'

  const nameNode = row.player ? (
    <Link
      href={`/roster/${String(row.player.id)}`}
      className="font-semibold text-zinc-100 hover:text-accent"
    >
      {gamertag}
    </Link>
  ) : (
    <span className="font-semibold text-zinc-200" title="Unresolved gamertag">
      {gamertag}
    </span>
  )

  const measurementsParts: string[] = []
  if (row.heightText) measurementsParts.push(row.heightText)
  if (row.weightLbs !== null) measurementsParts.push(`${row.weightLbs} lbs`)
  if (row.handedness) measurementsParts.push(`Shoots ${row.handedness}`)
  const measurementsLine = measurementsParts.join(' · ')

  return (
    <li className="grid grid-cols-[2.5rem_1fr] items-start gap-3 border border-zinc-900 bg-zinc-950 px-3 py-2">
      <span
        className={`font-condensed text-[11px] font-bold uppercase tracking-widest ${accentClass}`}
      >
        {row.position ?? '—'}
      </span>
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 truncate text-sm">
          {row.isCaptain ? (
            <span title="Captain" className="text-yellow-400">
              ★
            </span>
          ) : null}
          {nameNode}
          {row.playerNumber !== null ? (
            <span className="font-condensed text-[11px] tabular-nums text-zinc-500">
              #{row.playerNumber}
            </span>
          ) : null}
          {row.playerNamePersona ? (
            <span className="truncate text-xs text-zinc-500" title={row.playerNamePersona}>
              {row.playerNamePersona}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 font-condensed text-[10px] uppercase tracking-wider text-zinc-500">
          <span className="truncate">{row.buildClass ?? 'Unknown build'}</span>
          {row.playerLevelNumber !== null ? (
            <span className="tabular-nums text-zinc-600">L{row.playerLevelNumber}</span>
          ) : null}
        </div>
        {measurementsLine ? (
          <div className="font-condensed text-[10px] uppercase tracking-wider text-zinc-600">
            {measurementsLine}
          </div>
        ) : null}
        {row.xFactors.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {row.xFactors.map((xf) => (
              <XFactorPill key={xf.slotIndex} name={xf.name} tier={xf.tier} />
            ))}
          </div>
        ) : null}
      </div>
    </li>
  )
}

/**
 * Three-tier X-Factor badge: tier color comes from the HSV-classified icon
 * color stored in `player_loadout_x_factors.tier`. Elite = red, All Star =
 * blue, Specialist = yellow.
 */
function XFactorPill({
  name,
  tier,
}: {
  name: string
  tier: 'Elite' | 'All Star' | 'Specialist' | null
}) {
  const tierClass = (() => {
    switch (tier) {
      case 'Elite':
        return 'border-red-700/50 bg-red-950/30 text-red-200'
      case 'All Star':
        return 'border-blue-700/50 bg-blue-950/30 text-blue-200'
      case 'Specialist':
        return 'border-yellow-700/50 bg-yellow-950/30 text-yellow-200'
      default:
        return 'border-zinc-800 bg-zinc-900 text-zinc-400'
    }
  })()
  return (
    <span
      className={`inline-flex items-center border px-1.5 py-0.5 font-condensed text-[9px] font-semibold uppercase tracking-widest ${tierClass}`}
      title={tier ? `${name} — ${tier}` : name}
    >
      {name}
    </span>
  )
}

function GhostChip() {
  return (
    <li className="grid grid-cols-[2.5rem_1fr] items-center gap-3 border border-dashed border-zinc-900 px-3 py-2">
      <span className="font-condensed text-[11px] font-bold uppercase tracking-widest text-zinc-700">
        —
      </span>
      <div className="font-condensed text-[10px] uppercase tracking-wider text-zinc-700">
        CPU / Empty
      </div>
    </li>
  )
}
