import type { PossessionEdge } from '@/lib/match-recap'
import { formatSeconds } from '@/lib/match-recap'
import { SectionHeader } from './top-performers'

interface PossessionEdgeProps {
  edge: PossessionEdge
}

const OUR_LABEL = 'BGM'
const OPP_LABEL = 'OPP'

export function PossessionEdgeBar({ edge }: PossessionEdgeProps) {
  const { bgmShare, oppShare, inputs, weights } = edge

  const formula =
    weights.faceoff > 0
      ? 'Shots 45% · Faceoffs 30% · Hits 25%'
      : 'Shots 65% · Hits 35% (faceoff data unavailable)'

  return (
    <section>
      <SectionHeader
        title="Possession & Pressure Edge"
        subtitle="computed from team totals"
      />

      <div className="border border-zinc-800 bg-surface px-4 py-4">
        {/* Headline split */}
        <div className="flex items-end justify-between gap-3">
          <Side label={OUR_LABEL} share={bgmShare} highlighted={bgmShare >= oppShare} />
          <Side
            label={OPP_LABEL}
            share={oppShare}
            highlighted={oppShare > bgmShare}
            alignRight
          />
        </div>

        {/* Bar */}
        <div className="mt-3 flex h-2 w-full overflow-hidden rounded-sm bg-zinc-800/60">
          <div
            className="bg-accent/80 transition-all"
            style={{ width: `${bgmShare.toString()}%` }}
            aria-hidden
          />
          <div
            className="bg-zinc-600/60 transition-all"
            style={{ width: `${oppShare.toString()}%` }}
            aria-hidden
          />
        </div>

        {/* Inputs */}
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
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
            them={null}
            note="info only"
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
  share,
  highlighted,
  alignRight = false,
}: {
  label: string
  share: number
  highlighted: boolean
  alignRight?: boolean
}) {
  return (
    <div className={`flex flex-col ${alignRight ? 'items-end' : 'items-start'}`}>
      <span className="font-condensed text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
        {label}
      </span>
      <span
        className={`font-condensed text-3xl font-black tabular leading-none ${
          highlighted ? 'text-zinc-50' : 'text-zinc-500'
        }`}
      >
        {share.toString()}
      </span>
    </div>
  )
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
