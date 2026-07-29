import type { PossessionEdge } from '@/lib/match-recap'
import { formatSeconds } from '@/lib/match-recap'
import { abbreviateTeamName } from '@/lib/format'
import { confidenceTone, confidenceWord } from './ocr-provenance-footer'

// Rail module — Deserve to Win. Replaces the full-width `possession-edge.tsx`
// readout, which was built before the Phase 2 regrid and overflowed the 299px
// rail by ~412px.
//
// Everything here is derived from `buildPossessionEdge`, whose weight set
// degrades with data availability. That degradation is surfaced two ways: the
// header confidence chip (share of the full model this match could supply) and
// the disclosure, where an input the match never captured is shown as an
// excluded row rather than quietly dropped.
//
// Static by design — the needle sweep / count-up is Phase 12 motion. The
// disclosure is a native `<details>`, so the caret flips without client JS
// (the prototype's `＋` never flipped; the review flagged it).

interface DtwGaugeProps {
  edge: PossessionEdge
  opponentName: string
  scoreFor: number
  scoreAgainst: number
}

const BGM_LABEL = 'BGM'

/** Verdict is a coin flip inside this many DtW points of dead even. */
const COIN_FLIP_POINTS = 3

/**
 * The full model's weights. Coverage = the share of these that the match
 * actually supplied, which is what the confidence chip reports — the active
 * weights in `edge.weights` are already renormalised, so they can't show it.
 */
const CANONICAL_WEIGHTS = { shots: 0.4, toa: 0.3, faceoff: 0.2, hits: 0.1 } as const

type Side = 'bgm' | 'opp'
type Verdict = Side | 'coin'

interface Contributor {
  id: keyof typeof CANONICAL_WEIGHTS
  label: string
  /** Weight in the ACTIVE model; 0 when this input is not part of it. */
  weight: number
  bgmDisplay: string
  oppDisplay: string
  /** BGM share 0..1, or null when the match captured nothing to compare. */
  share: number | null
  /** Signed contribution to BGM's DtW points, or null when there is no share. */
  delta: number | null
}

export function DtwGauge({ edge, opponentName, scoreFor, scoreAgainst }: DtwGaugeProps) {
  const oppAbbrev = abbreviateTeamName(opponentName)
  const bgmPct = edge.bgmRaw
  const oppPct = edge.oppRaw
  const edgeDelta = bgmPct - oppPct

  const verdict: Verdict =
    Math.abs(edgeDelta) < COIN_FLIP_POINTS ? 'coin' : edgeDelta > 0 ? 'bgm' : 'opp'
  const actual: Side | 'tie' =
    scoreFor > scoreAgainst ? 'bgm' : scoreFor < scoreAgainst ? 'opp' : 'tie'
  // "Too close to call" cannot contradict a result, so it is never a mismatch.
  const aligned = verdict === 'coin' || verdict === actual
  const sideLabel = (s: Side) => (s === 'bgm' ? BGM_LABEL : oppAbbrev)

  const verdictText =
    verdict === 'coin'
      ? 'Too close to call'
      : verdict === actual
        ? `${sideLabel(verdict)} earned this win`
        : actual === 'tie'
          ? `${sideLabel(verdict)} deserved the win`
          : `${sideLabel(verdict)} should have won`

  const contributors = buildContributors(edge)
  const coverage = modelCoverage(contributors)

  return (
    <section>
      <div className="broadcast-panel-soft relative overflow-hidden">
        <span aria-hidden className="ticker-strip ticker-strip-thin absolute inset-x-0 top-0" />

        <div className="flex flex-col gap-2.5 px-3.5 pb-3.5 pt-3">
          <div className="flex flex-col gap-0.5">
            <div className="flex items-baseline gap-2">
              <h2 className="font-condensed text-[11px] font-extrabold uppercase tracking-[0.18em] text-fg-4">
                <span aria-hidden className="pr-1 text-accent">
                  ▰
                </span>
                Deserve to Win
              </h2>
              <ConfidenceChip coverage={coverage} contributors={contributors} />
            </div>
            <p className="font-condensed text-[10px] uppercase tracking-[0.12em] text-fg-5">
              Weighted team totals · {edge.inputs.shots.source === 'ocr' ? 'OCR shots' : 'EA shots'}
            </p>
          </div>

          <div className="flex items-end justify-between gap-2 pt-0.5">
            <SidePct side="bgm" label={BGM_LABEL} pct={bgmPct} verdict={verdict} />
            <SidePct side="opp" label={oppAbbrev} pct={oppPct} verdict={verdict} />
          </div>

          <Gauge bgmPct={bgmPct} verdict={verdict} />

          <div className="flex flex-col items-center gap-1.5">
            <span
              className={`border px-3 py-[5px] text-center font-condensed text-[10px] font-black uppercase tracking-[0.2em] ${verdictBadgeClass(verdict)}`}
            >
              {verdictText}
            </span>
            <ResultLine
              edgeDelta={edgeDelta}
              actual={actual}
              actualLabel={actual === 'bgm' ? BGM_LABEL : oppAbbrev}
              scoreFor={scoreFor}
              scoreAgainst={scoreAgainst}
              aligned={aligned}
            />
          </div>

          <Disclosure contributors={contributors} oppAbbrev={oppAbbrev} />
        </div>
      </div>
    </section>
  )
}

