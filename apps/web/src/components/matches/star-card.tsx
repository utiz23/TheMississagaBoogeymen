import Link from 'next/link'
import type { TopPerformerWithDelta } from '@/lib/match-recap'
import { formatSeconds } from '@/lib/match-recap'
import { formatPosition } from '@/lib/format'
import { PlayerSilhouette } from '@/components/home/player-card'
import { PositionPill } from './position-pill'
import { ArchetypePillCompact } from '@/components/ui/archetype-pill'

interface StarCardProps {
  rank: 1 | 2 | 3
  performer: TopPerformerWithDelta
  opponentLabel: string
}

const RANK_NAME = { 1: 'First Star', 2: 'Second Star', 3: 'Third Star' } as const
const RANK_STARS = {
  1: { on: '★★★', off: '' },
  2: { on: '★★', off: '' },
  3: { on: '★', off: '' },
} as const

export function StarCard({ rank, performer, opponentLabel }: StarCardProps) {
  const isBgm = performer.side === 'bgm'
  const teamLabel = isBgm ? 'BGM' : opponentLabel
  const posLabel = performer.position
    ? formatPosition(performer.position)
    : performer.isGoalie
      ? 'G'
      : null

  const rankCls = rank === 1 ? 'r1' : rank === 2 ? 'r2' : 'r3'
  const wrapperCls = [
    'group relative flex min-h-[360px] flex-col border bg-surface transition-[border-color,transform] hover:-translate-y-0.5 hover:border-zinc-700',
    rank === 1
      ? 'border-accent/40 [background:linear-gradient(180deg,rgba(232,65,49,0.06),var(--color-surface)_40%)]'
      : rank === 2
        ? 'border-zinc-800 [background:linear-gradient(180deg,rgba(235,235,235,0.04),var(--color-surface)_40%)]'
        : 'border-zinc-800',
  ].join(' ')

  const aria = `${RANK_NAME[rank]}: ${performer.gamertag}, score ${performer.score.toFixed(2)}, ${performer.statLine}`

  const body = (
    <article aria-label={aria} className={wrapperCls} data-rank={rankCls}>
      {rank === 1 ? (
        <span
          aria-hidden
          className="ticker-strip ticker-strip-thin absolute inset-x-0 top-0 z-[1]"
        />
      ) : null}

      <Header rank={rank} />
      <Identity performer={performer} rank={rank} />
      <MetaChips
        teamLabel={teamLabel}
        isBgm={isBgm}
        posLabel={posLabel}
        position={performer.position}
        isGoalie={performer.isGoalie}
        archetype={performer.archetype}
      />
      <ScoreBlock rank={rank} performer={performer} />
      <StatLine performer={performer} />
      <BreakdownBar performer={performer} />
    </article>
  )

  if (isBgm && performer.playerId !== null) {
    return (
      <Link href={`/roster/${performer.playerId.toString()}`} className="block">
        {body}
      </Link>
    )
  }
  return body
}

// ─── Header (rank label + stars) ──────────────────────────────────────────────

function Header({ rank }: { rank: 1 | 2 | 3 }) {
  const labelCls = rank === 1 ? 'text-accent' : rank === 2 ? 'text-fg-2' : 'text-fg-4'
  const onCls =
    rank === 1
      ? 'text-accent [text-shadow:0_0_8px_rgba(232,65,49,0.5)]'
      : rank === 2
        ? 'text-fg-1 [text-shadow:0_0_6px_rgba(235,235,235,0.18)]'
        : 'text-fg-2'

  return (
    <div className="flex items-center gap-2 border-b border-zinc-800 px-4 pb-2 pt-3">
      <span
        className={`font-condensed text-[10.5px] font-black uppercase tracking-[0.24em] ${labelCls}`}
      >
        {RANK_NAME[rank]}
      </span>
      <span className="ml-auto font-condensed text-[14px] leading-none tracking-[0.18em] text-fg-5">
        <span className={onCls}>{RANK_STARS[rank].on}</span>
        {RANK_STARS[rank].off}
      </span>
    </div>
  )
}

// ─── Identity row (portrait + name + jersey) ──────────────────────────────────

