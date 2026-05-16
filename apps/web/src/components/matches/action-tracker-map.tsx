'use client'

import { useMemo, useState } from 'react'
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
}

type FilterableType = 'goal' | 'shot' | 'hit' | 'penalty' | 'faceoff'
type TeamFilter = 'all' | 'home' | 'away'
type PeriodFilter = 'all' | number

const ALL_TYPES: FilterableType[] = ['goal', 'shot', 'hit', 'penalty', 'faceoff']
const TRACKED_TYPES = new Set<string>(ALL_TYPES)
const TYPE_META: { type: FilterableType; label: string }[] = [
  { type: 'goal', label: 'Goals' },
  { type: 'shot', label: 'Shots' },
  { type: 'hit', label: 'Hits' },
  { type: 'penalty', label: 'Penalties' },
  { type: 'faceoff', label: 'Faceoffs' },
]

export function ActionTrackerMap({ events, opponentLabel }: ActionTrackerMapProps) {
  const tracked = events.filter((e) => TRACKED_TYPES.has(e.eventType))

  const [enabledTypes, setEnabledTypes] = useState<Set<FilterableType>>(new Set(ALL_TYPES))
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all')
  const [teamFilter, setTeamFilter] = useState<TeamFilter>('all')
  const [search, setSearch] = useState('')

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
      />

      <SummaryStrip
        visible={visibleCards.length}
        onRink={visibleMarkers.length}
        unplaced={unplaced}
        totals={matchTotals}
        oppAbbrev={oppAbbrev}
      />

      <div className="grid grid-cols-1 gap-3.5 xl:grid-cols-[1fr_380px]">
        <RinkPanel events={visibleMarkers} oppAbbrev={oppAbbrev} />
        <EventList events={visibleCards} oppAbbrev={oppAbbrev} />
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
}: {
  visible: number
  onRink: number
  unplaced: number
  totals: { goalsBgm: number; goalsOpp: number; shots: number; hits: number; penalties: number }
  oppAbbrev: string
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
}: {
  k: string
  v: string
  accent?: boolean
  dim?: boolean
}) {
  return (
    <div className="flex flex-col gap-[1px]">
      <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-5)]">
        {k}
      </span>
      <span
        className={`font-condensed text-[18px] font-black tabular-nums leading-none ${
          accent === true
            ? 'text-[var(--color-accent)]'
            : dim === true
              ? 'text-[var(--color-fg-4)]'
              : 'text-[var(--color-fg-1)]'
        }`}
      >
        {v}
      </span>
    </div>
  )
}

// ─── Rink panel ─────────────────────────────────────────────────────────────

function RinkPanel({ events, oppAbbrev }: { events: MatchEventRow[]; oppAbbrev: string }) {
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
      <div className="relative w-full">
        <RinkSvg className="block h-auto w-full" />
        <svg
          viewBox="0 0 2405 1025"
          preserveAspectRatio="xMidYMid meet"
          className="absolute inset-0 block h-auto w-full"
          aria-hidden
        >
          {events.map((e) => (
            <Marker key={e.id} event={e} />
          ))}
        </svg>
      </div>
    </div>
  )
}

// ─── Event list ─────────────────────────────────────────────────────────────

