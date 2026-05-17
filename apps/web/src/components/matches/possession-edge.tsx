import type { PossessionEdge } from '@/lib/match-recap'
import { formatSeconds } from '@/lib/match-recap'
import { abbreviateTeamName } from '@/lib/format'

interface PossessionEdgeProps {
  edge: PossessionEdge
  opponentName: string
  scoreFor: number
  scoreAgainst: number
}

const BGM_LABEL = 'BGM'

interface Contributor {
  id: string
  label: string
  weight: number
  bgmDisplay: string
  oppDisplay: string
  /** BGM share 0..1, or null when data is missing. */
  share: number | null
  /** Signed contribution to BGM DtW% (positive = BGM, negative = OPP), or null. */
  delta: number | null
}

export function PossessionEdgeBar({
  edge,
  opponentName,
  scoreFor,
  scoreAgainst,
}: PossessionEdgeProps) {
  const oppAbbr = abbreviateTeamName(opponentName)
  const bgmPct = edge.bgmRaw
  const oppPct = edge.oppRaw
  const edgeDelta = bgmPct - oppPct
  const verdict: 'bgm' | 'opp' | 'coin' =
    Math.abs(edgeDelta) < 3 ? 'coin' : edgeDelta > 0 ? 'bgm' : 'opp'

  const verdictText =
    verdict === 'bgm'
      ? `${BGM_LABEL} Earned This Win`
      : verdict === 'opp'
        ? `${oppAbbr} Should Have Won`
        : 'Too Close to Call'

  const dtwWinner: 'bgm' | 'opp' = edgeDelta >= 0 ? 'bgm' : 'opp'
  const actualWinner: 'bgm' | 'opp' = scoreFor >= scoreAgainst ? 'bgm' : 'opp'
  const resultMatches = verdict === 'coin' ? true : dtwWinner === actualWinner
  const actualWinnerLabel = actualWinner === 'bgm' ? BGM_LABEL : oppAbbr

  const { weighted, informational } = buildContributors(edge, oppAbbr)
  const shotsSource = edge.inputs.shots.source

  return (
    <section className="relative border border-zinc-800 bg-surface">
      <span aria-hidden className="ticker-strip ticker-strip-thin absolute inset-x-0 top-0" />

      {/* Module header */}
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-5 py-3 sm:px-6">
        <span className="font-condensed text-[12px] font-extrabold uppercase tracking-[0.22em] text-fg-3">
          <span aria-hidden className="pr-1.5 text-accent">
            ▰
          </span>
          Deserve to Win
        </span>
        <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.18em] text-fg-5">
          · Weighted team totals
        </span>
        <SourceBadge source={shotsSource} />
      </header>

      {/* Headline: BGM% · gauge+verdict · OPP% */}
      <div className="grid grid-cols-1 items-center gap-6 px-5 pt-5 sm:grid-cols-[1fr_auto_1fr] sm:gap-8 sm:px-8 sm:pt-6">
        <SidePct side="bgm" label={BGM_LABEL} pct={bgmPct} verdict={verdict} />

        <div className="flex min-w-[260px] max-w-[320px] flex-col items-center gap-2 sm:order-none">
          <Gauge bgmPct={bgmPct} verdict={verdict} />
          <Verdict verdict={verdict} text={verdictText} edge={edgeDelta} />
        </div>

        <SidePct side="opp" label={oppAbbr} pct={oppPct} verdict={verdict} />
      </div>

      {/* Result-match footnote */}
      <div className="flex flex-wrap items-center justify-center gap-3 px-5 pb-4 pt-1 sm:px-8">
        <span
          className={`border px-2.5 py-1 font-condensed text-[10.5px] font-extrabold uppercase tracking-[0.18em] ${
            resultMatches
              ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400'
              : 'border-amber-500/50 bg-amber-500/10 text-amber-400'
          }`}
        >
          {resultMatches ? '✓ Matches actual final' : '⚠ Result mismatch'}
        </span>
        <span className="font-condensed text-[11px] font-bold uppercase tracking-[0.16em] text-fg-4">
          {actualWinnerLabel} won{' '}
          <b className="font-black tabular-nums text-fg-1">
            {scoreFor}–{scoreAgainst}
          </b>
          {!resultMatches && (
            <> — DtW says {dtwWinner === 'bgm' ? BGM_LABEL : oppAbbr} should have</>
          )}
        </span>
      </div>

      {/* Where the edge came from — collapsible */}
      <details className="group border-t border-zinc-800 bg-charcoal/40 open:bg-charcoal/40">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-raised/50 sm:px-8 [&::-webkit-details-marker]:hidden">
          <span className="font-condensed text-[11px] font-extrabold uppercase tracking-[0.22em] text-fg-4">
            Where the edge came from
          </span>
          <span className="font-condensed text-[9.5px] font-bold uppercase tracking-[0.18em] text-fg-5">
            Weighted contributors
          </span>
          <svg
            aria-hidden
            viewBox="0 0 12 12"
            className="ml-auto h-3 w-3 text-fg-4 transition-transform duration-200 group-open:rotate-180"
          >
            <path
              d="M2 4l4 4 4-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </summary>

        <div className="px-5 pb-5 sm:px-8">
          <ul className="divide-y divide-zinc-800/60">
            {weighted.map((c) => (
              <ContributorRow key={c.id} contributor={c} />
            ))}
            {informational.map((c) => (
              <InformationalRow key={c.id} contributor={c} />
            ))}
          </ul>
        </div>
      </details>

      {/* Methodology row */}
      <div className="flex flex-wrap items-center gap-4 border-t border-zinc-800 px-5 py-3 sm:px-8">
        <span className="font-condensed text-[10px] font-bold uppercase tracking-[0.22em] text-fg-5">
          Formula
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {weighted.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1.5 border border-zinc-800 bg-background px-2 py-0.5 font-condensed text-[10px] font-extrabold uppercase tracking-[0.14em] text-fg-3"
            >
              {c.label}
              <b className="font-black tabular-nums text-fg-1">{Math.round(c.weight * 100)}%</b>
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SidePct({
  side,
  label,
  pct,
  verdict,
}: {
  side: 'bgm' | 'opp'
  label: string
  pct: number
  verdict: 'bgm' | 'opp' | 'coin'
}) {
  const isWinner = verdict === side
  const isTied = verdict === 'coin'
  // Scoreboard rule: winner=accent, losing BGM=paper, losing OPP=grey, tied=paper
  const labelColor = isWinner ? 'text-accent' : side === 'bgm' ? 'text-fg-3' : 'text-fg-4'
  const dotColor = isWinner ? 'bg-accent' : side === 'bgm' ? 'bg-fg-3' : 'bg-fg-4'
  const pctColor = isWinner
    ? 'text-accent'
    : isTied
      ? 'text-fg-1'
      : side === 'bgm'
        ? 'text-fg-1'
        : 'text-fg-3'
  const align = side === 'bgm' ? 'sm:items-start' : 'sm:items-end'

  return (
    <div className={`flex flex-col items-start gap-1 ${align}`}>
      <span
        className={`flex items-center gap-2 font-condensed text-[12px] font-extrabold uppercase tracking-[0.22em] ${labelColor}`}
      >
        <span aria-hidden className={`h-2 w-2 ${dotColor}`} />
        {label}
      </span>
      <span
        className={`flex items-baseline gap-1 font-condensed text-[64px] font-black leading-none tabular-nums sm:text-[80px] ${pctColor}`}
        style={isWinner ? { textShadow: '0 0 22px rgba(232,65,49,0.30)' } : undefined}
      >
        {pct.toFixed(1)}
        <span className="pb-2 font-condensed text-[22px] font-extrabold text-fg-5 sm:text-[26px]">
          %
        </span>
      </span>
    </div>
  )
}

function Verdict({
  verdict,
  text,
  edge,
}: {
  verdict: 'bgm' | 'opp' | 'coin'
  text: string
  edge: number
}) {
  const badgeCls =
    verdict === 'coin'
      ? 'border-amber-500/50 bg-amber-500/10 text-amber-400'
      : 'border-accent/50 bg-accent/10 text-accent'
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span
        className={`border px-3.5 py-1.5 font-condensed text-[11px] font-black uppercase tracking-[0.24em] ${badgeCls}`}
      >
        {text}
      </span>
      <span className="font-condensed text-[10.5px] font-bold uppercase tracking-[0.14em] tabular-nums text-fg-3">
        Edge{' '}
        <b className="font-black text-fg-1">
          {edge >= 0 ? '+' : ''}
          {edge.toFixed(1)} pts
        </b>
      </span>
    </div>
  )
}

function Gauge({ bgmPct, verdict }: { bgmPct: number; verdict: 'bgm' | 'opp' | 'coin' }) {
  const cx = 120
  const cy = 120
  const r = 96
  const needleLen = 86
  // bgmPct=100 → 0° (right), bgmPct=0 → 180° (left)
  const angDeg = 180 - 1.8 * Math.max(0, Math.min(100, bgmPct))
  const ang = (angDeg * Math.PI) / 180
  const splitX = (cx + r * Math.cos(ang)).toFixed(2)
  const splitY = (cy - r * Math.sin(ang)).toFixed(2)
  const tipX = (cx + needleLen * Math.cos(ang)).toFixed(2)
  const tipY = (cy - needleLen * Math.sin(ang)).toFixed(2)

  const bgmSegColor =
    verdict === 'bgm'
      ? 'var(--color-accent)'
      : verdict === 'coin'
        ? 'var(--color-otl)'
        : 'var(--color-fg-3)'
  const oppSegColor =
    verdict === 'opp'
      ? 'var(--color-accent)'
      : verdict === 'coin'
        ? 'var(--color-otl)'
        : 'var(--color-fg-4)'

  return (
    <svg viewBox="0 0 240 152" className="block aspect-[240/152] h-auto w-full" aria-hidden>
      <path
        d="M 24 120 A 96 96 0 0 1 216 120"
        fill="none"
        stroke="var(--color-charcoal)"
        strokeWidth={30}
      />
      <path
        d={`M 24 120 A 96 96 0 0 1 ${splitX} ${splitY}`}
        fill="none"
        stroke={bgmSegColor}
        strokeWidth={22}
      />
      <path
        d={`M ${splitX} ${splitY} A 96 96 0 0 1 216 120`}
        fill="none"
        stroke={oppSegColor}
        strokeWidth={22}
      />
      <line x1={24} y1={120} x2={24} y2={130} stroke="var(--color-fg-5)" strokeWidth={1.2} />
      <line x1={120} y1={24} x2={120} y2={14} stroke="var(--color-fg-5)" strokeWidth={1.2} />
      <line x1={216} y1={120} x2={216} y2={130} stroke="var(--color-fg-5)" strokeWidth={1.2} />
      <text
        x={24}
        y={144}
        textAnchor="middle"
        className="font-condensed"
        style={{
          fontSize: 8.5,
          fontWeight: 800,
          letterSpacing: '0.16em',
          fill: 'var(--color-fg-5)',
        }}
      >
        0%
      </text>
      <text
        x={120}
        y={10}
        textAnchor="middle"
        className="font-condensed"
        style={{
          fontSize: 8.5,
          fontWeight: 800,
          letterSpacing: '0.16em',
          fill: 'var(--color-fg-5)',
        }}
      >
        50
      </text>
      <text
        x={216}
        y={144}
        textAnchor="middle"
        className="font-condensed"
        style={{
          fontSize: 8.5,
          fontWeight: 800,
          letterSpacing: '0.16em',
          fill: 'var(--color-fg-5)',
        }}
      >
        100%
      </text>
      <line
        x1={cx}
        y1={cy}
        x2={tipX}
        y2={tipY}
        stroke="var(--color-fg-1)"
        strokeWidth={3.5}
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r={8} fill="var(--color-fg-1)" />
      <circle cx={cx} cy={cy} r={4} fill="var(--color-background)" />
    </svg>
  )
}

function ContributorRow({ contributor }: { contributor: Contributor }) {
  const share = contributor.share ?? 0.5
  const bgmSharePct = (share * 100).toFixed(2)
  const oppSharePct = (100 - share * 100).toFixed(2)
  const delta = contributor.delta
  const sign = delta == null ? '' : delta >= 0 ? '+' : ''
  const deltaColor =
    delta == null
      ? 'text-fg-5'
      : delta > 0
        ? 'text-emerald-400'
        : delta < 0
          ? 'text-rose-400'
          : 'text-fg-1'

  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 py-2.5 sm:grid-cols-[110px_60px_1fr_96px]">
      <span className="font-condensed text-[13px] font-black uppercase tracking-[0.06em] text-fg-2">
        {contributor.label}
      </span>
      <span className="justify-self-end border border-zinc-800 bg-background px-2 py-0.5 text-center font-condensed text-[11px] font-extrabold tabular-nums text-fg-3 sm:justify-self-auto">
        {Math.round(contributor.weight * 100)}%
      </span>

      <div className="col-span-2 grid grid-cols-[60px_1fr_60px] items-center gap-2.5 sm:col-span-1">
        <span className="text-right font-condensed text-[14px] font-extrabold leading-none tabular-nums text-accent">
          {contributor.bgmDisplay}
        </span>
        <div className="flex h-2.5 border border-zinc-800 bg-charcoal">
          <span className="block h-full bg-accent" style={{ width: `${bgmSharePct}%` }} />
          <span className="block h-full bg-fg-4" style={{ width: `${oppSharePct}%` }} />
        </div>
        <span className="text-left font-condensed text-[14px] font-extrabold leading-none tabular-nums text-fg-3">
          {contributor.oppDisplay}
        </span>
      </div>

      <div className="col-span-2 text-right font-condensed sm:col-span-1">
        <span className={`text-[13px] font-extrabold tabular-nums ${deltaColor}`}>
          {sign}
          {delta == null ? '—' : delta.toFixed(1)}
        </span>
        <span className="ml-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-fg-5 sm:ml-0 sm:block sm:mt-0.5">
          to DtW
        </span>
      </div>
    </li>
  )
}

