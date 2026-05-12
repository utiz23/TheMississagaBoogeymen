import type { MatchShotTypeSummaryRow } from '@eanhl/db/queries'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'

interface ShotMixProps {
  rows: MatchShotTypeSummaryRow[]
}

interface SideStats {
  total: number | null
  wrist: number | null
  slap: number | null
  backhand: number | null
  snap: number | null
  deflections: number | null
  powerPlay: number | null
}

const TYPE_LABELS: Array<[keyof SideStats, string]> = [
  ['wrist', 'Wrist'],
  ['snap', 'Snap'],
  ['backhand', 'Backhand'],
  ['slap', 'Slap'],
  ['deflections', 'Deflection'],
  ['powerPlay', 'Power Play'],
]

/**
 * Per-side shot-type breakdown. Aggregates per-period rows into one row per
 * side; if a full-game aggregate row (period_number = -1) exists, prefer it.
 */
export function ShotMix({ rows }: ShotMixProps) {
  if (rows.length === 0) return null

  const bgm = aggForSide(rows, 'for')
  const opp = aggForSide(rows, 'against')

  if (
    bgm.total === null &&
    opp.total === null &&
    bgm.snap === null &&
    opp.snap === null
  ) {
    return null
  }

  const subtitle = buildSubtitle(bgm, opp)

  return (
    <section className="space-y-3">
      <SectionHeader label="Shot Mix" subtitle={subtitle ?? 'Shot type breakdown — OCR-derived'} />
      <Panel className="px-4 py-4">
        <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-x-3 text-sm">
          <div />
          <div className="text-right font-condensed text-[11px] font-bold uppercase tracking-widest text-[#ce202f]">
            BGM
          </div>
          <div className="text-right font-condensed text-[11px] font-bold uppercase tracking-widest text-[#7d8db0]">
            OPP
          </div>
        </div>

        <div className="mt-2 grid grid-cols-[1fr_5rem_5rem] items-center gap-x-3 border-b border-zinc-800 pb-3">
          <TotalLabel />
          <div className="text-right font-condensed text-xl font-bold tabular-nums text-zinc-100">
            {bgm.total ?? '—'}
          </div>
          <div className="text-right font-condensed text-xl font-semibold tabular-nums text-zinc-400">
            {opp.total ?? '—'}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-[1fr_5rem_5rem] items-center gap-x-3 gap-y-2 text-sm">
          {TYPE_LABELS.map(([key, label]) => (
            <Row key={key} label={label} forVal={bgm[key]} againstVal={opp[key]} />
          ))}
        </div>
      </Panel>
    </section>
  )
}

function TotalLabel() {
  return (
    <div className="font-condensed text-[12px] font-bold uppercase tracking-widest text-zinc-200">
      Total
    </div>
  )
}

function Row({
  label,
  forVal,
  againstVal,
}: {
  label: string
  forVal: number | null
  againstVal: number | null
}) {
  return (
    <>
      <div className="font-condensed text-xs uppercase tracking-widest text-zinc-400">
        {label}
      </div>
      <div className="text-right tabular-nums text-zinc-200">{forVal ?? '—'}</div>
      <div className="text-right tabular-nums text-zinc-500">{againstVal ?? '—'}</div>
    </>
  )
}

function aggForSide(rows: MatchShotTypeSummaryRow[], side: 'for' | 'against'): SideStats {
  const sideRows = rows.filter((r) => r.teamSide === side)
  const fullGame = sideRows.find((r) => r.periodNumber === -1)
  if (fullGame) {
    return {
      total: fullGame.totalShots,
      wrist: fullGame.wristShots,
      slap: fullGame.slapShots,
      backhand: fullGame.backhandShots,
      snap: fullGame.snapShots,
      deflections: fullGame.deflections,
      powerPlay: fullGame.powerPlayShots,
    }
  }
  const sum = (key: keyof SideStats) =>
    sideRows.reduce<number | null>((acc, r) => {
      const fieldKey = SIDE_TO_ROW_KEY[key]
      const v = r[fieldKey] as number | null
      if (v === null) return acc
      return (acc ?? 0) + v
    }, null)
  return {
    total: sum('total'),
    wrist: sum('wrist'),
    slap: sum('slap'),
    backhand: sum('backhand'),
    snap: sum('snap'),
    deflections: sum('deflections'),
    powerPlay: sum('powerPlay'),
  }
}

const SIDE_TO_ROW_KEY: Record<keyof SideStats, keyof MatchShotTypeSummaryRow> = {
  total: 'totalShots',
  wrist: 'wristShots',
  slap: 'slapShots',
  backhand: 'backhandShots',
  snap: 'snapShots',
  deflections: 'deflections',
  powerPlay: 'powerPlayShots',
}

/**
 * "Most BGM shots: Wrist · Most OPP shots: Slap" — skipped when totals are
 * tied at zero, or when no shot-type buckets have data.
 */
function buildSubtitle(bgm: SideStats, opp: SideStats): string | null {
  const bgmLeader = leadingType(bgm)
  const oppLeader = leadingType(opp)
  if (!bgmLeader && !oppLeader) return null
  const parts: string[] = []
  if (bgmLeader) parts.push(`Most BGM shots: ${bgmLeader}`)
  if (oppLeader) parts.push(`Most OPP shots: ${oppLeader}`)
  return parts.join(' · ')
}

function leadingType(side: SideStats): string | null {
  let best: { label: string; value: number } | null = null
  for (const [key, label] of TYPE_LABELS) {
    const v = side[key]
    if (v === null || v <= 0) continue
    if (best === null || v > best.value) best = { label, value: v }
  }
  return best?.label ?? null
}