function EventList({ events, oppAbbrev }: { events: MatchEventRow[]; oppAbbrev: string }) {
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

  // Period asc, then clock desc (clock counts down inside a period).
  const sorted = [...events].sort((a, b) => {
    if (a.periodNumber !== b.periodNumber) return a.periodNumber - b.periodNumber
    return clockToSeconds(b.clock) - clockToSeconds(a.clock)
  })
  const byPeriod: Array<{ period: number; label: string; rows: MatchEventRow[] }> = []
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

  return (
    <div className="flex h-[420px] flex-col border border-[var(--color-border)] bg-[var(--color-surface)] xl:h-[612px]">
      <div className="flex items-center gap-2.5 border-b border-[var(--color-border)] px-3.5 py-2.5">
        <span className="font-condensed text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--color-fg-3)]">
          Events
        </span>
        <span className="ml-auto font-condensed text-[10px] font-bold tracking-[0.14em] text-[var(--color-fg-5)]">
          <b className="font-black tabular-nums text-[var(--color-accent)]">{events.length}</b> shown
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {byPeriod.map((g) => (
          <div key={g.period}>
            <PeriodDivider label={g.label} count={g.rows.length} />
            {g.rows.map((e) => (
              <EventCard key={e.id} event={e} oppAbbrev={oppAbbrev} />
            ))}
          </div>
        ))}
      </div>
    </div>
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

function EventCard({ event, oppAbbrev }: { event: MatchEventRow; oppAbbrev: string }) {
  const isBgm = event.teamSide === 'for'
  const isFaceoff = event.eventType === 'faceoff'
  const noMarker = !isFaceoff && (event.x === null || event.y === null)
  const lowConf = event.positionConfidence === 'extrapolated'

  const rail = isFaceoff
    ? 'bg-[linear-gradient(180deg,var(--color-accent)_50%,var(--color-fg-3)_50%)]'
    : isBgm
      ? 'bg-[var(--color-accent)]'
      : 'bg-[var(--color-fg-3)]'

  const actor = event.actor?.gamertag ?? event.actorGamertagSnapshot ?? '—'
  const target = event.target?.gamertag ?? event.targetGamertagSnapshot ?? null
  const periodTag = cleanPeriodLabel(event.periodLabel) || `P${String(event.periodNumber)}`
  const infraction = (event as { infraction?: string | null }).infraction ?? null
  const targetLine = event.eventType === 'penalty'
    ? (infraction ? infraction.toUpperCase() : null)
    : target

  return (
    <div className="relative grid grid-cols-[3px_38px_36px_1fr_auto] items-center gap-2.5 border-b border-[color:rgba(58,56,57,0.5)] py-2.5 pl-0 pr-3 transition-colors hover:bg-[rgba(232,65,49,0.04)]">
      <span className={`absolute left-0 top-0 bottom-0 w-[3px] ${rail}`} aria-hidden />
      <span aria-hidden />
      <span className="text-center font-condensed leading-tight">
        <span className="block font-condensed text-[10px] font-bold tabular-nums tracking-[0.04em] text-[var(--color-fg-3)]">
          {event.clock ?? '—'}
        </span>
        <span className="block font-condensed text-[8.5px] font-bold uppercase tracking-[0.16em] text-[var(--color-fg-6)]">
          {periodTag}
        </span>
      </span>
      <EventIcon eventType={event.eventType} isBgm={isBgm} />
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span
            className={`font-condensed text-[11px] font-extrabold uppercase tracking-[0.18em] ${
              isFaceoff
                ? 'text-[var(--color-fg-4)]'
                : isBgm
                  ? 'text-[var(--color-accent)]'
                  : 'text-[var(--color-fg-2)]'
            }`}
          >
            {event.eventType}
          </span>
        </div>
        <div className="mt-[1px] truncate font-condensed text-[12.5px] font-extrabold uppercase tracking-[0.04em] leading-tight text-[var(--color-fg-1)]">
          {actor}
        </div>
        {targetLine ? (
          <div className="mt-[1px] truncate font-condensed text-[10.5px] font-semibold tracking-[0.02em] leading-tight text-[var(--color-fg-3)]">
            {event.eventType === 'penalty' ? (
              <span className="font-extrabold uppercase tracking-[0.1em] text-[var(--color-otl)]">
                {targetLine}
              </span>
            ) : (
              <>
                <span className="mr-1 text-[var(--color-fg-6)]">→</span>
                {targetLine}
              </>
            )}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col items-end gap-1">
        <span
          className={`font-condensed text-[9px] font-extrabold uppercase tracking-[0.2em] ${
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
    </div>
  )
}

function EventIcon({ eventType, isBgm }: { eventType: string; isBgm: boolean }) {
  const side: 'home' | 'away' = isBgm ? 'home' : 'away'
  const size = 26
  if (eventType === 'goal') return <Avatar><GoalMarker side={side} size={size} /></Avatar>
  if (eventType === 'shot') return <Avatar><ShotMarker side={side} size={size} /></Avatar>
  if (eventType === 'hit') return <Avatar><HitMarker side={side} size={size} /></Avatar>
  if (eventType === 'penalty') return <Avatar><PenaltyMarker side={side} size={size} /></Avatar>
  // Faceoff: silhouette with team-side ring tint, mirroring the design's
  // "no marker — show participant" treatment for list-only events.
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

function Avatar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-8 w-8 items-center justify-center" aria-hidden>
      {children}
    </div>
  )
}

// ─── Rink markers (reused from prior implementation) ────────────────────────

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