// ─── Headline ─────────────────────────────────────────────────────────────────

function SidePct({
  side,
  label,
  pct,
  verdict,
}: {
  side: Side
  label: string
  pct: number
  verdict: Verdict
}) {
  const leads = verdict === side
  const labelColor = leads ? sideColorClass(side) : 'text-fg-4'
  const valueColor = leads ? sideColorClass(side) : 'text-fg-3'
  const align = side === 'bgm' ? 'items-start' : 'items-end'

  return (
    <div className={`flex min-w-0 flex-col ${align}`}>
      <span
        className={`font-condensed text-[10px] font-extrabold uppercase tracking-[0.2em] ${labelColor}`}
      >
        {label}
      </span>
      <span
        className={`font-condensed text-[38px] font-black leading-[0.9] tabular-nums ${valueColor}`}
        style={
          leads && side === 'bgm' ? { textShadow: '0 0 22px rgba(232,65,49,0.30)' } : undefined
        }
      >
        {pct.toFixed(1)}
        <span className="font-condensed text-[18px] text-fg-4">%</span>
      </span>
    </div>
  )
}

function ResultLine({
  edgeDelta,
  actual,
  actualLabel,
  scoreFor,
  scoreAgainst,
  aligned,
}: {
  edgeDelta: number
  actual: Side | 'tie'
  actualLabel: string
  scoreFor: number
  scoreAgainst: number
  aligned: boolean
}) {
  // Winner-first, unlike the BGM-left hero scorebug: this line names the team
  // out loud, so "NA won 4–5" (BGM-first) would read as NA winning with four.
  const hi = Math.max(scoreFor, scoreAgainst)
  const lo = Math.min(scoreFor, scoreAgainst)
  const outcome =
    actual === 'tie'
      ? `Tied ${String(scoreFor)}–${String(scoreAgainst)}`
      : `${actualLabel} won ${String(hi)}–${String(lo)}`

  return (
    <span
      className={`text-balance text-center font-condensed text-[10px] font-bold uppercase tracking-[0.12em] tabular-nums ${
        aligned ? 'text-fg-4' : 'text-[var(--color-otl)]'
      }`}
    >
      Edge{' '}
      <b className="font-black text-fg-2">
        {edgeDelta >= 0 ? '+' : '−'}
        {Math.abs(edgeDelta).toFixed(1)}
      </b>{' '}
      · {outcome}
      {aligned ? null : ' — DtW disagrees'}
    </span>
  )
}

function ConfidenceChip({
  coverage,
  contributors,
}: {
  coverage: number
  contributors: Contributor[]
}) {
  const missing = contributors.filter((c) => c.share === null).map((c) => c.label)
  const tone = confidenceTone(coverage)
  const toneClass =
    tone === 'ok'
      ? 'text-[var(--color-win)]'
      : tone === 'warn'
        ? 'text-[var(--color-otl)]'
        : 'text-fg-3'
  const tooltip =
    missing.length > 0
      ? `Share of the full Deserve-to-Win model this match supplied. Missing: ${missing.join(', ')}.`
      : 'Share of the full Deserve-to-Win model this match supplied. All inputs present.'

  return (
    <span
      title={tooltip}
      className={`ml-auto cursor-help font-condensed text-[10px] font-bold uppercase tracking-[0.14em] tabular-nums ${toneClass}`}
    >
      <span aria-hidden className="pr-1">
        ●
      </span>
      {confidenceWord(coverage)} {coverage.toFixed(2)}
    </span>
  )
}

