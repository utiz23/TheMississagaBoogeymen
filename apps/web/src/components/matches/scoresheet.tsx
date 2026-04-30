import Link from 'next/link'
import type { Scoresheet, SkaterRow, GoalieRow } from '@/lib/match-recap'
import { formatPosition } from '@/lib/format'
import { PositionPill } from './position-pill'

interface ScoresheetProps {
  scoresheet: Scoresheet
}

export function ScoresheetSection({ scoresheet }: ScoresheetProps) {
  const { skaters, goalies } = scoresheet
  if (skaters.length === 0 && goalies.length === 0) return null

  return (
    <section>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-400">
          BGM Scoresheet
        </h2>
        <span className="text-[10px] font-medium uppercase tracking-[0.15em] text-zinc-600">
          (per-player stats tracked for BGM only)
        </span>
      </div>

      <div className="space-y-4">
        {skaters.length > 0 ? <SkaterTable rows={skaters} /> : null}
        {goalies.length > 0 ? <GoalieTable rows={goalies} /> : null}
      </div>
    </section>
  )
}

// ─── Skater table ─────────────────────────────────────────────────────────────

function SkaterTable({ rows }: { rows: SkaterRow[] }) {
  return (
    <div className="overflow-x-auto border border-zinc-800 bg-surface">
      <table className="w-full min-w-[680px]">
        <thead>
          <tr className="border-b border-zinc-800">
            <Th align="left" wide>
              Player
            </Th>
            <Th align="left">Pos</Th>
            <Th>G</Th>
            <Th>A</Th>
            <Th>PTS</Th>
            <Th>+/-</Th>
            <Th>SOG</Th>
            <Th>Hits</Th>
            <Th>PIM</Th>
            <Th hideOnMobile>FO</Th>
            <Th hideOnMobile>Pass%</Th>
            <Th hideOnMobile>BLK</Th>
            <Th>TOI</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <SkaterRowEl key={row.playerId} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SkaterRowEl({ row }: { row: SkaterRow }) {
  const positionLabel = row.position ? formatPosition(row.position) : '—'
  const pmColor =
    row.plusMinus > 0 ? 'text-emerald-400' : row.plusMinus < 0 ? 'text-rose-400' : 'text-zinc-400'
  const pmLabel = row.plusMinus > 0 ? `+${row.plusMinus.toString()}` : row.plusMinus.toString()

  return (
    <tr className="group border-b border-zinc-800/60 transition-colors hover:bg-surface-raised">
      <td className="py-2.5 pl-4 pr-2 text-sm">
        <Link
          href={`/roster/${row.playerId.toString()}`}
          className="flex items-center gap-2 font-medium text-zinc-200 group-hover:text-zinc-50"
        >
          <span className="truncate max-w-[10rem]">{row.gamertag}</span>
          {row.dnf ? <DnfBadge /> : null}
        </Link>
      </td>
      <td className="px-2 py-2.5 text-left">
        {row.position !== null ? (
          <PositionPill label={positionLabel} position={row.position} isGoalie={false} />
        ) : (
          <span className="text-xs text-zinc-600">—</span>
        )}
      </td>
      <Td>{row.goals.toString()}</Td>
      <Td>{row.assists.toString()}</Td>
      <Td featured>{row.points.toString()}</Td>
      <Td>
        <span className={pmColor}>{pmLabel}</span>
      </Td>
      <Td>{row.shots.toString()}</Td>
      <Td>{row.hits.toString()}</Td>
      <Td>{row.pim.toString()}</Td>
      <Td hideOnMobile>{row.faceoffRecord ?? '—'}</Td>
      <Td hideOnMobile>{row.passPct !== null ? `${row.passPct.toFixed(0)}%` : '—'}</Td>
      <Td hideOnMobile>{row.blocks.toString()}</Td>
      <Td>{row.toi ?? '—'}</Td>
    </tr>
  )
}

// ─── Goalie table ─────────────────────────────────────────────────────────────

function GoalieTable({ rows }: { rows: GoalieRow[] }) {
  return (
    <div className="overflow-x-auto border border-zinc-800 bg-surface">
      <table className="w-full min-w-[480px]">
        <thead>
          <tr className="border-b border-zinc-800">
            <Th align="left" wide>
              Goalie
            </Th>
            <Th>SV</Th>
            <Th>GA</Th>
            <Th>SV%</Th>
            <Th>SA</Th>
            <Th>TOI</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <GoalieRowEl key={row.playerId} row={row} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GoalieRowEl({ row }: { row: GoalieRow }) {
  return (
    <tr className="group border-b border-zinc-800/60 transition-colors hover:bg-surface-raised last:border-b-0">
      <td className="py-2.5 pl-4 pr-2 text-sm">
        <Link
          href={`/roster/${row.playerId.toString()}`}
          className="flex items-center gap-2 font-medium text-zinc-200 group-hover:text-zinc-50"
        >
          <PositionPill label="G" position="goalie" isGoalie={true} />
          <span className="truncate max-w-[10rem]">{row.gamertag}</span>
          {row.dnf ? <DnfBadge /> : null}
        </Link>
      </td>
      <Td>{row.saves.toString()}</Td>
      <Td>{row.goalsAgainst.toString()}</Td>
      <Td featured>{row.savePctFormatted}</Td>
      <Td>{row.shotsAgainst.toString()}</Td>
      <Td>{row.toi ?? '—'}</Td>
    </tr>
  )
}

// ─── Cell helpers ─────────────────────────────────────────────────────────────

function Th({
  children,
  align = 'right',
  hideOnMobile = false,
  wide = false,
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
  hideOnMobile?: boolean
  wide?: boolean
}) {
  const baseClasses = 'py-2 text-xs font-semibold uppercase tracking-wider text-zinc-600'
  const alignClass = align === 'left' ? 'text-left' : 'text-right'
  const widthClass = wide ? 'pl-4 pr-2' : 'px-2'
  const hideClass = hideOnMobile ? 'hidden sm:table-cell' : ''
  return <th className={`${baseClasses} ${alignClass} ${widthClass} ${hideClass}`}>{children}</th>
}

function Td({
  children,
  hideOnMobile = false,
  featured = false,
}: {
  children: React.ReactNode
  hideOnMobile?: boolean
  featured?: boolean
}) {
  const hideClass = hideOnMobile ? 'hidden sm:table-cell' : ''
  const colorClass = featured ? 'text-zinc-50 font-bold' : 'text-zinc-300'
  return (
    <td
      className={`px-2 py-2.5 text-right text-sm tabular ${colorClass} ${hideClass}`}
    >
      {children}
    </td>
  )
}

function DnfBadge() {
  return (
    <span
      title="Did not finish"
      className="rounded-sm border border-zinc-700/60 bg-zinc-900/60 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-zinc-500"
    >
      DNF
    </span>
  )
}
