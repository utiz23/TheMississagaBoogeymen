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
import { PlayerSilhouette } from '@/components/home/player-card'

interface ActionTrackerMapProps {
  events: MatchEventRow[]
}

type FilterableType = 'goal' | 'shot' | 'hit' | 'penalty' | 'faceoff'

const ALL_TYPES: FilterableType[] = ['goal', 'shot', 'hit', 'penalty', 'faceoff']
const TRACKED_TYPES = new Set<string>(ALL_TYPES)

/**
 * Single-match Action Tracker view — mirrors the in-game post-game
 * "Action Tracker" tab. Two surfaces:
 *
 *   Rink (left)  — markers for events with non-null (x, y). Faceoffs
 *                  never plot because the canonical OCR pipeline
 *                  doesn't capture the faceoff_map screen yet (the
 *                  in-game Faceoff Map tab would supply positions);
 *                  see the deferred-work note at the bottom of the
 *                  Phase 5 HANDOFF section.
 *
 *   Cards (right) — one row per event the type+period filter admits,
 *                   INCLUDING unpositioned faceoffs/penalties. Card
 *                   layout: silhouette portrait tinted by team side,
 *                   event-type badge, actor → receiver, plus clock
 *                   and period in a footer line.
 *
 * Hides itself entirely if no tracked events exist.
 */
type PeriodFilter = 'all' | number

export function ActionTrackerMap({ events }: ActionTrackerMapProps) {
  const tracked = events.filter((e) => TRACKED_TYPES.has(e.eventType))

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

  // Period discovery uses tracked events (not just positioned ones) so
  // periods with only faceoffs still surface in the chip set.
  const periodsAvailable = Array.from(
    new Map(tracked.map((e) => [e.periodNumber, e.periodLabel])).entries(),
  ).sort(([a], [b]) => a - b)

  const periodScoped =
    periodFilter === 'all'
      ? tracked
      : tracked.filter((e) => e.periodNumber === periodFilter)

  // Count per type across the period-scoped pool so chip badges reflect
  // exactly what's reachable under the current period filter.
  const counts: Record<FilterableType, number> = {
    goal: 0,
    shot: 0,
    hit: 0,
    penalty: 0,
    faceoff: 0,
  }
  for (const e of periodScoped) {
    if (e.eventType in counts) counts[e.eventType as FilterableType]++
  }

  // Two derived pools driven by the same filter set:
  //   visibleMarkers — only positioned non-faceoff events drawn on the rink
  //   visibleCards   — full filter set, including positionless faceoffs
  const visibleCards = periodScoped.filter((e) => {
    if (!(e.eventType in counts)) return false
    return enabled.has(e.eventType as FilterableType)
  })
  const visibleMarkers = visibleCards.filter(
    (e) => e.eventType !== 'faceoff' && e.x !== null && e.y !== null,
  )

  const positionedTotal = tracked.filter(
    (e) => e.eventType !== 'faceoff' && e.x !== null && e.y !== null,
  ).length
  const unpositionedNonFaceoff = tracked.filter(
    (e) => e.eventType !== 'faceoff' && (e.x === null || e.y === null),
  ).length

  return (
    <section className="space-y-3">
      <SectionHeader
        label="Action Tracker"
        subtitle="All event types from the in-game post-game Action Tracker — OCR-derived"
      />
      <Panel className="overflow-hidden px-3 py-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <FilterChips counts={counts} enabled={enabled} onToggle={toggle} />
          <PeriodChips
            available={periodsAvailable}
            selected={periodFilter}
            onSelect={setPeriodFilter}
          />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
          <div className="relative w-full">
            <RinkSvg className="block h-auto w-full" />
            <svg
              viewBox="0 0 2405 1025"
              preserveAspectRatio="xMidYMid meet"
              className="absolute inset-0 block h-auto w-full"
              aria-hidden
            >
              {visibleMarkers.map((e) => (
                <Marker key={e.id} event={e} />
              ))}
            </svg>
          </div>
          <EventList events={visibleCards} />
        </div>
        <CoverageDisclosure
          visibleOnMap={visibleMarkers.length}
          positionedTotal={positionedTotal}
          unpositionedTotal={unpositionedNonFaceoff}
        />
      </Panel>
    </section>
  )
}

// ─── Event list ─────────────────────────────────────────────────────────────

function EventList({ events }: { events: MatchEventRow[] }) {
  if (events.length === 0) {
    return (
      <div className="flex h-full min-h-[200px] items-center justify-center border border-zinc-900 bg-zinc-950 px-3 py-4 text-[11px] uppercase tracking-wider text-zinc-600">
        No events match
      </div>
    )
  }
  // Period ASC, then clock DESC (game clock counts down, so 19:59 is earlier
  // than 0:01 within the same period).
  const sorted = [...events].sort((a, b) => {
    if (a.periodNumber !== b.periodNumber) return a.periodNumber - b.periodNumber
    return clockToSeconds(b.clock) - clockToSeconds(a.clock)
  })
  return (
    <div className="flex max-h-[600px] flex-col overflow-y-auto border border-zinc-900 bg-zinc-950">
      <div className="sticky top-0 z-10 border-b border-zinc-900 bg-zinc-950 px-3 py-2 font-condensed text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Events · {String(events.length)}
      </div>
      <ul className="divide-y divide-zinc-900">
        {sorted.map((e) => (
          <EventCard key={e.id} event={e} />
        ))}
      </ul>
    </div>
  )
}