// ─── Gauge ────────────────────────────────────────────────────────────────────

function Gauge({ bgmPct, verdict }: { bgmPct: number; verdict: Verdict }) {
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

  // Same rule as the Team Stats bars: the leading side takes its saturated
  // team colour, the trailing side stays present but faded.
  const bgmSeg = verdict === 'bgm' ? 'var(--color-accent)' : 'rgba(232,65,49,0.30)'
  const oppSeg = verdict === 'opp' ? 'var(--opp)' : 'var(--opp-line)'

  return (
    <svg viewBox="0 0 240 152" className="mx-auto block w-full max-w-[230px]" aria-hidden>
      <path
        d="M 24 120 A 96 96 0 0 1 216 120"
        fill="none"
        stroke="var(--color-charcoal)"
        strokeWidth={30}
      />
      <path
        d={`M 24 120 A 96 96 0 0 1 ${splitX} ${splitY}`}
        fill="none"
        stroke={bgmSeg}
        strokeWidth={22}
      />
      <path
        d={`M ${splitX} ${splitY} A 96 96 0 0 1 216 120`}
        fill="none"
        stroke={oppSeg}
        strokeWidth={22}
      />
      <line x1={24} y1={120} x2={24} y2={130} stroke="var(--color-fg-4)" strokeWidth={1.2} />
      <line x1={120} y1={24} x2={120} y2={14} stroke="var(--color-fg-4)" strokeWidth={1.2} />
      <line x1={216} y1={120} x2={216} y2={130} stroke="var(--color-fg-4)" strokeWidth={1.2} />
      <TickLabel x={24} y={144} text="0%" />
      <TickLabel x={120} y={11} text="50" />
      <TickLabel x={216} y={144} text="100%" />
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

function TickLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor="middle"
      className="font-condensed"
      style={{
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: '0.1em',
        fill: 'var(--color-fg-4)',
      }}
    >
      {text}
    </text>
  )
}

// ─── Where the edge came from ─────────────────────────────────────────────────

function Disclosure({
  contributors,
  oppAbbrev,
}: {
  contributors: Contributor[]
  oppAbbrev: string
}) {
  const weighted = contributors.filter((c) => c.weight > 0)
  const excluded = contributors.filter((c) => c.weight === 0)

  return (
    <details className="group border-t border-border-subtle pt-2.5">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-condensed text-[10px] font-bold uppercase tracking-[0.14em] text-fg-4 [&::-webkit-details-marker]:hidden">
        Where the edge came from
        <svg
          aria-hidden
          viewBox="0 0 12 12"
          className="ml-auto h-3 w-3 shrink-0 transition-transform duration-200 group-open:rotate-180"
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

      <div className="flex flex-col gap-2.5 pt-2.5">
        {weighted.map((c) => (
          <ContributorBlock key={c.id} contributor={c} oppAbbrev={oppAbbrev} />
        ))}
        {excluded.map((c) => (
          <ExcludedRow key={c.id} contributor={c} />
        ))}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2.5">
          <span className="font-condensed text-[10px] font-bold uppercase tracking-[0.14em] text-fg-4">
            Formula
          </span>
          {weighted.map((c) => (
            <span
              key={c.id}
              className="border border-border px-1.5 py-[1px] font-condensed text-[10px] font-extrabold uppercase tabular-nums text-fg-3"
            >
              {c.label} {Math.round(c.weight * 100)}
            </span>
          ))}
        </div>
      </div>
    </details>
  )
}

