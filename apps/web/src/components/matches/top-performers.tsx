'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { PlayerScoreEntry, ScoreFactor, TopPerformer } from '@/lib/match-recap'
import { formatSavePct } from '@/lib/match-recap'
import { formatPosition, formatPositionFull } from '@/lib/format'
import { PositionPill } from './position-pill'
import { Panel } from '@/components/ui/panel'
import { SectionHeader } from '@/components/ui/section-header'

interface TopPerformersProps {
  performers: TopPerformer[]
  allTeamScores: PlayerScoreEntry[]
  opponentLabel: string
}

export function TopPerformers({ performers, allTeamScores, opponentLabel }: TopPerformersProps) {
  if (performers.length === 0 && allTeamScores.length === 0) return null
  const [expanded, setExpanded] = useState(false)

  const bgmScores = allTeamScores.filter((e) => e.side === 'bgm')
  const oppScores = allTeamScores.filter((e) => e.side === 'opp')

  return (
    <section className="space-y-3">
      <SectionHeader label="Top Performers" subtitle="Computed from player stats" />

      {performers.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {performers.map((p, i) => (
            <PerformerCard
              key={p.side === 'bgm' ? `bgm:${p.playerId?.toString() ?? i.toString()}` : `opp:${p.eaPlayerId ?? p.gamertag}`}
              performer={p}
              rank={i + 1}
            />
          ))}
        </div>
      ) : null}

      <Panel>
        <button
          type="button"
          onClick={() => { setExpanded((v) => !v) }}
          className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-surface-raised"
        >
          <span className="font-condensed text-base font-semibold uppercase tracking-wide text-zinc-200">
            Show all player scores
          </span>
          <span className={`text-zinc-500 transition-transform ${expanded ? 'rotate-180' : ''}`}>⌄</span>
        </button>

        {expanded ? (
          <div className="border-t border-zinc-800">
            <div className="px-3 pb-1 pt-2">
              <p className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-600">
                Score = weighted composite · click a row to see breakdown
              </p>
            </div>

            {bgmScores.length > 0 ? (
              <ScoreGroup label="BGM" entries={bgmScores} />
            ) : null}

            {oppScores.length > 0 ? (
              <ScoreGroup label={opponentLabel} entries={oppScores} />
            ) : null}
          </div>
        ) : null}
      </Panel>
    </section>
  )
}

// ─── Score group (one team side) ──────────────────────────────────────────────

function ScoreGroup({ label, entries }: { label: string; entries: PlayerScoreEntry[] }) {
  return (
    <div className="border-t border-zinc-800/60">
      <div className="px-4 py-2">
        <span className="font-condensed text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
          {label}
        </span>
      </div>
      <div>
        {entries.map((entry) => (
          <ScoreRow key={entry.side === 'bgm' ? `bgm:${entry.playerId?.toString() ?? ''}` : `opp:${entry.eaPlayerId ?? ''}`} entry={entry} />
        ))}
      </div>
    </div>
  )
}

// ─── Individual score row with expandable breakdown ────────────────────────────

