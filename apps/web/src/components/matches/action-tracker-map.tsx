'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { MatchEventRow } from '@eanhl/db/queries'
import { SectionHeader } from '@/components/ui/section-header'
import { RinkSvg } from '@/components/branding/rink'
import {
  GoalMarker,
  HitMarker,
  PenaltyMarker,
  ShotMarker,
} from '@/components/branding/event-markers'
import { PlayerSilhouette } from '@/components/home/player-card'

/**
 * Action Tracker Map — Boogeymen Design System "Action Tracker Map.html"
 * Concept B handoff (`https://api.anthropic.com/v1/design/h/YeCIB2CKXirPonqDCu8tjw`).
 *
 * Layout: a broadcast-panel rink on the left, a 380-px right-rail event
 * list on the right, a filter bar + summary strip stacked above both.
 * Faceoffs are list-only by design (no positions captured by the OCR
 * pipeline yet); events with NULL (x,y) surface in the list with a
 * NO MARKER tag rather than being silently dropped.
 *
 * Implemented from the design:
 *   - Filter bar — period segment + team toggle + 5 type toggles with
 *     mini-marker swatches and count badges, plus a player-name search.
 *   - Summary strip — visible/on-rink/unplaced counts + per-type totals.
 *   - Rink head — direction indicator ("opp ← defends · attacks → BGM").
 *   - Event cards — left rail accent (red for BGM, neutral for opp),
 *     when (clock + period), type icon (uses the same marker component
 *     as the rink), silhouette avatar, body (event type label + actor
 *     line + target/infraction line), right-side period tag with
 *     NO MARKER / LOWCONF badges when applicable.
 *   - Sticky period dividers inside the list.
 *
 * Deferred (per the design's "v1" envelope):
 *   - Bi-directional sync (click card ↔ highlight marker)
 *   - Sort dropdown / goals-only quick mode
 *   - Marker hover/selected halo states (rink markers stay statically rendered)
 */

interface ActionTrackerMapProps {
  events: MatchEventRow[]
  opponentLabel: string
  /** Hex (e.g. `#cc3333`) extracted from the opp crest. Null = neutral palette. */
  opponentColor?: string | null
  /**
   * Whether BGM had home ice. Drives the marker design treatment so the
   * home-side glyph (solid fill) is drawn for the team that was actually
   * home and the away-side glyph (color ring around a white center) for
   * the visitor. Null = legacy fallback where BGM is always home.
   */
  bgmWasHome?: boolean | null
}

const BGM_COLOR = '#ce202f'

type FilterableType = 'goal' | 'shot' | 'hit' | 'penalty' | 'faceoff'
type TeamFilter = 'all' | 'home' | 'away'
type PeriodFilter = 'all' | number
type SortMode = 'period' | 'chrono' | 'newest'

const ALL_TYPES: FilterableType[] = ['goal', 'shot', 'hit', 'penalty', 'faceoff']
const TRACKED_TYPES = new Set<string>(ALL_TYPES)
const TYPE_META: { type: FilterableType; label: string }[] = [
  { type: 'goal', label: 'Goals' },
  { type: 'shot', label: 'Shots' },
  { type: 'hit', label: 'Hits' },
  { type: 'penalty', label: 'Penalties' },
  { type: 'faceoff', label: 'Faceoffs' },
]

