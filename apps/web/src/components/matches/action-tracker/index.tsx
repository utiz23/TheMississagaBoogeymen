'use client'

import { useMemo, useState } from 'react'
import type { MatchActionTrackerProvenance, MatchEventRow } from '@eanhl/db/queries'
import { periodsToShow } from '@/lib/period-label'
import { abbreviateTeamName } from '@/lib/format'
import {
  OcrProvenanceFooter,
  type ProvenanceBadge,
  confidenceTone,
  confidenceWord,
  formatProvenancePercent,
} from '@/components/matches/ocr-provenance-footer'
import { FilterBar } from './filters'
import { EventList } from './event-list'
import { MotionReveal } from '../motion'
import { RinkPanel } from './rink'
import {
  ALL_TYPES,
  BGM_COLOR,
  OPP_COLOR,
  TRACKED_TYPES,
  TeamPaletteContext,
  type FilterableType,
  type PeriodFilter,
  type SortMode,
  type TeamFilter,
} from './shared'

/**
 * Action Tracker — full-width section at the foot of the game sheet.
 *
 * Phase 9 of the game-sheet revamp is a "best of both" build: the prototype
 * supplied the frame (bordered section chrome matching the timeline/rail
 * siblings, two-tier filter bar, map-left / list-right split, DEFENDS·ATTACKS
 * axis), while the map itself — coordinate mapping, marker glyphs, collision
 * de-confliction, hover/pin tooltips — is the production implementation, which
 * plots events far more accurately than the prototype's did.
 *
 * Dropped from the old implementation, per the plan's locked decisions:
 *   - the faceoff-dots view mode (and its per-dot win-count overlay)
 *   - the player-name search box
 *   - the "match totals" summary strip (the hero, box score and team-stats
 *     rail already carry every number it repeated)
 *   - the "Goals only" shortcut (not in the prototype, and it duplicated what
 *     the type toggles already do in one extra click)
 */

interface ActionTrackerProps {
  events: MatchEventRow[]
  opponentLabel: string
  /**
   * Whether BGM had home ice. Drives the marker design treatment so the
   * home-side glyph (solid fill) is drawn for the club that was actually home
   * and the away-side glyph (colour ring around a white centre) for the
   * visitor. Null = legacy fallback where BGM is always home.
   */
  bgmWasHome?: boolean | null
  /** OCR provenance for the section footer (extracted range + source screens). */
  provenance?: MatchActionTrackerProvenance
  /**
   * Render the provenance footer. It is an operator diagnostic (how well the
   * OCR read this match), so the page gates it on admin — see
   * `lib/ocr-diagnostics`. Defaults to false: a caller that hasn't thought
   * about the gate should not be leaking it.
   */
  showProvenance?: boolean
}

