'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { PlayerScoreEntry, ScoreFactor } from '@/lib/match-recap'
import { formatSeconds, formatSavePct } from '@/lib/match-recap'
import { formatPosition } from '@/lib/format'
import { PositionPill } from './position-pill'

interface ShowAllPlayerScoresProps {
  entries: PlayerScoreEntry[]
  opponentLabel: string
}

const RANK_STARS = ['★★★', '★★', '★']

export function ShowAllPlayerScores({ entries, opponentLabel }: ShowAllPlayerScoresProps) {
  const [open, setOpen] = useState(false)
  const [openRow, setOpenRow] = useState<number | null>(null)

  if (entries.length === 0) return null

  const tableId = 'show-all-scores-table'

  return (
    <div className="border border-zinc-800 bg-surface">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v)
        }}
        aria-expanded={open}
        aria-controls={tableId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-raised"
      >
        <span className="font-condensed text-[12px] font-extrabold uppercase tracking-[0.18em] text-fg-2">
          <span aria-hidden className="pr-1.5 text-accent">
            ▰
          </span>
          Show all player scores
        </span>
        <span className="ml-auto font-condensed text-[10.5px] font-bold uppercase tracking-[0.16em] text-fg-5">
          {entries.length} players
          <span
            aria-hidden
            className={`pl-1.5 text-accent transition-transform ${open ? 'inline-block rotate-180' : 'inline-block'}`}
          >
            ⌄
          </span>
        </span>
      </button>

      {open ? (
        <div id={tableId} className="border-t border-zinc-800">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <Th>#</Th>
                <Th> </Th>
                <Th>Player</Th>
                <Th num>G</Th>
                <Th num>A</Th>
                <Th num>+/−</Th>
                <Th num hideOnMobile>
                  SOG
                </Th>
                <Th num hideOnMobile>
                  Hits
                </Th>
                <Th num hideOnMobile>
                  TOI · SV%
                </Th>
                <Th num>Score</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, i) => (
                <ScoreRow
                  key={
                    entry.side === 'bgm'
                      ? `bgm:${entry.playerId?.toString() ?? i.toString()}`
                      : `opp:${entry.eaPlayerId ?? entry.gamertag}`
                  }
                  entry={entry}
                  rank={i + 1}
                  opponentLabel={opponentLabel}
                  isOpen={openRow === i}
                  onToggle={() => {
                    setOpenRow(openRow === i ? null : i)
                  }}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}

function Th({
  children,
  num,
  hideOnMobile,
}: {
  children: React.ReactNode
  num?: boolean
  hideOnMobile?: boolean
}) {
  return (
    <th
      scope="col"
      className={[
        'border-b border-zinc-800 bg-surface-raised px-3 py-2 font-condensed text-[10px] font-bold uppercase tracking-[0.18em] text-fg-5',
        num ? 'text-right' : 'text-left',
        hideOnMobile ? 'hidden sm:table-cell' : '',
      ].join(' ')}
    >
      {children}
    </th>
  )
}

function ScoreRow({
  entry,
  rank,
  opponentLabel,
  isOpen,
  onToggle,
}: {
  entry: PlayerScoreEntry
  rank: number
  opponentLabel: string
  isOpen: boolean
  onToggle: () => void
}) {
  const isTop3 = rank <= 3
  const posLabel = entry.position ? formatPosition(entry.position) : entry.isGoalie ? 'G' : null
  const rowBg =
    rank === 1
      ? 'bg-accent/[0.06]'
      : rank === 2
        ? 'bg-accent/[0.03]'
        : rank === 3
          ? 'bg-accent/[0.015]'
          : ''
  const rankCls = isTop3 ? 'text-accent font-black' : 'text-fg-3'
  const scoreCls =
    rank === 1
      ? 'text-accent font-black text-[14px]'
      : isTop3
        ? 'text-fg-1 font-black text-[14px]'
        : 'text-fg-2 font-extrabold text-[12.5px]'

  const s = entry.stats
  const pmCls =
    s.plusMinus > 0
      ? 'text-emerald-400 font-extrabold'
      : s.plusMinus < 0
        ? 'text-rose-400 font-extrabold'
        : 'text-fg-3'
  const sa = s.shotsAgainst ?? 0
  const saves = s.saves ?? 0
  const toaOrSv = entry.isGoalie
    ? sa > 0
      ? formatSavePct(saves / sa)
      : '—'
    : s.toiSeconds !== null
      ? formatSeconds(s.toiSeconds)
      : '—'

  return (
    <>
      <tr
        className={`cursor-pointer border-b border-zinc-800/40 transition-colors hover:bg-surface-raised ${rowBg}`}
        tabIndex={0}
        role="button"
        aria-expanded={isOpen}
        aria-controls={`row-${rank.toString()}-breakdown`}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle()
          }
        }}
      >
        <td className={`px-3 py-2 font-condensed text-[12px] tabular-nums ${rankCls}`}>
          {rank}
          {isTop3 ? (
            <span className="ml-1 font-bold tracking-[0.1em] text-accent">
              {RANK_STARS[rank - 1]}
            </span>
          ) : null}
        </td>
        <td className="px-3 py-2">
          <span
            className={`mr-1 inline-block border px-1.5 py-0.5 font-condensed text-[9px] font-extrabold uppercase tracking-[0.16em] ${
              entry.side === 'bgm'
                ? 'border-accent/50 bg-accent/10 text-accent'
                : 'border-fg-3/50 bg-fg-1/[0.04] text-fg-1'
            }`}
          >
            {entry.side === 'bgm' ? 'BGM' : opponentLabel}
          </span>
          {posLabel !== null ? (
            <PositionPill
              label={posLabel}
              position={entry.position}
              isGoalie={entry.isGoalie}
              side={entry.side}
            />
          ) : null}
        </td>
        <td className="px-3 py-2 font-condensed text-[12px] font-extrabold uppercase tracking-[0.04em] text-fg-1">
          {entry.side === 'bgm' && entry.playerId !== null ? (
            <Link
              href={`/roster/${entry.playerId.toString()}`}
              className="hover:text-accent"
              onClick={(e) => {
                e.stopPropagation()
              }}
            >
              {entry.gamertag}
            </Link>
          ) : (
            entry.gamertag
          )}
        </td>
        <td className="px-3 py-2 text-right font-condensed text-[12px] tabular-nums text-fg-2">
          {entry.isGoalie ? '—' : s.goals}
        </td>
        <td className="px-3 py-2 text-right font-condensed text-[12px] tabular-nums text-fg-2">
          {entry.isGoalie ? '—' : s.assists}
        </td>
        <td
          className={`px-3 py-2 text-right font-condensed text-[12px] tabular-nums ${entry.isGoalie ? 'text-fg-5' : pmCls}`}
        >
          {entry.isGoalie ? '—' : s.plusMinus >= 0 ? `+${s.plusMinus.toString()}` : s.plusMinus}
        </td>
        <td className="hidden px-3 py-2 text-right font-condensed text-[12px] tabular-nums text-fg-3 sm:table-cell">
          {entry.isGoalie ? '—' : s.shots}
        </td>
        <td className="hidden px-3 py-2 text-right font-condensed text-[12px] tabular-nums text-fg-3 sm:table-cell">
          {entry.isGoalie ? '—' : s.hits}
        </td>
        <td className="hidden px-3 py-2 text-right font-condensed text-[12px] tabular-nums text-fg-3 sm:table-cell">
          {toaOrSv}
        </td>
        <td className={`px-3 py-2 text-right font-condensed tabular-nums ${scoreCls}`}>
          {entry.score.toFixed(2)}
        </td>
      </tr>
      {isOpen ? (
        <tr id={`row-${rank.toString()}-breakdown`}>
          <td colSpan={10} className="border-b border-zinc-800 bg-background/40 px-4 py-3 sm:px-6">
            <BreakdownTable breakdown={entry.breakdown} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

// ─── Per-factor breakdown table (moved from top-performers.tsx) ──────────────

function BreakdownTable({ breakdown }: { breakdown: ScoreFactor[] }) {
  const nonZero = breakdown.filter((f) => f.value !== 0 || f.contribution !== 0)
  const rows = nonZero.length > 0 ? nonZero : breakdown
  const total = breakdown.reduce((s, f) => s + f.contribution, 0)

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-zinc-800/60">
          <th className="py-1.5 text-left font-semibold uppercase tracking-[0.14em] text-fg-5">
            Factor
          </th>
          <th className="py-1.5 text-right font-semibold uppercase tracking-[0.14em] text-fg-5">
            Stat
          </th>
          <th className="py-1.5 text-right font-semibold uppercase tracking-[0.14em] text-fg-5">
            Weight
          </th>
          <th className="py-1.5 text-right font-semibold uppercase tracking-[0.14em] text-fg-5">
            Points
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((fac) => (
          <FactorRow key={fac.label} fac={fac} />
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-zinc-700/60">
          <td
            colSpan={3}
            className="py-1.5 font-condensed font-bold uppercase tracking-[0.14em] text-fg-4"
          >
            Total
          </td>
          <td
            className={`py-1.5 text-right font-condensed font-black tabular-nums ${total >= 0 ? 'text-fg-1' : 'text-rose-400'}`}
          >
            {total.toFixed(2)}
          </td>
        </tr>
      </tfoot>
    </table>
  )
}

function FactorRow({ fac }: { fac: ScoreFactor }) {
  const isNeg = fac.contribution < 0
  const isZero = fac.value === 0
  const displayValue = fac.label === 'SV%' ? formatSavePct(fac.value) : fac.value.toString()
  return (
    <tr className={`border-b border-zinc-800/30 ${isZero ? 'opacity-40' : ''}`}>
      <td className="py-1 text-fg-4">{fac.label}</td>
      <td className="py-1 text-right tabular-nums text-fg-3">{displayValue}</td>
      <td className="py-1 text-right tabular-nums text-fg-5">×{Math.abs(fac.weight).toFixed(2)}</td>
      <td
        className={`py-1 text-right font-semibold tabular-nums ${isNeg ? 'text-rose-400' : isZero ? 'text-fg-5' : 'text-emerald-400'}`}
      >
        {fac.contribution >= 0 ? '+' : ''}
        {fac.contribution.toFixed(2)}
      </td>
    </tr>
  )
}