export function ActionTrackerMap({
  events,
  opponentLabel,
  opponentColor,
  bgmWasHome,
}: ActionTrackerMapProps) {
  // The marker geometry has two design treatments — `home` (solid) and
  // `away` (outline). We assign them based on actual match home/away. Each
  // team also keeps its own color regardless of which treatment it ends up
  // wearing, so both home- and away-style glyphs render in the right hex.
  const bgmIsHome = bgmWasHome !== false
  const homeColor = bgmIsHome ? BGM_COLOR : opponentColor ?? null
  const awayColor = bgmIsHome ? opponentColor ?? null : BGM_COLOR
  const tracked = events.filter((e) => TRACKED_TYPES.has(e.eventType))

  const [enabledTypes, setEnabledTypes] = useState<Set<FilterableType>>(new Set(ALL_TYPES))
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all')
  const [teamFilter, setTeamFilter] = useState<TeamFilter>('all')
  const [search, setSearch] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('period')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  if (tracked.length === 0) return null

  const oppAbbrev = abbreviateTeam(opponentLabel)

  const periodsAvailable = useMemo(() => {
    const set = new Map<number, string>()
    for (const e of tracked) set.set(e.periodNumber, e.periodLabel ?? `P${String(e.periodNumber)}`)
    return [...set.entries()].sort(([a], [b]) => a - b)
  }, [tracked])

  // Period + team pool drives chip counts so badges reflect what's reachable.
  const teamScoped = useMemo(() => {
    return tracked.filter((e) => {
      if (teamFilter === 'home' && e.teamSide !== 'for') return false
      if (teamFilter === 'away' && e.teamSide !== 'against') return false
      return true
    })
  }, [tracked, teamFilter])

  const periodScoped = useMemo(() => {
    return teamScoped.filter((e) => periodFilter === 'all' || e.periodNumber === periodFilter)
  }, [teamScoped, periodFilter])

  const periodCounts: Record<'all' | number, number> = { all: teamScoped.length }
  for (const [n] of periodsAvailable) periodCounts[n] = 0
  for (const e of teamScoped) {
    periodCounts[e.periodNumber] = (periodCounts[e.periodNumber] ?? 0) + 1
  }

  const typeCounts: Record<FilterableType, number> = {
    goal: 0, shot: 0, hit: 0, penalty: 0, faceoff: 0,
  }
  for (const e of periodScoped) {
    if (e.eventType in typeCounts) typeCounts[e.eventType as FilterableType]++
  }

  const visibleCards = useMemo(() => {
    const q = search.trim().toLowerCase()
    return periodScoped.filter((e) => {
      if (!(e.eventType in typeCounts)) return false
      if (!enabledTypes.has(e.eventType as FilterableType)) return false
      if (!q) return true
      const haystack = [
        e.actor?.gamertag,
        e.actorGamertagSnapshot,
        e.target?.gamertag,
        e.targetGamertagSnapshot,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [periodScoped, enabledTypes, search, typeCounts])

  const visibleMarkers = visibleCards.filter(
    (e) => e.eventType !== 'faceoff' && e.x !== null && e.y !== null,
  )
  const unplaced = visibleCards.length - visibleMarkers.length

  const matchTotals = useMemo(() => {
    const t = { goalsBgm: 0, goalsOpp: 0, shots: 0, hits: 0, penalties: 0 }
    for (const e of tracked) {
      switch (e.eventType) {
        case 'goal':
          if (e.teamSide === 'for') t.goalsBgm++
          else t.goalsOpp++
          break
        case 'shot': t.shots++; break
        case 'hit': t.hits++; break
        case 'penalty': t.penalties++; break
      }
    }
    return t
  }, [tracked])

  // OCR confidence proxy: fraction of positioned events whose position is not
  // extrapolated. We don't ship a per-event OCR score yet, but positionConfidence
  // is the closest signal exposed today.
  const ocrConfidence = useMemo(() => {
    const positioned = tracked.filter((e) => e.x !== null && e.y !== null)
    if (positioned.length === 0) return null
    const confirmed = positioned.filter((e) => e.positionConfidence !== 'extrapolated').length
    return confirmed / positioned.length
  }, [tracked])

  const goalsOnly = enabledTypes.size === 1 && enabledTypes.has('goal')
  const toggleGoalsOnly = () => {
    setEnabledTypes(goalsOnly ? new Set(ALL_TYPES) : new Set(['goal']))
  }

  const toggleSelected = (id: number) => setSelectedId((prev) => (prev === id ? null : id))
  const clearSelected = () => setSelectedId(null)

  const toggleType = (t: FilterableType) => {
    setEnabledTypes((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  return (
    <section className="space-y-3">
      <SectionHeader label="Action Tracker Map" subtitle="Post-game OCR · event positions on the rink" />

      <FilterBar
        periodsAvailable={periodsAvailable}
        periodFilter={periodFilter}
        setPeriodFilter={setPeriodFilter}
        teamFilter={teamFilter}
        setTeamFilter={setTeamFilter}
        oppAbbrev={oppAbbrev}
        periodCounts={periodCounts}
        typeCounts={typeCounts}
        enabledTypes={enabledTypes}
        toggleType={toggleType}
        search={search}
        setSearch={setSearch}
        goalsOnly={goalsOnly}
        toggleGoalsOnly={toggleGoalsOnly}
      />

      <SummaryStrip
        visible={visibleCards.length}
        onRink={visibleMarkers.length}
        unplaced={unplaced}
        totals={matchTotals}
        oppAbbrev={oppAbbrev}
        ocrConfidence={ocrConfidence}
      />

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[380px_1fr]">
        <EventList
          events={visibleCards}
          sortMode={sortMode}
          setSortMode={setSortMode}
          selectedId={selectedId}
          hoveredId={hoveredId}
          onHover={setHoveredId}
          onSelect={toggleSelected}
          opponentColor={opponentColor ?? null}
        />
        <RinkPanel
          events={visibleMarkers}
          oppAbbrev={oppAbbrev}
          hoveredId={hoveredId}
          onHover={setHoveredId}
          selectedId={selectedId}
          onSelect={toggleSelected}
          onClearSelected={clearSelected}
          bgmIsHome={bgmIsHome}
          homeColor={homeColor}
          awayColor={awayColor}
        />
      </div>
    </section>
  )
}

// ─── Filter bar ─────────────────────────────────────────────────────────────

function FilterBar({
  periodsAvailable,
  periodFilter,
  setPeriodFilter,
  teamFilter,
  setTeamFilter,
  oppAbbrev,
  periodCounts,
  typeCounts,
  enabledTypes,
  toggleType,
  search,
  setSearch,
  goalsOnly,
  toggleGoalsOnly,
}: {
  periodsAvailable: Array<[number, string]>
  periodFilter: PeriodFilter
  setPeriodFilter: (p: PeriodFilter) => void
  teamFilter: TeamFilter
  setTeamFilter: (t: TeamFilter) => void
  oppAbbrev: string
  periodCounts: Record<'all' | number, number>
  typeCounts: Record<FilterableType, number>
  enabledTypes: Set<FilterableType>
  toggleType: (t: FilterableType) => void
  search: string
  setSearch: (v: string) => void
  goalsOnly: boolean
  toggleGoalsOnly: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5">
      <FilterLabel>Period</FilterLabel>
      <Segment>
        <SegButton
          active={periodFilter === 'all'}
          onClick={() => setPeriodFilter('all')}
          label="All"
          count={periodCounts.all}
        />
        {periodsAvailable.map(([n, label]) => (
          <SegButton
            key={n}
            active={periodFilter === n}
            onClick={() => setPeriodFilter(n)}
            label={cleanPeriodLabel(label) || `P${String(n)}`}
            count={periodCounts[n] ?? 0}
          />
        ))}
      </Segment>

      <FilterLabel>Team</FilterLabel>
      <Segment>
        <SegButton
          active={teamFilter === 'all'}
          onClick={() => setTeamFilter('all')}
          label="All"
        />
        <SegButton
          active={teamFilter === 'home'}
          onClick={() => setTeamFilter('home')}
          label="BGM"
          tintAccent={teamFilter !== 'home'}
        />
        <SegButton
          active={teamFilter === 'away'}
          onClick={() => setTeamFilter('away')}
          label={oppAbbrev}
        />
      </Segment>

      <div className="flex flex-wrap items-center gap-1.5">
        {TYPE_META.map((t) => (
          <TypeToggle
            key={t.type}
            type={t.type}
            label={t.label}
            count={typeCounts[t.type]}
            active={enabledTypes.has(t.type)}
            onToggle={() => toggleType(t.type)}
          />
        ))}
      </div>

      <SearchInput value={search} onChange={setSearch} />

      <button
        type="button"
        onClick={toggleGoalsOnly}
        aria-pressed={goalsOnly}
        className={`ml-auto inline-flex items-center gap-1.5 border px-2.5 py-[5px] font-condensed text-[10.5px] font-bold uppercase tracking-[0.16em] transition-colors ${
          goalsOnly
            ? 'border-[rgba(232,65,49,0.4)] bg-[rgba(232,65,49,0.10)] text-[var(--color-accent)]'
            : 'border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-fg-3)] hover:text-[var(--color-fg-1)]'
        }`}
      >
        <GoalMarker side="home" size={12} />
        <span>Goals only</span>
      </button>
    </div>
  )
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-condensed text-[9px] font-bold uppercase tracking-[0.22em] text-[var(--color-fg-5)]">
      {children}
    </span>
  )
}

function Segment({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex divide-x divide-[var(--color-border)] border border-[var(--color-border)] bg-[var(--color-background)]">
      {children}
    </div>
  )
}

function SegButton({
  active,
  onClick,
  label,
  count,
  tintAccent,
}: {
  active: boolean
  onClick: () => void
  label: string
  count?: number
  tintAccent?: boolean
}) {
  const base =
    'inline-flex items-center gap-1.5 px-2.5 py-1.5 font-condensed text-[10.5px] font-bold uppercase tracking-[0.14em] transition-colors'
  const tone = active
    ? 'bg-[rgba(232,65,49,0.10)] text-[var(--color-accent)]'
    : tintAccent === true
      ? 'text-[var(--color-accent)] hover:text-[#ef6a5e]'
      : 'text-[var(--color-fg-4)] hover:text-[var(--color-fg-2)]'
  return (
    <button type="button" onClick={onClick} className={`${base} ${tone}`}>
      <span>{label}</span>
      {count !== undefined ? (
        <span
          className={`min-w-[16px] border px-1 py-[1px] text-center font-condensed text-[9.5px] font-bold tabular-nums ${
            active
              ? 'border-[rgba(232,65,49,0.4)] text-[var(--color-accent)]'
              : 'border-[var(--color-border)] text-[var(--color-fg-5)]'
          }`}
        >
          {count}
        </span>
      ) : null}
    </button>
  )
}

function TypeToggle({
  type,
  label,
  count,
  active,
  onToggle,
}: {
  type: FilterableType
  label: string
  count: number
  active: boolean
  onToggle: () => void
}) {
  const isFaceoff = type === 'faceoff'
  const base =
    'inline-flex items-center gap-1.5 border px-2.5 py-1 font-condensed text-[10.5px] font-bold uppercase tracking-[0.1em] transition-colors'
  const tone = active
    ? 'border-[rgba(232,65,49,0.4)] bg-[rgba(232,65,49,0.10)] text-[var(--color-fg-1)]'
    : 'border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-fg-3)] opacity-60 hover:opacity-100'
  const dashed = isFaceoff ? 'border-dashed' : ''
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`${base} ${tone} ${dashed}`}
    >
      <TypeSwatch type={type} />
      <span>{label}</span>
      <span
        className={`min-w-[16px] border px-1 py-[1px] text-center font-condensed text-[9.5px] font-bold tabular-nums ${
          active
            ? 'border-[rgba(232,65,49,0.4)] text-[var(--color-accent)]'
            : 'border-[var(--color-border)] text-[var(--color-fg-5)]'
        }`}
      >
        {count}
      </span>
      {isFaceoff ? (
        <span className="font-condensed text-[8.5px] font-semibold tracking-[0.18em] text-[var(--color-fg-5)]">
          List only
        </span>
      ) : null}
    </button>
  )
}

function TypeSwatch({ type }: { type: FilterableType }) {
  const size = 14
  if (type === 'goal') return <GoalMarker side="home" size={size} />
  if (type === 'shot') return <ShotMarker side="home" size={size} />
  if (type === 'hit') return <HitMarker side="home" size={size} />
  if (type === 'penalty') return <PenaltyMarker side="home" size={size} />
  // Faceoff has no marker; render a dashed circle.
  return (
    <span
      className="inline-block rounded-full border border-dashed border-[var(--color-fg-5)]"
      style={{ width: 14, height: 14 }}
    />
  )
}

function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5 border border-[var(--color-border)] bg-[var(--color-background)] px-2.5 py-1">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-3 w-3 text-[var(--color-fg-5)]">
        <circle cx={11} cy={11} r={7} />
        <line x1={21} y1={21} x2={16.65} y2={16.65} />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search player / tag…"
        className="min-w-[140px] bg-transparent font-condensed text-[12px] font-semibold tracking-[0.04em] text-[var(--color-fg-1)] placeholder:text-[var(--color-fg-5)] focus:outline-none"
      />
    </label>
  )
}

// ─── Summary strip ──────────────────────────────────────────────────────────

function SummaryStrip({
  visible,
  onRink,
  unplaced,
  totals,
  oppAbbrev,
  ocrConfidence,
}: {
  visible: number
  onRink: number
  unplaced: number
  totals: { goalsBgm: number; goalsOpp: number; shots: number; hits: number; penalties: number }
  oppAbbrev: string
  ocrConfidence: number | null
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border border-t-0 border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2">
      <SummaryGroup>
        <SummaryKV k="Visible" v={String(visible)} />
        <SummaryKV k="On rink" v={String(onRink)} dim />
        <SummaryKV k="Unplaced" v={String(unplaced)} dim />
      </SummaryGroup>
      <div className="h-7 w-px bg-[var(--color-border)]" aria-hidden />
      <SummaryGroup>
        <SummaryKV k="Goals · BGM" v={String(totals.goalsBgm)} accent />
        <SummaryKV k={oppAbbrev} v={String(totals.goalsOpp)} />
        <SummaryKV k="Shots" v={String(totals.shots)} />
        <SummaryKV k="Hits" v={String(totals.hits)} />
        <SummaryKV k="Penalties" v={String(totals.penalties)} />
      </SummaryGroup>
      <div className="h-7 w-px bg-[var(--color-border)]" aria-hidden />
      <SummaryGroup>
        {ocrConfidence !== null && ocrConfidence >= 0.75 ? (
          <SummaryKV k="OCR confidence" v={ocrConfidence.toFixed(2)} tone="win" />
        ) : (
          <SummaryKV
            k="OCR confidence"
            v={ocrConfidence === null ? '—' : ocrConfidence.toFixed(2)}
          />
        )}
        <SummaryKV k="Source" v="Action Tracker OCR · v2" small />
      </SummaryGroup>
    </div>
  )
}

function SummaryGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">{children}</div>
}

function SummaryKV({
  k,
  v,
  accent,
  dim,
  tone,
  small,
}: {
  k: string
  v: string
  accent?: boolean
  dim?: boolean
  tone?: 'win'
  small?: boolean
}) {
  const colorClass = accent === true
    ? 'text-[var(--color-accent)]'
    : tone === 'win'
      ? 'text-[var(--color-win,#3fb27f)]'
      : dim === true
        ? 'text-[var(--color-fg-4)]'
        : small === true
          ? 'text-[var(--color-fg-3)]'
          : 'text-[var(--color-fg-1)]'
  const sizeClass = small === true ? 'text-[11px] font-bold' : 'text-[18px] font-black tabular-nums'
  return (
    <div className="flex flex-col gap-[1px]">
      <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-5)]">
        {k}
      </span>
      <span className={`font-condensed leading-none ${sizeClass} ${colorClass}`}>
        {v}
      </span>
    </div>
  )
}