export function ActionTracker({
  events,
  opponentLabel,
  bgmWasHome,
  provenance = { extractedAt: null, sources: [] },
  showProvenance = false,
}: ActionTrackerProps) {
  const bgmIsHome = bgmWasHome !== false
  // Colour follows the CLUB, the treatment follows home ice: BGM always paints
  // accent and the opponent always paints `--opp`, but whichever of them had
  // home ice gets the solid glyph. See `shared.ts` for why the per-match OCR
  // hexes are no longer used here.
  const HOME_COLOR = bgmIsHome ? BGM_COLOR : OPP_COLOR
  const AWAY_COLOR = bgmIsHome ? OPP_COLOR : BGM_COLOR

  const tracked = useMemo(() => events.filter((e) => TRACKED_TYPES.has(e.eventType)), [events])

  const [enabledTypes, setEnabledTypes] = useState<Set<FilterableType>>(new Set(ALL_TYPES))
  // Default to ALL, matching the prototype. The old implementation opened on
  // the first period with data, which both hid most of the match on load and
  // read as a bug when period 1 showed a disabled "0" next to a selected 2ND.
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all')
  const [teamFilter, setTeamFilter] = useState<TeamFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('period')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  const oppAbbrev = abbreviateTeamName(opponentLabel)

  const maxPeriodSeen = useMemo(() => {
    let m = 3
    for (const e of events) if (e.periodNumber > m) m = e.periodNumber
    return m
  }, [events])

  const periodList = useMemo(() => periodsToShow(maxPeriodSeen), [maxPeriodSeen])

  const periodHasData = useMemo(() => {
    const set = new Set<number>()
    for (const e of events) set.add(e.periodNumber)
    return set
  }, [events])

  // Period + team pool drives the chip counts, so a badge always reflects what
  // is actually reachable with the other filters where they are.
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

  const periodCounts = useMemo(() => {
    const counts: Record<'all' | number, number> = { all: teamScoped.length }
    for (const n of periodList) counts[n] = 0
    for (const e of teamScoped) counts[e.periodNumber] = (counts[e.periodNumber] ?? 0) + 1
    return counts
  }, [teamScoped, periodList])

  const typeCounts = useMemo(() => {
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
    return counts
  }, [periodScoped])

  const visibleCards = useMemo(() => {
    return periodScoped.filter(
      (e) => TRACKED_TYPES.has(e.eventType) && enabledTypes.has(e.eventType as FilterableType),
    )
  }, [periodScoped, enabledTypes])

  const visibleMarkers = useMemo(
    () => visibleCards.filter((e) => e.eventType !== 'faceoff' && e.x !== null && e.y !== null),
    [visibleCards],
  )
  const offRink = visibleCards.length - visibleMarkers.length

  // The rink is handed EVERY plottable event and told separately what to draw
  // and what to solid-fill. Three sets, because the two tiers of filter mean
  // different things:
  //
  //   rinkMarkers  — everything. Only ever used to compute de-confliction
  //                  offsets, so a marker's position is a constant: no filter
  //                  change can nudge its neighbours to new coordinates.
  //   scopedIds    — passes PERIOD + TEAM. These are context switches ("show me
  //                  the 2nd period"), so what falls outside is not part of the
  //                  picture at all and is removed outright.
  //   visibleIds   — also passes the TYPE toggles. A type toggle is a subset of
  //                  the same picture, so what it excludes stays on the ice as
  //                  a ghost and the reader's spatial map survives.
  const rinkMarkers = useMemo(
    () => tracked.filter((e) => e.eventType !== 'faceoff' && e.x !== null && e.y !== null),
    [tracked],
  )
  const scopedMarkerIds = useMemo(
    () =>
      new Set(
        periodScoped
          .filter((e) => e.eventType !== 'faceoff' && e.x !== null && e.y !== null)
          .map((e) => e.id),
      ),
    [periodScoped],
  )
  const visibleMarkerIds = useMemo(() => new Set(visibleMarkers.map((e) => e.id)), [visibleMarkers])

  // A pinned event that the filters then hide must stop counting as selected:
  // selection fades every OTHER marker, so a stale pin leaves the whole rink
  // dimmed with nothing on screen explaining why. Derived rather than cleared
  // in an effect, so re-widening the filter brings the pin back.
  const activeSelectedId = useMemo(
    () => (visibleCards.some((e) => e.id === selectedId) ? selectedId : null),
    [visibleCards, selectedId],
  )

  // OCR confidence proxy: share of positioned events whose position was read
  // directly rather than extrapolated. Not a text-confidence score.
  //
  // Faceoffs are excluded even when they carry an (x, y) — match 250 has one
  // that does. They are never drawn on the rink, so counting them would make
  // the footer claim "Plotted · 74/74" against 73 actual markers.
  const positionStats = useMemo(() => {
    const positioned = tracked.filter(
      (e) => e.eventType !== 'faceoff' && e.x !== null && e.y !== null,
    )
    const extrapolated = positioned.filter((e) => e.positionConfidence === 'extrapolated').length
    return { positioned: positioned.length, extrapolated }
  }, [tracked])

  const ocrConfidence =
    positionStats.positioned === 0
      ? null
      : (positionStats.positioned - positionStats.extrapolated) / positionStats.positioned

  const toggleSelected = (id: number) => {
    setSelectedId((prev) => (prev === id ? null : id))
  }
  const clearSelected = () => {
    setSelectedId(null)
  }

  const toggleType = (t: FilterableType) => {
    setEnabledTypes((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  const isEmpty = tracked.length === 0

  return (
    <TeamPaletteContext.Provider value={{ HOME_COLOR, AWAY_COLOR }}>
      <section>
        {/* The stage, before any play: the whole panel lifts in as one
            surface, then a single red wipe brings the ice online. Wrapped in
            MotionReveal because this module sits at the foot of a long page —
            without a scroll trigger the plot-in would replay to an empty room. */}
        {/* The prototype composes this section as a padded broadcast FIELD with
            the module's parts sitting on it as separate cards — not as one flat
            surface with internal dividers. That is load-bearing here: the rink
            (broadcast-strong), the event list and the provenance footer are
            already bordered cards, so on a bg-surface field the list and footer
            read as flush panels with no depth. On the soft field they separate. */}
        <MotionReveal className="gs-rise broadcast-panel-soft relative overflow-hidden p-4">
          <span aria-hidden className="gs-wipe" />
          {/* Title floats bare on the field, above the cards — the prototype's
              `.page-head`, which carries no chrome of its own. */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-3">
            {/* House module header — the same 12px / semibold / 0.16em / fg-4
                with an fg-5 ornament that Box Score, Team Stats, Event Timeline
                and Lineup carry. The provenance the subtitle used to spell out
                lives in the footer, which states it with actual numbers. */}
            <h2 className="font-condensed text-[12px] font-semibold tracking-[0.16em] uppercase text-fg-4">
              <span aria-hidden className="pr-1 text-fg-5">
                ▰
              </span>
              Action Tracker Map
            </h2>
            {isEmpty ? null : (
              <span className="font-condensed text-[12px] font-bold tracking-[0.14em] uppercase text-fg-4">
                Click a marker or card to pin it
              </span>
            )}
          </div>

          {isEmpty ? (
            <EmptyActionTracker />
          ) : (
            /* Filter card → stage, 8px apart (prototype's `.filter-bar`
               margin-bottom); the stage's own columns sit 12px apart. */
            <div className="flex flex-col gap-2">
              <FilterBar
                periodList={periodList}
                periodHasData={periodHasData}
                periodFilter={periodFilter}
                setPeriodFilter={setPeriodFilter}
                teamFilter={teamFilter}
                setTeamFilter={setTeamFilter}
                oppAbbrev={oppAbbrev}
                periodCounts={periodCounts}
                typeCounts={typeCounts}
                enabledTypes={enabledTypes}
                toggleType={toggleType}
              />

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
                <RinkPanel
                  events={rinkMarkers}
                  scopedIds={scopedMarkerIds}
                  visibleIds={visibleMarkerIds}
                  oppAbbrev={oppAbbrev}
                  hoveredId={hoveredId}
                  onHover={setHoveredId}
                  selectedId={activeSelectedId}
                  onSelect={toggleSelected}
                  onClearSelected={clearSelected}
                  bgmIsHome={bgmIsHome}
                  offRink={offRink}
                />
                {/* Wrapper is the stretched grid cell; the list fills it
                    absolutely at xl (see EventList) so the rink sets height. */}
                <div className="min-w-0 xl:relative">
                  <EventList
                    events={visibleCards}
                    sortMode={sortMode}
                    setSortMode={setSortMode}
                    selectedId={activeSelectedId}
                    hoveredId={hoveredId}
                    onHover={setHoveredId}
                    onSelect={toggleSelected}
                    onClearSelected={clearSelected}
                    bgmIsHome={bgmIsHome}
                  />
                </div>
              </div>
            </div>
          )}

          {showProvenance ? (
            <ActionTrackerOcrFooter
              provenance={provenance}
              ocrConfidence={ocrConfidence}
              positionStats={positionStats}
            />
          ) : null}
        </MotionReveal>
      </section>
    </TeamPaletteContext.Provider>
  )
}

/**
 * Honest degraded state. Reviewed action-tracker OCR exists for a handful of
 * matches; everywhere else this says so instead of drawing an empty rink that
 * implies "nothing happened".
 */
function EmptyActionTracker() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 border border-border bg-surface px-4 py-10 text-center">
      <div className="font-condensed text-[13px] font-extrabold tracking-[0.18em] uppercase text-fg-3">
        No tracked events
      </div>
      <div className="max-w-[420px] font-condensed text-[11px] leading-relaxed font-semibold text-fg-3">
        Rink positions come from reviewed post-game Action Tracker capture. This match has none, so
        there is nothing to plot — the box score and team stats above are EA-sourced and unaffected.
      </div>
    </div>
  )
}

const AT_CONFIDENCE_TOOLTIP =
  'Position proxy — the share of plotted events whose rink position was read directly, not extrapolated. Not an OCR text-confidence.'

const AT_SCREEN_LABELS: Readonly<Record<string, string>> = {
  post_game_action_tracker: 'Action Tracker',
  post_game_events: 'Post-game events',
}

function ActionTrackerOcrFooter({
  provenance,
  ocrConfidence,
  positionStats,
}: {
  provenance: MatchActionTrackerProvenance
  ocrConfidence: number | null
  positionStats: { positioned: number; extrapolated: number }
}) {
  const score = ocrConfidence ?? 0
  const sources = [
    ...new Set(provenance.sources.map((s) => AT_SCREEN_LABELS[s.screenType] ?? s.screenType)),
  ]
  const readDirectly = positionStats.positioned - positionStats.extrapolated
  const extrapShare =
    positionStats.positioned > 0 ? positionStats.extrapolated / positionStats.positioned : 0
  // With no positioned events the headline already reads "No data" — emit no
  // badges rather than a misleading "Plotted · 0/0" / "Extrapolated · 0%" pair.
  const badges: ProvenanceBadge[] =
    positionStats.positioned === 0
      ? []
      : [
          {
            label: `Plotted · ${String(readDirectly)}/${String(positionStats.positioned)}`,
            tone: ocrConfidence !== null && ocrConfidence >= 0.9 ? 'ok' : 'warn',
          },
          {
            label: `Extrapolated · ${formatProvenancePercent(extrapShare)}`,
            tone: positionStats.extrapolated === 0 ? 'ok' : 'warn',
          },
        ]

  return (
    <OcrProvenanceFooter
      capturedAt={provenance.extractedAt}
      capturedLabel="Extracted"
      sources={sources}
      headline={{
        value: ocrConfidence === null ? '—' : ocrConfidence.toFixed(2),
        word: ocrConfidence === null ? 'No data' : confidenceWord(score),
        tone: ocrConfidence === null ? 'neutral' : confidenceTone(score),
      }}
      headlineTooltip={AT_CONFIDENCE_TOOLTIP}
      badges={badges}
    />
  )
}
