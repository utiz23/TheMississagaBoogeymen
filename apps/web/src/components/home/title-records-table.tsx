'use client'

import { useState } from 'react'

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

function winPct(wins: number, losses: number, otl: number): string {
  const total = wins + losses + otl
  if (total === 0) return '—'
  return ((wins / total) * 100).toFixed(1) + '%'
}

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

  return (
    <div className="space-y-3">
      {/* Mode pill selector */}
      <div className="flex gap-1.5">
        {MODE_LABELS.map(({ mode: m, label }) => (
          <button
            key={m}
            onClick={() => { setMode(m) }}
            className={[
              'rounded border px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors',
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
      <div className="overflow-x-auto border border-zinc-800">
        <table className="w-full min-w-[620px] text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-right text-[10px] uppercase tracking-wider text-zinc-600">
              <th className="px-4 py-2 text-left font-medium">Title</th>
              <th className="px-3 py-2 font-medium">GP</th>
              <th className="px-3 py-2 font-medium text-accent">W</th>
              <th className="px-3 py-2 font-medium">L</th>
              <th className="px-3 py-2 font-medium">OTL</th>
              <th className="px-3 py-2 font-medium">W%</th>
              <th className="px-3 py-2 font-medium">GF/G</th>
              <th className="px-3 py-2 font-medium">GA/G</th>
              <th className="px-3 py-2 font-medium">TOA</th>
              <th className="px-3 py-2 font-medium">PP%</th>
              <th className="px-3 py-2 font-medium">PK%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/50">
            {titles.map((title) => {
              const s = getModeStats(title, mode)
              return (
                <tr
                  key={title.slug}
                  className={title.isLive ? 'bg-accent/5' : 'bg-surface'}
                >
                  <td className="px-4 py-3">
                    <span
                      className={`font-condensed text-sm font-semibold ${title.isLive ? 'text-accent' : 'text-zinc-300'}`}
                    >
                      {title.name}
                    </span>
                    {title.isLive && (
                      <span className="ml-2 rounded bg-accent/15 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent/70">
                        live
                      </span>
                    )}
                  </td>
                  {s === null ? (
                    Array.from({ length: 10 }, (_, i) => (
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
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-400">{s.losses}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-500">{s.otl}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-300">
                        {winPct(s.wins, s.losses, s.otl)}
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
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-400">
                        {fmtPct(s.powerPlayPct)}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-400">
                        {fmtPct(s.powerPlayKillPct)}
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