// ─── Rink panel ─────────────────────────────────────────────────────────────

function RinkPanel({
  events,
  oppAbbrev,
  hoveredId,
  onHover,
  selectedId,
  onSelect,
  onClearSelected,
  bgmIsHome,
  homeColor,
  awayColor,
}: {
  events: MatchEventRow[]
  oppAbbrev: string
  hoveredId: number | null
  onHover: (id: number | null) => void
  selectedId: number | null
  onSelect: (id: number) => void
  onClearSelected: () => void
  bgmIsHome: boolean
  homeColor: string | null
  awayColor: string | null
}) {
  // Tooltip prefers explicit hover; falls back to the selected marker so the
  // pinned event keeps its detail panel visible.
  const focusedId = hoveredId ?? selectedId
  const focused = focusedId === null ? null : events.find((e) => e.id === focusedId) ?? null
  return (
    <div className="border border-[var(--color-border)] broadcast-panel-strong px-3.5 pb-2 pt-3.5">
      <div className="mb-2.5 flex items-center gap-3.5">
        <span className="font-condensed text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--color-fg-4)]">
          Event map · 5-on-5 ice
        </span>
        <div className="ml-auto flex items-center gap-3.5 font-condensed text-[10px] font-bold uppercase tracking-[0.18em]">
          <span className="text-[var(--color-fg-3)]">{oppAbbrev} ←</span>
          <span className="text-[var(--color-fg-6)]">defends · attacks</span>
          <span className="text-[var(--color-accent)]">→ BGM</span>
        </div>
      </div>
      <div
        className="relative w-full"
        style={{ aspectRatio: `${String(VIEW_W)} / ${String(VIEW_H)}` }}
        onMouseLeave={() => onHover(null)}
        onClick={onClearSelected}
      >
        <RinkSvg className="block h-full w-full" />
        <svg
          viewBox="0 0 2405 1025"
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
                onEnter={() => onHover(e.id)}
                onLeave={() => onHover(null)}
                onClick={() => onSelect(e.id)}
                bgmIsHome={bgmIsHome}
                homeColor={homeColor}
                awayColor={awayColor}
              />
            )
          })}
        </svg>
        {focused ? <MarkerTooltip event={focused} /> : null}
      </div>
    </div>
  )
}