function Identity({ performer, rank }: { performer: TopPerformerWithDelta; rank: 1 | 2 | 3 }) {
  const portraitCls = [
    'flex h-16 w-16 items-end justify-center overflow-hidden rounded-full border',
    rank === 1
      ? 'border-accent shadow-[0_0_12px_rgba(232,65,49,0.18)] [background:radial-gradient(circle_at_top,rgba(232,65,49,0.16),transparent_55%),linear-gradient(180deg,rgba(50,48,49,0.9),rgba(26,24,25,1))]'
      : performer.side === 'opp'
        ? 'border-fg-3/40 [background:radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_55%),linear-gradient(180deg,rgba(50,48,49,0.9),rgba(26,24,25,1))]'
        : 'border-accent/30 [background:radial-gradient(circle_at_top,rgba(232,65,49,0.16),transparent_55%),linear-gradient(180deg,rgba(50,48,49,0.9),rgba(26,24,25,1))]',
  ].join(' ')

  return (
    <div className="grid grid-cols-[64px_1fr_auto] items-center gap-3 px-4 pb-2 pt-4">
      <div className={portraitCls}>
        <PlayerSilhouette sizeClass="h-14 w-14" className="text-fg-6" />
      </div>
      <div className="min-w-0">
        <div className="truncate font-condensed text-[15px] font-black uppercase leading-tight tracking-[0.04em] text-fg-1">
          {performer.gamertag}
        </div>
      </div>
      <Jersey rank={rank} jersey={performer.jerseyNumber} />
    </div>
  )
}

function Jersey({ rank, jersey }: { rank: 1 | 2 | 3; jersey: number | null }) {
  // Jersey number comes from playerProfiles (manually-owned). Opponent
  // entries and BGM players without a profile fall back to "—".
  const numCls =
    rank === 1 ? 'text-accent [text-shadow:0_0_14px_rgba(232,65,49,0.30)]' : 'text-fg-1'
  return (
    <div className="flex min-w-[44px] flex-col items-center leading-none">
      <span className="font-condensed text-[9px] font-bold tracking-[0.12em] text-fg-6">#</span>
      <span className={`font-condensed text-[28px] font-black tabular-nums leading-none ${numCls}`}>
        {jersey ?? '—'}
      </span>
    </div>
  )
}

// ─── Meta chips (team + position) ─────────────────────────────────────────────

function MetaChips({
  teamLabel,
  isBgm,
  posLabel,
  position,
  isGoalie,
  archetype,
}: {
  teamLabel: string
  isBgm: boolean
  posLabel: string | null
  position: string | null
  isGoalie: boolean
  archetype: TopPerformerWithDelta['archetype']
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3">
      <span
        className={`border px-1.5 py-0.5 font-condensed text-[10px] font-extrabold uppercase tracking-[0.18em] ${
          isBgm
            ? 'border-accent/50 bg-accent/10 text-accent'
            : 'border-fg-3/50 bg-fg-1/[0.04] text-fg-1'
        }`}
      >
        {teamLabel}
      </span>
      {posLabel !== null ? (
        <PositionPill
          label={posLabel}
          position={position}
          isGoalie={isGoalie}
          side={isBgm ? 'bgm' : 'opp'}
        />
      ) : null}
      {archetype !== null ? <ArchetypePillCompact archetype={archetype} /> : null}
    </div>
  )
}

// ─── Score block (hero score + "vs season avg" delta) ─────────────────────────

function ScoreBlock({ rank, performer }: { rank: 1 | 2 | 3; performer: TopPerformerWithDelta }) {
  const scoreCls =
    rank === 1
      ? 'text-accent [text-shadow:0_0_14px_rgba(232,65,49,0.22)]'
      : rank === 2
        ? 'text-fg-1'
        : 'text-fg-1'
  return (
    <div className="flex items-baseline gap-3 border-t border-zinc-800/60 px-4 pb-3 pt-2">
      <span
        className={`font-condensed text-[56px] font-black tabular-nums leading-none tracking-tight ${scoreCls}`}
      >
        {performer.score.toFixed(2)}
      </span>
      <div className="flex flex-col gap-[1px] pb-1.5">
        <span className="font-condensed text-[9px] font-extrabold uppercase tracking-[0.24em] text-fg-5">
          Game score
        </span>
        {performer.vsSeasonAvg !== null ? (
          <span className="font-condensed text-[10px] font-bold tabular-nums tracking-[0.12em] text-fg-4">
            <span
              className={
                performer.vsSeasonAvg >= 0
                  ? 'font-extrabold text-emerald-400'
                  : 'font-extrabold text-rose-400'
              }
            >
              {performer.vsSeasonAvg >= 0 ? '+' : ''}
              {performer.vsSeasonAvg.toFixed(1)}
            </span>{' '}
            vs season avg
          </span>
        ) : (
          <span className="font-condensed text-[10px] font-bold tracking-[0.12em] text-fg-6 italic">
            — no season data
          </span>
        )}
      </div>
    </div>
  )
}

