'use client'

import { useState } from 'react'
import { Panel } from '@/components/ui/panel'
import { formatWinPct } from '@/lib/format'

export interface RecordModeStats {
  gamesPlayed: number
  wins: number
  losses: number
  otl: number
  avgGoalsFor: string | null
  avgGoalsAgainst: string | null
  avgTimeOnAttack: string | null
  powerPlayPct: string | null
  powerPlayKillPct: string | null
}

export interface TitleRecordData {
  name: string
  slug: string
  isLive: boolean
  all: RecordModeStats | null
  sixs: RecordModeStats | null
  sixsg: RecordModeStats | null
  threes: RecordModeStats | null
}

type RecordMode = 'all' | '6s' | '6sg' | '3s'

const MODE_LABELS: { mode: RecordMode; label: string }[] = [
  { mode: 'all', label: 'All' },
  { mode: '6s', label: '6s' },
  { mode: '6sg', label: '6s+G' },
  { mode: '3s', label: '3s' },
]

function fmt(val: string | null): string {
  return val ?? '—'
}

function fmtPct(val: string | null): string {
  return val !== null ? `${val}%` : '—'
}

function getModeStats(title: TitleRecordData, mode: RecordMode): RecordModeStats | null {
  switch (mode) {
    case 'all':
      return title.all
    case '6s':
      return title.sixs
    case '6sg':
      return title.sixsg
    case '3s':
      return title.threes
  }
}

export function TitleRecordsTable({ titles }: { titles: TitleRecordData[] }) {
  const [mode, setMode] = useState<RecordMode>('all')
  // PP% / PK% can't be combined across playlists (no opportunity counts), so
  // "All" leaves those columns out instead of a column of dashes.
  const showSpecialTeams = mode !== 'all'
  const statCols = showSpecialTeams ? 10 : 8

  return (
    <div className="space-y-3">
      {/* Mode pill selector */}
      <div className="flex gap-1.5">
        {MODE_LABELS.map(({ mode: m, label }) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m)
            }}
            className={[
              'rounded border px-3 py-1 font-condensed text-xs font-semibold uppercase tracking-wider transition-colors',
              mode === m
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-zinc-700 bg-transparent text-zinc-500 hover:border-zinc-500 hover:text-zinc-300',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Comparison table */}
      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              <th scope="col" className="sticky left-0 z-10 bg-surface px-4 py-2 text-left">
                Title
              </th>
              <th className="px-3 py-2">GP</th>
              <th className="px-3 py-2 text-accent">W</th>
              <th className="px-3 py-2">L</th>
              <th className="px-3 py-2">OTL</th>
              <th className="px-3 py-2">W%</th>
              <th className="px-3 py-2">GF/G</th>
              <th className="px-3 py-2">GA/G</th>
              <th className="px-3 py-2">TOA</th>
              {showSpecialTeams && (
                <>
                  <th className="px-3 py-2">PP%</th>
                  <th className="px-3 py-2">PK%</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {titles.map((title) => {
              const s = getModeStats(title, mode)
              return (
                <tr key={title.slug} className={title.isLive ? 'bg-accent/5' : 'bg-surface'}>
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 px-4 py-3 text-left font-normal ${title.isLive ? 'bg-[color-mix(in_srgb,var(--color-accent)_5%,var(--color-surface))]' : 'bg-surface'}`}
                  >
                    <span
                      className={`font-condensed text-sm font-semibold ${title.isLive ? 'text-accent' : 'text-zinc-300'}`}
                    >
                      {title.name}
                    </span>
                    {title.isLive && (
                      <span className="ml-2 border border-accent/40 bg-accent/15 px-1 py-0.5 font-condensed text-[10px] font-bold uppercase tracking-wider text-accent/80">
                        live
                      </span>
                    )}
                  </th>
                  {s === null ? (
                    Array.from({ length: statCols }, (_, i) => (
                      <td key={i} className="px-3 py-3 text-right text-zinc-700">
                        —
                      </td>
                    ))
                  ) : (
                    <>
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-400">
                        {s.gamesPlayed}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums font-semibold text-accent">
                        {s.wins}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-400">
                        {s.losses}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-500">{s.otl}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-300">
                        {formatWinPct(s.wins, s.wins + s.losses + s.otl)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-300">
                        {fmt(s.avgGoalsFor)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-400">
                        {fmt(s.avgGoalsAgainst)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-400">
                        {fmt(s.avgTimeOnAttack)}
                      </td>
                      {showSpecialTeams && (
                        <>
                          <td className="px-3 py-3 text-right tabular-nums text-zinc-400">
                            {fmtPct(s.powerPlayPct)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-zinc-400">
                            {fmtPct(s.powerPlayKillPct)}
                          </td>
                        </>
                      )}
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </Panel>
    </div>
  )
}