function InformationalRow({ contributor }: { contributor: Contributor }) {
  const missing = contributor.share == null
  const share = contributor.share ?? 0.5
  const bgmSharePct = (share * 100).toFixed(2)
  const oppSharePct = (100 - share * 100).toFixed(2)

  return (
    <li className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 py-2.5 opacity-70 sm:grid-cols-[110px_60px_1fr_96px]">
      <span className="font-condensed text-[13px] font-black uppercase tracking-[0.06em] text-fg-4">
        {contributor.label}
      </span>
      <span className="justify-self-end border border-dashed border-zinc-800 bg-background px-2 py-0.5 text-center font-condensed text-[11px] font-extrabold uppercase tabular-nums text-fg-5 sm:justify-self-auto">
        — info
      </span>

      <div className="col-span-2 grid grid-cols-[60px_1fr_60px] items-center gap-2.5 sm:col-span-1">
        <span className="text-right font-condensed text-[14px] font-extrabold leading-none tabular-nums text-fg-5">
          {contributor.bgmDisplay}
        </span>
        <div
          className={`flex h-2.5 border border-zinc-800 ${
            missing
              ? 'bg-[repeating-linear-gradient(135deg,var(--color-charcoal)_0_4px,var(--color-background)_4px_6px)]'
              : 'bg-charcoal'
          }`}
        >
          {!missing && (
            <>
              <span className="block h-full bg-fg-4" style={{ width: `${bgmSharePct}%` }} />
              <span className="block h-full bg-fg-4" style={{ width: `${oppSharePct}%` }} />
            </>
          )}
        </div>
        <span className="text-left font-condensed text-[14px] font-extrabold leading-none tabular-nums text-fg-5">
          {contributor.oppDisplay}
        </span>
      </div>

      <div className="col-span-2 text-right font-condensed sm:col-span-1">
        <span className="text-[11px] font-bold tabular-nums text-fg-5">{missing ? 'N/A' : ''}</span>
        <span className="ml-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-fg-6 sm:ml-0 sm:block sm:mt-0.5">
          {missing ? 'OCR missing' : 'not weighted'}
        </span>
      </div>
    </li>
  )
}