function ContributorBlock({
  contributor,
  oppAbbrev,
}: {
  contributor: Contributor
  oppAbbrev: string
}) {
  const { share, delta } = contributor
  const bgmLeads = share !== null && share > 0.5
  const oppLeads = share !== null && share < 0.5

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="font-condensed text-[11px] font-black uppercase tracking-[0.06em] text-fg-2">
          {contributor.label}
        </span>
        <span className="border border-border px-1.5 py-[1px] font-condensed text-[10px] font-extrabold tabular-nums text-fg-3">
          {Math.round(contributor.weight * 100)}%
        </span>
        <span className="ml-auto font-condensed text-[11px] font-extrabold tabular-nums text-fg-3">
          <b className={bgmLeads ? 'text-accent' : ''}>{contributor.bgmDisplay}</b> –{' '}
          <b className={oppLeads ? '[color:var(--opp)]' : ''}>{contributor.oppDisplay}</b>
        </span>
      </div>

      {share === null ? (
        <div
          aria-hidden
          className="h-2 border border-border bg-[repeating-linear-gradient(135deg,var(--color-charcoal)_0_4px,var(--color-background)_4px_6px)]"
        />
      ) : (
        <div aria-hidden className="flex h-2 border border-border bg-charcoal">
          <span
            className="block h-full"
            style={{ width: `${(share * 100).toFixed(2)}%`, background: 'var(--color-accent)' }}
          />
          <span
            className="block h-full"
            style={{ width: `${(100 - share * 100).toFixed(2)}%`, background: 'var(--opp)' }}
          />
        </div>
      )}

      <span className="font-condensed text-[10px] font-bold uppercase tracking-[0.1em] tabular-nums text-fg-4">
        {delta === null || share === null ? (
          <>Not captured · model treats as even</>
        ) : (
          <>
            <b
              className={`font-black ${delta > 0 ? 'text-accent' : delta < 0 ? '[color:var(--opp)]' : 'text-fg-3'}`}
            >
              {delta >= 0 ? '+' : '−'}
              {Math.abs(delta).toFixed(1)}
            </b>{' '}
            {delta >= 0 ? 'to' : 'from'} DtW · BGM {(share * 100).toFixed(0)}% ·{' '}
            {oppAbbrev.toUpperCase()} {(100 - share * 100).toFixed(0)}%
          </>
        )}
      </span>
    </div>
  )
}

function ExcludedRow({ contributor }: { contributor: Contributor }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="font-condensed text-[11px] font-black uppercase tracking-[0.06em] text-fg-4">
        {contributor.label}
      </span>
      <span className="border border-dashed border-border px-1.5 py-[1px] font-condensed text-[10px] font-extrabold uppercase text-fg-4">
        — info
      </span>
      <span className="ml-auto font-condensed text-[10px] font-bold uppercase tracking-[0.1em] text-fg-4">
        Not captured · excluded
      </span>
    </div>
  )
}

// ─── Derivations ──────────────────────────────────────────────────────────────

function sideColorClass(side: Side): string {
  return side === 'bgm' ? 'text-accent' : '[color:var(--opp)]'
}

function verdictBadgeClass(verdict: Verdict): string {
  if (verdict === 'coin') {
    return 'border-[var(--color-otl-border)] bg-[var(--color-otl-bg)] text-[var(--color-otl)]'
  }
  return verdict === 'bgm'
    ? 'border-accent/50 bg-accent/10 text-accent'
    : 'border-[color:var(--opp-line)] bg-[color:var(--opp-soft)] [color:var(--opp)]'
}

/**
 * Share of the full model (`CANONICAL_WEIGHTS`) this match could actually feed.
 * An input with no data is excluded even when the active model still gives it a
 * weight — `buildPossessionEdge` falls back to an even 0.5 share there, which
 * is a guess, not evidence.
 */
function modelCoverage(contributors: Contributor[]): number {
  let covered = 0
  for (const c of contributors) {
    if (c.share === null) continue
    covered += CANONICAL_WEIGHTS[c.id]
  }
  return covered
}

function buildContributors(edge: PossessionEdge): Contributor[] {
  const { inputs, weights } = edge
  return [
    makeShots(inputs, weights),
    makeToa(inputs, weights),
    makeFaceoff(inputs, weights),
    makeHits(inputs, weights),
  ]
}

function shareDelta(share: number | null, weight: number): number | null {
  if (share === null) return null
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
): Contributor {
  const pct = inputs.faceoffPct
  const share = pct !== null ? pct / 100 : null
  return {
    id: 'faceoff',
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
