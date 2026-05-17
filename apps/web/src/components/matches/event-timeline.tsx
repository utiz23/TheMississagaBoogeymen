'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { MatchEventRow } from '@eanhl/db/queries'
import { SectionHeader } from '@/components/ui/section-header'
import { GoalMarker, PenaltyMarker } from '@/components/branding/event-markers'
import { abbreviateTeamName } from '@/lib/format'
import { formatPeriodLabel, periodsToShow } from '@/lib/period-label'

/**
 * Event Timeline — Boogeymen Design System "Event Timeline.html" Concept
 * B handoff (`https://api.anthropic.com/v1/design/h/QR91m4eHg0Pt3X87UafRIw`).
 *
 * A dual-side scoresheet timeline: central rail, BGM cards on the left,
 * opp cards on the right, period dividers spanning the rail. After
 * every goal a score bubble sits on the rail with the running tally
 * and a lead-change banner. The game-winning goal gets a GWG ribbon +
 * accent glow.
 *
 * Story-only: shows goals + penalties. Filters above the timeline:
 *   - Period: All / P1 / P2 / P3 / OT… (auto-derived from data).
 *   - Team: All / BGM / opp.
 */

interface EventTimelineProps {
  events: MatchEventRow[]
  opponentLabel: string
  bgmWasHome?: boolean | null
  bgmColor?: string | null
  oppColor?: string | null
}

type PeriodFilter = 'all' | number
type TeamFilter = 'all' | 'bgm' | 'opp'

const STORY_TYPES = new Set(['goal', 'penalty'])
// Same per-team fallbacks the Action Tracker Map uses, so markers in both
// sections look identical when the OCR colour extractor hasn't produced a
// per-match hex yet.
const BGM_FALLBACK = '#ce202f'
const OPP_FALLBACK = '#233f94'

interface MarkerPalette {
  homeColor: string
  awayColor: string
  bgmIsHome: boolean
}

function resolveMarkerSide(
  teamSide: MatchEventRow['teamSide'],
  bgmIsHome: boolean,
): 'home' | 'away' {
  const eventIsBgm = teamSide === 'for'
  return eventIsBgm === bgmIsHome ? 'home' : 'away'
}

export function EventTimeline({
  events,
  opponentLabel,
  bgmWasHome,
  bgmColor,
  oppColor,
}: EventTimelineProps) {
  const storyEvents = events.filter((e) => STORY_TYPES.has(e.eventType))
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all')
  const [teamFilter, setTeamFilter] = useState<TeamFilter>('all')

  const oppAbbrev = abbreviateTeamName(opponentLabel)

  const bgmIsHome = bgmWasHome !== false
  const bgmResolved = bgmColor ?? BGM_FALLBACK
  const oppResolved = oppColor ?? OPP_FALLBACK
  const palette: MarkerPalette = {
    homeColor: bgmIsHome ? bgmResolved : oppResolved,
    awayColor: bgmIsHome ? oppResolved : bgmResolved,
    bgmIsHome,
  }

  // GWG is computed against the FULL goal list so filters can't change it.
  const gwgId = useMemo(() => findGameWinningGoalId(storyEvents), [storyEvents])

  // Running score per goal id — needed for the on-rail bubbles.
  const goalContext = useMemo(() => buildGoalContext(storyEvents), [storyEvents])

  const maxPeriodSeen = useMemo(() => {
    let m = 3
    for (const e of storyEvents) if (e.periodNumber > m) m = e.periodNumber
    return m
  }, [storyEvents])

  const periodList = useMemo(() => periodsToShow(maxPeriodSeen), [maxPeriodSeen])

  const periodHasData = useMemo(() => {
    const set = new Set<number>()
    for (const e of storyEvents) set.add(e.periodNumber)
    return set
  }, [storyEvents])

  const visible = storyEvents.filter((e) => {
    if (periodFilter !== 'all' && e.periodNumber !== periodFilter) return false
    if (teamFilter === 'bgm' && e.teamSide !== 'for') return false
    if (teamFilter === 'opp' && e.teamSide !== 'against') return false
    return true
  })

  // Final score for the bottom anchor — full unfiltered goal counts.
  const final = useMemo(() => {
    let bgm = 0
    let opp = 0
    for (const e of storyEvents) {
      if (e.eventType !== 'goal') continue
      if (e.teamSide === 'for') bgm++
      else opp++
    }
    return { bgm, opp, bgmWon: bgm > opp, tied: bgm === opp }
  }, [storyEvents])

  // Group by period for divider rendering.
  const groups = useMemo(() => buildGroups(visible), [visible])

  if (storyEvents.length === 0) return null

  return (
    <section className="space-y-3">
      <SectionHeader label="Event Timeline" subtitle="Game flow · goals + penalties" />

      <FilterBar
        periodFilter={periodFilter}
        setPeriodFilter={setPeriodFilter}
        periodList={periodList}
        periodHasData={periodHasData}
        teamFilter={teamFilter}
        setTeamFilter={setTeamFilter}
        oppAbbrev={oppAbbrev}
      />

      {visible.length === 0 ? (
        <EmptyState
          onReset={() => {
            setPeriodFilter('all')
            setTeamFilter('all')
          }}
        />
      ) : (
        <div className="mx-auto max-w-[980px] px-2 sm:px-4">
          <div className="relative py-2">
            {/* Central rail with red end-caps */}
            <Rail />

            {/* Opening face-off anchor */}
            <Anchor label="Opening face-off" />

            {groups.map((g) => (
              <PeriodSection
                key={g.period}
                periodLabel={g.label}
                events={g.rows}
                goalContext={goalContext}
                gwgId={gwgId}
                oppAbbrev={oppAbbrev}
                palette={palette}
              />
            ))}

            {/* Final anchor */}
            <Anchor
              label={final.tied ? 'Final · tied' : `Final · ${final.bgmWon ? 'BGM' : oppAbbrev}`}
            >
              <FinalScore bgm={final.bgm} opp={final.opp} bgmWon={final.bgmWon} tied={final.tied} />
            </Anchor>
          </div>
        </div>
      )}
    </section>
  )
}

