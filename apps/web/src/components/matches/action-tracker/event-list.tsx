'use client'

import { useEffect, useRef } from 'react'
import type { MatchEventRow } from '@eanhl/db/queries'
import {
  GoalMarker,
  HitMarker,
  PenaltyMarker,
  ShotMarker,
} from '@/components/branding/event-markers'
import { PlayerSilhouette } from '@/components/home/player-card'
import {
  cleanPeriodLabel,
  clockToSeconds,
  resolveMarkerSide,
  useTeamPalette,
  withAlpha,
  type SortMode,
} from './shared'

/**
 * Chronological event list, synced both ways with the rink: hovering or
 * clicking a card lights its marker and vice versa, and selecting a marker
 * scrolls its card into view.
 *
 * Frame is the prototype's (header row with the sort control and a live
 * "N shown" count); the cards are the production ones, which carry the actor ›
 * target line, the matching marker glyph, and the NO MARKER / APPROX honesty
 * tags the prototype's cards had no concept of.
 */
/** Stable option id, so the listbox can point aria-activedescendant at a row. */
const optionId = (id: number) => `event-option-${String(id)}`

export function EventList({
  events,
  sortMode,
  setSortMode,
  selectedId,
  hoveredId,
  onHover,
  onSelect,
  onClearSelected,
  bgmIsHome,
}: {
  events: MatchEventRow[]
  sortMode: SortMode
  setSortMode: (m: SortMode) => void
  selectedId: number | null
  hoveredId: number | null
  onHover: (id: number | null) => void
  onSelect: (id: number) => void
  onClearSelected: () => void
  bgmIsHome: boolean
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // When a card becomes selected (by either click or marker click), scroll it
  // into view inside the list — block:'nearest' is a no-op if already visible.
  useEffect(() => {
    if (selectedId === null) return
    const container = scrollRef.current
    if (!container) return
    const target = container.querySelector<HTMLElement>(`[data-event-id="${String(selectedId)}"]`)
    if (target) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  // "period" → grouped (chronological inside each period).
  // "chrono" / "newest" → flat list, no dividers.
  const sorted = [...events].sort((a, b) => {
    const periodDelta = a.periodNumber - b.periodNumber
    if (periodDelta !== 0) {
      return sortMode === 'newest' ? -periodDelta : periodDelta
    }
    // Inside a period, clock counts DOWN. Earliest-first = highest clock first.
    const clockDelta = clockToSeconds(b.clock) - clockToSeconds(a.clock)
    return sortMode === 'newest' ? -clockDelta : clockDelta
  })

  const showPeriodDividers = sortMode === 'period'
  const byPeriod: { period: number; label: string; rows: MatchEventRow[] }[] = []
  if (showPeriodDividers) {
    for (const e of sorted) {
      const last = byPeriod[byPeriod.length - 1]
      if (last?.period === e.periodNumber) {
        last.rows.push(e)
      } else {
        byPeriod.push({
          period: e.periodNumber,
          label: cleanPeriodLabel(e.periodLabel) || `P${String(e.periodNumber)}`,
          rows: [e],
        })
      }
    }
  }

  return (
    // At xl the list fills its (stretched) grid cell absolutely, so the RINK
    // decides the row height and the list scrolls inside it. Left in flow it
    // would push the row to its own content height — 95 cards tall.
    <div className="flex h-[420px] min-w-0 flex-col border border-border bg-surface xl:absolute xl:inset-0 xl:h-auto">
      <div className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5">
        <span className="font-condensed text-[11px] font-bold tracking-[0.18em] uppercase text-fg-3">
          Events
        </span>
        <SortSelect value={sortMode} onChange={setSortMode} />
        <span className="ml-auto font-condensed text-[10px] font-bold tracking-[0.14em] text-fg-3">
          <b className="font-black tabular-nums text-accent">{events.length}</b> shown
        </span>
      </div>

      {events.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-6 text-center">
          <div className="font-condensed text-[13px] font-extrabold tracking-[0.18em] uppercase text-fg-3">
            No events match
          </div>
          <div className="max-w-[240px] font-condensed text-[11px] leading-relaxed font-semibold text-fg-3">
            Adjust the period, team or type filters above.
          </div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          // overflow-x-hidden: the list owns its own width. Long gamertags
          // truncate inside the card rather than pushing an inner horizontal
          // scrollbar onto the pane (a prototype-review defect).
          className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto"
          tabIndex={0}
          role="listbox"
          // The cards are role=option (a listbox may only own options), so the
          // container keeps the focus and points at the active row instead —
          // the canonical single-tab-stop listbox pattern.
          aria-activedescendant={selectedId === null ? undefined : optionId(selectedId)}
          // Arrow keys select as they move (that IS the pin), so there is no
          // separate Enter step to advertise.
          aria-label="Event list — arrow keys move through the events and pin the one you land on, Escape clears the pin"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              if (sorted.length === 0) return
              const currentIdx = sorted.findIndex((ev) => ev.id === selectedId)
              const nextIdx =
                currentIdx === -1
                  ? e.key === 'ArrowDown'
                    ? 0
                    : sorted.length - 1
                  : e.key === 'ArrowDown'
                    ? Math.min(currentIdx + 1, sorted.length - 1)
                    : Math.max(currentIdx - 1, 0)
              const next = sorted[nextIdx]
              if (next) onSelect(next.id)
            } else if (e.key === 'Escape') {
              e.preventDefault()
              onClearSelected()
            }
          }}
        >
          {showPeriodDividers
            ? byPeriod.map((g) => (
                <div key={g.period} role="group" aria-label={g.label}>
                  <PeriodDivider label={g.label} count={g.rows.length} />
                  {g.rows.map((e) => (
                    <EventCard
                      key={e.id}
                      event={e}
                      selected={selectedId === e.id}
                      hovered={hoveredId === e.id}
                      onSelect={() => {
                        onSelect(e.id)
                      }}
                      onHover={onHover}
                      bgmIsHome={bgmIsHome}
                    />
                  ))}
                </div>
              ))
            : sorted.map((e) => (
                <EventCard
                  key={e.id}
                  event={e}
                  selected={selectedId === e.id}
                  hovered={hoveredId === e.id}
                  onSelect={() => {
                    onSelect(e.id)
                  }}
                  onHover={onHover}
                  bgmIsHome={bgmIsHome}
                />
              ))}
        </div>
      )}
    </div>
  )
}

