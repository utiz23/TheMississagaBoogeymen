'use client'

import { useState } from 'react'
import type { ShotLocations } from '@eanhl/db'
import { EA_ICE_INDEX_TO_ZONE, ICE_ZONE_SHAPES } from '@/components/roster/shot-map-zones'
import type { IceZoneId, NetZoneId } from '@/components/roster/shot-map-zones'
import { IceMapSvg, NetMapSvg } from '@/components/roster/shot-map-renderer'
import { volumeColor, shootingPctColor } from '@/lib/shot-map-colors'
import { BroadcastPanel } from '@/components/ui/broadcast-panel'
import { SectionHeader } from '@/components/ui/section-header'

type View = 'ice' | 'net'
type Mode = 'shots' | 'goals' | 'shootingPct'

interface Props {
  aggregates: ShotLocations
  hasData: boolean
}

export function TeamShotMap({ aggregates, hasData }: Props) {
  const [view, setView] = useState<View>('ice')
  const [mode, setMode] = useState<Mode>('shots')

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SectionHeader label="Team Shot Map" subtitle="All modes · NHL 26" />
        <ModeTabs mode={mode} onChange={setMode} disabled={!hasData} />
      </div>
      <BroadcastPanel className="p-4">
      {hasData ? (
        <>
          <div className="mb-3">
            <ViewToggle view={view} onChange={setView} />
          </div>

          <div className="flex items-start gap-10">
            <div className="w-[360px] flex-shrink-0">
              {view === 'ice' ? (
                <IceView aggregates={aggregates} mode={mode} />
              ) : (
                <NetView aggregates={aggregates} mode={mode} />
              )}
            </div>
            <div className="flex-shrink-0 pt-2">
              <Breakdown aggregates={aggregates} view={view} mode={mode} />
            </div>
          </div>

          <Legend mode={mode} />
        </>
      ) : (
        <p className="py-8 text-center font-condensed text-[12px] uppercase tracking-wider text-zinc-500">
          Shot location data is only collected for{' '}
          <span className="font-bold text-zinc-200">NHL 26</span>.
        </p>
      )}
      </BroadcastPanel>
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
          onClick={() => {
            onChange(t.id)
          }}
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

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="inline-flex gap-1">
      {(['ice', 'net'] as View[]).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => {
            onChange(v)
          }}
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

function IceView({ aggregates, mode }: { aggregates: ShotLocations; mode: Mode }) {
  const arr = mode === 'goals' ? aggregates.goalsIce : aggregates.shotsIce
  const min = Math.min(...arr)
  const max = Math.max(...arr)
  const pctRange = pctMinMax(aggregates.shotsIce, aggregates.goalsIce)

  const getZoneFill = (_: IceZoneId, i: number): string => {
    const shots = aggregates.shotsIce[i] ?? 0
    const goals = aggregates.goalsIce[i] ?? 0
    if (mode === 'shootingPct') return shootingPctColor(shots, goals, pctRange.min, pctRange.max)
    return volumeColor(arr[i] ?? 0, min, max)
  }

  const getZoneTooltip = (_: IceZoneId, i: number): string => {
    const shots = aggregates.shotsIce[i] ?? 0
    const goals = aggregates.goalsIce[i] ?? 0
    return buildTooltip(mode, shots, goals)
  }

  return <IceMapSvg idPrefix="team" getZoneFill={getZoneFill} getZoneTooltip={getZoneTooltip} />
}

function NetView({ aggregates, mode }: { aggregates: ShotLocations; mode: Mode }) {
  const arr = mode === 'goals' ? aggregates.goalsNet : aggregates.shotsNet
  const min = Math.min(...arr)
  const max = Math.max(...arr)
  const pctRange = pctMinMax(aggregates.shotsNet, aggregates.goalsNet)

  const getZoneFill = (_: NetZoneId, i: number): string => {
    const shots = aggregates.shotsNet[i] ?? 0
    const goals = aggregates.goalsNet[i] ?? 0
    if (mode === 'shootingPct') return shootingPctColor(shots, goals, pctRange.min, pctRange.max)
    return volumeColor(arr[i] ?? 0, min, max)
  }

  const getZoneTooltip = (_: NetZoneId, i: number): string => {
    const shots = aggregates.shotsNet[i] ?? 0
    const goals = aggregates.goalsNet[i] ?? 0
    return buildTooltip(mode, shots, goals)
  }

  return <NetMapSvg idPrefix="team" getZoneFill={getZoneFill} getZoneTooltip={getZoneTooltip} />
}

function Breakdown({
  aggregates,
  view,
  mode,
}: {
  aggregates: ShotLocations
  view: View
  mode: Mode
}) {
  if (view === 'ice') {
    const arr = mode === 'goals' ? aggregates.goalsIce : aggregates.shotsIce
    const total = arr.reduce((a, b) => a + b, 0)
    let high = 0,
      mid = 0,
      low = 0

    for (const [idxStr, zoneId] of Object.entries(EA_ICE_INDEX_TO_ZONE)) {
      const i = Number(idxStr) - 1
      const band = ICE_ZONE_SHAPES[zoneId].band
      const v = arr[i] ?? 0
      if (band === 'high_danger') high += v
      else if (band === 'long_range') low += v
      else mid += v
    }

    return (
      <ul className="space-y-5 font-condensed">
        <TotalRow label="All locations" value={total} />
        <TotalRow label="High danger" value={high} />
        <TotalRow label="Mid range" value={mid} />
        <TotalRow label="Long range" value={low} />
      </ul>
    )
  }

  const arr = mode === 'goals' ? aggregates.goalsNet : aggregates.shotsNet
  return (
    <ul className="space-y-5 font-condensed">
      <TotalRow label="All on-net" value={arr.reduce((a, b) => a + b, 0)} />
      <TotalRow label="Upper" value={(arr[0] ?? 0) + (arr[1] ?? 0)} />
      <TotalRow label="Lower" value={(arr[2] ?? 0) + (arr[3] ?? 0)} />
      <TotalRow label="Five hole" value={arr[4] ?? 0} />
    </ul>
  )
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <li>
      <div className="text-3xl font-black text-zinc-50">{Math.round(value)}</div>
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
      Darker = fewer · Brighter = more
    </p>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function pctMinMax(shots: number[], goals: number[]) {
  let min = 1,
    max = 0
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

function buildTooltip(mode: Mode, shots: number, goals: number): string {
  if (mode === 'shootingPct') {
    if (shots < 5) return `${String(goals)}/${String(shots)} (insufficient sample)`
    return `${String(goals)} G / ${String(shots)} S = ${((goals / shots) * 100).toFixed(1)}%`
  }
  if (mode === 'goals') return `${String(goals)} goals`
  return `${String(shots)} shots`
}
