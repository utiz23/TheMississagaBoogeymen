'use client'

import { useState } from 'react'
import type { ShotLocations } from '@eanhl/db'
import { EA_ICE_INDEX_TO_ZONE, ICE_ZONE_SHAPES } from './shot-map-zones'
import { IceMapSvg, NetMapSvg } from './shot-map-renderer'
import { deviationColor, shootingPctColor } from '@/lib/shot-map-colors'

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
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-condensed text-xs font-bold uppercase tracking-[0.2em] text-zinc-100">
          Shot Map · NHL 26
        </h3>
        <ModeTabs mode={mode} onChange={setMode} disabled={!hasData} />
      </div>

      {hasData && player ? (
        <>
          <div className="mb-3">
            <ViewToggle view={view} onChange={setView} />
          </div>

          {/* Map (fixed 360px) + NHL-EDGE-style stat panel beside it */}
          <div className="flex items-start gap-10">
            <div className="w-[360px] flex-shrink-0">
              {view === 'ice' ? (
                <IceMap player={player} teamAvg={teamAverage} mode={mode} />
              ) : (
                <NetMap player={player} teamAvg={teamAverage} mode={mode} />
              )}
            </div>
            <div className="flex-shrink-0 pt-2">
              <Breakdown player={player} teamAverage={teamAverage} view={view} mode={mode} />
            </div>
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
  const range = playerPctRange(player.shotsIce, player.goalsIce)

  return (
    <IceMapSvg
      idPrefix="player"
      getZoneFill={(_, i) => {
        const playerShots = player.shotsIce[i] ?? 0
        const playerGoals = player.goalsIce[i] ?? 0
        const teamShots = teamAvg.shotsIce[i] ?? 0
        const teamGoals = teamAvg.goalsIce[i] ?? 0
        if (mode === 'shots') return deviationColor(playerShots, teamShots)
        if (mode === 'goals') return deviationColor(playerGoals, teamGoals)
        return shootingPctColor(playerShots, playerGoals, range.min, range.max)
      }}
      getZoneTooltip={(_, i) => {
        const playerShots = player.shotsIce[i] ?? 0
        const playerGoals = player.goalsIce[i] ?? 0
        const teamShots = teamAvg.shotsIce[i] ?? 0
        const teamGoals = teamAvg.goalsIce[i] ?? 0
        return buildTooltip(mode, playerShots, playerGoals, teamShots, teamGoals)
      }}
    />
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
  const range = playerPctRange(player.shotsNet, player.goalsNet)

  return (
    <NetMapSvg
      idPrefix="player"
      getZoneFill={(_, i) => {
        const playerShots = player.shotsNet[i] ?? 0
        const playerGoals = player.goalsNet[i] ?? 0
        const teamShots = teamAvg.shotsNet[i] ?? 0
        const teamGoals = teamAvg.goalsNet[i] ?? 0
        if (mode === 'shots') return deviationColor(playerShots, teamShots)
        if (mode === 'goals') return deviationColor(playerGoals, teamGoals)
        return shootingPctColor(playerShots, playerGoals, range.min, range.max)
      }}
      getZoneTooltip={(_, i) => {
        const playerShots = player.shotsNet[i] ?? 0
        const playerGoals = player.goalsNet[i] ?? 0
        const teamShots = teamAvg.shotsNet[i] ?? 0
        const teamGoals = teamAvg.goalsNet[i] ?? 0
        return buildTooltip(mode, playerShots, playerGoals, teamShots, teamGoals)
      }}
    />
  )
}

/**
 * NHL-EDGE-style breakdown: player count (large) + team avg (small, grey) per band.
 */
function Breakdown({
  player,
  teamAverage,
  view,
  mode,
}: {
  player: ShotLocations
  teamAverage: ShotLocations
  view: View
  mode: Mode
}) {
  if (view === 'ice') {
    const pArr = mode === 'goals' ? player.goalsIce : player.shotsIce
    const tArr = mode === 'goals' ? teamAverage.goalsIce : teamAverage.shotsIce

    const pTotal = pArr.reduce((a, b) => a + b, 0)
    const tTotal = tArr.reduce((a, b) => a + b, 0)
    let pH = 0, pM = 0, pL = 0
    let tH = 0, tM = 0, tL = 0

    for (const [idxStr, zoneId] of Object.entries(EA_ICE_INDEX_TO_ZONE)) {
      const i = Number(idxStr) - 1
      const band = ICE_ZONE_SHAPES[zoneId].band
      const pv = pArr[i] ?? 0
      const tv = tArr[i] ?? 0
      if (band === 'high_danger') { pH += pv; tH += tv }
      else if (band === 'long_range') { pL += pv; tL += tv }
      else { pM += pv; tM += tv }
    }

    return (
      <ul className="space-y-5 font-condensed">
        <BreakdownRow label="All locations" player={pTotal} avg={tTotal} />
        <BreakdownRow label="High danger"   player={pH}     avg={tH} />
        <BreakdownRow label="Mid range"     player={pM}     avg={tM} />
        <BreakdownRow label="Long range"    player={pL}     avg={tL} />
      </ul>
    )
  }

  // Net view
  const pArr = mode === 'goals' ? player.goalsNet : player.shotsNet
  const tArr = mode === 'goals' ? teamAverage.goalsNet : teamAverage.shotsNet
  const pTotal = pArr.reduce((a, b) => a + b, 0)
  const tTotal = tArr.reduce((a, b) => a + b, 0)
  const pUpper = (pArr[0] ?? 0) + (pArr[1] ?? 0)
  const tUpper = (tArr[0] ?? 0) + (tArr[1] ?? 0)
  const pLower = (pArr[2] ?? 0) + (pArr[3] ?? 0)
  const tLower = (tArr[2] ?? 0) + (tArr[3] ?? 0)
  const pFive = pArr[4] ?? 0
  const tFive = tArr[4] ?? 0

  return (
    <ul className="space-y-5 font-condensed">
      <BreakdownRow label="All on-net"  player={pTotal}  avg={tTotal} />
      <BreakdownRow label="Upper"       player={pUpper}  avg={tUpper} />
      <BreakdownRow label="Lower"       player={pLower}  avg={tLower} />
      <BreakdownRow label="Five hole"   player={pFive}   avg={tFive} />
    </ul>
  )
}

function BreakdownRow({
  label,
  player,
  avg,
}: {
  label: string
  player: number
  avg: number
}) {
  return (
    <li>
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-black text-zinc-50">{Math.round(player)}</span>
        <span className="text-xl font-bold text-zinc-500">{Math.round(avg)}</span>
      </div>
      <div className="mt-0.5 text-[9px] uppercase tracking-widest text-zinc-500">{label}</div>
    </li>
  )
}

function Legend({ mode }: { mode: Mode }) {
  if (mode === 'shootingPct') {
    return (
      <p className="mt-3 text-[9px] uppercase tracking-widest text-zinc-500">
        Cold · cool · hot &middot; Zones with &lt;5 shots dimmed.
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
  if (max === 0) { min = 0; max = 1 }
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
    return `${String(pGoals)} goals · team avg ${tGoals.toFixed(1)} · ${formatDelta(pGoals, tGoals)}`
  }
  return `${String(pShots)} shots · team avg ${tShots.toFixed(1)} · ${formatDelta(pShots, tShots)}`
}

function formatDelta(playerCount: number, teamAvg: number): string {
  if (teamAvg === 0) return playerCount === 0 ? '0%' : '+∞%'
  const pct = ((playerCount - teamAvg) / teamAvg) * 100
  const rounded = Math.round(pct)
  if (rounded > 0) return `+${String(rounded)}%`
  return `${String(rounded)}%`
}