function EventCard({ event }: { event: MatchEventRow }) {
  const isBgm = event.teamSide === 'for'
  const accent = isBgm ? 'border-l-red-700' : 'border-l-zinc-700'
  const actor = event.actor?.gamertag || event.actorGamertagSnapshot || 'unknown'
  const target = event.target?.gamertag || event.targetGamertagSnapshot
  const periodTag = cleanPeriodLabel(event.periodLabel) || `P${String(event.periodNumber)}`
  return (
    <li className={`border-l-2 ${accent} px-3 py-2.5 text-[11px] leading-tight`}>
      <div className="flex items-start gap-2.5">
        <Portrait isBgm={isBgm} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-1.5">
            <EventTypeBadge type={event.eventType} isBgm={isBgm} />
            <span className="truncate text-zinc-200">{actor}</span>
            {target ? (
              <>
                <span className="text-zinc-600">→</span>
                <span className="truncate text-zinc-400">{target}</span>
              </>
            ) : null}
          </div>
          <div className="flex items-center gap-2 font-condensed text-[10px] uppercase tracking-wider text-zinc-500">
            <span className="font-mono tabular-nums text-zinc-400">
              {event.clock || '—'}
            </span>
            <span className="text-zinc-700">·</span>
            <span>{periodTag}</span>
          </div>
        </div>
      </div>
    </li>
  )
}

/**
 * 32×32 silhouette portrait with team-side tint. Reuses the canonical
 * `PlayerSilhouette` SVG so future per-player avatar swaps land in one
 * place. The team-side tint is the cheapest visual distinguisher
 * available until we have real headshots.
 */
function Portrait({ isBgm }: { isBgm: boolean }) {
  const wrap = isBgm
    ? 'border-red-900/50 bg-red-950/30 text-red-700'
    : 'border-zinc-800 bg-zinc-900 text-zinc-700'
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border ${wrap}`}
      aria-hidden
    >
      <PlayerSilhouette sizeClass="h-7 w-7" />
    </div>
  )
}

function EventTypeBadge({ type, isBgm }: { type: string; isBgm: boolean }) {
  const label =
    type === 'goal' ? 'G' :
    type === 'shot' ? 'S' :
    type === 'hit' ? 'H' :
    type === 'penalty' ? 'P' :
    type === 'faceoff' ? 'F' :
    '?'
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

// ─── Filter chips + coverage disclosure ─────────────────────────────────────

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
  if (available.length <= 1) return null
  const items: Array<{ key: PeriodFilter; label: string }> = [
    { key: 'all', label: 'All' },
    ...available.map(([n, label]) => ({
      key: n as PeriodFilter,
      label: cleanPeriodLabel(label) || `P${String(n)}`,
    })),
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

function cleanPeriodLabel(raw: string | null): string {
  if (!raw) return ''
  return raw
    .replace(/^\s*(?:RT|LT|RB|LB)\s+/i, '')
    .replace(/\s+(?:RT|LT|RB|LB)\s*$/i, '')
    .trim()
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
  const chips: { type: FilterableType; label: string; icon: React.ReactNode | null }[] = [
    { type: 'goal', label: 'Goals', icon: <GoalMarker side="home" size={14} /> },
    { type: 'shot', label: 'Shots', icon: <ShotMarker side="home" size={14} /> },
    { type: 'hit', label: 'Hits', icon: <HitMarker side="home" size={14} /> },
    { type: 'penalty', label: 'Penalties', icon: <PenaltyMarker side="home" size={14} /> },
    // Faceoff has no rink marker yet (no positions in our data); render the
    // letter 'F' as a placeholder icon to keep the chip visually consistent.
    { type: 'faceoff', label: 'Faceoffs', icon: <FaceoffChipIcon /> },
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

/**
 * Visual placeholder for the faceoff filter chip. Yellow circle with
 * "F" matches the in-game faceoff visual (the FACEOFF column in the
 * in-game Action Tracker uses a yellow F glyph).
 */
function FaceoffChipIcon() {
  return (
    <span className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-yellow-500 font-condensed text-[8px] font-bold leading-none text-black">
      F
    </span>
  )
}

// ─── Rink markers ───────────────────────────────────────────────────────────

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
  const halfW = width / 2
  const halfH = height / 2
  const cx = Math.max(halfW, Math.min(VIEW_W - halfW, x))
  const cy = Math.max(halfH, Math.min(VIEW_H - halfH, y))
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

// Hockey-standard coordinates → SVG. Matches ShotMap's old mapping;
// keep here to keep the new component self-contained.
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
