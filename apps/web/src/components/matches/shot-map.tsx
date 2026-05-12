'use client'

import { useState } from 'react'
import type { MatchEventRow } from '@eanhl/db/queries'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'
import { RinkSvg } from '@/components/branding/rink'
import {
  GoalMarker,
  HitMarker,
  PenaltyMarker,
  ShotMarker,
} from '@/components/branding/event-markers'

interface ShotMapProps {
  events: MatchEventRow[]
}

type FilterableType = 'goal' | 'shot' | 'hit' | 'penalty'

const ALL_TYPES: FilterableType[] = ['goal', 'shot', 'hit', 'penalty']
const TRACKED_TYPES = new Set<string>(ALL_TYPES)

/**
 * Single-match shot/event map. Plots each `match_events` row with non-null
 * (x, y) onto the proper rink illustration. Filter chips above the rink let
 * the viewer toggle event types.
 *
 * Coordinates are stored exactly as they appear in the in-game art: zones
 * stay fixed per period (BGM attacks the same side in the art that it did
 * in the real game). Teams switch ends every period, so events naturally
 * appear on different sides in different periods.
 *
 * Faceoffs are intentionally excluded — they aren't tracked on the map by
 * design (their per-period counts surface in the Period Summary instead).
 *
 * Hides itself if no positioned events exist.
 */
type PeriodFilter = 'all' | number

