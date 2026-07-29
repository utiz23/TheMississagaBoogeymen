'use client'

import Link from 'next/link'
import type { PlayerScoreEntry, ScoreFactor } from '@/lib/match-recap'
import { formatSeconds, formatSavePct } from '@/lib/match-recap'
import { formatPosition } from '@/lib/format'
import { PositionPill } from './position-pill'

// One performer row for the rail list. This file used to render the 360px-tall
// three-star cards in a 3-up grid — which is what overflowed the 1/4 rail after
// the Phase 2 regrid. The prototype replaces them with a compact ranked row that
// expands into the score breakdown, so the same information survives at rail
// width. Top-3 rows keep the star glyphs and the accent tint; the rest of the
// list uses the identical template, which is why rows 1–10 read as one ladder.

interface PerformerRowProps {
  entry: PlayerScoreEntry
  rank: number
  opponentLabel: string
  /** Signed delta vs season-to-date average. Top 3 / BGM only; null otherwise. */
  vsSeasonAvg: number | null
  expanded: boolean
  panelId: string
  onToggle: () => void
}

const RANK_STARS = ['★★★', '★★', '★']

export function PerformerRow({
  entry,
  rank,
  opponentLabel,
  vsSeasonAvg,
  expanded,
  panelId,
  onToggle,
}: PerformerRowProps) {
  const isBgm = entry.side === 'bgm'
  const isTop3 = rank <= 3
  const posLabel = entry.position ? formatPosition(entry.position) : entry.isGoalie ? 'G' : null

  const tint =
    rank === 1
      ? 'bg-accent/[0.06]'
      : rank === 2
        ? 'bg-accent/[0.03]'
        : rank === 3
          ? 'bg-accent/[0.015]'
          : ''

  const rowClass = [
    'grid w-full grid-cols-[18px_minmax(0,1fr)_auto] items-center gap-x-2.5 border-t border-border-subtle px-3.5 py-2 text-left outline-none transition-colors',
    'cursor-pointer hover:bg-surface-raised focus-visible:ring-1 focus-visible:ring-accent',
    expanded ? 'bg-surface-raised [box-shadow:inset_2px_0_0_var(--color-accent)]' : tint,
  ].join(' ')

  const scoreClass = isTop3 ? 'text-accent' : entry.score < 0 ? 'text-fg-5' : 'text-fg-2'

  return (
    <div>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={onToggle}
        className={rowClass}
      >
        <span
          className={`text-center font-condensed text-[13px] font-black leading-none tabular-nums ${
            isTop3 ? 'text-accent' : 'text-fg-4'
          }`}
        >
          {rank}
        </span>

        <span className="flex min-w-0 flex-col gap-[3px]">
          <span className="truncate font-condensed text-[12.5px] font-extrabold uppercase tracking-[0.02em] text-fg-1">
            {entry.gamertag}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className={`border px-1.5 py-[1px] font-condensed text-[9.5px] font-extrabold uppercase tracking-[0.16em] ${
                isBgm
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : '[background:var(--opp-soft)] [border-color:var(--opp-line)] [color:var(--opp)]'
              }`}
            >
              {isBgm ? 'BGM' : opponentLabel}
            </span>
            {posLabel !== null ? (
              <PositionPill label={posLabel} position={entry.position} isGoalie={entry.isGoalie} />
            ) : null}
            {isTop3 ? (
              <span
                aria-hidden
                className={`font-condensed text-[10px] leading-none tracking-[-0.05em] text-accent ${
                  rank === 1 ? '[text-shadow:0_0_8px_rgba(232,65,49,0.5)]' : ''
                }`}
              >
                {RANK_STARS[rank - 1]}
              </span>
            ) : null}
          </span>
        </span>

        <span
          className={`text-right font-condensed text-[18px] font-black leading-none tabular-nums ${scoreClass} ${
            rank === 1 ? '[text-shadow:0_0_12px_rgba(232,65,49,0.28)]' : ''
          }`}
        >
          {entry.score.toFixed(2)}
        </span>
      </button>

      {expanded ? (
        <div
          id={panelId}
          className="flex flex-col gap-2 border-t border-border-subtle bg-background px-3.5 pb-3 pt-2.5 [box-shadow:inset_2px_0_0_var(--color-accent)]"
        >
          <BreakdownBar breakdown={entry.breakdown} score={entry.score} />
          <StatLine entry={entry} />
          <SeasonDelta vsSeasonAvg={vsSeasonAvg} isBgm={isBgm} />
          {isBgm && entry.playerId !== null ? (
            <Link
              href={`/roster/${entry.playerId.toString()}`}
              className="self-start font-condensed text-[10px] font-bold uppercase tracking-[0.12em] text-accent hover:underline"
            >
              Full player page →
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ─── Expanded panel blocks ────────────────────────────────────────────────────

function StatLine({ entry }: { entry: PlayerScoreEntry }) {
  const s = entry.stats

  if (entry.isGoalie) {
    const sa = s.shotsAgainst ?? 0
    const saves = s.saves ?? 0
    return (
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <Stat label="SV" value={saves.toString()} />
        <Stat label="SA" value={sa.toString()} />
        <Stat label="SV%" value={sa > 0 ? formatSavePct(saves / sa) : '—'} />
        <Stat label="GA" value={(s.shotsAgainst === null ? 0 : sa - saves).toString()} dim />
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      <Stat label="G" value={s.goals.toString()} />
      <Stat label="A" value={s.assists.toString()} />
      <Stat
        label="+/−"
        value={s.plusMinus >= 0 ? `+${s.plusMinus.toString()}` : s.plusMinus.toString()}
        {...(s.plusMinus > 0
          ? { tone: 'pos' as const }
          : s.plusMinus < 0
            ? { tone: 'neg' as const }
            : {})}
      />
      <Stat label="SOG" value={s.shots.toString()} dim />
      <Stat label="Hits" value={s.hits.toString()} dim />
      <Stat label="TOI" value={s.toiSeconds !== null ? formatSeconds(s.toiSeconds) : '—'} dim />
    </div>
  )
}

function Stat({
  label,
  value,
  dim,
  tone,
}: {
  label: string
  value: string
  dim?: boolean
  tone?: 'pos' | 'neg'
}) {
  const valueCls =
    tone === 'pos' ? 'text-win' : tone === 'neg' ? 'text-loss' : dim ? 'text-fg-3' : 'text-fg-1'
  return (
    <span className="flex flex-col gap-[1px]">
      <span className="font-condensed text-[9px] font-extrabold uppercase tracking-[0.18em] text-fg-5">
        {label}
      </span>
      <span
        className={`font-condensed text-[13px] font-extrabold leading-none tabular-nums ${valueCls}`}
      >
        {value}
      </span>
    </span>
  )
}

function SeasonDelta({ vsSeasonAvg, isBgm }: { vsSeasonAvg: number | null; isBgm: boolean }) {
  // Opponents have no profile history, so "no season data" would be noise on
  // their rows — say nothing at all instead.
  if (vsSeasonAvg === null) {
    if (!isBgm) return null
    return (
      <span className="font-condensed text-[10px] font-bold uppercase tracking-[0.12em] text-fg-5">
        — no season data
      </span>
    )
  }
  return (
    <span className="font-condensed text-[10px] font-bold uppercase tracking-[0.12em] text-fg-4">
      <span className={vsSeasonAvg >= 0 ? 'font-extrabold text-win' : 'font-extrabold text-loss'}>
        {vsSeasonAvg >= 0 ? '+' : ''}
        {vsSeasonAvg.toFixed(1)}
      </span>{' '}
      vs season avg
    </span>
  )
}

/**
 * "Where the 7.65 came from" — segmented bar + legend. Only positive factors
 * build width (the bar shows where the score CAME FROM, not where it was
 * docked); the two largest negatives ride along in the legend with a `−`.
 */
function BreakdownBar({ breakdown, score }: { breakdown: ScoreFactor[]; score: number }) {
  const positives = breakdown.filter((f) => f.contribution > 0)
  const positiveTotal = positives.reduce((sum, f) => sum + f.contribution, 0)
  const segments = positives.map((f) => ({
    label: f.label,
    pct: positiveTotal > 0 ? (f.contribution / positiveTotal) * 100 : 0,
    color: factorColor(f.label, true),
  }))
  const negatives = breakdown
    .filter((f) => f.contribution < 0)
    .sort((a, b) => a.contribution - b.contribution)
    .slice(0, 2)
  const legend = [
    ...positives.sort((a, b) => b.contribution - a.contribution).slice(0, 4),
    ...negatives,
  ]

  return (
    <div className="flex flex-col gap-1.5">
      <span className="font-condensed text-[10px] font-extrabold uppercase tracking-[0.14em] text-fg-4">
        Where the {score.toFixed(2)} came from
      </span>
      <div className="flex h-1.5 overflow-hidden border border-border bg-charcoal">
        {segments.map((seg) => (
          <span
            key={seg.label}
            className="block h-full"
            style={{ width: `${seg.pct.toFixed(2)}%`, background: seg.color }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-1">
        {legend.map((f) => {
          const isNeg = f.contribution < 0
          return (
            <span
              key={f.label}
              className="inline-flex items-center gap-1 font-condensed text-[10px] font-bold uppercase tracking-[0.1em] text-fg-4"
            >
              <span
                aria-hidden
                className="inline-block h-[7px] w-[7px] flex-none"
                style={{ background: factorColor(f.label, !isNeg) }}
              />
              {shortLabel(f.label)}{' '}
              <b className={`tabular-nums ${isNeg ? 'text-loss' : 'text-fg-2'}`}>
                {isNeg ? '' : '+'}
                {f.contribution.toFixed(1)}
              </b>
            </span>
          )
        })}
      </div>
    </div>
  )
}

function factorColor(label: string, positive: boolean): string {
  if (!positive) return 'var(--color-loss)'
  switch (label) {
    case 'Goals':
      return 'var(--color-accent)'
    case 'Assists':
      return 'var(--color-fg-1)'
    case '+/-':
      return 'var(--color-win)'
    case 'Shots':
      return 'rgba(232,65,49,0.55)'
    case 'FO Net':
    case 'SV%':
      return 'rgba(232,65,49,0.30)'
    case 'Hits':
      return 'var(--color-fg-4)'
    case 'Win Bonus':
      return 'var(--color-win)'
    case 'Takeaways':
    case 'Interceptions':
    case 'Blocked Shots':
    case 'Penalties Drawn':
    case 'Saves':
    case 'Desp. Saves':
    case 'Breakaway Saves':
    case 'Pen. Shot Saves':
    case 'Pokechecks':
      return 'var(--color-fg-3)'
    default:
      return 'var(--color-fg-4)'
  }
}

function shortLabel(label: string): string {
  switch (label) {
    case 'Goals':
      return 'G'
    case 'Assists':
      return 'A'
    case '+/-':
      return '+/−'
    case 'Shots':
      return 'SOG'
    case 'FO Net':
      return 'FO'
    case 'Goals Against':
      return 'GA'
    case 'Penalties Drawn':
      return 'PD'
    case 'Penalty Min':
      return 'PIM'
    case 'Win Bonus':
      return 'Win'
    case 'Blocked Shots':
      return 'BLK'
    case 'Takeaways':
      return 'TKA'
    case 'Interceptions':
      return 'INT'
    case 'Desp. Saves':
      return 'DSV'
    case 'Breakaway Saves':
      return 'BWY'
    case 'Pen. Shot Saves':
      return 'PSV'
    default:
      return label
  }
}
