import Link from 'next/link'
import type { WithWithoutRow, PairRow } from '@eanhl/db/queries'
import {
  CHEMISTRY_MIN_GP_WITH,
  CHEMISTRY_MIN_GP_WITHOUT,
  CHEMISTRY_PAIR_MIN_GP,
} from '@eanhl/db/queries'
import { Panel } from '@/components/ui/panel'
import { SectionHeader } from '@/components/ui/section-header'

type ChemistryWithWithoutRow = WithWithoutRow & {
  dnfWith: number
  dnfWithout: number
}

type ChemistryPairRow = PairRow & {
  dnf: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function winPct(wins: number, gp: number): number | null {
  if (gp === 0) return null
  return wins / gp
}

function fmtWinPct(wins: number, gp: number): string {
  const pct = winPct(wins, gp)
  return pct !== null ? `${(pct * 100).toFixed(1)}%` : '—'
}

function fmtRecord(wins: number, losses: number, otl: number, dnf: number): string {
  return `${wins.toString()}-${losses.toString()}-${otl.toString()}-${dnf.toString()}`
}

function fmtPerGame(total: number, gp: number): string {
  if (gp === 0) return '—'
  return (total / gp).toFixed(2)
}

// ─── Sorted column header ──────────────────────────────────────────────────

function SortedHeader({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {label}
      <span className="text-[10px] text-accent">↓</span>
    </span>
  )
}

// ─── Sample-size badge ─────────────────────────────────────────────────────

function SampleBadge({ gp, threshold }: { gp: number; threshold: number }) {
  const strong = gp >= threshold * 2
  return (
    <span
      className={[
        'inline-block px-1.5 py-0.5 font-condensed text-[10px] font-bold tabular-nums leading-none',
        strong ? 'bg-emerald-950 text-emerald-400' : 'bg-amber-950 text-amber-400',
      ].join(' ')}
    >
      {gp.toString()}
    </span>
  )
}

// ─── Delta cell ───────────────────────────────────────────────────────────

function DeltaCell({ delta }: { delta: number | null }) {
  if (delta === null)
    return (
      <td className="px-3 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-600">
        —
      </td>
    )

  const deltaPoints = Math.round(delta * 100)
  const formatted = `${deltaPoints >= 0 ? '+' : ''}${deltaPoints.toString()}`
  const colorClass =
    delta > 0.02 ? 'text-emerald-400' : delta < -0.02 ? 'text-rose-400' : 'text-zinc-400'

  return (
    <td
      className={`px-3 py-2.5 text-right font-condensed text-sm font-semibold tabular-nums ${colorClass}`}
    >
      {formatted}
    </td>
  )
}

// ─── With / Without table ─────────────────────────────────────────────────

interface WithWithoutTableProps {
  rows: ChemistryWithWithoutRow[]
}

export function WithWithoutTable({ rows }: WithWithoutTableProps) {
  if (rows.length === 0) {
    return (
      <ChemistryEmpty
        message={`Need ≥ ${CHEMISTRY_MIN_GP_WITH.toString()} games with and ≥ ${CHEMISTRY_MIN_GP_WITHOUT.toString()} games without a player to show splits.`}
      />
    )
  }

  const sortedRows = [...rows].sort((a, b) => {
    const aDelta =
      (winPct(a.winsWith, a.gpWith) ?? -Infinity) -
      (winPct(a.winsWithout, a.gpWithout) ?? -Infinity)
    const bDelta =
      (winPct(b.winsWith, b.gpWith) ?? -Infinity) -
      (winPct(b.winsWithout, b.gpWithout) ?? -Infinity)
    if (bDelta !== aDelta) return bDelta - aDelta
    return b.gpWith - a.gpWith
  })

  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-zinc-800 bg-surface-raised">
            <th className="py-2 pl-4 pr-3 text-left font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Player
            </th>
            <th className="px-3 py-2 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              GP W/
            </th>
            <th className="px-3 py-2 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Rec W/
            </th>
            <th className="px-3 py-2 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Win% W/
            </th>
            <th className="px-3 py-2 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              GP W/O
            </th>
            <th className="px-3 py-2 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Rec W/O
            </th>
            <th className="px-3 py-2 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Win% W/O
            </th>
            <th className="px-3 py-2 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-300">
              <SortedHeader label="Δ" />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {sortedRows.map((row) => {
            const pctWith = winPct(row.winsWith, row.gpWith)
            const pctWithout = winPct(row.winsWithout, row.gpWithout)
            const delta = pctWith !== null && pctWithout !== null ? pctWith - pctWithout : null

            return (
              <tr key={row.playerId} className="transition-colors hover:bg-surface-raised">
                <td className="py-2.5 pl-4 pr-3">
                  <Link
                    href={`/roster/${row.playerId.toString()}`}
                    className="font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-200 transition-colors hover:text-accent"
                  >
                    {row.gamertag}
                  </Link>
                </td>
                <td className="px-3 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-300">
                  <SampleBadge gp={row.gpWith} threshold={CHEMISTRY_MIN_GP_WITH} />
                </td>
                <td className="px-3 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-400">
                  {fmtRecord(row.winsWith, row.lossesWith, row.otlWith, row.dnfWith)}
                </td>
                <td className="px-3 py-2.5 text-right font-condensed text-sm font-semibold tabular-nums text-zinc-200">
                  {fmtWinPct(row.winsWith, row.gpWith)}
                </td>
                <td className="px-3 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-300">
                  <SampleBadge gp={row.gpWithout} threshold={CHEMISTRY_MIN_GP_WITHOUT} />
                </td>
                <td className="px-3 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-400">
                  {fmtRecord(row.winsWithout, row.lossesWithout, row.otlWithout, row.dnfWithout)}
                </td>
                <td className="px-3 py-2.5 text-right font-condensed text-sm font-semibold tabular-nums text-zinc-200">
                  {fmtWinPct(row.winsWithout, row.gpWithout)}
                </td>
                <DeltaCell delta={delta} />
              </tr>
            )
          })}
        </tbody>
      </table>
    </Panel>
  )
}

