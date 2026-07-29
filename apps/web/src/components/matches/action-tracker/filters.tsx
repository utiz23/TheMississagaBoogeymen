'use client'

import {
  GoalMarker,
  HitMarker,
  PenaltyMarker,
  ShotMarker,
} from '@/components/branding/event-markers'
import { formatPeriodLabel } from '@/lib/period-label'
import {
  FACEOFF_NOTE,
  TYPE_META,
  useTeamPalette,
  withAlpha,
  type FilterableType,
  type PeriodFilter,
  type TeamFilter,
} from './shared'

/**
 * Filter bar — the prototype's two-tier format (scope on top, event types
 * below) carrying the production filter model: live counts that react to the
 * other filters, disabled chips for periods with no data, and real marker
 * glyphs as the type swatches rather than generic dots.
 *
 * The player search from the old implementation is dropped (not in the
 * prototype, and the event list is short enough to scan).
 */
export function FilterBar({
  periodList,
  periodHasData,
  periodFilter,
  setPeriodFilter,
  teamFilter,
  setTeamFilter,
  oppAbbrev,
  periodCounts,
  typeCounts,
  enabledTypes,
  toggleType,
  goalsOnly,
  toggleGoalsOnly,
}: {
  periodList: readonly number[]
  periodHasData: Set<number>
  periodFilter: PeriodFilter
  setPeriodFilter: (p: PeriodFilter) => void
  teamFilter: TeamFilter
  setTeamFilter: (t: TeamFilter) => void
  oppAbbrev: string
  periodCounts: Record<'all' | number, number>
  typeCounts: Record<FilterableType, number>
  enabledTypes: Set<FilterableType>
  toggleType: (t: FilterableType) => void
  goalsOnly: boolean
  toggleGoalsOnly: () => void
}) {
  return (
    <div className="border-t border-border bg-background/40 px-3.5 py-2.5">
      {/* Tier 1 — scope: which period, which team. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <FilterLabel>Period</FilterLabel>
        <Segment>
          <SegButton
            active={periodFilter === 'all'}
            onClick={() => {
              setPeriodFilter('all')
            }}
            label="All"
            count={periodCounts.all}
          />
          {periodList.map((n) => {
            const enabled = periodHasData.has(n)
            return (
              <SegButton
                key={n}
                active={periodFilter === n}
                onClick={() => {
                  if (enabled) setPeriodFilter(n)
                }}
                label={formatPeriodLabel(n)}
                count={periodCounts[n] ?? 0}
                disabled={!enabled}
              />
            )
          })}
        </Segment>

        <span className="h-4 w-px bg-border" aria-hidden />
        <FilterLabel>Team</FilterLabel>
        <Segment>
          <SegButton
            active={teamFilter === 'all'}
            onClick={() => {
              setTeamFilter('all')
            }}
            label="All"
          />
          <SegButton
            active={teamFilter === 'home'}
            onClick={() => {
              setTeamFilter('home')
            }}
            label="BGM"
            tint="var(--color-accent)"
          />
          <SegButton
            active={teamFilter === 'away'}
            onClick={() => {
              setTeamFilter('away')
            }}
            label={oppAbbrev}
            tint="var(--opp, #81878D)"
          />
        </Segment>
      </div>

      {/* Tier 2 — which event types. Counts are scoped by tier 1. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {TYPE_META.map((t) => (
          <TypeToggle
            key={t.type}
            type={t.type}
            label={t.label}
            count={typeCounts[t.type]}
            active={enabledTypes.has(t.type)}
            onToggle={() => {
              toggleType(t.type)
            }}
          />
        ))}
        <button
          type="button"
          onClick={toggleGoalsOnly}
          aria-pressed={goalsOnly}
          className={`ml-auto inline-flex items-center gap-1.5 border px-2.5 py-[5px] font-condensed text-[10.5px] font-bold tracking-[0.16em] uppercase transition-colors ${
            goalsOnly
              ? 'border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] text-accent'
              : 'border-border bg-background text-fg-3 hover:text-fg-1'
          }`}
        >
          <GoalMarker side="home" size={12} homeColor="var(--color-accent)" />
          <span>Goals only</span>
        </button>
      </div>
    </div>
  )
}

function FilterLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`font-condensed text-[9px] font-bold tracking-[0.22em] uppercase text-fg-5 ${className ?? ''}`}
    >
      {children}
    </span>
  )
}

function Segment({ children }: { children: React.ReactNode }) {
  return (
    <div className="inline-flex divide-x divide-border border border-border bg-background">
      {children}
    </div>
  )
}

function SegButton({
  active,
  onClick,
  label,
  count,
  tint,
  disabled = false,
}: {
  active: boolean
  onClick: () => void
  label: string
  count?: number
  /** Team colour for the team segment — the chip paints in its club's identity. */
  tint?: string
  disabled?: boolean
}) {
  const color = tint ?? 'var(--color-accent)'
  const base =
    'inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 font-condensed text-[10.5px] font-bold uppercase tracking-[0.14em] transition-colors'
  const tone = disabled
    ? 'cursor-not-allowed text-fg-6 opacity-50'
    : active
      ? ''
      : tint !== undefined
        ? 'hover:brightness-125'
        : 'text-fg-4 hover:text-fg-2'
  const style: React.CSSProperties = disabled
    ? {}
    : active
      ? { backgroundColor: withAlpha(color, 0.1), color }
      : tint !== undefined
        ? { color: withAlpha(color, 0.75) }
        : {}
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-disabled={disabled || undefined}
      className={`${base} ${tone}`}
      style={style}
    >
      <span>{label}</span>
      {count !== undefined ? (
        <span
          className="min-w-[16px] border px-1 py-[1px] text-center font-condensed text-[9.5px] font-bold tabular-nums"
          style={
            active
              ? { borderColor: withAlpha(color, 0.4), color }
              : { borderColor: 'var(--color-border)', color: 'var(--color-fg-5)' }
          }
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
  const empty = count === 0
  const base =
    'inline-flex items-center gap-1.5 border px-2.5 py-1 font-condensed text-[10.5px] font-bold uppercase tracking-[0.1em] transition-colors'
  const tone = active
    ? 'border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] text-fg-1'
    : 'border-border bg-background text-fg-3 opacity-60 hover:opacity-100'
  const dashed = isFaceoff ? 'border-dashed' : ''
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      title={isFaceoff ? FACEOFF_NOTE : undefined}
      className={`${base} ${tone} ${dashed} ${empty ? 'saturate-0' : ''}`}
    >
      <TypeSwatch type={type} />
      <span>{label}</span>
      <span
        className={`min-w-[16px] border px-1 py-[1px] text-center font-condensed text-[9.5px] font-bold tabular-nums ${
          active
            ? 'border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] text-accent'
            : 'border-border text-fg-5'
        }`}
      >
        {count}
      </span>
    </button>
  )
}

/**
 * Chip swatch — the same marker component the rink draws, so the legend on the
 * filter and the glyph on the ice are provably the same object.
 */
function TypeSwatch({ type }: { type: FilterableType }) {
  const { HOME_COLOR } = useTeamPalette()
  const size = 14
  const colorProps = { homeColor: HOME_COLOR }
  if (type === 'goal') return <GoalMarker side="home" size={size} {...colorProps} />
  if (type === 'shot') return <ShotMarker side="home" size={size} {...colorProps} />
  if (type === 'hit') return <HitMarker side="home" size={size} {...colorProps} />
  if (type === 'penalty') return <PenaltyMarker side="home" size={size} {...colorProps} />
  // Faceoffs have no rink marker — a dashed ring says "tracked, not plotted".
  return (
    <span
      className="inline-block rounded-full border border-dashed border-fg-5"
      style={{ width: size, height: size }}
    />
  )
}
