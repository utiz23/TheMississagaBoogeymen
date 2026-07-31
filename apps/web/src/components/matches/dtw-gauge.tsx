import type { PossessionEdge } from '@/lib/match-recap'
import { formatSeconds } from '@/lib/match-recap'
import { abbreviateTeamName } from '@/lib/format'
import { delayVar, DTW_LANDS_MS, DTW_SWEEP_DELAY_MS, DTW_SWEEP_MS } from '@/lib/motion'
import { DtwGaugeArc } from './dtw-gauge-arc'
import { CountUp } from './motion'
import { confidenceTone } from './ocr-provenance-footer'

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
// DESIGN OF RECORD: `Game sheet prototype layout (1)/Game Sheet copy.dc.html`
// lines 657-730 — the REVISED file, not the plain `Game Sheet.dc.html` this
// module was first built from. The copy file's DtW is an a11y/legibility pass:
// a 12px type floor (no 10/11px anywhere), the opponent drawn in `--opp` /
// `--opp-2` rather than neutral grey, a borderless verdict line, and the
// disclosure promoted to a full-width `wire-cta` box. Two of its details are
// deliberately NOT ported — see the notes at `ContributorBlock`.
//
// Motion (Phase 12) is preserved on top of the new skin: a single front sweeps
// the arc while both percentages count up and the needle rides it; the winning
// number blooms once as it lands, then the verdict arrives last. The arc lives
// in `dtw-gauge-arc.tsx` (client, for the needle); this stays a server
// component.

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

  // The prototype only mocks the aligned state (green). Generalised: the model
  // agreeing with the scoreboard is a win-coloured statement, disagreeing with
  // it is the same amber the rest of the page uses for "look closer", and a
  // coin flip asserts nothing so it stays neutral.
  const verdictColor =
    verdict === 'coin'
      ? 'text-fg-4'
      : aligned
        ? 'text-[var(--color-win)]'
        : 'text-[var(--color-otl)]'

  const contributors = buildContributors(edge)
  const coverage = modelCoverage(contributors)

  return (
    <section>
      <div className="gs-rise broadcast-panel-soft relative overflow-hidden">
        <span aria-hidden className="gs-wipe" />

        <div className="flex flex-col gap-[11px] px-3.5 pb-3.5 pt-3">
          <div className="flex items-baseline gap-2">
            <h2 className="font-condensed text-[12px] font-semibold uppercase tracking-[0.16em] text-fg-4">
              <span aria-hidden className="pr-1 text-fg-5">
                ▰
              </span>
              Deserve to Win
            </h2>
            <ConfidenceChip coverage={coverage} contributors={contributors} />
          </div>

          <div className="flex items-end justify-between gap-2">
            <SidePct side="bgm" label={BGM_LABEL} pct={bgmPct} verdict={verdict} />
            <SidePct side="opp" label={oppAbbrev} pct={oppPct} verdict={verdict} />
          </div>

          <DtwGaugeArc bgmPct={bgmPct} />

          <div className="flex flex-col items-center gap-1.5">
            {/* The conclusion, arriving last: it rises in just after the needle
                rests. The prototype's border-glow flare went with the border —
                a box-shadow on a borderless line reads as a floating halo. */}
            <span
              className={`gs-block-rise text-balance py-0.5 text-center font-condensed text-[12px] font-black uppercase tracking-[0.2em] ${verdictColor}`}
              style={delayVar(DTW_LANDS_MS + 50)}
            >
              {verdictText}
            </span>
          </div>

          <Disclosure contributors={contributors} />
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
  // Colour is now fixed per side, not per verdict: this pair is one quantity
  // split in two, so BGM is always the accent and the opponent is always their
  // resolved colour. Which side is ahead is carried by the numbers, the arc
  // split and the verdict line.
  const labelColor = side === 'bgm' ? 'text-accent' : '[color:var(--opp-2)]'
  const valueColor = side === 'bgm' ? 'text-accent' : '[color:var(--opp)]'
  const align = side === 'bgm' ? 'items-start' : 'items-end'

  // The opponent number counts DOWN from 100 while BGM counts up from 0, so the
  // pair reads as one quantity being divided rather than two tallies racing.
  const countFrom = side === 'bgm' ? 0 : 100

  // Only the winning side blooms, and only once. A coin-flip verdict blooms
  // nothing — there is no conclusion to mark.
  const leads = verdict === side
  const bloomClass = leads ? (side === 'bgm' ? 'gs-bloom-accent' : 'gs-bloom-opp') : ''

  return (
    <div className={`flex min-w-0 flex-col ${align}`}>
      <span
        className={`font-condensed text-[12px] font-extrabold uppercase tracking-[0.2em] ${labelColor}`}
      >
        {label}
      </span>
      <span
        className={`${bloomClass} font-condensed text-[38px] font-black leading-[0.9] tabular-nums ${valueColor}`}
        style={
          // The resting red shadow is BGM-only and unconditional, as the
          // prototype draws it. The bloom keyframe's `both` fill supersedes it
          // while running and settles on its own resting glow; under reduced
          // motion the animation is gone and this inline value is what paints.
          side === 'bgm'
            ? { ...delayVar(DTW_LANDS_MS), textShadow: '0 0 22px rgba(232,65,49,0.30)' }
            : leads
              ? delayVar(DTW_LANDS_MS)
              : undefined
        }
      >
        <CountUp
          value={pct}
          from={countFrom}
          decimals={1}
          durationMs={DTW_SWEEP_MS}
          delayMs={DTW_SWEEP_DELAY_MS}
        >
          {pct.toFixed(1)}
        </CountUp>
        <span className="font-condensed text-[18px] text-fg-5">%</span>
      </span>
    </div>
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
        : 'text-fg-4'
  const tooltip =
    missing.length > 0
      ? `Share of the full Deserve-to-Win model this match supplied. Missing: ${missing.join(', ')}.`
      : 'Share of the full Deserve-to-Win model this match supplied. All inputs present.'

  return (
    <span
      title={tooltip}
      className={`ml-auto cursor-help font-condensed text-[12px] font-bold uppercase tracking-[0.14em] tabular-nums ${toneClass}`}
    >
      <span aria-hidden className="gs-dot-breathe pr-1">
        ●
      </span>
      {coverage.toFixed(2)}
    </span>
  )
}

// ─── Where the edge came from ─────────────────────────────────────────────────

function Disclosure({ contributors }: { contributors: Contributor[] }) {
  const weighted = contributors.filter((c) => c.weight > 0)
  const excluded = contributors.filter((c) => c.weight === 0)

  return (
    <details className="group border-t border-border-subtle pt-2.5">
      {/* `wire-cta` from the prototype: charcoal box with a neutral resting
          border and fg-2 label, going accent on hover. The named `group/cta`
          keeps the hover scoped to the summary — the default `group` is the
          <details>, whose open state drives the caret, and hovering the opened
          panel must not light the button up. */}
      <summary className="group/cta flex w-full cursor-pointer list-none items-center justify-center gap-[7px] border border-border bg-charcoal px-3 py-2.5 transition-colors hover:border-accent hover:bg-[var(--color-accent-soft)] [&::-webkit-details-marker]:hidden">
        <span className="whitespace-nowrap font-condensed text-[12px] font-extrabold uppercase tracking-[0.08em] text-fg-2 transition-colors group-hover/cta:text-accent">
          Where the edge came from
        </span>
        <span
          aria-hidden
          className="gs-chevron font-condensed text-[12px] leading-none text-fg-2 group-open:rotate-180 group-hover/cta:text-accent"
        >
          ⌄
        </span>
      </summary>

      <div className="flex flex-col gap-2.5 pt-2.5">
        {weighted.map((c) => (
          <ContributorBlock key={c.id} contributor={c} />
        ))}
        {excluded.map((c) => (
          <ExcludedRow key={c.id} contributor={c} />
        ))}
        <div className="flex flex-wrap items-center gap-[5px] border-t border-border-subtle pt-[9px]">
          <span className="font-condensed text-[12px] font-bold uppercase tracking-[0.14em] text-fg-4">
            Formula
          </span>
          {weighted.map((c) => (
            <span
              key={c.id}
              className="border border-border px-1.5 py-0.5 font-condensed text-[12px] font-extrabold uppercase tabular-nums text-fg-3"
            >
              {c.label} {Math.round(c.weight * 100)}
            </span>
          ))}
        </div>
      </div>
    </details>
  )
}

function ContributorBlock({ contributor }: { contributor: Contributor }) {
  const { share, delta } = contributor
  const bgmLeads = share !== null && share > 0.5
  const oppLeads = share !== null && share < 0.5

  // NOT ported from the prototype, both traceable to its mechanical
  // `--fg-4` → `--opp-2` recolour rather than to intent:
  //
  //   1. Its bars paint the LEADING side accent whichever team that is — the
  //      hits row (BGM 14, opponent 39) draws the opponent's 74% in BGM red and
  //      BGM's 26% in the opponent colour. Two rows above, red is BGM. Here the
  //      accent stays with BGM on every row.
  //   2. Its delta number is accent even when negative. Kept signed-coloured,
  //      so a category BGM lost is not printed in BGM's colour.
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="font-condensed text-[12px] font-black uppercase tracking-[0.06em] text-fg-2">
          {contributor.label}
        </span>
        <span className="border border-border px-[5px] py-px font-condensed text-[12px] font-extrabold tabular-nums text-fg-3">
          {Math.round(contributor.weight * 100)}%
        </span>
        <span className="ml-auto font-condensed text-[12px] font-extrabold tabular-nums text-fg-3">
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
        // Each side grows from its own outer edge, so the pair duels toward the
        // split rather than both sliding the same way. Widths are untouched —
        // only scaleX animates, so nothing reflows.
        <div aria-hidden className="flex h-2 border border-border bg-charcoal">
          <span
            className={`gs-bar-on-open block h-full ${bgmLeads ? 'gs-flare-on-open-accent' : ''}`}
            style={{ width: `${(share * 100).toFixed(2)}%`, background: 'var(--color-accent)' }}
          />
          <span
            className={`gs-bar-on-open gs-bar-on-open-right block h-full ${oppLeads ? 'gs-flare-on-open-opp' : ''}`}
            style={{ width: `${(100 - share * 100).toFixed(2)}%`, background: 'var(--opp-2)' }}
          />
        </div>
      )}

      <span className="font-condensed text-[12px] font-bold uppercase tracking-[0.1em] tabular-nums text-fg-4">
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
            {delta >= 0 ? 'to' : 'from'} DtW · BGM {(share * 100).toFixed(0)}%
          </>
        )}
      </span>
    </div>
  )
}

function ExcludedRow({ contributor }: { contributor: Contributor }) {
  // The prototype has no excluded row to copy — it mocks a match where every
  // input landed. Built to the contributor rhythm instead (label row, then
  // caption row) rather than as one line: at the 12px floor a single row of
  // "FACEOFF % · — INFO · NOT CAPTURED · EXCLUDED" wraps twice in a 299px rail.
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className="font-condensed text-[12px] font-black uppercase tracking-[0.06em] text-fg-4">
          {contributor.label}
        </span>
        <span className="border border-dashed border-border px-[5px] py-px font-condensed text-[12px] font-extrabold uppercase text-fg-4">
          — info
        </span>
      </div>
      <span className="font-condensed text-[12px] font-bold uppercase tracking-[0.1em] text-fg-4">
        Not captured · excluded
      </span>
    </div>
  )
}

// ─── Derivations ──────────────────────────────────────────────────────────────

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
