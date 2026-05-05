import type { PossessionEdge } from '@/lib/match-recap'
import { formatSeconds } from '@/lib/match-recap'
import { SectionHeader } from './top-performers'

interface PossessionEdgeProps {
  edge: PossessionEdge
}

const OUR_LABEL = 'BGM'
const OPP_LABEL = 'OPP'

export function PossessionEdgeBar({ edge }: PossessionEdgeProps) {
  const { bgmShare, oppShare, bgmRaw, oppRaw, inputs, weights } = edge
  const bgmWins = bgmShare >= oppShare

  const formula =
    weights.toa > 0 && weights.faceoff > 0
      ? 'Shots 40% · TOA 30% · Faceoffs 20% · Hits 10%'
      : weights.toa > 0
        ? 'Shots 50% · TOA 35% · Hits 15%'
        : weights.faceoff > 0
          ? 'Shots 55% · Faceoffs 30% · Hits 15%'
          : 'Shots 70% · Hits 30% (no TOA or faceoff data)'

  return (
    <section>
      <SectionHeader title="Deserve To Win" subtitle="computed from team totals" />

      <div className="border border-zinc-800 bg-surface px-4 py-5">
        {/* Gauge row */}
        <div className="flex items-end justify-between gap-2">
          <Side label={OUR_LABEL} value={bgmRaw} highlighted={bgmWins} />
          <Gauge bgmShare={bgmShare} oppShare={oppShare} />
          <Side label={OPP_LABEL} value={oppRaw} highlighted={!bgmWins} alignRight />
        </div>

        {/* Input grid */}
        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <Input label="Shots" us={inputs.shots.us} them={inputs.shots.them} />
          <Input label="Hits" us={inputs.hits.us} them={inputs.hits.them} />
          {inputs.faceoffPct !== null ? (
            <Input
              label="Faceoff %"
              us={`${inputs.faceoffPct.toFixed(0)}%`}
              them={`${(100 - inputs.faceoffPct).toFixed(0)}%`}
            />
          ) : (
            <Input label="Faceoff %" us="—" them="—" />
          )}
          <Input
            label="TOA"
            us={inputs.timeOnAttackSeconds !== null ? formatSeconds(inputs.timeOnAttackSeconds) : '—'}
            them={inputs.timeOnAttackSecondsAgainst !== null ? formatSeconds(inputs.timeOnAttackSecondsAgainst) : null}
          />
        </div>

        <p className="mt-3 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-600">
          Weights: {formula}
        </p>
      </div>
    </section>
  )
}

function Side({
  label,
  value,
  highlighted,
  alignRight = false,
}: {
  label: string
  value: number
  highlighted: boolean
  alignRight?: boolean
}) {
  return (
    <div className={`flex flex-col pb-1 ${alignRight ? 'items-end' : 'items-start'}`}>
      <span className="font-condensed text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </span>
      <span
        className={`font-condensed text-4xl font-black tabular leading-none ${
          highlighted ? 'text-accent' : 'text-zinc-500'
        }`}
      >
        {value.toFixed(1)}
      </span>
      {highlighted ? (
        <span className="mt-0.5 font-condensed text-[9px] font-bold uppercase tracking-[0.2em] text-accent/70">
          edge
        </span>
      ) : null}
    </div>
  )
}

function Gauge({ bgmShare, oppShare: _oppShare }: { bgmShare: number; oppShare: number }) {
  const cx = 120
  const cy = 120
  const r = 96
  const strokeW = 22
  const needle = shareToNeedle(bgmShare)
  const needleX = cx + Math.cos(needle) * (r - 10)
  const needleY = cy + Math.sin(needle) * (r - 10)

  // Clamp 1–99 so degenerate zero-length SVG arcs are never generated.
  // splitDeg marks the boundary between the BGM arc (left, from -180°) and the
  // OPP arc (right, to 0°). It must grow leftward as OPP share increases so the
  // BGM arc is proportional to bgmShare, not (1-bgmShare).
  const clampedShare = Math.max(1, Math.min(99, bgmShare))
  const splitDeg = -((1 - clampedShare / 100) * 180)

  return (
    <div className="flex h-[150px] flex-1 items-end justify-center">
      <svg viewBox="0 0 240 128" className="h-full w-full max-w-[280px]" aria-hidden>
        {/* Dark backing track */}
        <path
          d={arcPath(cx, cy, r, -180, 0)}
          fill="none"
          stroke="#0d1117"
          strokeWidth={strokeW + 8}
          strokeLinecap="butt"
        />
        {/* BGM arc — left side, shrinks as BGM share decreases */}
        <path
          d={arcPath(cx, cy, r, -180, splitDeg)}
          fill="none"
          stroke="#e11d48"
          strokeWidth={strokeW}
          strokeLinecap="butt"
        />
        {/* OPP arc — right side, shrinks as BGM share increases */}
        <path
          d={arcPath(cx, cy, r, splitDeg, 0)}
          fill="none"
          stroke="#374151"
          strokeWidth={strokeW}
          strokeLinecap="butt"
        />
        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={needleX}
          y2={needleY}
          stroke="white"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
        {/* Pivot */}
        <circle cx={cx} cy={cy} r="8" fill="white" />
        <circle cx={cx} cy={cy} r="4" fill="#0d1117" />
      </svg>
    </div>
  )
}

// BGM 100% → -180° (far left / BGM zone)
// BGM  50% →  -90° (straight up / center)
// BGM   0% →    0° (far right / OPP zone)
function shareToNeedle(share: number): number {
  const normalized = Math.max(0, Math.min(100, share)) / 100
  const degrees = -((1 - normalized) * 180)
  return (degrees * Math.PI) / 180
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const start = polar(cx, cy, r, startDeg)
  const end = polar(cx, cy, r, endDeg)
  return `M ${start.x.toString()} ${start.y.toString()} A ${r.toString()} ${r.toString()} 0 0 1 ${end.x.toString()} ${end.y.toString()}`
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg * Math.PI) / 180
  return { x: cx + Math.cos(rad) * r, y: cy + Math.sin(rad) * r }
}

function Input({
  label,
  us,
  them,
  note,
}: {
  label: string
  us: number | string
  them: number | string | null
  note?: string
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-600">
        {label}
        {note ? <span className="ml-1 text-zinc-700 normal-case tracking-normal">({note})</span> : null}
      </span>
      <span className="font-condensed text-sm font-bold tabular text-zinc-300">
        {them !== null ? `${us.toString()}-${them.toString()}` : us.toString()}
      </span>
    </div>
  )
}