function SortSelect({ value, onChange }: { value: SortMode; onChange: (m: SortMode) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="sr-only">Sort events</span>
      <select
        value={value}
        onChange={(e) => {
          onChange(e.target.value as SortMode)
        }}
        className="border border-border bg-background px-1.5 py-[3px] font-condensed text-[10px] font-bold tracking-[0.14em] uppercase text-fg-2"
      >
        <option value="period">By period</option>
        <option value="chrono">Chronological</option>
        <option value="newest">Newest first</option>
      </select>
    </label>
  )
}

// aria-hidden: the same label is the enclosing role=group's accessible name,
// and a bare div is not a legal child of a listbox.
function PeriodDivider({ label, count }: { label: string; count: number }) {
  return (
    <div
      aria-hidden
      className="sticky top-0 z-10 flex items-center gap-2 border-y border-border bg-background px-3.5 py-2"
    >
      <span className="font-condensed text-[9.5px] font-extrabold tracking-[0.22em] uppercase text-accent">
        {label}
      </span>
      <span className="h-px flex-1 bg-border" aria-hidden />
      <span className="font-condensed text-[9.5px] font-bold tracking-[0.18em] tabular-nums text-fg-3">
        {String(count)} events
      </span>
    </div>
  )
}

function EventCard({
  event,
  selected,
  hovered,
  onSelect,
  onHover,
  bgmIsHome,
}: {
  event: MatchEventRow
  selected: boolean
  hovered: boolean
  onSelect: () => void
  onHover: (id: number | null) => void
  bgmIsHome: boolean
}) {
  const isFaceoff = event.eventType === 'faceoff'
  const noMarker = !isFaceoff && (event.x === null || event.y === null)
  const lowConf = event.positionConfidence === 'extrapolated'

  const { HOME_COLOR, AWAY_COLOR } = useTeamPalette()
  // Card paint follows the rink-marker side, so a card always reads the same
  // colour as its glyph. Faceoffs use the WINNING team's colour — `teamSide`
  // already encodes 'for' (BGM won) vs 'against' (opp won).
  const side: 'home' | 'away' = resolveMarkerSide(event.teamSide, bgmIsHome)
  const isHomeSide = side === 'home'
  const teamColor = isHomeSide ? HOME_COLOR : AWAY_COLOR

  const actor = event.actor?.gamertag ?? event.actorGamertagSnapshot ?? '—'
  const target = event.target?.gamertag ?? event.targetGamertagSnapshot ?? null
  const periodTag = cleanPeriodLabel(event.periodLabel) || `P${String(event.periodNumber)}`
  const infraction = (event as { infraction?: string | null }).infraction ?? null
  const pillLabel =
    event.eventType === 'penalty' && infraction
      ? infraction.toUpperCase()
      : event.eventType.toUpperCase()

  return (
    <div
      id={optionId(event.id)}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      onMouseEnter={() => {
        onHover(event.id)
      }}
      onMouseLeave={() => {
        onHover(null)
      }}
      data-event-id={String(event.id)}
      className="relative grid w-full min-w-0 cursor-pointer grid-cols-[3px_32px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-[color:rgba(58,56,57,0.5)] py-3 pr-3 pl-0 text-left transition-colors"
      style={{
        backgroundColor: selected
          ? withAlpha(teamColor, 0.16)
          : hovered
            ? withAlpha(teamColor, 0.06)
            : undefined,
        boxShadow:
          hovered && !selected ? `inset 0 0 0 1px ${withAlpha(teamColor, 0.45)}` : undefined,
      }}
    >
      <span
        className={`absolute top-0 bottom-0 left-0 ${selected ? 'w-[4px]' : 'w-[3px]'}`}
        style={{
          backgroundColor: teamColor,
          boxShadow: selected ? `0 0 12px ${withAlpha(teamColor, 0.65)}` : undefined,
        }}
        aria-hidden
      />
      <span aria-hidden />
      <EventAvatar teamColor={teamColor} />
      <div className="min-w-0">
        <div className="truncate font-condensed text-[14px] leading-snug font-extrabold tracking-[0.04em] uppercase text-fg-1">
          {actor}
          {target ? (
            <>
              <span className="mx-1.5 text-fg-3">›</span>
              <span className="text-fg-2">{target}</span>
            </>
          ) : null}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <EventTypePill label={pillLabel} color={teamColor} isHomeSide={isHomeSide} />
          <span className="font-condensed text-[12px] leading-none font-extrabold tracking-[0.04em] tabular-nums text-fg-1">
            {event.clock ?? '—'}
          </span>
          <span className="font-condensed text-[10px] leading-none font-extrabold tracking-[0.18em] uppercase text-fg-3">
            {periodTag}
          </span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <CardEventMark eventType={event.eventType} side={side} teamColor={teamColor} />
        {noMarker ? (
          <span className="inline-flex items-center border border-dashed border-border px-1.5 py-[2px] font-condensed text-[9px] font-bold tracking-[0.16em] uppercase text-fg-3">
            No marker
          </span>
        ) : null}
        {lowConf ? (
          <span className="inline-flex items-center border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.10)] px-1.5 py-[2px] font-condensed text-[9px] font-bold tracking-[0.16em] uppercase text-[var(--color-otl)]">
            Approx
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Inline glyph matching this event's rink marker, in the same team colour and
 * the same home/away treatment — so card and ice are visibly one object.
 */
function CardEventMark({
  eventType,
  side,
  teamColor,
  size = 24,
}: {
  eventType: string
  side: 'home' | 'away'
  teamColor: string
  size?: number
}) {
  const colorProps = side === 'home' ? { homeColor: teamColor } : { awayColor: teamColor }
  if (eventType === 'goal') return <GoalMarker side={side} size={size} {...colorProps} />
  if (eventType === 'shot') return <ShotMarker side={side} size={size} {...colorProps} />
  if (eventType === 'hit') return <HitMarker side={side} size={size} {...colorProps} />
  if (eventType === 'penalty') return <PenaltyMarker side={side} size={size} {...colorProps} />
  // Faceoff has no rink marker — dashed ring tinted with the winner's colour.
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="shrink-0" aria-hidden>
      <circle
        cx={12}
        cy={12}
        r={9}
        fill="none"
        stroke={teamColor}
        strokeDasharray="2 2"
        strokeWidth={1.75}
      />
    </svg>
  )
}

function EventTypePill({
  label,
  color,
  isHomeSide,
}: {
  label: string
  color: string
  isHomeSide: boolean
}) {
  // Team-tinted pill. Home-side pills get a thin white ring to echo the white
  // outline on the home-side rink markers. Text uses the team colour directly —
  // both `--color-accent` and `--opp` are guaranteed legible on the dark
  // surface (the Phase 1 resolver enforces a lightness floor on `--opp`), so
  // the old dark-hex promotion is no longer needed.
  return (
    <span
      className="inline-flex items-center px-2 py-[3px] font-condensed text-[11px] font-extrabold tracking-[0.14em] uppercase"
      style={{
        color,
        backgroundColor: withAlpha(color, 0.2),
        border: `1px solid ${withAlpha(color, 0.65)}`,
        boxShadow: isHomeSide ? '0 0 0 1.5px #fff' : undefined,
      }}
    >
      {label}
    </span>
  )
}

function EventAvatar({ teamColor }: { teamColor: string }) {
  return (
    <div
      className="flex h-8 w-8 items-end justify-center overflow-hidden rounded-full border bg-[linear-gradient(180deg,rgba(50,48,49,0.9),rgba(26,24,25,1))]"
      style={{ borderColor: withAlpha(teamColor, 0.65) }}
      aria-hidden
    >
      <PlayerSilhouette sizeClass="h-7 w-7" />
    </div>
  )
}