function MarkerTooltip({ event }: { event: MatchEventRow }) {
  // Position the tooltip at the same clamped center as the rendered marker
  // — otherwise edge-of-rink events drift since the marker clamp moves the
  // glyph but the tooltip would stay at the raw coordinate.
  const center = markerCenter(event)
  const leftPct = (center.x / VIEW_W) * 100
  const topPct = (center.y / VIEW_H) * 100
  const isBgm = event.teamSide === 'for'
  const actor = event.actor?.gamertag ?? event.actorGamertagSnapshot ?? '—'
  const target = event.target?.gamertag ?? event.targetGamertagSnapshot ?? null
  const infraction = (event as { infraction?: string | null }).infraction ?? null
  const targetLine = event.eventType === 'penalty'
    ? (infraction ? infraction.toUpperCase() : null)
    : target
  const periodTag = cleanPeriodLabel(event.periodLabel) || `P${String(event.periodNumber)}`
  const borderColor = isBgm ? 'rgba(232,65,49,0.45)' : 'var(--color-fg-3)'
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 max-w-[280px] min-w-[220px] -translate-x-1/2 px-3 py-2.5 bg-[var(--color-charcoal,#1a1819)]"
      style={{
        left: `${leftPct.toString()}%`,
        top: `${topPct.toString()}%`,
        transform: `translate(-50%, calc(-100% - 14px))`,
        border: `1px solid ${borderColor}`,
        boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
      }}
    >
      <span
        aria-hidden
        className="absolute left-1/2 -bottom-[7px] block h-3 w-3 -translate-x-1/2 rotate-45 bg-[var(--color-charcoal,#1a1819)]"
        style={{
          borderRight: `1px solid ${borderColor}`,
          borderBottom: `1px solid ${borderColor}`,
        }}
      />
      <div className="mb-1.5 flex items-center gap-2">
        <span
          className={`font-condensed text-[11px] font-black uppercase tracking-[0.18em] ${
            isBgm ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg-1)]'
          }`}
        >
          {event.eventType}
        </span>
        <span className="ml-auto font-condensed text-[10.5px] font-bold tabular-nums tracking-[0.06em] text-[var(--color-fg-3)]">
          {event.clock ?? '—'}
        </span>
      </div>
      <div className="font-condensed text-[14px] font-extrabold uppercase tracking-[0.04em] leading-tight text-[var(--color-fg-1)]">
        {actor}
      </div>
      {targetLine ? (
        <div className="mt-[3px] font-condensed text-[11px] font-semibold tracking-[0.04em] leading-tight text-[var(--color-fg-3)]">
          {event.eventType === 'penalty' ? (
            <span className="font-extrabold uppercase tracking-[0.1em] text-[var(--color-otl)]">
              {targetLine}
            </span>
          ) : (
            <>
              <span className="mx-1.5 text-[var(--color-fg-5)]">→</span>
              {targetLine}
            </>
          )}
        </div>
      ) : null}
      <div className="mt-[7px] flex gap-3 border-t border-[var(--color-border)] pt-[7px] font-condensed text-[10px] font-bold uppercase tracking-[0.14em]">
        <span className={isBgm ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg-4)]'}>
          {periodTag}
        </span>
        {event.positionConfidence === 'extrapolated' ? (
          <span className="text-[var(--color-otl)]">Approx</span>
        ) : null}
      </div>
    </div>
  )
}

