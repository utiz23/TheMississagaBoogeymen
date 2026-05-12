import type { BoxScoreGroup, BoxScoreRow } from '@/lib/match-recap'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'

interface TeamStatsProps {
  rows: BoxScoreGroup[]
}

export function TeamStats({ rows }: TeamStatsProps) {
  if (rows.length === 0) return null

  return (
    <section className="space-y-3">
      <SectionHeader label="Box Score" subtitle="Team totals and aggregate stats" />
      <Panel className="px-4 py-4">
        {/* Side labels */}
        <div className="mb-3 grid grid-cols-[5rem_1fr_5rem] items-center gap-3">
          <span className="text-right font-condensed text-xs font-bold uppercase tracking-widest text-accent">
            BGM
          </span>
          <span />
          <span className="text-left font-condensed text-xs font-bold uppercase tracking-widest text-zinc-500">
            OPP
          </span>
        </div>
        <div className="space-y-5">
          {rows.map((group) => (
            <Group key={group.title} group={group} />
          ))}
        </div>
      </Panel>
    </section>
  )
}

function Group({ group }: { group: BoxScoreGroup }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-4">
        <div className="h-px flex-1 bg-zinc-800" />
        <h3 className="font-condensed text-xs font-bold uppercase tracking-[0.22em] text-zinc-300">
          {group.title}
        </h3>
        <div className="h-px flex-1 bg-zinc-800" />
      </div>
      {group.placeholder ? (
        <div className="rounded-sm border border-dashed border-zinc-800/80 bg-zinc-950/30 px-3 py-3 text-center text-xs uppercase tracking-[0.16em] text-zinc-600">
          Ratings are reserved for later extraction / derivation
        </div>
      ) : (
        <div className="space-y-0">
          {group.rows.map((row, i) => (
            <Row key={row.label} row={row} isLast={i === group.rows.length - 1} />
          ))}
        </div>
      )}
      {group.footnote ? (
        <p className="pt-1 text-[10px] leading-snug text-zinc-500">{group.footnote}</p>
      ) : null}
    </div>
  )
}

function Row({ row, isLast }: { row: BoxScoreRow; isLast: boolean }) {
  return (
    <div className={`space-y-2 py-2.5 ${isLast ? '' : 'border-b border-zinc-800/60'}`}>
      <div className="grid grid-cols-[5rem_1fr_5rem] items-center gap-3">
        <span className="text-right font-condensed text-xl font-bold tabular-nums text-accent">
          {row.us}
        </span>
        <span className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
          {row.label}
        </span>
        <span className="text-left font-condensed text-xl font-bold tabular-nums text-zinc-400">
          {row.them ?? '—'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${barWidth(row.us, row.them).toString()}%` }}
          />
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-zinc-500"
            style={{ width: `${barWidth(row.them, row.us).toString()}%` }}
          />
        </div>
      </div>
    </div>
  )
}

function barWidth(value: string | null, other: string | null): number {
  const ours = parseStat(value)
  const theirs = parseStat(other)
  const max = Math.max(ours, theirs, 1)
  return Math.max(0, Math.min(100, (ours / max) * 100))
}

function parseStat(value: string | null): number {
  if (!value) return 0
  if (value.includes('/')) return parseFloat(value.split('/')[0] ?? '0') || 0
  if (value.includes(':')) {
    const [m, s] = value.split(':')
    return parseInt(m ?? '0', 10) * 60 + (parseInt(s ?? '0', 10) || 0)
  }
  const cleaned = value.replace('%', '')
  const parsed = parseFloat(cleaned)
  if (Number.isNaN(parsed)) return 0
  return parsed
}
