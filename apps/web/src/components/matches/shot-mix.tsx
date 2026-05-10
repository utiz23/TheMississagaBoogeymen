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

/**
 * Per-side shot-type breakdown. Aggregates per-period rows into one row per
 * side; if a full-game aggregate row (period_number = -1) exists, prefer it.
 */
export function ShotMix({ rows }: ShotMixProps) {
  if (rows.length === 0) return null

  const aggForSide = (side: 'for' | 'against'): SideStats => {
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
    // No full-game row — sum the per-period rows.
    const sum = (key: keyof SideStats) =>
      sideRows.reduce<number | null>((acc, r) => {
        const v = r[key as keyof MatchShotTypeSummaryRow] as number | null
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

  const bgm = aggForSide('for')
  const opp = aggForSide('against')

  if (
    bgm.total === null &&
    opp.total === null &&
    bgm.snap === null &&
    opp.snap === null
  ) {
    return null
  }

  return (
    <section className="space-y-3">
      <SectionHeader label="Shot Mix" subtitle="Shot type breakdown — OCR-derived" />
      <Panel className="px-4 py-4">
        <div className="grid grid-cols-[1fr_5rem_5rem] items-center gap-x-3 gap-y-2 text-sm">
          <div />
          <div className="text-right font-condensed text-[11px] font-bold uppercase tracking-widest text-accent">
            BGM
          </div>
          <div className="text-right font-condensed text-[11px] font-bold uppercase tracking-widest text-zinc-500">
            OPP
          </div>

          <Row label="Total" forVal={bgm.total} againstVal={opp.total} bold />
          <Row label="Wrist" forVal={bgm.wrist} againstVal={opp.wrist} />
          <Row label="Snap" forVal={bgm.snap} againstVal={opp.snap} />
          <Row label="Backhand" forVal={bgm.backhand} againstVal={opp.backhand} />
          <Row label="Slap" forVal={bgm.slap} againstVal={opp.slap} />
          <Row label="Deflection" forVal={bgm.deflections} againstVal={opp.deflections} />
          <Row label="Power Play" forVal={bgm.powerPlay} againstVal={opp.powerPlay} />
        </div>
      </Panel>
    </section>
  )
}

function Row({
  label,
  forVal,
  againstVal,
  bold,
}: {
  label: string
  forVal: number | null
  againstVal: number | null
  bold?: boolean
}) {
  return (
    <>
      <div className={`font-condensed text-xs uppercase tracking-widest ${bold ? 'font-bold text-zinc-200' : 'text-zinc-400'}`}>
        {label}
      </div>
      <div className={`text-right tabular-nums ${bold ? 'font-bold text-zinc-100' : 'text-zinc-200'}`}>
        {forVal ?? '—'}
      </div>
      <div className={`text-right tabular-nums ${bold ? 'font-semibold text-zinc-300' : 'text-zinc-500'}`}>
        {againstVal ?? '—'}
      </div>
    </>
  )
}
