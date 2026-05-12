import Link from 'next/link'
import type { WithWithoutRow, PairRow } from '@eanhl/db/queries'
import {
  CHEMISTRY_MIN_GP_WITH,
  CHEMISTRY_MIN_GP_WITHOUT,
  CHEMISTRY_PAIR_MIN_GP,
} from '@eanhl/db/queries'
import { BroadcastPanel } from '@/components/ui/broadcast-panel'
import { formatWinPct } from '@/lib/format'

type ChemistryWithWithoutRow = WithWithoutRow & {
  dnfWith: number
  dnfWithout: number
}

type ChemistryPairRow = PairRow & {
  dnf: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Local winPct fraction — only used inside this file for the With/Without
 *  delta math (chemistry's `Δ = pctWith − pctWithout`). The display string
 *  uses the canonical `formatWinPct` from `@/lib/format`. */
function winPctFraction(wins: number, gp: number): number | null {
  if (gp === 0) return null
  return wins / gp
}

/**
 * Display record string. OTL is collapsed into Losses per project convention,
 * so the cell label is always W-L. DNF is excluded (kept on the row for the
 * cell's `title=` tooltip via `recordBreakdown` below).
 */
function fmtRecord(wins: number, losses: number, otl: number): string {
  return `${wins.toString()}-${(losses + otl).toString()}`
}

/** Long-form record breakdown for the cell tooltip — shows the original
 *  W/L/OTL/DNF split so the collapsed display doesn't lose information. */
function recordBreakdown(wins: number, losses: number, otl: number, dnf: number): string {
  const parts = [`${String(wins)} W`, `${String(losses)} L`]
  if (otl > 0) parts.push(`${String(otl)} OTL (counted as L)`)
  if (dnf > 0) parts.push(`${String(dnf)} DNF (excluded)`)
  return parts.join(' · ')
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
      (winPctFraction(a.winsWith, a.gpWith) ?? -Infinity) -
      (winPctFraction(a.winsWithout, a.gpWithout) ?? -Infinity)
    const bDelta =
      (winPctFraction(b.winsWith, b.gpWith) ?? -Infinity) -
      (winPctFraction(b.winsWithout, b.gpWithout) ?? -Infinity)
    if (bDelta !== aDelta) return bDelta - aDelta
    return b.gpWith - a.gpWith
  })

  return (
    <BroadcastPanel intensity="soft" ticker={false} className="overflow-x-auto">
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
            const pctWith = winPctFraction(row.winsWith, row.gpWith)
            const pctWithout = winPctFraction(row.winsWithout, row.gpWithout)
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
                <td
                  className="px-3 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-400"
                  title={recordBreakdown(
                    row.winsWith,
                    row.lossesWith,
                    row.otlWith,
                    row.dnfWith,
                  )}
                >
                  {fmtRecord(row.winsWith, row.lossesWith, row.otlWith)}
                </td>
                <td className="px-3 py-2.5 text-right font-condensed text-sm font-semibold tabular-nums text-zinc-200">
                  {formatWinPct(row.winsWith, row.gpWith)}
                </td>
                <td className="px-3 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-300">
                  <SampleBadge gp={row.gpWithout} threshold={CHEMISTRY_MIN_GP_WITHOUT} />
                </td>
                <td
                  className="px-3 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-400"
                  title={recordBreakdown(
                    row.winsWithout,
                    row.lossesWithout,
                    row.otlWithout,
                    row.dnfWithout,
                  )}
                >
                  {fmtRecord(row.winsWithout, row.lossesWithout, row.otlWithout)}
                </td>
                <td className="px-3 py-2.5 text-right font-condensed text-sm font-semibold tabular-nums text-zinc-200">
                  {formatWinPct(row.winsWithout, row.gpWithout)}
                </td>
                <DeltaCell delta={delta} />
              </tr>
            )
          })}
        </tbody>
      </table>
    </BroadcastPanel>
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
    <BroadcastPanel intensity="soft" ticker={false} className="overflow-x-auto">
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
                <td
                  className="px-3 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-400"
                  title={recordBreakdown(row.wins, row.losses, row.otl, row.dnf)}
                >
                  {fmtRecord(row.wins, row.losses, row.otl)}
                </td>
                <td className="px-3 py-2.5 text-right font-condensed text-sm font-semibold tabular-nums text-zinc-200">
                  {formatWinPct(row.wins, row.gp)}
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
    </BroadcastPanel>
  )
}

// ─── Empty state ───────────────────────────────────────────────────────────

function ChemistryEmpty({ message }: { message: string }) {
  return (
    <BroadcastPanel
      intensity="soft"
      ticker={false}
      className="flex min-h-[8rem] items-center justify-center"
    >
      <p className="px-4 text-center font-condensed text-sm uppercase tracking-wider text-zinc-500">
        {message}
      </p>
    </BroadcastPanel>
  )
}

// The previous `<ChemistrySection>` thin wrapper was replaced by the tabbed
// container in `chemistry-section.tsx` — see that file for the current
// section-level Chemistry frame.