// ─── Event list ─────────────────────────────────────────────────────────────

function EventList({
  events,
  sortMode,
  setSortMode,
  selectedId,
  hoveredId,
  onHover,
  onSelect,
  opponentColor,
}: {
  events: MatchEventRow[]
  sortMode: SortMode
  setSortMode: (m: SortMode) => void
  selectedId: number | null
  hoveredId: number | null
  onHover: (id: number | null) => void
  onSelect: (id: number) => void
  opponentColor: string | null
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  // When a card becomes selected (by either click or marker click), scroll it
  // into view inside the list — block:'nearest' is a no-op if already visible.
  useEffect(() => {
    if (selectedId === null) return
    const container = scrollRef.current
    if (!container) return
    const target = container.querySelector<HTMLElement>(
      `[data-event-id="${String(selectedId)}"]`,
    )
    if (target) target.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])
  if (events.length === 0) {
    return (
      <div className="flex h-[420px] flex-col items-center justify-center gap-2 border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-6 text-center xl:h-[612px]">
        <div className="font-condensed text-[13px] font-extrabold uppercase tracking-[0.18em] text-[var(--color-fg-3)]">
          No events match
        </div>
        <div className="max-w-[240px] font-condensed text-[11px] font-semibold leading-relaxed text-[var(--color-fg-5)]">
          Adjust the period / team / type filters above or clear the search.
        </div>
      </div>
    )
  }

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
  const byPeriod: Array<{ period: number; label: string; rows: MatchEventRow[] }> = []
  if (showPeriodDividers) {
    for (const e of sorted) {
      const last = byPeriod[byPeriod.length - 1]
      if (last && last.period === e.periodNumber) {
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
    <div className="flex h-[420px] flex-col border border-[var(--color-border)] bg-[var(--color-surface)] xl:h-[612px]">
      <div className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-3.5 py-2.5">
        <span className="font-condensed text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--color-fg-3)]">
          Events
        </span>
        <SortSelect value={sortMode} onChange={setSortMode} />
        <span className="ml-auto font-condensed text-[10px] font-bold tracking-[0.14em] text-[var(--color-fg-5)]">
          <b className="font-black tabular-nums text-[var(--color-accent)]">{events.length}</b> shown
        </span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {showPeriodDividers
          ? byPeriod.map((g) => (
              <div key={g.period}>
                <PeriodDivider label={g.label} count={g.rows.length} />
                {g.rows.map((e) => (
                  <EventCard
                    key={e.id}
                    event={e}
                    selected={selectedId === e.id}
                    hovered={hoveredId === e.id}
                    onSelect={() => onSelect(e.id)}
                    onHover={onHover}
                    opponentColor={opponentColor}
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
                onSelect={() => onSelect(e.id)}
                onHover={onHover}
                opponentColor={opponentColor}
              />
            ))}
      </div>
    </div>
  )
}

function SortSelect({ value, onChange }: { value: SortMode; onChange: (m: SortMode) => void }) {
  return (
    <label className="inline-flex items-center gap-1.5">
      <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-5)]">
        Sort
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as SortMode)}
        className="border border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-[3px] font-condensed text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-fg-2)] focus:outline-none"
      >
        <option value="period">By period</option>
        <option value="chrono">Chronological</option>
        <option value="newest">Newest first</option>
      </select>
    </label>
  )
}

function PeriodDivider({ label, count }: { label: string; count: number }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-y border-[var(--color-border)] bg-[var(--color-background)] px-3.5 py-2">
      <span className="font-condensed text-[9.5px] font-extrabold uppercase tracking-[0.22em] text-[var(--color-accent)]">
        {label}
      </span>
      <span className="h-px flex-1 bg-[var(--color-border)]" aria-hidden />
      <span className="font-condensed text-[9.5px] font-bold tracking-[0.18em] tabular-nums text-[var(--color-fg-5)]">
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
  opponentColor,
}: {
  event: MatchEventRow
  selected: boolean
  hovered: boolean
  onSelect: () => void
  onHover: (id: number | null) => void
  opponentColor: string | null
}) {
  const isBgm = event.teamSide === 'for'
  const isFaceoff = event.eventType === 'faceoff'
  const noMarker = !isFaceoff && (event.x === null || event.y === null)
  const lowConf = event.positionConfidence === 'extrapolated'

  // Cards paint in each event's team identity color, independent of the
  // rink marker design (solid vs outline). A BGM card is always BGM red;
  // an opp card uses the extracted opponent color, with a neutral fallback.
  const teamColor = isBgm ? BGM_COLOR : (opponentColor ?? '#7c7c80')

  const rail = isFaceoff
    ? 'bg-[linear-gradient(180deg,var(--color-accent)_50%,var(--color-fg-3)_50%)]'
    : undefined

  const actor = event.actor?.gamertag ?? event.actorGamertagSnapshot ?? '—'
  const target = event.target?.gamertag ?? event.targetGamertagSnapshot ?? null
  const periodTag = cleanPeriodLabel(event.periodLabel) || `P${String(event.periodNumber)}`
  const infraction = (event as { infraction?: string | null }).infraction ?? null
  const pillLabel = event.eventType === 'penalty' && infraction
    ? infraction.toUpperCase()
    : event.eventType.toUpperCase()

  // Selected wins over hover. Hover (from marker or pointer) adds a soft
  // accent ring so the user can see which card the rink interaction maps to.
  const bgClass = selected
    ? isBgm
      ? 'bg-[rgba(232,65,49,0.10)]'
      : 'bg-[rgba(235,235,235,0.04)]'
    : hovered
      ? 'bg-[rgba(232,65,49,0.05)]'
      : 'hover:bg-[rgba(232,65,49,0.04)]'
  const railWidth = selected ? 'w-[4px]' : 'w-[3px]'
  const railShadow = selected
    ? isBgm
      ? 'shadow-[0_0_10px_rgba(232,65,49,0.6)]'
      : 'shadow-[0_0_10px_rgba(235,235,235,0.4)]'
    : ''
  const hoverRing = hovered && !selected
    ? 'ring-1 ring-inset ring-[rgba(232,65,49,0.35)]'
    : ''

  return (
    <button
      type="button"
      onClick={onSelect}
      onMouseEnter={() => onHover(event.id)}
      onMouseLeave={() => onHover(null)}
      data-event-id={String(event.id)}
      aria-pressed={selected}
      className={`relative grid w-full grid-cols-[3px_36px_1fr_auto] items-start gap-2.5 border-b border-[color:rgba(58,56,57,0.5)] py-2.5 pl-0 pr-3 text-left transition-colors ${bgClass} ${hoverRing}`}
    >
      <span
        className={`absolute left-0 top-0 bottom-0 ${railWidth} ${rail ?? ''} ${railShadow}`}
        style={rail ? undefined : { backgroundColor: teamColor }}
        aria-hidden
      />
      <span aria-hidden />
      <EventAvatar isBgm={isBgm} />
      <div className="min-w-0">
        <div className="truncate font-condensed text-[13px] font-extrabold uppercase tracking-[0.04em] leading-tight text-[var(--color-fg-1)]">
          {actor}
          {target ? (
            <>
              <span className="mx-1.5 text-[var(--color-fg-5)]">›</span>
              <span className="text-[var(--color-fg-2)]">{target}</span>
            </>
          ) : null}
        </div>
        <div className="mt-1.5">
          <EventTypePill label={pillLabel} color={teamColor} />
        </div>
      </div>
      <div className="flex flex-col items-end gap-[3px]">
        <span className="font-condensed text-[11px] font-bold tabular-nums tracking-[0.04em] leading-none text-[var(--color-fg-2)]">
          {event.clock ?? '—'}
        </span>
        <span
          className={`font-condensed text-[9px] font-extrabold uppercase tracking-[0.2em] leading-none ${
            isBgm ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg-5)]'
          }`}
        >
          {periodTag}
        </span>
        {noMarker ? (
          <span className="inline-flex items-center gap-1 border border-dashed border-[var(--color-border)] px-1.5 py-[1px] font-condensed text-[8.5px] font-bold uppercase tracking-[0.18em] text-[var(--color-fg-5)]">
            No marker
          </span>
        ) : null}
        {lowConf ? (
          <span className="inline-flex items-center gap-1 border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.10)] px-1.5 py-[1px] font-condensed text-[8.5px] font-bold uppercase tracking-[0.18em] text-[var(--color-otl)]">
            Approx
          </span>
        ) : null}
      </div>
    </button>
  )
}

function EventTypePill({ label, color }: { label: string; color: string }) {
  // Team-tinted pill: 14%-alpha fill, color-tinted border, color-tinted
  // text. Reads as a button without claiming click affordance.
  return (
    <span
      className="inline-flex items-center px-1.5 py-[2px] font-condensed text-[9.5px] font-bold uppercase tracking-[0.18em]"
      style={{
        color,
        borderColor: hexWithAlpha(color, 0.55),
        backgroundColor: hexWithAlpha(color, 0.14),
        border: `1px solid ${hexWithAlpha(color, 0.55)}`,
      }}
    >
      {label}
    </span>
  )
}

/**
 * Append an opacity (0–1) to a hex color string, returning a CSS rgba()
 * value. Handles both 3- and 6-char hex inputs. Falls through to the
 * original string for unrecognised formats so callers don't break.
 */
function hexWithAlpha(hex: string, alpha: number): string {
  const trimmed = hex.trim().replace('#', '')
  const isShort = trimmed.length === 3
  const isLong = trimmed.length === 6
  if (!isShort && !isLong) return hex
  const expand = (s: string): number => parseInt(s.length === 1 ? s + s : s, 16)
  const r = expand(isShort ? trimmed[0]! : trimmed.slice(0, 2))
  const g = expand(isShort ? trimmed[1]! : trimmed.slice(2, 4))
  const b = expand(isShort ? trimmed[2]! : trimmed.slice(4, 6))
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`
}

function EventAvatar({ isBgm }: { isBgm: boolean }) {
  return (
    <div
      className={`flex h-8 w-8 items-end justify-center overflow-hidden rounded-full border ${
        isBgm
          ? 'border-[rgba(232,65,49,0.3)] bg-[linear-gradient(180deg,rgba(50,48,49,0.9),rgba(26,24,25,1))]'
          : 'border-[var(--color-border)] bg-[linear-gradient(180deg,rgba(50,48,49,0.9),rgba(26,24,25,1))]'
      }`}
      aria-hidden
    >
      <PlayerSilhouette sizeClass="h-7 w-7" />
    </div>
  )
}

// ─── Rink markers (reused from prior implementation) ────────────────────────

function Marker({
  event,
  hovered,
  selected,
  faded,
  onEnter,
  onLeave,
  onClick,
  bgmIsHome,
  homeColor,
  awayColor,
}: {
  event: MatchEventRow
  hovered: boolean
  selected: boolean
  faded: boolean
  onEnter: () => void
  onLeave: () => void
  onClick: () => void
  bgmIsHome: boolean
  homeColor: string | null
  awayColor: string | null
}) {
  const hockeyX = Number(event.x)
  const hockeyY = Number(event.y)
  const svgX = rinkX(hockeyX)
  const svgY = rinkY(hockeyY)
  const side: 'home' | 'away' = resolveMarkerSide(event.teamSide, bgmIsHome)
  const extrapolated = event.positionConfidence === 'extrapolated'

  const common = {
    x: svgX,
    y: svgY,
    extrapolated,
    hovered,
    selected,
    faded,
    onEnter,
    onLeave,
    onClick,
  }

  switch (event.eventType) {
    case 'goal':
      return (
        <PlacedMarker {...common} width={112} height={97}>
          <GoalMarker side={side} size={112} homeColor={homeColor} awayColor={awayColor} />
        </PlacedMarker>
      )
    case 'shot':
      return (
        <PlacedMarker {...common} width={84} height={84}>
          <ShotMarker side={side} size={84} homeColor={homeColor} awayColor={awayColor} />
        </PlacedMarker>
      )
    case 'hit':
      return (
        <PlacedMarker {...common} width={80} height={80}>
          <HitMarker side={side} size={80} homeColor={homeColor} awayColor={awayColor} />
        </PlacedMarker>
      )
    case 'penalty':
      return (
        <PlacedMarker {...common} width={112} height={112}>
          <PenaltyMarker side={side} size={112} homeColor={homeColor} awayColor={awayColor} />
        </PlacedMarker>
      )
    default:
      return null
  }
}

/**
 * Resolve which marker design treatment ('home' = solid, 'away' = outline)
 * an event should wear based on its team side and which team had home ice
 * in the match. Defaults to BGM-as-home when bgmIsHome can't be determined.
 */
function resolveMarkerSide(
  teamSide: MatchEventRow['teamSide'],
  bgmIsHome: boolean,
): 'home' | 'away' {
  const eventIsBgm = teamSide === 'for'
  return eventIsBgm === bgmIsHome ? 'home' : 'away'
}

function PlacedMarker({
  x,
  y,
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
  x: number
  y: number
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
  const cx = Math.max(halfW, Math.min(VIEW_W - halfW, x))
  const cy = Math.max(halfH, Math.min(VIEW_H - halfH, y))
  const haloR = Math.max(width, height) * 0.55
  // Selection wins over fade for the chosen marker. Hover halo is drawn under
  // the selected halo so the strong-accent state isn't washed out.
  const baseOpacity = faded ? 0.18 : (extrapolated === true ? 0.5 : 1)
  const groupStyle: React.CSSProperties = {
    cursor: faded ? 'default' : 'pointer',
    pointerEvents: faded ? 'none' : 'auto',
    filter: selected ? 'drop-shadow(0 0 12px rgba(232,65,49,0.85))' : undefined,
    transition: 'opacity 0.12s, filter 0.12s',
  }
  return (
    <g
      transform={`translate(${cx}, ${cy})`}
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
          r={haloR}
          fill="rgba(232,65,49,0.22)"
          stroke="var(--color-accent)"
          strokeWidth={6}
        />
      ) : hovered ? (
        <circle
          r={haloR}
          fill="rgba(232,65,49,0.06)"
          stroke="rgba(232,65,49,0.42)"
          strokeWidth={2}
        />
      ) : null}
      <g transform={`translate(${-halfW}, ${-halfH})`}>{children}</g>
    </g>
  )
}

const VIEW_W = 2405
const VIEW_H = 1025

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
    case 'goal': return { width: 112, height: 97 }
    case 'shot': return { width: 84, height: 84 }
    case 'hit': return { width: 80, height: 80 }
    case 'penalty': return { width: 112, height: 112 }
    default: return { width: 84, height: 84 }
  }
}

function markerCenter(event: MatchEventRow): { x: number; y: number } {
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

// ─── Pure helpers ───────────────────────────────────────────────────────────

function clockToSeconds(clock: string | null): number {
  if (!clock) return 0
  const [m, s] = clock.split(':')
  return Number(m) * 60 + Number(s)
}

function cleanPeriodLabel(raw: string | null): string {
  if (!raw) return ''
  return raw
    .replace(/^\s*(?:RT|LT|RB|LB)\s+/i, '')
    .replace(/\s+(?:RT|LT|RB|LB)\s*$/i, '')
    .trim()
}

function abbreviateTeam(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'OPP'
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase()
  return words
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
}
