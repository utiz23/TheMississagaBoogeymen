'use client'

import { useMemo } from 'react'
import type { MatchEventRow } from '@eanhl/db/queries'
import { RinkSvg } from '@/components/branding/rink'
import {
  GoalMarker,
  HitMarker,
  PenaltyMarker,
  ShotMarker,
} from '@/components/branding/event-markers'
import { computeMarkerOffsets, type MarkerOffset } from '@/lib/marker-layout'
import { cleanPeriodLabel, resolveMarkerSide, useTeamPalette, withAlpha } from './shared'

/**
 * The rink map. Geometry, marker glyphs, collision de-confliction and the
 * hover/pin tooltip are ported verbatim from the previous production
 * `action-tracker-map.tsx` — that map is the good part of the old section and
 * the redesign is a frame around it, not a replacement for it.
 *
 * What changed in Phase 9: the panel head adopts the prototype's
 * "<OPP> ← DEFENDS · ATTACKS → BGM" axis (at a legible contrast — the
 * prototype shipped it at 1.52:1), the legend draws the real marker glyphs
 * instead of bare letters, and colours come from the site tokens rather than
 * per-match OCR hexes (see `shared.ts`).
 */

// The rink artwork's intrinsic viewBox. All marker maths is in these units.
const VIEW_W = 2405
const VIEW_H = 1025

/** EA rink coordinates are ±100 along the long axis, ±42.5 across. */
function rinkX(hockeyX: number): number {
  const clamped = Math.max(-100, Math.min(100, hockeyX))
  return 1202.5 + clamped * 12
}
function rinkY(hockeyY: number): number {
  const clamped = Math.max(-42.5, Math.min(42.5, hockeyY))
  return 512.5 - clamped * 12
}

function markerSize(type: string): { width: number; height: number } {
  switch (type) {
    case 'goal':
      return { width: 112, height: 97 }
    case 'shot':
      return { width: 84, height: 84 }
    case 'hit':
      return { width: 80, height: 80 }
    case 'penalty':
      return { width: 112, height: 112 }
    default:
      return { width: 84, height: 84 }
  }
}

/** Rendered (clamped) centre of an event's marker, in viewBox units. */
export function markerCenter(event: MatchEventRow): { x: number; y: number } {
  const { width, height } = markerSize(event.eventType)
  const halfW = width / 2
  const halfH = height / 2
  const rawX = rinkX(Number(event.x))
  const rawY = rinkY(Number(event.y))
  return {
    x: Math.max(halfW, Math.min(VIEW_W - halfW, rawX)),
    y: Math.max(halfH, Math.min(VIEW_H - halfH, rawY)),
  }
}