// ─── Stat line ────────────────────────────────────────────────────────────────

function StatLine({ performer }: { performer: TopPerformerWithDelta }) {
  const s = performer.stats
  const isCenter = performer.position === 'center'

  if (performer.isGoalie) {
    const sa = s.shotsAgainst ?? 0
    const saves = s.saves ?? 0
    const svPct = sa > 0 ? (saves / sa) * 100 : null
    return (
      <div className="flex flex-wrap gap-x-3.5 gap-y-1 px-4 pb-3 pt-1">
        <Stat label="SV" value={saves.toString()} />
        <Stat label="SA" value={sa.toString()} />
        <Stat label="SV%" value={svPct !== null ? svPct.toFixed(1) : '—'} />
        <Stat label="GA" value={(s.shotsAgainst === null ? 0 : sa - saves).toString()} />
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1 px-4 pb-3 pt-1">
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
      {isCenter && s.faceoffPct !== null ? (
        <Stat label="FO%" value={s.faceoffPct.toFixed(0)} dim />
      ) : (
        <Stat label="Hits" value={s.hits.toString()} dim />
      )}
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
    tone === 'pos'
      ? 'text-emerald-400'
      : tone === 'neg'
        ? 'text-rose-400'
        : dim
          ? 'text-fg-3'
          : 'text-fg-1'
  return (
    <div className="flex flex-col gap-[1px]">
      <span className="font-condensed text-[9px] font-extrabold uppercase tracking-[0.2em] text-fg-5">
        {label}
      </span>
      <span
        className={`font-condensed text-[14px] font-extrabold leading-none tabular-nums ${valueCls}`}
      >
        {value}
      </span>
    </div>
  )
}

// ─── Breakdown bar + legend ───────────────────────────────────────────────────

function BreakdownBar({ performer }: { performer: TopPerformerWithDelta }) {
  // Only positive contributions build width; negatives are surfaced in the
  // legend with a `−` prefix but don't get a bar segment (the bar shows
  // where the score CAME FROM, not where it was docked).
  const positives = performer.breakdown.filter((f) => f.contribution > 0)
  const positiveTotal = positives.reduce((s, f) => s + f.contribution, 0)
  const segments = positives.map((f) => ({
    label: f.label,
    contribution: f.contribution,
    pct: positiveTotal > 0 ? (f.contribution / positiveTotal) * 100 : 0,
    color: factorColor(f.label, true),
  }))
  // Top 6 contributing legend entries (positive + the 2 largest negatives if any).
  const negatives = performer.breakdown
    .filter((f) => f.contribution < 0)
    .sort((a, b) => a.contribution - b.contribution)
    .slice(0, 2)
  const legend = [
    ...positives.sort((a, b) => b.contribution - a.contribution).slice(0, 4),
    ...negatives,
  ]

  return (
    <div className="mt-auto border-t border-zinc-800 bg-surface/50 px-4 pb-3 pt-2.5">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-condensed text-[9px] font-extrabold uppercase tracking-[0.22em] text-fg-5">
          Where the {performer.score.toFixed(2)} came from
        </span>
        <span className="ml-auto font-condensed text-[10.5px] font-black tabular-nums tracking-[0.04em] text-fg-2">
          = {performer.score.toFixed(2)}
        </span>
      </div>
      <div className="flex h-1.5 overflow-hidden border border-zinc-800 bg-charcoal">
        {segments.map((seg) => (
          <span
            key={seg.label}
            className="block h-full"
            style={{ width: `${seg.pct.toFixed(2)}%`, background: seg.color }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-1">
        {legend.map((f) => {
          const isNeg = f.contribution < 0
          return (
            <span
              key={f.label}
              className="inline-flex items-center gap-1 font-condensed text-[9px] font-bold uppercase tracking-[0.1em] text-fg-4"
            >
              <span
                aria-hidden
                className="inline-block h-2 w-2"
                style={{ background: factorColor(f.label, !isNeg) }}
              />
              {shortLabel(f.label)}{' '}
              <b className={`tabular-nums ${isNeg ? 'text-rose-400' : 'text-fg-2'}`}>
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