function SourceBadge({ source }: { source: 'ea' | 'ocr' }) {
  const isOcr = source === 'ocr'
  const dot = isOcr ? 'bg-emerald-400' : 'bg-fg-3'
  const text = isOcr ? 'OCR · post-game' : 'EA · official'
  return (
    <span className="ml-auto inline-flex items-center gap-2 font-condensed text-[10px] font-bold uppercase tracking-[0.18em] text-fg-5">
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${dot}`}
        style={{ boxShadow: isOcr ? '0 0 6px rgba(16,185,129,0.6)' : undefined }}
      />
      {text}
    </span>
  )
}

// ─── Contributor math ─────────────────────────────────────────────────────────

function buildContributors(
  edge: PossessionEdge,
  oppAbbr: string,
): { weighted: Contributor[]; informational: Contributor[] } {
  const { inputs, weights } = edge

  const all: Contributor[] = [
    makeShots(inputs, weights),
    makeToa(inputs, weights),
    makeFaceoff(inputs, weights, oppAbbr),
    makeHits(inputs, weights),
  ]

  return {
    weighted: all.filter((c) => c.weight > 0),
    informational: all.filter((c) => c.weight === 0),
  }
}

function shareDelta(share: number | null, weight: number): number | null {
  if (share == null) return null
  return (share - 0.5) * weight * 100
}

function makeShots(
  inputs: PossessionEdge['inputs'],
  weights: PossessionEdge['weights'],
): Contributor {
  const { us, them } = inputs.shots
  const total = us + them
  const share = total > 0 ? us / total : null
  return {
    id: 'shots',
    label: 'Shots',
    weight: weights.shots,
    bgmDisplay: us.toString(),
    oppDisplay: them.toString(),
    share,
    delta: shareDelta(share, weights.shots),
  }
}

function makeToa(
  inputs: PossessionEdge['inputs'],
  weights: PossessionEdge['weights'],
): Contributor {
  const us = inputs.timeOnAttackSeconds
  const them = inputs.timeOnAttackSecondsAgainst
  const haveBoth = us !== null && them !== null
  const share = haveBoth && us + them > 0 ? us / (us + them) : null
  return {
    id: 'toa',
    label: 'TOA',
    weight: weights.toa,
    bgmDisplay: us !== null ? formatSeconds(us) : '—',
    oppDisplay: them !== null ? formatSeconds(them) : '—',
    share,
    delta: shareDelta(share, weights.toa),
  }
}

function makeFaceoff(
  inputs: PossessionEdge['inputs'],
  weights: PossessionEdge['weights'],
  _oppAbbr: string,
): Contributor {
  const pct = inputs.faceoffPct
  const share = pct !== null ? pct / 100 : null
  return {
    id: 'faceoffs',
    label: 'Faceoff %',
    weight: weights.faceoff,
    bgmDisplay: pct !== null ? `${pct.toFixed(0)}%` : '—',
    oppDisplay: pct !== null ? `${(100 - pct).toFixed(0)}%` : '—',
    share,
    delta: shareDelta(share, weights.faceoff),
  }
}

function makeHits(
  inputs: PossessionEdge['inputs'],
  weights: PossessionEdge['weights'],
): Contributor {
  const { us, them } = inputs.hits
  const total = us + them
  const share = total > 0 ? us / total : null
  return {
    id: 'hits',
    label: 'Hits',
    weight: weights.hits,
    bgmDisplay: us.toString(),
    oppDisplay: them.toString(),
    share,
    delta: shareDelta(share, weights.hits),
  }
}