export function RinkPanel({
  events,
  oppAbbrev,
  hoveredId,
  onHover,
  selectedId,
  onSelect,
  onClearSelected,
  bgmIsHome,
  offRink,
}: {
  events: MatchEventRow[]
  oppAbbrev: string
  hoveredId: number | null
  onHover: (id: number | null) => void
  selectedId: number | null
  onSelect: (id: number) => void
  onClearSelected: () => void
  bgmIsHome: boolean
  /** Events passing the filters that carry no rink position (faceoffs, NULL x/y). */
  offRink: number
}) {
  // Tooltip prefers explicit hover; falls back to the selected marker so the
  // pinned event keeps its detail panel visible.
  const focusedId = hoveredId ?? selectedId
  const focused = focusedId === null ? null : (events.find((e) => e.id === focusedId) ?? null)

  // De-conflict markers that land on (nearly) the same rink coordinate. Without
  // this, co-located events (e.g. match 250's two E. WANHG → M. LEHMANN shots
  // at 10:20 and 0:42, <1px apart) render on top of each other and one has no
  // visible marker. Offsets are deterministic + stable across renders.
  const markerOffsets = useMemo(() => {
    return computeMarkerOffsets(
      events.map((e) => {
        const c = markerCenter(e)
        return { id: e.id, cx: c.x, cy: c.y }
      }),
    )
  }, [events])

  return (
    <div className="broadcast-panel-strong min-w-0 border border-border px-3.5 pb-3 pt-3">
      <div className="mb-2 flex flex-wrap items-center gap-x-3.5 gap-y-1">
        <span className="font-condensed text-[11px] font-bold uppercase tracking-[0.18em] text-fg-3">
          Event map · 5-on-5 ice
        </span>
        {/* Direction of play. Contrast fixed from the prototype's fg-6 (1.52:1)
            — this is the only thing telling you which way the ice runs. */}
        <div className="ml-auto flex items-center gap-2 font-condensed text-[10px] font-bold uppercase tracking-[0.16em] whitespace-nowrap">
          <span style={{ color: 'var(--opp, #81878D)' }}>{oppAbbrev} ←</span>
          <span className="text-fg-3">defends · attacks</span>
          <span className="text-accent">→ BGM</span>
        </div>
      </div>

      {/* Below sm the rink would shrink to ~292×124 — 73 markers inside 124px of
          ice, which is a smear, not a map. It keeps a 520px floor and scrolls
          sideways instead; the event list underneath is the non-scrolling way
          to read the same events. */}
      <div className="overflow-x-auto sm:overflow-x-visible">
        <div
          className="relative w-full min-w-[520px] sm:min-w-0"
          style={{ aspectRatio: `${String(VIEW_W)} / ${String(VIEW_H)}` }}
          onMouseLeave={() => {
            onHover(null)
          }}
          onClick={onClearSelected}
        >
          <RinkSvg className="block h-full w-full" />
          {/* aria-hidden by design: the markers are a pointer-only affordance and
            73 focusable SVG nodes would be a tab-stop swamp. The event list next
            to it is the keyboard/AT equivalent — it carries the same rows, is a
            single tab stop, and selecting there pins the marker here. */}
          <svg
            viewBox={`0 0 ${String(VIEW_W)} ${String(VIEW_H)}`}
            preserveAspectRatio="xMidYMid meet"
            className="absolute inset-0 block h-auto w-full"
            aria-hidden
          >
            {events.map((e) => {
              const isSelected = selectedId === e.id
              const isFaded = selectedId !== null && !isSelected
              return (
                <Marker
                  key={e.id}
                  event={e}
                  hovered={hoveredId === e.id}
                  selected={isSelected}
                  faded={isFaded}
                  offset={markerOffsets.get(e.id)}
                  onEnter={() => {
                    onHover(e.id)
                  }}
                  onLeave={() => {
                    onHover(null)
                  }}
                  onClick={() => {
                    onSelect(e.id)
                  }}
                  bgmIsHome={bgmIsHome}
                />
              )
            })}
          </svg>
          {events.length === 0 ? <EmptyRinkNote /> : null}
          {focused ? (
            <MarkerTooltip
              event={focused}
              bgmIsHome={bgmIsHome}
              offset={markerOffsets.get(focused.id)}
            />
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 font-condensed text-[9.5px] font-bold uppercase tracking-[0.16em] text-fg-3">
        <span className="text-fg-3">Legend</span>
        <LegendItem label="Goal">
          <GoalMarker side="home" size={13} homeColor="var(--color-accent)" />
        </LegendItem>
        <LegendItem label="Shot">
          <ShotMarker side="home" size={13} homeColor="var(--color-accent)" />
        </LegendItem>
        <LegendItem label="Hit">
          <HitMarker side="home" size={13} homeColor="var(--color-accent)" />
        </LegendItem>
        <LegendItem label="Penalty">
          <PenaltyMarker side="home" size={13} homeColor="var(--color-accent)" />
        </LegendItem>
        {offRink > 0 ? (
          <span className="text-fg-3">
            <b className="font-black tabular-nums text-fg-3">{offRink}</b> not plotted
          </span>
        ) : null}
      </div>
    </div>
  )
}

function LegendItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {children}
      <span>{label}</span>
    </span>
  )
}

/**
 * Honest empty rink — drawn when the filters (or the match) leave nothing to
 * plot. The rink art stays visible underneath so the section keeps its shape
 * instead of collapsing to a message box.
 */
function EmptyRinkNote() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span className="border border-border bg-background/85 px-3 py-1.5 font-condensed text-[10.5px] font-bold uppercase tracking-[0.18em] text-fg-3">
        No plotted events
      </span>
    </div>
  )
}