function ScoreRow({ entry }: { entry: PlayerScoreEntry }) {
  const [open, setOpen] = useState(false)
  const posLabel = entry.position ? formatPosition(entry.position) : entry.isGoalie ? 'G' : null

  return (
    <div className="border-b border-zinc-800/40 last:border-b-0">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v) }}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-raised"
      >
        {/* Expand chevron */}
        <span className={`shrink-0 text-[10px] text-zinc-600 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>

        {/* Position pill */}
        {posLabel !== null ? (
          <PositionPill
            label={posLabel}
            position={entry.position}
            isGoalie={entry.isGoalie}
            side={entry.side}
          />
        ) : null}

        {/* Name — BGM entries link to profile; opponent entries are plain */}
        <span className="flex-1 truncate font-condensed text-sm font-semibold text-zinc-200">
          {entry.side === 'bgm' && entry.playerId !== null ? (
            <Link
              href={`/roster/${entry.playerId.toString()}`}
              className="hover:text-zinc-50"
              onClick={(e) => { e.stopPropagation() }}
            >
              {entry.gamertag}
            </Link>
          ) : (
            entry.gamertag
          )}
        </span>

        {/* Stat line */}
        <span className="shrink-0 font-condensed text-xs tabular-nums text-zinc-500">
          {entry.statLine}
        </span>

        {/* Score */}
        <span className="w-14 shrink-0 text-right font-condensed text-sm font-black tabular-nums text-zinc-100">
          {entry.score.toFixed(2)}
        </span>
      </button>

      {open ? (
        <div className="border-t border-zinc-800/40 bg-zinc-950/40 px-4 py-3">
          <BreakdownTable breakdown={entry.breakdown} />
        </div>
      ) : null}
    </div>
  )
}

// ─── Breakdown table ──────────────────────────────────────────────────────────

function BreakdownTable({ breakdown }: { breakdown: ScoreFactor[] }) {
  const nonZero = breakdown.filter((f) => f.value !== 0 || f.contribution !== 0)
  const rows = nonZero.length > 0 ? nonZero : breakdown

  const total = breakdown.reduce((s, f) => s + f.contribution, 0)

  return (
    <div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-800/60">
            <th className="py-1.5 text-left font-semibold uppercase tracking-[0.14em] text-zinc-600">Factor</th>
            <th className="py-1.5 text-right font-semibold uppercase tracking-[0.14em] text-zinc-600">Stat</th>
            <th className="py-1.5 text-right font-semibold uppercase tracking-[0.14em] text-zinc-600">Weight</th>
            <th className="py-1.5 text-right font-semibold uppercase tracking-[0.14em] text-zinc-600">Points</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((fac) => (
            <FactorRow key={fac.label} fac={fac} />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-zinc-700/60">
            <td colSpan={3} className="py-1.5 font-condensed font-bold uppercase tracking-[0.14em] text-zinc-400">
              Total
            </td>
            <td className={`py-1.5 text-right font-condensed font-black tabular-nums ${total >= 0 ? 'text-zinc-100' : 'text-rose-400'}`}>
              {total.toFixed(2)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function FactorRow({ fac }: { fac: ScoreFactor }) {
  const isNeg = fac.contribution < 0
  const isZero = fac.value === 0
  const displayValue = fac.label === 'SV%' ? formatSavePct(fac.value) : fac.value.toString()

  return (
    <tr className={`border-b border-zinc-800/30 ${isZero ? 'opacity-40' : ''}`}>
      <td className="py-1 text-zinc-400">{fac.label}</td>
      <td className="py-1 text-right tabular-nums text-zinc-300">{displayValue}</td>
      <td className="py-1 text-right tabular-nums text-zinc-600">×{Math.abs(fac.weight).toFixed(2)}</td>
      <td className={`py-1 text-right font-semibold tabular-nums ${isNeg ? 'text-rose-400' : isZero ? 'text-zinc-600' : 'text-emerald-400'}`}>
        {fac.contribution >= 0 ? '+' : ''}{fac.contribution.toFixed(2)}
      </td>
    </tr>
  )
}

// ─── Top 3 performer cards ────────────────────────────────────────────────────

function PerformerCard({ performer, rank }: { performer: TopPerformer; rank: number }) {
  const positionLabel = performer.position
    ? formatPosition(performer.position)
    : performer.isGoalie
      ? 'G'
      : null

  const className = `group relative border px-4 py-4 transition-colors hover:brightness-110 ${cardClass(rank)}`
  const content = (
      <div className="space-y-2 text-center">
        <div className="font-condensed text-xl text-yellow-300">{rank === 1 ? '★★★' : rank === 2 ? '★★' : '★'}</div>
        <div>
          <div className="flex items-center justify-center gap-2">
            {positionLabel !== null ? (
              <PositionPill label={positionLabel} position={performer.position} isGoalie={performer.isGoalie} onLight />
            ) : null}
            <span className="truncate font-condensed text-sm font-bold uppercase tracking-wide text-zinc-100 group-hover:text-zinc-50">
              {performer.gamertag}
            </span>
          </div>
          {performer.position !== null ? (
            <span className="mt-0.5 block font-condensed text-[10px] uppercase tracking-[0.18em] text-zinc-700">
              {formatPositionFull(performer.position)}
            </span>
          ) : performer.isGoalie ? (
            <span className="mt-0.5 block font-condensed text-[10px] uppercase tracking-[0.18em] text-zinc-700">
              Goalie
            </span>
          ) : null}
        </div>
        <div className="font-condensed text-4xl font-black tabular-nums text-zinc-100">{performer.score.toFixed(2)}</div>
        <span className="block font-condensed text-sm font-semibold tabular-nums text-zinc-300">{performer.statLine}</span>
      </div>
  )

  if (performer.side === 'bgm' && performer.playerId !== null) {
    return (
      <Link href={`/roster/${performer.playerId.toString()}`} className={className}>
        {content}
      </Link>
    )
  }

  return <div className={className}>{content}</div>
}

function cardClass(rank: number): string {
  switch (rank) {
    case 1:
      return 'border-yellow-500/40 bg-[linear-gradient(135deg,rgba(255,232,124,0.98),rgba(125,99,12,0.95))]'
    case 2:
      return 'border-zinc-400/40 bg-[linear-gradient(135deg,rgba(244,244,247,0.98),rgba(99,103,112,0.95))]'
    default:
      return 'border-orange-400/40 bg-[linear-gradient(135deg,rgba(244,196,159,0.98),rgba(97,56,22,0.95))]'
  }
}