// ─── Rail + anchors ─────────────────────────────────────────────────────────

function Rail() {
  return (
    <div
      className="pointer-events-none absolute inset-y-0 left-1/2 hidden -translate-x-1/2 sm:block"
      aria-hidden
    >
      <div className="relative h-full w-[2px] bg-[var(--color-border)]">
        <span className="absolute -top-[3px] -left-[3px] block h-2 w-2 rounded-full bg-[var(--color-accent)] shadow-[0_0_12px_rgba(232,65,49,0.7)]" />
        <span className="absolute -bottom-[3px] -left-[3px] block h-2 w-2 rounded-full bg-[var(--color-accent)] shadow-[0_0_12px_rgba(232,65,49,0.7)]" />
      </div>
    </div>
  )
}

function Anchor({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="relative flex items-center justify-center py-2.5">
      <span className="relative z-10 inline-flex items-center gap-3 border border-[var(--color-border)] bg-[var(--color-charcoal)] px-3.5 py-1.5 font-condensed text-[10px] font-extrabold uppercase tracking-[0.24em] text-[var(--color-fg-4)]">
        {label}
        {children ? <span className="h-3 w-px bg-[var(--color-border)]" aria-hidden /> : null}
        {children}
      </span>
    </div>
  )
}

function FinalScore({
  bgm,
  opp,
  bgmWon,
  tied,
}: {
  bgm: number
  opp: number
  bgmWon: boolean
  tied: boolean
}) {
  return (
    <span className="inline-flex items-baseline gap-1.5 font-condensed font-black tabular-nums">
      <span
        className={
          tied
            ? 'text-[var(--color-fg-1)]'
            : bgmWon
              ? 'text-[var(--color-accent)]'
              : 'text-[var(--color-fg-3)]'
        }
      >
        {bgm}
      </span>
      <span className="text-[var(--color-fg-6)]">–</span>
      <span
        className={
          tied
            ? 'text-[var(--color-fg-1)]'
            : bgmWon
              ? 'text-[var(--color-fg-3)]'
              : 'text-[var(--color-fg-1)]'
        }
      >
        {opp}
      </span>
    </span>
  )
}

// ─── Period sections ────────────────────────────────────────────────────────

