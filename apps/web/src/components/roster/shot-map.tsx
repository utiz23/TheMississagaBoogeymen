'use client'

import { useState, useMemo } from 'react'
import type { ShotLocations } from '@eanhl/db'
import {
  EA_ICE_INDEX_TO_ZONE,
  EA_NET_INDEX_TO_ZONE,
  ICE_ZONE_SHAPES,
  NET_ZONE_SHAPES,
  HALF_RINK_OUTLINE,
} from './shot-map-zones'
import {
  deviationColor,
  shootingPctColor,
} from '@/lib/shot-map-colors'

type View = 'ice' | 'net'
type Mode = 'shots' | 'goals' | 'shootingPct'

interface Props {
  player: ShotLocations | null
  teamAverage: ShotLocations
  hasData: boolean
}

export function ShotMap({ player, teamAverage, hasData }: Props) {
  const [view, setView] = useState<View>('ice')
  const [mode, setMode] = useState<Mode>('shots')

  return (
    <section className="border border-zinc-800 bg-surface p-4">
      <header className="mb-3 flex items-center justify-between">
        <h3 className="font-condensed text-xs font-bold uppercase tracking-[0.2em] text-zinc-100">
          Shot Map · NHL 26
        </h3>
        <ModeTabs mode={mode} onChange={setMode} disabled={!hasData} />
      </header>

      {hasData && player ? (
        <>
          <div className="mb-3 flex items-center gap-2">
            <ViewToggle view={view} onChange={setView} />
          </div>

          <div className="grid grid-cols-[1.4fr_1fr] gap-4">
            <div>
              {view === 'ice' ? (
                <IceMap player={player} teamAvg={teamAverage} mode={mode} />
              ) : (
                <NetMap player={player} teamAvg={teamAverage} mode={mode} />
              )}
            </div>
            <Breakdown player={player} view={view} mode={mode} />
          </div>

          <Legend mode={mode} />
        </>
      ) : (
        <p className="py-8 text-center text-[12px] text-zinc-500">
          Shot location data is only collected for{' '}
          <span className="font-bold text-zinc-200">NHL 26</span>.
        </p>
      )}
    </section>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────

function ModeTabs({
  mode,
  onChange,
  disabled,
}: {
  mode: Mode
  onChange: (m: Mode) => void
  disabled: boolean
}) {
  const tabs: { id: Mode; label: string }[] = [
    { id: 'shots', label: 'SOG' },
    { id: 'goals', label: 'G' },
    { id: 'shootingPct', label: 'S%' },
  ]
  return (
    <div className="flex gap-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          disabled={disabled}
          onClick={() => { onChange(t.id) }}
          className={`font-condensed text-[10px] font-bold uppercase tracking-widest px-2 py-1 ${
            mode === t.id
              ? 'bg-[#c34353] text-white'
              : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200'
          } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function ViewToggle({
  view,
  onChange,
}: {
  view: View
  onChange: (v: View) => void
}) {
  return (
    <div className="inline-flex gap-1">
      {(['ice', 'net'] as View[]).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => { onChange(v) }}
          className={`font-condensed text-[10px] font-bold uppercase tracking-widest px-2 py-1 ${
            view === v ? 'bg-zinc-200 text-zinc-900' : 'bg-zinc-800 text-zinc-400'
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  )
}

function IceMap({
  player,
  teamAvg,
  mode,
}: {
  player: ShotLocations
  teamAvg: ShotLocations
  mode: Mode
}) {
  const range = useMemo(() => playerPctRange(player.shotsIce, player.goalsIce), [player])

  return (
    <svg viewBox="0 0 200 180" className="w-full">
      {/* backdrop — goal line at top (y=0), blue line at bottom (y=180) */}
      <path d={HALF_RINK_OUTLINE} fill="#1f1f23" stroke="#3f3f46" strokeWidth="0.6" />

      {Object.entries(EA_ICE_INDEX_TO_ZONE).map(([idxStr, zoneId]) => {
        const i = Number(idxStr) - 1
        const shape = ICE_ZONE_SHAPES[zoneId]
        const playerShots = player.shotsIce[i] ?? 0
        const playerGoals = player.goalsIce[i] ?? 0
        const teamShots = teamAvg.shotsIce[i] ?? 0
        const teamGoals = teamAvg.goalsIce[i] ?? 0

        let fill: string
        if (mode === 'shots') fill = deviationColor(playerShots, teamShots)
        else if (mode === 'goals') fill = deviationColor(playerGoals, teamGoals)
        else fill = shootingPctColor(playerShots, playerGoals, range.min, range.max)

        const tooltip = buildTooltip(mode, playerShots, playerGoals, teamShots, teamGoals)

        return (
          <g key={zoneId}>
            <path d={shape.d} fill={fill} stroke="#3f3f46" strokeWidth="0.4" data-zone={zoneId}>
              <title>{tooltip}</title>
            </path>
          </g>
        )
      })}
    </svg>
  )
}

function NetMap({
  player,
  teamAvg,
  mode,
}: {
  player: ShotLocations
  teamAvg: ShotLocations
  mode: Mode
}) {
  const range = useMemo(() => playerPctRange(player.shotsNet, player.goalsNet), [player])

  return (
    <svg viewBox="0 0 100 60" className="w-full">
      {Object.entries(EA_NET_INDEX_TO_ZONE).map(([idxStr, zoneId]) => {
        const i = Number(idxStr) - 1
        const shape = NET_ZONE_SHAPES[zoneId]
        const playerShots = player.shotsNet[i] ?? 0
        const playerGoals = player.goalsNet[i] ?? 0
        const teamShots = teamAvg.shotsNet[i] ?? 0
        const teamGoals = teamAvg.goalsNet[i] ?? 0

        let fill: string
        if (mode === 'shots') fill = deviationColor(playerShots, teamShots)
        else if (mode === 'goals') fill = deviationColor(playerGoals, teamGoals)
        else fill = shootingPctColor(playerShots, playerGoals, range.min, range.max)

        const tooltip = buildTooltip(mode, playerShots, playerGoals, teamShots, teamGoals)

        return (
          <rect
            key={zoneId}
            x={shape.x}
            y={shape.y}
            width={shape.w}
            height={shape.h}
            fill={fill}
            stroke="#c34353"
            strokeWidth="0.5"
            data-zone={zoneId}
          >
            <title>{tooltip}</title>
          </rect>
        )
      })}
    </svg>
  )
}

function Breakdown({
  player,
  view,
  mode,
}: {
  player: ShotLocations
  view: View
  mode: Mode
}) {
  if (view === 'ice') {
    const arr = mode === 'goals' ? player.goalsIce : player.shotsIce
    const total = arr.reduce((a, b) => a + b, 0)
    let high = 0
    let mid = 0
    let long = 0
    for (const [idxStr, zoneId] of Object.entries(EA_ICE_INDEX_TO_ZONE)) {
      const i = Number(idxStr) - 1
      const band = ICE_ZONE_SHAPES[zoneId].band
      const v = arr[i] ?? 0
      if (band === 'high_danger') high += v
      else if (band === 'long_range') long += v
      else mid += v
    }
    return (
      <ul className="space-y-3 font-condensed text-zinc-300">
        <BreakdownRow label="All locations" value={total} emphasize />
        <BreakdownRow label="High danger" value={high} />
        <BreakdownRow label="Mid range" value={mid} />
        <BreakdownRow label="Long range" value={long} />
      </ul>
    )
  }

  // Net view: upper / lower / 5-hole
  const arr = mode === 'goals' ? player.goalsNet : player.shotsNet
  const total = arr.reduce((a, b) => a + b, 0)
  const upper = (arr[0] ?? 0) + (arr[1] ?? 0)
  const lower = (arr[2] ?? 0) + (arr[3] ?? 0)
  const fiveHole = arr[4] ?? 0
  return (
    <ul className="space-y-3 font-condensed text-zinc-300">
      <BreakdownRow label="All on-net" value={total} emphasize />
      <BreakdownRow label="Upper" value={upper} />
      <BreakdownRow label="Lower" value={lower} />
      <BreakdownRow label="Five hole" value={fiveHole} />
    </ul>
  )
}

function BreakdownRow({
  label,
  value,
  emphasize = false,
}: {
  label: string
  value: number
  emphasize?: boolean
}) {
  return (
    <li>
      <div
        className={
          emphasize ? 'text-xl font-extrabold text-zinc-50' : 'text-base font-bold text-zinc-200'
        }
      >
        {Math.round(value)}
      </div>
      <div className="text-[9px] uppercase tracking-widest text-zinc-500">{label}</div>
    </li>
  )
}

function Legend({ mode }: { mode: Mode }) {
  if (mode === 'shootingPct') {
    return (
      <p className="mt-3 text-[9px] uppercase tracking-widest text-zinc-500">
        Cool · cold · hot. Zones with &lt;5 shots dimmed.
      </p>
    )
  }
  return (
    <p className="mt-3 text-[9px] uppercase tracking-widest text-zinc-500">
      <span style={{ color: '#656cbe' }}>▌ below team avg</span>
      <span className="mx-2">·</span>
      <span className="text-zinc-500">▍ at avg</span>
      <span className="mx-2">·</span>
      <span style={{ color: '#c34353' }}>▎ above</span>
    </p>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function playerPctRange(shots: number[], goals: number[]) {
  let min = 1
  let max = 0
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i] ?? 0
    if (s < 5) continue
    const pct = (goals[i] ?? 0) / s
    if (pct < min) min = pct
    if (pct > max) max = pct
  }
  if (max === 0) {
    min = 0
    max = 1
  }
  return { min, max }
}

function buildTooltip(
  mode: Mode,
  pShots: number,
  pGoals: number,
  tShots: number,
  tGoals: number,
): string {
  if (mode === 'shootingPct') {
    if (pShots < 5) return `${String(pGoals)}/${String(pShots)} (insufficient sample)`
    const pct = ((pGoals / pShots) * 100).toFixed(1)
    return `${String(pGoals)} G / ${String(pShots)} S = ${pct}%`
  }
  if (mode === 'goals') {
    return `${String(pGoals)} goals · team avg ${tGoals.toFixed(1)}`
  }
  return `${String(pShots)} shots · team avg ${tShots.toFixed(1)}`
}