// ─── Best Pairs table ─────────────────────────────────────────────────────

interface BestPairsTableProps {
  rows: ChemistryPairRow[]
}

export function BestPairsTable({ rows }: BestPairsTableProps) {
  if (rows.length === 0) {
    return (
      <ChemistryEmpty
        message={`Need ≥ ${CHEMISTRY_PAIR_MIN_GP.toString()} games together to show a pair.`}
      />
    )
  }

  const sortedRows = [...rows].sort((a, b) => {
    const aDiff = a.totalGf - a.totalGa
    const bDiff = b.totalGf - b.totalGa
    if (bDiff !== aDiff) return bDiff - aDiff
    return b.gp - a.gp
  })

  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-[680px]">
        <thead>
          <tr className="border-b border-zinc-800 bg-surface-raised">
            <th className="py-2 pl-4 pr-3 text-left font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Pair
            </th>
            <th className="px-3 py-2 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              GP
            </th>
            <th className="px-3 py-2 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Record
            </th>
            <th className="px-3 py-2 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Win%
            </th>
            <th className="px-3 py-2 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              GF/GP
            </th>
            <th className="px-3 py-2 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              GA/GP
            </th>
            <th className="px-3 py-2 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-300">
              <SortedHeader label="Diff" />
            </th>
            <th className="px-3 py-2 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              Diff/GP
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {sortedRows.map((row) => {
            const diff = row.totalGf - row.totalGa
            const diffPerGame = row.gp > 0 ? diff / row.gp : 0
            const diffStr = `${diffPerGame >= 0 ? '+' : ''}${diffPerGame.toFixed(2)}`
            const diffColor =
              diffPerGame > 0.1
                ? 'text-emerald-400'
                : diffPerGame < -0.1
                  ? 'text-rose-400'
                  : 'text-zinc-400'

            return (
              <tr
                key={`${row.p1Id.toString()}-${row.p2Id.toString()}`}
                className="transition-colors hover:bg-surface-raised"
              >
                <td className="py-2.5 pl-4 pr-3">
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    <Link
                      href={`/roster/${row.p1Id.toString()}`}
                      className="font-condensed font-semibold uppercase tracking-wide text-zinc-200 transition-colors hover:text-accent"
                    >
                      {row.p1Gamertag}
                    </Link>
                    <span className="text-zinc-700">+</span>
                    <Link
                      href={`/roster/${row.p2Id.toString()}`}
                      className="font-condensed font-semibold uppercase tracking-wide text-zinc-200 transition-colors hover:text-accent"
                    >
                      {row.p2Gamertag}
                    </Link>
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-300">
                  <SampleBadge gp={row.gp} threshold={CHEMISTRY_PAIR_MIN_GP} />
                </td>
                <td className="px-3 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-400">
                  {fmtRecord(row.wins, row.losses, row.otl, row.dnf)}
                </td>
                <td className="px-3 py-2.5 text-right font-condensed text-sm font-semibold tabular-nums text-zinc-200">
                  {fmtWinPct(row.wins, row.gp)}
                </td>
                <td className="px-3 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-400">
                  {fmtPerGame(row.totalGf, row.gp)}
                </td>
                <td className="px-3 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-400">
                  {fmtPerGame(row.totalGa, row.gp)}
                </td>
                <td
                  className={`px-3 py-2.5 text-right font-condensed text-sm font-semibold tabular-nums ${diffColor}`}
                >
                  {`${diff >= 0 ? '+' : ''}${diff.toString()}`}
                </td>
                <td
                  className={`px-3 py-2.5 text-right font-condensed text-sm font-semibold tabular-nums ${diffColor}`}
                >
                  {diffStr}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Panel>
  )
}

// ─── Empty state ───────────────────────────────────────────────────────────

function ChemistryEmpty({ message }: { message: string }) {
  return (
    <Panel className="flex min-h-[8rem] items-center justify-center">
      <p className="px-4 text-center font-condensed text-sm uppercase tracking-wider text-zinc-500">
        {message}
      </p>
    </Panel>
  )
}

// ─── Section wrapper with title ────────────────────────────────────────────

interface ChemistrySectionProps {
  title: string
  children: React.ReactNode
}

export function ChemistrySection({ title, children }: ChemistrySectionProps) {
  return (
    <div className="space-y-3">
      <SectionHeader label={title} />
      {children}
    </div>
  )
}