function Marker({
  event,
  hovered,
  selected,
  faded,
  offset,
  onEnter,
  onLeave,
  onClick,
  bgmIsHome,
}: {
  event: MatchEventRow
  hovered: boolean
  selected: boolean
  faded: boolean
  offset?: MarkerOffset | undefined
  onEnter: () => void
  onLeave: () => void
  onClick: () => void
  bgmIsHome: boolean
}) {
  const svgX = rinkX(Number(event.x))
  const svgY = rinkY(Number(event.y))
  const side: 'home' | 'away' = resolveMarkerSide(event.teamSide, bgmIsHome)
  const extrapolated = event.positionConfidence === 'extrapolated'
  const { HOME_COLOR, AWAY_COLOR } = useTeamPalette()
  const markerColors = { homeColor: HOME_COLOR, awayColor: AWAY_COLOR }

  const common = {
    eventId: event.id,
    x: svgX,
    y: svgY,
    offsetX: offset?.dx ?? 0,
    offsetY: offset?.dy ?? 0,
    extrapolated,
    hovered,
    selected,
    faded,
    onEnter,
    onLeave,
    onClick,
  }

  const { width, height } = markerSize(event.eventType)

  switch (event.eventType) {
    case 'goal':
      return (
        <PlacedMarker {...common} width={width} height={height}>
          <GoalMarker side={side} size={width} {...markerColors} />
        </PlacedMarker>
      )
    case 'shot':
      return (
        <PlacedMarker {...common} width={width} height={height}>
          <ShotMarker side={side} size={width} {...markerColors} />
        </PlacedMarker>
      )
    case 'hit':
      return (
        <PlacedMarker {...common} width={width} height={height}>
          <HitMarker side={side} size={width} {...markerColors} />
        </PlacedMarker>
      )
    case 'penalty':
      return (
        <PlacedMarker {...common} width={width} height={height}>
          <PenaltyMarker side={side} size={width} {...markerColors} />
        </PlacedMarker>
      )
    default:
      return null
  }
}

function PlacedMarker({
  eventId,
  x,
  y,
  offsetX = 0,
  offsetY = 0,
  width,
  height,
  extrapolated,
  hovered,
  selected,
  faded,
  onEnter,
  onLeave,
  onClick,
  children,
}: {
  /** Mirrors the event list's `data-event-id`, so a marker and its card are
   *  addressable as one pair (used by the click↔highlight sync). */
  eventId: number
  x: number
  y: number
  /** Collision-deconfliction offset (see computeMarkerOffsets). 0 when the
   *  marker doesn't share its coordinate with another event. */
  offsetX?: number
  offsetY?: number
  width: number
  height: number
  extrapolated?: boolean
  hovered: boolean
  selected: boolean
  faded: boolean
  onEnter: () => void
  onLeave: () => void
  onClick: () => void
  children: React.ReactNode
}) {
  const halfW = width / 2
  const halfH = height / 2
  // Apply the deconfliction offset BEFORE clamping so a fanned-out marker still
  // can't escape the rink bounds.
  const cx = Math.max(halfW, Math.min(VIEW_W - halfW, x + offsetX))
  const cy = Math.max(halfH, Math.min(VIEW_H - halfH, y + offsetY))
  // Both halos sit clearly outside the marker bounds. Hover is a visible
  // "soft target" ring; selected adds a stronger filled accent so the pinned
  // event reads as a "you are here" beacon at a glance. The halo is always
  // accent — it is a UI state, not a team identity.
  const hoverHaloR = Math.max(width, height) * 0.85
  const selectedHaloR = Math.max(width, height) * 1.0
  const baseOpacity = faded ? 0.18 : extrapolated === true ? 0.5 : 1
  const groupStyle: React.CSSProperties = {
    cursor: faded ? 'default' : 'pointer',
    pointerEvents: faded ? 'none' : 'auto',
    filter: selected ? 'drop-shadow(0 0 12px rgba(232,65,49,0.85))' : undefined,
    transition: 'opacity 0.12s, filter 0.12s',
  }
  return (
    <g
      data-event-id={String(eventId)}
      transform={`translate(${String(cx)}, ${String(cy)})`}
      opacity={baseOpacity}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      style={groupStyle}
    >
      {selected ? (
        <circle
          r={selectedHaloR}
          fill="rgba(232,65,49,0.16)"
          stroke="var(--color-accent)"
          strokeWidth={3}
        />
      ) : hovered ? (
        <circle
          r={hoverHaloR}
          fill="rgba(232,65,49,0.05)"
          stroke="rgba(232,65,49,0.50)"
          strokeWidth={2}
        />
      ) : null}
      <g transform={`translate(${String(-halfW)}, ${String(-halfH)})`}>{children}</g>
    </g>
  )
}