function PeriodSection({
  periodLabel,
  events,
  goalContext,
  gwgId,
  oppAbbrev,
  palette,
}: {
  periodLabel: string
  events: MatchEventRow[]
  goalContext: Map<number, GoalContext>
  gwgId: number | null
  oppAbbrev: string
  palette: MarkerPalette
}) {
  const goalsHere = events.filter((e) => e.eventType === 'goal').length
  const pensHere = events.filter((e) => e.eventType === 'penalty').length
  const isOt = /\bOT/i.test(periodLabel)
  return (
    <div>
      <PeriodDivider
        label={periodLabel}
        goals={goalsHere}
        penalties={pensHere}
        total={events.length}
        isOt={isOt}
      />
      <ol className="space-y-0">
        {events.map((e) => {
          const ctx = e.eventType === 'goal' ? goalContext.get(e.id) : undefined
          return (
            <li key={e.id}>
              <EventRow
                event={e}
                gwgId={gwgId}
                goalContext={goalContext}
                palette={palette}
                oppAbbrev={oppAbbrev}
              />
              {ctx ? <ScoreBubble ctx={ctx} oppAbbrev={oppAbbrev} /> : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function PeriodDivider({
  label,
  goals,
  penalties,
  total,
  isOt,
}: {
  label: string
  goals: number
  penalties: number
  total: number
  isOt: boolean
}) {
  return (
    <div className="relative flex items-center justify-center py-4">
      <span
        className="absolute inset-y-1/2 left-0 right-0 h-px bg-[linear-gradient(to_right,transparent,var(--color-border)_30%,var(--color-border)_70%,transparent)]"
        aria-hidden
      />
      <span
        className={`relative z-10 inline-flex items-center gap-3 border bg-[var(--color-charcoal)] px-4 py-1.5 ${
          isOt ? 'border-[rgba(245,158,11,0.4)]' : 'border-[rgba(232,65,49,0.4)]'
        }`}
      >
        <span
          className={`font-condensed text-[15px] font-black uppercase tracking-[0.22em] ${
            isOt ? 'text-[var(--color-otl)]' : 'text-[var(--color-accent)]'
          }`}
        >
          {label}
        </span>
        <span className="h-4 w-px bg-[var(--color-border)]" aria-hidden />
        <span className="font-condensed text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--color-fg-3)]">
          <b className="font-black tabular-nums text-[var(--color-fg-1)]">{String(goals)}</b>{' '}
          {goals === 1 ? 'Goal' : 'Goals'}
          {' · '}
          <b className="font-black tabular-nums text-[var(--color-fg-1)]">
            {String(penalties)}
          </b>{' '}
          Pen
          {' · '}
          <b className="font-black tabular-nums text-[var(--color-fg-1)]">{String(total)}</b>{' '}
          {total === 1 ? 'event' : 'events'}
        </span>
      </span>
    </div>
  )
}

// ─── Event row + cards ──────────────────────────────────────────────────────

function EventRow({
  event,
  gwgId,
  goalContext,
  palette,
  oppAbbrev,
}: {
  event: MatchEventRow
  gwgId: number | null
  goalContext: Map<number, GoalContext>
  palette: MarkerPalette
  oppAbbrev: string
}) {
  const isBgm = event.teamSide === 'for'
  const periodTag = cleanPeriodLabel(event.periodLabel) || `P${String(event.periodNumber)}`
  const isGwg = event.id === gwgId
  const scoreCtx = event.eventType === 'goal' ? (goalContext.get(event.id) ?? null) : null
  // DB clock is the in-game broadcast countdown (remaining). Cards display
  // the "time of goal" elapsed mark so they match the post-game Events
  // screen and the NHL record-book convention.
  const displayClock = toElapsedClock(event.clock)
  return (
    <div className="grid grid-cols-1 items-center sm:grid-cols-[1fr_84px_1fr] sm:gap-0">
      <div className={isBgm ? 'flex justify-end pr-0' : 'hidden sm:block'}>
        {isBgm ? (
          <EventCard
            event={event}
            side="bgm"
            isGwg={isGwg}
            scoreCtx={scoreCtx}
            palette={palette}
            oppAbbrev={oppAbbrev}
          />
        ) : null}
      </div>
      <div className="hidden items-center justify-center sm:flex">
        <ClockPill clock={displayClock} period={periodTag} isBgm={isBgm} />
      </div>
      <div className={!isBgm ? 'flex justify-start pl-0' : 'hidden sm:block'}>
        {!isBgm ? (
          <EventCard
            event={event}
            side="opp"
            isGwg={isGwg}
            scoreCtx={scoreCtx}
            palette={palette}
            oppAbbrev={oppAbbrev}
          />
        ) : null}
      </div>
    </div>
  )
}

function ClockPill({
  clock,
  period,
  isBgm,
}: {
  clock: string | null
  period: string
  isBgm: boolean
}) {
  return (
    <span
      className={`relative z-10 inline-flex flex-col items-center gap-[1px] border bg-[var(--color-background)] px-2.5 py-1 ${
        isBgm ? 'border-[rgba(232,65,49,0.4)]' : 'border-[rgba(235,235,235,0.35)]'
      }`}
    >
      <span className="font-condensed text-[10.5px] font-extrabold tabular-nums leading-none tracking-[0.06em] text-[var(--color-fg-1)]">
        {clock ?? '—'}
      </span>
      <span className="font-condensed text-[8.5px] font-bold uppercase leading-none tracking-[0.18em] text-[var(--color-fg-5)]">
        {period}
      </span>
    </span>
  )
}

function EventCard({
  event,
  side,
  isGwg,
  scoreCtx,
  palette,
  oppAbbrev,
}: {
  event: MatchEventRow
  side: 'bgm' | 'opp'
  isGwg: boolean
  scoreCtx: GoalContext | null
  palette: MarkerPalette
  oppAbbrev: string
}) {
  const isLeft = side === 'bgm'
  if (event.eventType === 'penalty') {
    return (
      <PenaltyCard
        event={event}
        side={side}
        isLeft={isLeft}
        palette={palette}
        oppAbbrev={oppAbbrev}
      />
    )
  }
  return (
    <GoalCard
      event={event}
      side={side}
      isLeft={isLeft}
      isGwg={isGwg}
      scoreCtx={scoreCtx}
      palette={palette}
      oppAbbrev={oppAbbrev}
    />
  )
}

function GoalCard({
  event,
  side,
  isLeft,
  isGwg,
  scoreCtx,
  palette,
  oppAbbrev,
}: {
  event: MatchEventRow
  side: 'bgm' | 'opp'
  isLeft: boolean
  isGwg: boolean
  scoreCtx: GoalContext | null
  palette: MarkerPalette
  oppAbbrev: string
}) {
  const markerSide = resolveMarkerSide(event.teamSide, palette.bgmIsHome)
  const teamLabel = side === 'bgm' ? 'BGM' : oppAbbrev
  const baseBorder =
    side === 'bgm'
      ? 'border-l-[3px] border-l-[var(--color-accent)]'
      : 'sm:border-r-[3px] sm:border-r-[var(--color-fg-2)] border-l-[3px] border-l-[var(--color-fg-2)] sm:border-l-0'
  const align = isLeft ? 'sm:text-right sm:items-end' : 'sm:text-left sm:items-start'
  const headOrder = isLeft ? 'sm:flex-row-reverse' : 'sm:flex-row'
  const footOrder = isLeft ? 'sm:flex-row-reverse' : 'sm:flex-row'
  const ribbonSide = isLeft ? 'sm:left-[-8px] sm:right-auto' : 'sm:right-[-8px]'
  const accentBg = isGwg
    ? 'border-[var(--color-accent)] bg-[linear-gradient(180deg,rgba(232,65,49,0.06),var(--color-surface))] shadow-[0_0_20px_rgba(232,65,49,0.18),inset_0_0_0_1px_rgba(232,65,49,0.15)]'
    : 'border-[var(--color-border)]'
  const scorer = pickActor(event, 'goal')
  const numberSuffix =
    event.goalNumberInGame !== null
      ? `Goal · ${teamLabel} #${String(event.goalNumberInGame)}`
      : `Goal · ${teamLabel}`
  return (
    <div
      className={`relative flex w-full max-w-[360px] min-w-[240px] flex-col gap-1.5 border bg-[var(--color-surface)] px-3.5 py-3 ${baseBorder} ${accentBg} ${align}`}
    >
      {isGwg ? (
        <span
          className={`absolute -top-2.5 right-[-8px] z-10 bg-[linear-gradient(180deg,var(--color-accent),var(--color-accent-strong))] px-2.5 py-1 font-condensed text-[10px] font-black uppercase tracking-[0.24em] text-white shadow-[0_0_16px_rgba(232,65,49,0.6)] ${ribbonSide}`}
        >
          GWG · Game-winner
        </span>
      ) : null}
      <div className={`flex items-center gap-2.5 ${headOrder}`}>
        <span className="inline-flex h-7 w-7 items-center justify-center">
          <GoalMarker
            side={markerSide}
            size={26}
            homeColor={palette.homeColor}
            awayColor={palette.awayColor}
          />
        </span>
        <span
          className={`font-condensed text-[11px] font-extrabold uppercase tracking-[0.22em] ${
            side === 'bgm' ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg-4)]'
          }`}
        >
          {numberSuffix}
        </span>
      </div>
      <ActorLine name={scorer.text} id={scorer.id} isGwg={isGwg} />
      <AssistsLine event={event} />
      {scoreCtx ? (
        <div
          className={`mt-1 flex items-center gap-2.5 border-t border-[var(--color-border-subtle)] pt-2 ${footOrder}`}
        >
          <span className="font-condensed text-[13px] font-black tabular-nums tracking-[0.02em] text-[var(--color-fg-3)]">
            <span
              className={scoreCtx.tied ? 'text-[var(--color-fg-1)]' : 'text-[var(--color-accent)]'}
            >
              {scoreCtx.bgmAfter}
            </span>
            <span className="px-1 text-[var(--color-fg-6)]">–</span>
            <span className="text-[var(--color-fg-1)]">{scoreCtx.oppAfter}</span>
          </span>
          <span className="font-condensed text-[9.5px] font-bold uppercase tracking-[0.18em] text-[var(--color-fg-5)]">
            {leadChangeLabel(scoreCtx, oppAbbrev)}
          </span>
        </div>
      ) : null}
    </div>
  )
}

function PenaltyCard({
  event,
  side,
  isLeft,
  palette,
  oppAbbrev,
}: {
  event: MatchEventRow
  side: 'bgm' | 'opp'
  isLeft: boolean
  palette: MarkerPalette
  oppAbbrev: string
}) {
  const markerSide = resolveMarkerSide(event.teamSide, palette.bgmIsHome)
  const teamLabel = side === 'bgm' ? 'BGM' : oppAbbrev
  const align = isLeft ? 'sm:text-right sm:items-end' : 'sm:text-left sm:items-start'
  const headOrder = isLeft ? 'sm:flex-row-reverse' : 'sm:flex-row'
  const sideBorder =
    side === 'bgm'
      ? 'border-l-[3px] border-l-[var(--color-otl)]'
      : 'sm:border-r-[3px] sm:border-r-[var(--color-otl)] border-l-[3px] border-l-[var(--color-otl)] sm:border-l-0'
  const culprit = pickActor(event, 'penalty')
  const minutes =
    event.penaltyMinutes !== null
      ? `${String(event.penaltyMinutes)} PIM`
      : event.penaltyType === 'Major'
        ? '5 PIM'
        : '2 PIM'
  return (
    <div
      className={`flex w-full max-w-[360px] min-w-[240px] flex-col gap-1.5 border border-[rgba(245,158,11,0.4)] bg-[linear-gradient(180deg,rgba(245,158,11,0.04),var(--color-surface))] px-3.5 py-3 ${sideBorder} ${align}`}
    >
      <div className={`flex items-center gap-2.5 ${headOrder}`}>
        <span className="inline-flex h-7 w-7 items-center justify-center text-[var(--color-otl)]">
          <PenaltyMarker
            side={markerSide}
            size={26}
            homeColor={palette.homeColor}
            awayColor={palette.awayColor}
          />
        </span>
        <span className="font-condensed text-[11px] font-extrabold uppercase tracking-[0.22em] text-[var(--color-otl)]">
          Penalty · {teamLabel}
        </span>
      </div>
      <ActorLine name={culprit.text} id={culprit.id} compact />
      {event.infraction ? (
        <span className="font-condensed text-[13px] font-extrabold uppercase tracking-[0.06em] text-[var(--color-otl)]">
          {event.infraction}
        </span>
      ) : null}
      <div className={`flex items-center gap-2 ${headOrder}`}>
        {event.penaltyType ? (
          <span className="inline-block border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.10)] px-1.5 py-[2px] font-condensed text-[10px] font-extrabold uppercase tracking-[0.18em] text-[var(--color-otl)]">
            {event.penaltyType}
          </span>
        ) : null}
        <span className="font-condensed text-[11px] font-extrabold tabular-nums tracking-[0.06em] text-[var(--color-fg-2)]">
          {minutes}
        </span>
      </div>
    </div>
  )
}

// ─── Sub-pieces ─────────────────────────────────────────────────────────────

function ActorLine({
  name,
  id,
  isGwg,
  compact,
}: {
  name: string
  id: number | null
  isGwg?: boolean
  compact?: boolean
}) {
  const sizeClass = compact === true ? 'text-[16px] font-extrabold' : 'text-[18px] font-black'
  const colorClass =
    isGwg === true
      ? 'text-[var(--color-accent)] [text-shadow:0_0_12px_rgba(232,65,49,0.30)]'
      : 'text-[var(--color-fg-1)]'
  if (id !== null) {
    return (
      <Link
        href={`/roster/${String(id)}`}
        className={`font-condensed uppercase leading-tight tracking-[0.04em] hover:text-[var(--color-accent)] ${sizeClass} ${colorClass}`}
      >
        {name}
      </Link>
    )
  }
  return (
    <span
      className={`font-condensed uppercase leading-tight tracking-[0.04em] ${sizeClass} ${colorClass}`}
      title="Unresolved gamertag"
    >
      {name}
    </span>
  )
}

function AssistsLine({ event }: { event: MatchEventRow }) {
  const primary = pickAssist(event, 'primary')
  const secondary = pickAssist(event, 'secondary')
  if (!primary && !secondary) {
    return (
      <div className="font-condensed text-[11px] font-semibold tracking-[0.04em] text-[var(--color-fg-5)]">
        <span className="mr-1 font-extrabold uppercase tracking-[0.18em] text-[var(--color-fg-6)] text-[10px]">
          A
        </span>
        <span className="italic">Unassisted</span>
      </div>
    )
  }
  return (
    <div className="font-condensed text-[11px] font-semibold tracking-[0.04em] text-[var(--color-fg-3)]">
      <span className="mr-1 font-extrabold uppercase tracking-[0.18em] text-[var(--color-fg-5)] text-[10px]">
        A
      </span>
      {primary ? <AssistName name={primary.text} id={primary.id} /> : null}
      {primary && secondary ? <span className="px-1 text-[var(--color-fg-6)]">·</span> : null}
      {secondary ? <AssistName name={secondary.text} id={secondary.id} /> : null}
    </div>
  )
}

function AssistName({ name, id }: { name: string; id: number | null }) {
  if (!name) return null
  if (id !== null) {
    return (
      <Link
        href={`/roster/${String(id)}`}
        className="font-bold text-[var(--color-fg-2)] hover:text-[var(--color-accent)]"
      >
        {name}
      </Link>
    )
  }
  return (
    <span className="font-bold text-[var(--color-fg-2)]" title="Unresolved">
      {name}
    </span>
  )
}

// ─── Score bubble (on-rail running score after a goal) ──────────────────────

function ScoreBubble({ ctx, oppAbbrev }: { ctx: GoalContext; oppAbbrev: string }) {
  const tone = ctx.tied
    ? 'border-[rgba(245,158,11,0.4)]'
    : ctx.leader === 'bgm'
      ? 'border-[rgba(232,65,49,0.4)] shadow-[0_0_12px_rgba(232,65,49,0.18)]'
      : 'border-[rgba(235,235,235,0.4)]'
  const swing = leadChangeLabel(ctx, oppAbbrev)
  const swingTone = ctx.tied
    ? 'text-[var(--color-otl)]'
    : ctx.leader === 'bgm'
      ? 'text-[var(--color-accent)]'
      : 'text-[var(--color-fg-1)]'
  return (
    <div className="relative z-10 hidden flex-col items-center py-1 sm:flex">
      <span
        className={`inline-flex items-baseline gap-1 border bg-[var(--color-charcoal)] px-3 py-1 font-condensed font-black tabular-nums ${tone}`}
      >
        <span
          className={`text-[16px] ${
            ctx.tied ? 'text-[var(--color-fg-1)]' : 'text-[var(--color-accent)]'
          }`}
        >
          {ctx.bgmAfter}
        </span>
        <span className="text-[11px] text-[var(--color-fg-6)]">–</span>
        <span className="text-[16px] text-[var(--color-fg-1)]">{ctx.oppAfter}</span>
      </span>
      <span
        className={`mt-1 font-condensed text-[9px] font-extrabold uppercase tracking-[0.22em] ${swingTone}`}
      >
        {swing}
      </span>
    </div>
  )
}

// ─── Filter bar + empty state ───────────────────────────────────────────────

function FilterBar({
  periodFilter,
  setPeriodFilter,
  periodList,
  periodHasData,
  teamFilter,
  setTeamFilter,
  oppAbbrev,
}: {
  periodFilter: PeriodFilter
  setPeriodFilter: (p: PeriodFilter) => void
  periodList: readonly number[]
  periodHasData: Set<number>
  teamFilter: TeamFilter
  setTeamFilter: (t: TeamFilter) => void
  oppAbbrev: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5">
      <FilterGroup label="Period">
        <Segment>
          <SegButton
            active={periodFilter === 'all'}
            onClick={() => {
              setPeriodFilter('all')
            }}
            label="All"
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
                disabled={!enabled}
              />
            )
          })}
        </Segment>
      </FilterGroup>
      <FilterGroup label="Team">
        <Segment>
          <SegButton
            active={teamFilter === 'all'}
            onClick={() => {
              setTeamFilter('all')
            }}
            label="All"
          />
          <SegButton
            active={teamFilter === 'bgm'}
            onClick={() => {
              setTeamFilter('bgm')
            }}
            label="BGM"
            tintAccent={teamFilter !== 'bgm'}
          />
          <SegButton
            active={teamFilter === 'opp'}
            onClick={() => {
              setTeamFilter('opp')
            }}
            label={oppAbbrev}
          />
        </Segment>
      </FilterGroup>
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="font-condensed text-[9px] font-bold uppercase tracking-[0.22em] text-[var(--color-fg-5)]">
        {label}
      </span>
      {children}
    </div>
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
  disabled = false,
}: {
  active: boolean
  onClick: () => void
  label: string
  count?: number
  tintAccent?: boolean
  disabled?: boolean
}) {
  const base =
    'inline-flex items-center gap-1.5 whitespace-nowrap px-2.5 py-1.5 font-condensed text-[10.5px] font-bold uppercase tracking-[0.14em] transition-colors'
  const tone = disabled
    ? 'cursor-not-allowed text-[var(--color-fg-6)] opacity-50'
    : active
      ? 'bg-[rgba(232,65,49,0.10)] text-[var(--color-accent)]'
      : tintAccent === true
        ? 'text-[var(--color-accent)] hover:text-[#ef6a5e]'
        : 'text-[var(--color-fg-4)] hover:text-[var(--color-fg-2)]'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-disabled={disabled || undefined}
      className={`${base} ${tone}`}
    >
      <span>{label}</span>
      {count !== undefined ? (
        <span
          className={`min-w-[18px] border px-1 py-[1px] text-center font-condensed text-[9.5px] font-bold tabular-nums ${
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

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center gap-2 border border-dashed border-[var(--color-border)] bg-[rgba(35,33,34,0.40)] px-6 py-16 text-center">
      <div className="font-condensed text-[14px] font-extrabold uppercase tracking-[0.18em] text-[var(--color-fg-3)]">
        No events match
      </div>
      <div className="max-w-[280px] font-condensed text-[11px] font-semibold leading-relaxed text-[var(--color-fg-5)]">
        Try clearing the period or team filter.
      </div>
      <button
        type="button"
        onClick={onReset}
        className="mt-2 border border-[rgba(232,65,49,0.4)] bg-[rgba(232,65,49,0.10)] px-3 py-1.5 font-condensed text-[10.5px] font-extrabold uppercase tracking-[0.18em] text-[var(--color-accent)]"
      >
        Reset filters
      </button>
    </div>
  )
}

// ─── Helpers: GWG, running score, grouping ──────────────────────────────────

interface GoalContext {
  goalId: number
  bgmAfter: number
  oppAfter: number
  bgmBefore: number
  oppBefore: number
  leader: 'bgm' | 'opp' | 'tied'
  prevLeader: 'bgm' | 'opp' | 'tied'
  scoredBy: 'bgm' | 'opp'
  tied: boolean
  // Periods 4+ are OT in EASHL (no shootout, OT3 = period 6). Any goal in OT
  // is sudden death, so the bubble swing reads "{team} wins" instead of the
  // normal "takes lead" / "+N" patterns.
  isOt: boolean
}

function buildGoalContext(events: MatchEventRow[]): Map<number, GoalContext> {
  // Sort chronologically — period ASC, then by clock DESC within a period.
  // DB stores `clock` as MM:SS remaining (the in-game broadcast clock counts
  // down from 20:00), so larger remaining = earlier in the period.
  const goals = events
    .filter((e) => e.eventType === 'goal')
    .slice()
    .sort((a, b) => {
      if (a.periodNumber !== b.periodNumber) return a.periodNumber - b.periodNumber
      return clockToSeconds(b.clock) - clockToSeconds(a.clock)
    })

  const out = new Map<number, GoalContext>()
  let bgm = 0
  let opp = 0
  let prevLeader: 'bgm' | 'opp' | 'tied' = 'tied'
  for (const g of goals) {
    const before = { bgm, opp }
    if (g.teamSide === 'for') bgm++
    else opp++
    const leader: 'bgm' | 'opp' | 'tied' = bgm === opp ? 'tied' : bgm > opp ? 'bgm' : 'opp'
    out.set(g.id, {
      goalId: g.id,
      bgmBefore: before.bgm,
      oppBefore: before.opp,
      bgmAfter: bgm,
      oppAfter: opp,
      leader,
      prevLeader,
      scoredBy: g.teamSide === 'for' ? 'bgm' : 'opp',
      tied: bgm === opp,
      isOt: g.periodNumber >= 4,
    })
    prevLeader = leader
  }
  return out
}

function leadChangeLabel(ctx: GoalContext, oppAbbrev: string): string {
  // Sudden death: any OT goal ends the game with the scorer's team winning.
  if (ctx.isOt) return `↑ ${ctx.scoredBy === 'bgm' ? 'BGM' : oppAbbrev} wins`
  if (ctx.tied) return '— Tied'
  if (ctx.prevLeader === 'tied')
    return ctx.leader === 'bgm' ? '↑ BGM takes lead' : `↑ ${oppAbbrev} takes lead`
  if (ctx.prevLeader !== ctx.leader)
    return ctx.leader === 'bgm' ? '↑ BGM regains lead' : `↑ ${oppAbbrev} regains lead`
  // Lead extended or trail narrowed.
  const margin = Math.abs(ctx.bgmAfter - ctx.oppAfter)
  if (ctx.scoredBy === ctx.leader) {
    return ctx.leader === 'bgm'
      ? `↑ BGM +${String(margin)} LEAD`
      : `↑ ${oppAbbrev} +${String(margin)} LEAD`
  }
  return ctx.scoredBy === 'bgm' ? 'BGM closes' : `${oppAbbrev} closes`
}

function findGameWinningGoalId(events: MatchEventRow[]): number | null {
  // Walk goals in true chronological order — period ASC, then remaining-clock
  // DESC (DB stores the countdown broadcast clock, so highest remaining =
  // earliest in the period). Walking the prop order risked mis-attribution
  // when a period had multiple BGM goals.
  const goals = events
    .filter((e) => e.eventType === 'goal')
    .slice()
    .sort((a, b) => {
      if (a.periodNumber !== b.periodNumber) return a.periodNumber - b.periodNumber
      return clockToSeconds(b.clock) - clockToSeconds(a.clock)
    })
  if (goals.length === 0) return null
  let bgmTotal = 0
  let oppTotal = 0
  for (const g of goals) {
    if (g.teamSide === 'for') bgmTotal++
    else oppTotal++
  }
  if (bgmTotal === oppTotal) return null
  const winningSide: 'for' | 'against' = bgmTotal > oppTotal ? 'for' : 'against'
  const target = Math.min(bgmTotal, oppTotal) + 1
  let runningCount = 0
  for (const g of goals) {
    if (g.teamSide !== winningSide) continue
    runningCount++
    if (runningCount === target) return g.id
  }
  return null
}

function buildGroups(
  events: MatchEventRow[],
): { period: number; label: string; rows: MatchEventRow[] }[] {
  // Period ASC, then remaining-clock DESC — chronological order. DB clock is
  // the in-game countdown, so larger remaining = earlier in the period.
  const sorted = [...events].sort((a, b) => {
    if (a.periodNumber !== b.periodNumber) return a.periodNumber - b.periodNumber
    return clockToSeconds(b.clock) - clockToSeconds(a.clock)
  })
  const out: { period: number; label: string; rows: MatchEventRow[] }[] = []
  for (const e of sorted) {
    const last = out[out.length - 1]
    if (last?.period === e.periodNumber) {
      last.rows.push(e)
    } else {
      out.push({
        period: e.periodNumber,
        label: cleanPeriodLabel(e.periodLabel) || `P${String(e.periodNumber)}`,
        rows: [e],
      })
    }
  }
  return out
}

function pickActor(
  event: MatchEventRow,
  kind: 'goal' | 'penalty' | 'compact',
): { text: string; id: number | null } {
  if (kind === 'goal') {
    if (event.scorer) return { text: event.scorer.gamertag, id: event.scorer.id }
    if (event.scorerSnapshot) return { text: event.scorerSnapshot, id: null }
  } else if (kind === 'penalty') {
    if (event.culprit) return { text: event.culprit.gamertag, id: event.culprit.id }
    if (event.culpritSnapshot) return { text: event.culpritSnapshot, id: null }
  }
  if (event.actor) return { text: event.actor.gamertag, id: event.actor.id }
  if (event.actorGamertagSnapshot) return { text: event.actorGamertagSnapshot, id: null }
  return { text: '—', id: null }
}

function pickAssist(
  event: MatchEventRow,
  which: 'primary' | 'secondary',
): { text: string; id: number | null } | null {
  if (which === 'primary') {
    if (event.primaryAssist)
      return { text: event.primaryAssist.gamertag, id: event.primaryAssist.id }
    if (event.primaryAssistSnapshot) return { text: event.primaryAssistSnapshot, id: null }
  } else {
    if (event.secondaryAssist)
      return { text: event.secondaryAssist.gamertag, id: event.secondaryAssist.id }
    if (event.secondaryAssistSnapshot) return { text: event.secondaryAssistSnapshot, id: null }
  }
  return null
}

function clockToSeconds(clock: string | null): number {
  if (!clock) return 0
  const [m, s] = clock.split(':')
  return Number(m) * 60 + Number(s)
}

// Periods in EASHL are 20 minutes (regulation + OT). DB stores the in-game
// broadcast clock (counts down from 20:00 = remaining), but the post-game
// Events screen — and the NHL "time of goal" record-book convention —
// reports the elapsed mark. Convert for display so the clock on each card
// matches the Events screen the rest of the recap pulls from.
const PERIOD_LENGTH_SEC = 20 * 60

function toElapsedClock(clock: string | null): string | null {
  if (!clock) return null
  const remaining = clockToSeconds(clock)
  const elapsed = PERIOD_LENGTH_SEC - remaining
  if (elapsed < 0 || elapsed > PERIOD_LENGTH_SEC) return clock
  const mm = Math.floor(elapsed / 60)
  const ss = elapsed % 60
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function cleanPeriodLabel(raw: string | null): string {
  if (!raw) return ''
  return raw
    .replace(/^\s*(?:RT|LT|RB|LB)\s+/i, '')
    .replace(/\s+(?:RT|LT|RB|LB)\s*$/i, '')
    .trim()
}