export function ShotMap({ events }: ShotMapProps) {
  // Only tracked event types (goals/shots/hits/penalties) participate.
  const tracked = events.filter((e) => TRACKED_TYPES.has(e.eventType))
  const positioned = tracked.filter((e) => e.x !== null && e.y !== null)

  // `useState` must come before the early return so the hook order is stable
  // across renders of the same client component (initial-data vs HMR).
  const [enabled, setEnabled] = useState<Set<FilterableType>>(new Set(ALL_TYPES))
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all')

  if (tracked.length === 0) return null

  const toggle = (t: FilterableType) => {
    setEnabled((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  // Discover which periods have positioned events.
  const periodsAvailable = Array.from(
    new Map(positioned.map((e) => [e.periodNumber, e.periodLabel])).entries(),
  ).sort(([a], [b]) => a - b)

  // Period-scoped pool drives BOTH chip counts and visible markers — counts
  // should reflect what the user can actually see under the current period
  // filter, not the match-wide total.
  const periodScoped =
    periodFilter === 'all'
      ? positioned
      : positioned.filter((e) => e.periodNumber === periodFilter)

  const counts: Record<FilterableType, number> = {
    goal: 0,
    shot: 0,
    hit: 0,
    penalty: 0,
  }
  for (const e of periodScoped) {
    if (e.eventType in counts) counts[e.eventType as FilterableType]++
  }

  const visible = periodScoped.filter((e) => {
    if (!(e.eventType in counts)) return false
    if (!enabled.has(e.eventType as FilterableType)) return false
    return true
  })

  const unpositionedCount = tracked.length - positioned.length

  return (
    <section className="space-y-3">
      <SectionHeader label="Shot Map" subtitle="Event positions on the rink — OCR-derived" />
      <Panel className="overflow-hidden px-3 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <FilterChips counts={counts} enabled={enabled} onToggle={toggle} />
          <PeriodChips
            available={periodsAvailable}
            selected={periodFilter}
            onSelect={setPeriodFilter}
          />
        </div>
        {positioned.length > 0 ? (
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_280px]">
            <div className="relative w-full">
              <RinkSvg className="block h-auto w-full" />
              <svg
                viewBox="0 0 2405 1025"
                preserveAspectRatio="xMidYMid meet"
                className="absolute inset-0 block h-auto w-full"
                aria-hidden
              >
                {visible.map((e) => (
                  <Marker key={e.id} event={e} />
                ))}
              </svg>
            </div>
            <EventList events={visible} />
          </div>
        ) : null}
        <CoverageDisclosure
          visibleOnMap={visible.length}
          positionedTotal={positioned.length}
          unpositionedTotal={unpositionedCount}
        />
      </Panel>
    </section>
  )
}

function EventList({ events }: { events: MatchEventRow[] }) {
  if (events.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center border border-zinc-900 bg-zinc-950 px-3 py-4 text-[11px] uppercase tracking-wider text-zinc-600">
        No events match
      </div>
    )
  }
  // Sort by period asc, then by clock descending in seconds (clock counts down).
  const sorted = [...events].sort((a, b) => {
    if (a.periodNumber !== b.periodNumber) return a.periodNumber - b.periodNumber
    return clockToSeconds(b.clock) - clockToSeconds(a.clock)
  })
  return (
    <div className="flex max-h-[600px] flex-col overflow-y-auto border border-zinc-900 bg-zinc-950">
      <div className="sticky top-0 z-10 border-b border-zinc-900 bg-zinc-950 px-3 py-2 font-condensed text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Events on map · {String(events.length)}
      </div>
      <ul className="divide-y divide-zinc-900">
        {sorted.map((e) => (
          <EventRow key={e.id} event={e} />
        ))}
      </ul>
    </div>
  )
}

function EventRow({ event }: { event: MatchEventRow }) {
  const isBgm = event.teamSide === 'for'
  const accent = isBgm ? 'border-l-red-700' : 'border-l-zinc-700'
  const actor =
    event.actor?.gamertag || event.actorGamertagSnapshot || 'unknown'
  const target = event.target?.gamertag || event.targetGamertagSnapshot
  const periodTag = event.periodLabel?.replace(/^RT\s+/i, '') || `P${String(event.periodNumber)}`
  return (
    <li className={`border-l-2 ${accent} px-3 py-2 text-[11px] leading-tight`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono tabular-nums text-zinc-300">{event.clock || '—'}</span>
        <span className="font-condensed text-[10px] uppercase tracking-wider text-zinc-500">
          {periodTag}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <EventTypeBadge type={event.eventType} isBgm={isBgm} />
        <span className="truncate text-zinc-200">{actor}</span>
        {target ? (
          <>
            <span className="text-zinc-600">→</span>
            <span className="truncate text-zinc-400">{target}</span>
          </>
        ) : null}
      </div>
    </li>
  )
}

function EventTypeBadge({ type, isBgm }: { type: string; isBgm: boolean }) {
  const label =
    type === 'goal' ? 'G' : type === 'shot' ? 'S' : type === 'hit' ? 'H' : type === 'penalty' ? 'P' : '?'
  return (
    <span
      className={[
        'inline-flex h-4 w-4 items-center justify-center font-condensed text-[9px] font-bold',
        isBgm ? 'bg-red-700 text-white' : 'bg-zinc-800 text-zinc-300',
      ].join(' ')}
    >
      {label}
    </span>
  )
}

function clockToSeconds(clock: string | null): number {
  if (!clock) return 0
  const [m, s] = clock.split(':')
  return Number(m) * 60 + Number(s)
}

function CoverageDisclosure({
  visibleOnMap,
  positionedTotal,
  unpositionedTotal,
}: {
  visibleOnMap: number
  positionedTotal: number
  unpositionedTotal: number
}) {
  if (positionedTotal === 0 && unpositionedTotal === 0) return null
  const filterApplied = visibleOnMap !== positionedTotal
  return (
    <p className="mt-2 px-1 text-[11px] leading-snug text-zinc-500">
      {filterApplied
        ? `${String(visibleOnMap)} marker${visibleOnMap === 1 ? '' : 's'} shown out of ${String(positionedTotal)} positioned`
        : `${String(positionedTotal)} event${positionedTotal === 1 ? '' : 's'} positioned on the rink`}
      {unpositionedTotal > 0 ? (
        <>
          {' · '}
          <span className="text-zinc-600">
            {String(unpositionedTotal)} captured but not yet placed
          </span>
        </>
      ) : null}
    </p>
  )
}

function PeriodChips({
  available,
  selected,
  onSelect,
}: {
  available: Array<[number, string]>
  selected: PeriodFilter
  onSelect: (p: PeriodFilter) => void
}) {
  if (available.length <= 1) return null // pointless filter for a single period
  const items: Array<{ key: PeriodFilter; label: string }> = [
    { key: 'all', label: 'All' },
    ...available.map(([n, label]) => ({ key: n as PeriodFilter, label: label || `P${String(n)}` })),
  ]
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((it) => {
        const isOn = it.key === selected
        return (
          <button
            key={String(it.key)}
            type="button"
            onClick={() => onSelect(it.key)}
            className={[
              'border px-2 py-1 font-condensed text-[10px] font-semibold uppercase tracking-wider transition-colors',
              isOn
                ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                : 'border-zinc-900 bg-zinc-950 text-zinc-500 hover:border-zinc-800 hover:text-zinc-300',
            ].join(' ')}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

function FilterChips({
  counts,
  enabled,
  onToggle,
}: {
  counts: Record<FilterableType, number>
  enabled: Set<FilterableType>
  onToggle: (t: FilterableType) => void
}) {
  const chips: { type: FilterableType; label: string; icon: React.ReactNode }[] = [
    { type: 'goal', label: 'Goals', icon: <GoalMarker side="home" size={14} /> },
    { type: 'shot', label: 'Shots', icon: <ShotMarker side="home" size={14} /> },
    { type: 'hit', label: 'Hits', icon: <HitMarker side="home" size={14} /> },
    { type: 'penalty', label: 'Penalties', icon: <PenaltyMarker side="home" size={14} /> },
  ]
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => {
        const isOn = enabled.has(c.type)
        const isAvailable = counts[c.type] > 0
        return (
          <button
            key={c.type}
            type="button"
            onClick={() => onToggle(c.type)}
            disabled={!isAvailable}
            className={[
              'flex items-center gap-1.5 border px-2.5 py-1 font-condensed text-[11px] font-semibold uppercase tracking-wider transition-colors',
              isAvailable
                ? isOn
                  ? 'border-zinc-700 bg-zinc-900 text-zinc-100'
                  : 'border-zinc-900 bg-zinc-950 text-zinc-600 hover:border-zinc-800 hover:text-zinc-400'
                : 'cursor-not-allowed border-zinc-950 bg-zinc-950 text-zinc-700',
            ].join(' ')}
          >
            <span className="flex h-3.5 w-3.5 items-center justify-center">{c.icon}</span>
            <span>{c.label}</span>
            <span className="text-zinc-500 tabular-nums">{counts[c.type]}</span>
          </button>
        )
      })}
    </div>
  )
}

function Marker({ event }: { event: MatchEventRow }) {
  const hockeyX = Number(event.x)
  const hockeyY = Number(event.y)
  const svgX = rinkX(hockeyX)
  const svgY = rinkY(hockeyY)
  const side: 'home' | 'away' = event.teamSide === 'for' ? 'home' : 'away'
  const extrapolated = event.positionConfidence === 'extrapolated'
  const tooltip = buildTooltip(event, extrapolated)

  switch (event.eventType) {
    case 'goal':
      return (
        <PlacedMarker x={svgX} y={svgY} width={112} height={97} tooltip={tooltip} extrapolated={extrapolated}>
          <GoalMarker side={side} size={112} />
        </PlacedMarker>
      )
    case 'shot':
      return (
        <PlacedMarker x={svgX} y={svgY} width={84} height={84} tooltip={tooltip} extrapolated={extrapolated}>
          <ShotMarker side={side} size={84} />
        </PlacedMarker>
      )
    case 'hit':
      return (
        <PlacedMarker x={svgX} y={svgY} width={80} height={80} tooltip={tooltip} extrapolated={extrapolated}>
          <HitMarker side={side} size={80} />
        </PlacedMarker>
      )
    case 'penalty':
      return (
        <PlacedMarker x={svgX} y={svgY} width={112} height={112} tooltip={tooltip} extrapolated={extrapolated}>
          <PenaltyMarker side={side} size={112} />
        </PlacedMarker>
      )
    default:
      return null
  }
}

function PlacedMarker({
  x,
  y,
  width,
  height,
  tooltip,
  extrapolated,
  children,
}: {
  x: number
  y: number
  width: number
  height: number
  tooltip: string
  extrapolated?: boolean
  children: React.ReactNode
}) {
  // Clamp so the entire marker fits inside the rink viewBox (0..2405 × 0..1025).
  // An event at hockey x=±100 or y=±42.5 sits right at the boards; without this
  // clamp the marker's outer half would render off-canvas (cut off).
  const halfW = width / 2
  const halfH = height / 2
  const cx = Math.max(halfW, Math.min(VIEW_W - halfW, x))
  const cy = Math.max(halfH, Math.min(VIEW_H - halfH, y))
  // Extrapolated markers had their pixel position outside the calibration
  // landmark hull — the RBF prediction is unbounded TRE there. Render at
  // reduced opacity so the operator can tell at a glance which markers are
  // best-guess. See docs/ocr/marker-extraction-research.md.
  return (
    <g
      transform={`translate(${cx - halfW}, ${cy - halfH})`}
      opacity={extrapolated === true ? 0.5 : 1}
    >
      <title>{tooltip}</title>
      {children}
    </g>
  )
}

const VIEW_W = 2405
const VIEW_H = 1025

// ─── Coordinate mapping ─────────────────────────────────────────────────────
//
// Rink viewBox is 0..2405 × 0..1025, centre at (1202.5, 512.5).
// Blue lines sit at x = 902.5 (BGM def) and x = 1502.5 (BGM off), 600 SVG
// units apart = 50 NHL feet, so 12 SVG units per foot.
// Hockey-standard: x ∈ [-100, +100] ft (goal line to goal line), y ∈ [-42.5,
// +42.5] ft. y inverts because SVG y grows downward.
//
// Clamp at the rink boundary: a few CVAT clicks land 5-6 ft past the boards
// in the in-game art's calibration. Rendering them off-canvas would hide
// real events; clamping pins them against the boards instead.
function rinkX(hockeyX: number): number {
  const clamped = Math.max(-100, Math.min(100, hockeyX))
  return 1202.5 + clamped * 12
}
function rinkY(hockeyY: number): number {
  const clamped = Math.max(-42.5, Math.min(42.5, hockeyY))
  return 512.5 - clamped * 12
}

function buildTooltip(event: MatchEventRow, extrapolated: boolean): string {
  const parts: string[] = []
  parts.push(event.eventType.toUpperCase())
  if (event.actor?.gamertag) parts.push(event.actor.gamertag)
  else if (event.actorGamertagSnapshot) parts.push(event.actorGamertagSnapshot)
  if (event.clock) parts.push(`@ ${event.clock}`)
  parts.push(event.periodLabel || `P${String(event.periodNumber)}`)
  if (extrapolated) parts.push('(approx. position)')
  return parts.join(' · ')
}