function MarkerTooltip({
  event,
  bgmIsHome,
  offset,
}: {
  event: MatchEventRow
  bgmIsHome: boolean
  offset?: MarkerOffset | undefined
}) {
  const { HOME_COLOR, AWAY_COLOR } = useTeamPalette()
  // Position the tooltip at the same clamped + deconflicted center as the
  // rendered marker — otherwise edge-of-rink events drift (the marker clamp
  // moves the glyph) and co-located markers point their tooltip at the wrong
  // (un-fanned) spot.
  const center = markerCenter(event)
  const leftPct = ((center.x + (offset?.dx ?? 0)) / VIEW_W) * 100
  const topPct = ((center.y + (offset?.dy ?? 0)) / VIEW_H) * 100
  const isHomeSide = resolveMarkerSide(event.teamSide, bgmIsHome) === 'home'
  const teamColor = isHomeSide ? HOME_COLOR : AWAY_COLOR
  const actor = event.actor?.gamertag ?? event.actorGamertagSnapshot ?? '—'
  const target = event.target?.gamertag ?? event.targetGamertagSnapshot ?? null
  const infraction = (event as { infraction?: string | null }).infraction ?? null
  const targetLine =
    event.eventType === 'penalty' ? (infraction ? infraction.toUpperCase() : null) : target
  const periodTag = cleanPeriodLabel(event.periodLabel) || `P${String(event.periodNumber)}`
  const borderColor = withAlpha(teamColor, 0.55)
  // Flip the tooltip below the marker for events in the top third of the rink,
  // where an above-marker tooltip would be clipped by the panel edge.
  const below = topPct < 34
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 max-w-[280px] min-w-[220px] bg-[var(--color-charcoal,#1a1819)] px-3 py-2.5"
      style={{
        left: `${leftPct.toString()}%`,
        top: `${topPct.toString()}%`,
        transform: below
          ? 'translate(-50%, calc(0% + 14px))'
          : 'translate(-50%, calc(-100% - 14px))',
        border: `1px solid ${borderColor}`,
        boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
      }}
    >
      <span
        aria-hidden
        className="absolute left-1/2 block h-3 w-3 bg-[var(--color-charcoal,#1a1819)]"
        style={
          below
            ? {
                top: '-7px',
                transform: 'translateX(-50%) rotate(45deg)',
                borderLeft: `1px solid ${borderColor}`,
                borderTop: `1px solid ${borderColor}`,
              }
            : {
                bottom: '-7px',
                transform: 'translateX(-50%) rotate(45deg)',
                borderRight: `1px solid ${borderColor}`,
                borderBottom: `1px solid ${borderColor}`,
              }
        }
      />
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className="font-condensed text-[11px] font-black uppercase tracking-[0.18em]"
          style={{ color: teamColor }}
        >
          {event.eventType}
        </span>
        <span className="ml-auto font-condensed text-[10.5px] font-bold tracking-[0.06em] tabular-nums text-fg-3">
          {event.clock ?? '—'}
        </span>
      </div>
      <div className="font-condensed text-[14px] leading-tight font-extrabold tracking-[0.04em] uppercase text-fg-1">
        {actor}
      </div>
      {targetLine ? (
        <div className="mt-[3px] font-condensed text-[11px] leading-tight font-semibold tracking-[0.04em] text-fg-3">
          {event.eventType === 'penalty' ? (
            <span className="font-extrabold tracking-[0.1em] uppercase text-[var(--color-otl)]">
              {targetLine}
            </span>
          ) : (
            <>
              <span className="mx-1.5 text-fg-3">→</span>
              {targetLine}
            </>
          )}
        </div>
      ) : null}
      <div className="mt-[7px] flex gap-3 border-t border-border pt-[7px] font-condensed text-[10px] font-bold tracking-[0.14em] uppercase">
        <span style={{ color: teamColor }}>{periodTag}</span>
        {event.positionConfidence === 'extrapolated' ? (
          <span className="text-[var(--color-otl)]">Approx</span>
        ) : null}
      </div>
    </div>
  )
}
