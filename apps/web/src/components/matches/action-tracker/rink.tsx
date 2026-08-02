'use client'

import { useEffect, useMemo, useState } from 'react'
import type { MatchEventRow } from '@eanhl/db/queries'
import { RinkSvg } from '@/components/branding/rink'
import {
  GoalMarker,
  HitMarker,
  PenaltyMarker,
  ShotMarker,
} from '@/components/branding/event-markers'
import { computeMarkerOffsets, type MarkerOffset } from '@/lib/marker-layout'
import { delayVar } from '@/lib/motion'
import { PLOT_TOTAL_MS, plotDelay, plotStep } from '@/lib/plot-schedule'
import { useGsArmed } from '../motion'
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

/* --- plot-in schedule (Phase 12 motion) ---------------------------------
   Events drop onto the ice in order, and EVERY marker is part of the cascade.
   A dense match compresses the gap between landings rather than dropping its
   later markers out of the schedule — see `lib/plot-schedule.ts` for why that
   distinction is load-bearing (an unscheduled marker renders with no drop
   class, i.e. sitting on the ice before the cascade even starts). */

export function RinkPanel({
  events,
  scopedIds,
  visibleIds,
  oppAbbrev,
  hoveredId,
  onHover,
  selectedId,
  onSelect,
  onClearSelected,
  bgmIsHome,
  offRink,
}: {
  /** EVERY plottable event. Drives de-confliction, so offsets never shift. */
  events: MatchEventRow[]
  /** Passes period + team. Anything outside this is not drawn at all. */
  scopedIds: ReadonlySet<number>
  /** Also passes the type toggles. Drawn-but-not-visible renders as a ghost. */
  visibleIds: ReadonlySet<number>
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
  // Plot-in runs ONCE. After it finishes, markers render with no drop class at
  // all, so re-widening a filter fades the returning markers back up on the
  // opacity transition instead of re-plotting them — the spec's guardrail is
  // that markers never move on filter, because the reader's spatial map of the
  // ice depends on it.
  //
  // Reduced motion is handled ENTIRELY by the CSS layer, which sets
  // `animation: none` on gs-marker-drop and both goal flares — the keyframes
  // end at the resting state, so the markers simply sit where they belong.
  // There is deliberately no `useReducedMotion()` check here: that hook reports
  // `true` until its first effect (the SSR-safe default), which is
  // indistinguishable from a genuine preference at the moment this effect first
  // runs — it used to set `plotDone` on the spot, so the cascade was torn down
  // during hydration and NEVER played for anyone.
  // The plot-in is PAUSED by the CSS layer until this module is armed, so its
  // teardown clock starts from the same moment. Anchored to mount it ran while
  // the panel was still held at its first frame off-screen, deleted the drop
  // classes ~3.2s later, and the cascade was gone before the reader ever
  // reached the ice — the markers just existed, having never landed.
  const armed = useGsArmed()
  const [plotDone, setPlotDone] = useState(false)

  useEffect(() => {
    if (!armed) return
    const timer = window.setTimeout(() => {
      setPlotDone(true)
    }, PLOT_TOTAL_MS)
    return () => {
      window.clearTimeout(timer)
    }
  }, [armed])

  // Tooltip prefers explicit hover; falls back to the selected marker so the
  // pinned event keeps its detail panel visible.
  const focusedId = hoveredId ?? selectedId
  const focused = focusedId === null ? null : (events.find((e) => e.id === focusedId) ?? null)

  // De-conflict markers that land on (nearly) the same rink coordinate. Without
  // this, co-located events (e.g. match 250's two E. WANHG → M. LEHMANN shots
  // at 10:20 and 0:42, <1px apart) render on top of each other and one has no
  // visible marker. Offsets are deterministic + stable across renders — and
  // because `events` is the UNFILTERED set, they are stable across filter
  // changes too, so ghosting a marker never shifts its neighbours.
  const markerOffsets = useMemo(() => {
    return computeMarkerOffsets(
      events.map((e) => {
        const c = markerCenter(e)
        return { id: e.id, cx: c.x, cy: c.y }
      }),
    )
  }, [events])

  // Plot-in position, counted over the VISIBLE markers only, so the drop
  // sequence stays a contiguous chronological cascade instead of leaving gaps
  // where a ghost sits. (At mount nothing is filtered, so this is the identity;
  // it matters only if a filter is applied before the plot-in has finished.)
  const plotOrder = useMemo(() => {
    const order = new Map<number, number>()
    let i = 0
    for (const e of events) {
      if (scopedIds.has(e.id) && visibleIds.has(e.id)) order.set(e.id, i++)
    }
    return order
  }, [events, scopedIds, visibleIds])

  // Gap between landings, compressed to fit the whole cascade in its budget.
  // Derived from the VISIBLE count for the same reason `plotOrder` is: a
  // filtered-out marker holds no slot in the sequence.
  const plotStepMs = useMemo(() => plotStep(plotOrder.size), [plotOrder])

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
              // Outside the period/team scope: not part of this picture at all.
              if (!scopedIds.has(e.id)) return null
              const isGhost = !visibleIds.has(e.id)
              const isSelected = selectedId === e.id
              // Two separate reasons to dim, one opacity: excluded by a filter,
              // or dimmed because some OTHER marker is pinned. Either way the
              // marker stays exactly where it is and stops taking pointers.
              const isFaded = isGhost || (selectedId !== null && !isSelected)
              return (
                <Marker
                  key={e.id}
                  event={e}
                  hovered={hoveredId === e.id}
                  selected={isSelected}
                  faded={isFaded}
                  dropDelayMs={
                    isGhost ? null : plotDelay(plotOrder.get(e.id) ?? 0, plotDone, plotStepMs)
                  }
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
          {/* Ghosts still render, so "nothing plotted" is about what PASSES the
              filters, not about how many <g> elements exist. */}
          {visibleIds.size === 0 ? <EmptyRinkNote /> : null}
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

/** Which one-shot flare a marker earns on landing; null for everything but goals. */
type GoalFlare = 'accent' | 'opp' | null

function goalFlareFor(event: MatchEventRow): GoalFlare {
  if (event.eventType !== 'goal') return null
  return event.teamSide === 'for' ? 'accent' : 'opp'
}

function Marker({
  event,
  hovered,
  selected,
  faded,
  offset,
  dropDelayMs,
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
  dropDelayMs: number | null
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
    dropDelayMs,
    // Goals flare once as they land, in the colour of the club that scored —
    // accent for BGM, neutral white for the opponent. Colour follows the CLUB
    // here, not home ice, matching the rest of the tracker's palette rule.
    goalFlare: goalFlareFor(event),
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
  dropDelayMs,
  goalFlare,
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
  /** Plot-in delay in ms, or null to appear instantly (see PLOT_IN_LIMIT). */
  dropDelayMs: number | null
  /** Goals flare once as they land — accent for BGM, white for the opponent. */
  goalFlare: GoalFlare
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
  // The flare rides the drop, so it only exists for markers that are actually
  // being plotted in — a goal that appears instantly (past the plot-in limit,
  // or on a filter re-widen) has no landing to mark.
  const flareClass =
    goalFlare === null || dropDelayMs === null
      ? null
      : goalFlare === 'accent'
        ? 'gs-goal-land'
        : 'gs-goal-land-opp'
  const groupStyle: React.CSSProperties = {
    cursor: faded ? 'default' : 'pointer',
    pointerEvents: faded ? 'none' : 'auto',
    filter: selected ? 'drop-shadow(0 0 12px rgba(232,65,49,0.85))' : undefined,
  }
  return (
    <g
      className="gs-fade-marker"
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
      {/* The drop lives on its OWN group. The positioned <g> above carries a
          `transform` ATTRIBUTE, and a CSS transform on the same element
          replaces it outright — animating there would fling every marker to
          the rink's origin. This inner group has no transform attribute, so
          the two compose. */}
      <g
        className={dropDelayMs === null ? undefined : 'gs-marker-drop'}
        style={dropDelayMs === null ? undefined : delayVar(dropDelayMs)}
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
        <g
          className={flareClass ?? undefined}
          style={flareClass === null ? undefined : delayVar(dropDelayMs ?? 0)}
          transform={`translate(${String(-halfW)}, ${String(-halfH)})`}
        >
          {children}
        </g>
      </g>
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
