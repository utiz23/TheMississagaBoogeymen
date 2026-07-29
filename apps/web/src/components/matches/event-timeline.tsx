'use client'

import { useId, useMemo, useState } from 'react'
import Link from 'next/link'
import type { MatchEventRow } from '@eanhl/db/queries'
import { abbreviateTeamName } from '@/lib/format'
import {
  buildTimeline,
  leadChangeLabel,
  periodCountLabel,
  sideOf,
  toElapsedClock,
  type GoalContext,
  type TimelinePeriod,
  type TimelineSide,
} from '@/lib/event-timeline'

/**
 * Event Timeline — the match replayed top to bottom.
 *
 * Central rail, BGM cards slid to the left, opponent cards to the right on
 * `--opp`, period dividers spanning the rail, and a running score under every
 * goal. The side is readable without colour: cards sit on their own side of
 * the rail and every kicker names its team ("GOAL · 4L #2").
 *
 * Every derivation lives in `lib/event-timeline.ts` — this file only renders.
 * Static by design; the row-by-row reveal is Phase 12 motion.
 *
 * Events are OCR-only and gated on review, so most matches have none. Two
 * degraded paths matter here and both are honest rather than empty-looking:
 * no events at all says so and explains why, and a timeline holding fewer
 * goals than the real score says how many it has instead of presenting a
 * partial tally as the final.
 */

interface EventTimelineProps {
  events: MatchEventRow[]
  opponentLabel: string
  /** The match's real final score — EA truth, never derived from events. */
  scoreFor: number
  scoreAgainst: number
}

const BGM_LABEL = 'BGM'
const ACCENT_LINE = 'rgba(232,65,49,0.4)'

export function EventTimeline({
  events,
  opponentLabel,
  scoreFor,
  scoreAgainst,
}: EventTimelineProps) {
  const oppAbbrev = abbreviateTeamName(opponentLabel)
  const model = useMemo(
    () => buildTimeline(events, { for: scoreFor, against: scoreAgainst }),
    [events, scoreFor, scoreAgainst],
  )
  // Condensed hides penalties, never goals — the arc of the game (and the
  // game-winner) always stays on screen. The prototype clipped by height
  // instead, which buried its own ending.
  const [showPenalties, setShowPenalties] = useState(false)
  const listId = useId()

  const hasPenalties = model.penaltyCount > 0
  const expanded = !hasPenalties || showPenalties

  return (
    <section>
      <div className="border border-border bg-surface">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3.5 pb-2 pt-3">
          <div className="flex flex-col gap-0.5">
            <h2 className="font-condensed text-[11px] font-extrabold uppercase tracking-[0.18em] text-fg-3">
              Event Timeline
            </h2>
            <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-3">
              {model.isEmpty
                ? 'Goals + penalties'
                : `Game flow · ${BGM_LABEL} left / ${oppAbbrev} right`}
            </span>
          </div>
          {model.isEmpty ? null : (
            <span className="font-condensed text-[10px] font-bold uppercase tracking-[0.14em] text-fg-3">
              {expanded ? 'Full game' : 'Condensed'}
            </span>
          )}
        </div>

        {model.isEmpty ? (
          <EmptyTimeline />
        ) : (
          <>
            <div className="relative px-3.5 pb-1" id={listId}>
              <Rail />
              <Anchor label="Opening face-off" />
              {model.periods.map((period) => (
                <PeriodBlock
                  key={period.periodNumber}
                  period={period}
                  goalContext={model.goalContext}
                  oppAbbrev={oppAbbrev}
                  showPenalties={expanded}
                />
              ))}
            </div>

            <FinalLine
              bgm={model.final.bgm}
              opp={model.final.opp}
              winner={model.final.winner}
              oppAbbrev={oppAbbrev}
            />

            {model.final.complete ? null : (
              <p className="px-3.5 pb-1 text-center font-condensed text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-3">
                Timeline has {String(model.final.countedBgm + model.final.countedOpp)} of{' '}
                {String(model.final.bgm + model.final.opp)} goals — the rest were not captured
              </p>
            )}

            {hasPenalties ? (
              <button
                type="button"
                onClick={() => {
                  setShowPenalties((v) => !v)
                }}
                aria-expanded={showPenalties}
                aria-controls={listId}
                className="mx-3.5 mb-3.5 mt-2 flex w-[calc(100%-1.75rem)] items-center justify-center gap-2 border border-border py-2 hover:border-[color:rgba(232,65,49,0.4)]"
              >
                <span className="font-condensed text-[10px] font-extrabold uppercase tracking-[0.16em] text-accent">
                  {showPenalties
                    ? 'Hide penalties'
                    : `Show ${String(model.penaltyCount)} ${
                        model.penaltyCount === 1 ? 'penalty' : 'penalties'
                      }`}
                </span>
                <span
                  aria-hidden
                  className={`font-condensed text-[10px] leading-none text-accent ${
                    showPenalties ? 'rotate-180' : ''
                  }`}
                >
                  ⌄
                </span>
              </button>
            ) : (
              <div className="pb-3.5" />
            )}
          </>
        )}
      </div>
    </section>
  )
}

// ─── Degraded state ─────────────────────────────────────────────────────────

function EmptyTimeline() {
  return (
    <div className="flex flex-col gap-1.5 px-3.5 pb-4">
      <span className="font-condensed text-[13px] font-extrabold uppercase tracking-[0.14em] text-fg-3">
        No play-by-play captured
      </span>
      <p className="max-w-[62ch] font-condensed text-[11px] font-semibold leading-relaxed tracking-[0.04em] text-fg-3">
        Goal and penalty events are read from game recordings, and only after that read is reviewed.
        This match has EA API stats only — the score, box score and player numbers on this page are
        unaffected.
      </p>
    </div>
  )
}

// ─── Rail + anchors ─────────────────────────────────────────────────────────

function Rail() {
  return (
    <div className="pointer-events-none absolute inset-y-0 left-1/2 hidden -translate-x-1/2 sm:block">
      <div className="relative h-full w-[2px]" style={{ background: ACCENT_LINE }}>
        <span className="absolute -left-[3px] -top-[3px] block h-2 w-2 rounded-full bg-accent" />
        <span className="absolute -bottom-[3px] -left-[3px] block h-2 w-2 rounded-full bg-accent" />
      </div>
    </div>
  )
}

function Anchor({ label }: { label: string }) {
  return (
    <div className="relative flex justify-center pb-2 pt-1.5">
      <span className="relative z-10 inline-flex items-center gap-2.5 border border-border bg-charcoal px-4 py-1.5 font-condensed text-[10px] font-extrabold uppercase tracking-[0.24em] text-fg-3">
        <span aria-hidden className="block h-[7px] w-[7px] rounded-full bg-[var(--color-fg-5)]" />
        {label}
      </span>
    </div>
  )
}

function FinalLine({
  bgm,
  opp,
  winner,
  oppAbbrev,
}: {
  bgm: number
  opp: number
  winner: TimelineSide | null
  oppAbbrev: string
}) {
  const tone =
    winner === null
      ? { border: 'var(--color-border)', color: 'var(--color-fg-1)' }
      : winner === 'bgm'
        ? { border: ACCENT_LINE, color: 'var(--color-accent)' }
        : { border: 'var(--opp-line)', color: 'var(--opp)' }
  return (
    <div className="px-3.5 pt-2 text-center">
      <span
        className="inline-flex items-baseline gap-1.5 border bg-background px-3.5 py-1.5 font-condensed text-[11px] font-extrabold uppercase tabular-nums tracking-[0.14em]"
        style={{ borderColor: tone.border, color: tone.color }}
      >
        <span className="text-fg-3">Final</span>
        <span aria-hidden className="text-fg-4">
          ·
        </span>
        {BGM_LABEL} {bgm} – {opp} {oppAbbrev}
      </span>
    </div>
  )
}

// ─── Periods ────────────────────────────────────────────────────────────────

function PeriodBlock({
  period,
  goalContext,
  oppAbbrev,
  showPenalties,
}: {
  period: TimelinePeriod<MatchEventRow>
  goalContext: Map<number, GoalContext>
  oppAbbrev: string
  showPenalties: boolean
}) {
  return (
    <div>
      <PeriodDivider
        label={period.label}
        countLabel={periodCountLabel(period.goals, period.penalties)}
        scoreless={period.goals === 0}
      />
      <ol>
        {period.rows.map((event) => {
          const isPenalty = event.eventType === 'penalty'
          return (
            <li key={event.id} className={isPenalty && !showPenalties ? 'hidden' : undefined}>
              <EventRow
                event={event}
                shortLabel={period.shortLabel}
                ctx={goalContext.get(event.id) ?? null}
                oppAbbrev={oppAbbrev}
              />
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function PeriodDivider({
  label,
  countLabel,
  scoreless,
}: {
  label: string
  countLabel: string
  scoreless: boolean
}) {
  return (
    <div className="relative flex items-center justify-center pb-2.5 pt-3.5">
      <span
        aria-hidden
        className="absolute inset-x-0 top-1/2 h-px bg-[linear-gradient(to_right,transparent,var(--color-border)_28%,var(--color-border)_72%,transparent)]"
      />
      <span
        className="relative z-10 inline-flex items-center gap-3 border bg-charcoal px-4 py-1"
        style={{ borderColor: scoreless ? 'var(--color-border)' : ACCENT_LINE }}
      >
        <span
          className={`font-condensed text-[15px] font-black uppercase tracking-[0.2em] ${
            scoreless ? 'text-fg-3' : 'text-accent'
          }`}
        >
          {label}
        </span>
        <span aria-hidden className="h-[15px] w-px bg-border" />
        <span
          className={`font-condensed text-[10px] font-bold uppercase tracking-[0.16em] ${
            scoreless ? 'text-fg-3' : 'text-fg-2'
          }`}
        >
          {countLabel}
        </span>
      </span>
    </div>
  )
}

// ─── Rows ───────────────────────────────────────────────────────────────────

/**
 * DOM order is pill → card, so the stacked mobile layout reads "time, then
 * card". At `sm` both are placed explicitly into the rail grid — the pill into
 * the middle column, the card into its team's side — so the empty half needs
 * no placeholder element.
 */
function EventRow({
  event,
  shortLabel,
  ctx,
  oppAbbrev,
}: {
  event: MatchEventRow
  shortLabel: string
  ctx: GoalContext | null
  oppAbbrev: string
}) {
  const side = sideOf(event.teamSide)
  const isBgm = side === 'bgm'
  return (
    <div className="relative z-10 my-1.5 grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[1fr_76px_1fr]">
      <div className="flex justify-start sm:col-start-2 sm:row-start-1 sm:justify-center">
        <ClockPill clock={toElapsedClock(event.clock)} period={shortLabel} />
      </div>
      <div
        className={`flex min-w-0 justify-start sm:row-start-1 ${
          isBgm ? 'sm:col-start-1 sm:justify-end' : 'sm:col-start-3'
        }`}
      >
        <EventCard event={event} side={side} ctx={ctx} oppAbbrev={oppAbbrev} />
      </div>
    </div>
  )
}

function ClockPill({ clock, period }: { clock: string | null; period: string }) {
  return (
    <span
      className="inline-flex flex-col items-center gap-px border bg-background px-2 py-1"
      style={{ borderColor: ACCENT_LINE }}
    >
      <span className="font-condensed text-[11px] font-extrabold leading-none tabular-nums tracking-[0.06em] text-fg-1">
        {clock ?? '—'}
      </span>
      <span className="font-condensed text-[10px] font-bold uppercase leading-none tracking-[0.1em] text-fg-3">
        {period}
      </span>
    </span>
  )
}

// ─── Cards ──────────────────────────────────────────────────────────────────

function EventCard({
  event,
  side,
  ctx,
  oppAbbrev,
}: {
  event: MatchEventRow
  side: TimelineSide
  ctx: GoalContext | null
  oppAbbrev: string
}) {
  return event.eventType === 'penalty' ? (
    <PenaltyCard event={event} side={side} oppAbbrev={oppAbbrev} />
  ) : (
    <GoalCard event={event} side={side} ctx={ctx} oppAbbrev={oppAbbrev} />
  )
}

/** Shared card geometry: BGM cards hug the rail from the left, opp from the right. */
function cardLayout(side: TimelineSide) {
  const isBgm = side === 'bgm'
  return {
    box: `flex w-full max-w-[340px] flex-col gap-1.5 bg-surface px-3.5 py-2.5 ${
      isBgm ? 'sm:items-end sm:text-right' : 'sm:items-start sm:text-left'
    }`,
    row: isBgm ? 'sm:flex-row-reverse' : 'sm:flex-row',
    justify: isBgm ? 'sm:justify-end' : 'sm:justify-start',
  }
}

function GoalCard({
  event,
  side,
  ctx,
  oppAbbrev,
}: {
  event: MatchEventRow
  side: TimelineSide
  ctx: GoalContext | null
  oppAbbrev: string
}) {
  const isBgm = side === 'bgm'
  const isGwg = ctx?.isGameWinner === true
  const layout = cardLayout(side)
  const teamLabel = isBgm ? BGM_LABEL : oppAbbrev
  const scorer = pickActor(event, 'goal')

  // The winner's card is the loud one: accent frame and glow on both sides of
  // the rail, because "this goal won it" outranks "this is their goal".
  const frame = isGwg
    ? { border: '1px solid var(--color-accent)', boxShadow: '0 0 18px rgba(232,65,49,0.35)' }
    : {
        border: '1px solid var(--color-border)',
        ...(isBgm
          ? { borderLeft: '3px solid var(--color-accent)' }
          : { borderRight: '3px solid var(--opp)' }),
      }
  const kickerColor = isGwg || isBgm ? 'var(--color-accent)' : 'var(--opp)'

  return (
    <div className={layout.box} style={frame}>
      <div className={`flex items-center gap-2 ${layout.row}`}>
        <span
          aria-hidden
          className="block h-1.5 w-1.5 flex-none rounded-full"
          style={{ background: kickerColor }}
        />
        <span
          className="font-condensed text-[10px] font-extrabold uppercase tracking-[0.2em]"
          style={{ color: kickerColor }}
        >
          Goal · {teamLabel} #{String(ctx?.goalNumberForSide ?? 1)}
          {isGwg ? ' · GWG' : ''}
        </span>
      </div>

      <ActorName
        name={scorer.text}
        id={scorer.id}
        className={`text-[17px] font-black leading-[1.05] tracking-[0.03em] ${
          isGwg ? 'text-accent' : 'text-fg-1'
        }`}
      />

      <AssistLine event={event} align={layout.row} />

      {ctx ? (
        <div
          className={`flex w-full items-center gap-2.5 border-t border-border-subtle pt-2 ${layout.row} ${layout.justify}`}
        >
          {/* Phase 6/7 colour rule: the side in front is saturated, the side
              behind is muted. A shut-out team's 0 in full opponent colour read
              louder than the lead it was losing to. */}
          <span className="font-condensed text-[13px] font-black tabular-nums tracking-[0.02em]">
            <span style={{ color: runningScoreColor(ctx, 'bgm') }}>{String(ctx.bgmAfter)}</span>
            <span className="px-[3px] text-fg-3">–</span>
            <span style={{ color: runningScoreColor(ctx, 'opp') }}>{String(ctx.oppAfter)}</span>
          </span>
          <span
            className="font-condensed text-[10px] font-bold uppercase tracking-[0.14em]"
            style={{ color: swingColor(ctx) }}
          >
            {leadChangeLabel(ctx, oppAbbrev)}
          </span>
        </div>
      ) : null}
    </div>
  )
}

/** Amber carries "penalty"; the side bar and the kicker carry which team took it. */
function PenaltyCard({
  event,
  side,
  oppAbbrev,
}: {
  event: MatchEventRow
  side: TimelineSide
  oppAbbrev: string
}) {
  const isBgm = side === 'bgm'
  const layout = cardLayout(side)
  const teamLabel = isBgm ? BGM_LABEL : oppAbbrev
  const culprit = pickActor(event, 'penalty')
  const minutes =
    event.penaltyMinutes !== null
      ? `${String(event.penaltyMinutes)} PIM`
      : event.penaltyType === 'Major'
        ? '5 PIM'
        : '2 PIM'
  return (
    <div
      className={layout.box}
      style={{
        border: '1px solid rgba(245,158,11,0.32)',
        background: 'linear-gradient(180deg,rgba(245,158,11,0.05),var(--color-surface))',
        ...(isBgm
          ? { borderLeft: '3px solid var(--color-accent)' }
          : { borderRight: '3px solid var(--opp)' }),
      }}
    >
      <div className={`flex items-center gap-2 ${layout.row}`}>
        <span
          aria-hidden
          className="block h-1.5 w-1.5 flex-none rounded-full bg-[var(--color-otl)]"
        />
        <span className="font-condensed text-[10px] font-extrabold uppercase tracking-[0.2em] text-[var(--color-otl)]">
          Penalty · {teamLabel}
        </span>
      </div>

      <ActorName
        name={culprit.text}
        id={culprit.id}
        className="text-[15px] font-extrabold leading-[1.05] tracking-[0.03em] text-fg-1"
      />

      {/* Natural order on both sides — mirroring this row turned "TRIPPING
          2 PIM" into "2 PIM TRIPPING"; only the label-led rows above mirror. */}
      <div className={`flex flex-wrap items-center gap-2 ${layout.justify}`}>
        {event.infraction ? (
          <span className="font-condensed text-[12px] font-extrabold uppercase tracking-[0.06em] text-[var(--color-otl)]">
            {event.infraction}
          </span>
        ) : null}
        <span className="font-condensed text-[11px] font-extrabold tabular-nums tracking-[0.06em] text-fg-3">
          {minutes}
        </span>
      </div>
    </div>
  )
}

// ─── Sub-pieces ─────────────────────────────────────────────────────────────

function ActorName({
  name,
  id,
  className,
}: {
  name: string
  id: number | null
  className: string
}) {
  const base = `font-condensed uppercase ${className}`
  // Opponent skaters have no profile page — only resolved BGM players link out.
  if (id === null) {
    return (
      <span className={base} title="Unresolved gamertag">
        {name}
      </span>
    )
  }
  return (
    <Link href={`/roster/${String(id)}`} className={`${base} hover:text-accent`}>
      {name}
    </Link>
  )
}

function AssistLine({ event, align }: { event: MatchEventRow; align: string }) {
  const primary = pickAssist(event, 'primary')
  const secondary = pickAssist(event, 'secondary')
  return (
    <div className={`flex items-center gap-1.5 ${align}`}>
      <span className="font-condensed text-[10px] font-extrabold uppercase tracking-[0.16em] text-fg-3">
        A
      </span>
      {!primary && !secondary ? (
        <span className="font-condensed text-[11px] font-semibold italic tracking-[0.02em] text-fg-3">
          Unassisted
        </span>
      ) : (
        <span className="font-condensed text-[11px] font-semibold tracking-[0.02em] text-fg-3">
          {primary ? <AssistName name={primary.text} id={primary.id} /> : null}
          {primary && secondary ? (
            <span aria-hidden className="px-1 text-fg-4">
              ·
            </span>
          ) : null}
          {secondary ? <AssistName name={secondary.text} id={secondary.id} /> : null}
        </span>
      )}
    </div>
  )
}

function AssistName({ name, id }: { name: string; id: number | null }) {
  if (id === null) {
    return (
      <span className="font-bold text-fg-2" title="Unresolved gamertag">
        {name}
      </span>
    )
  }
  return (
    <Link href={`/roster/${String(id)}`} className="font-bold text-fg-2 hover:text-accent">
      {name}
    </Link>
  )
}

function swingColor(ctx: GoalContext): string {
  if (ctx.tied) return 'var(--color-otl)'
  return ctx.leader === 'bgm' ? 'var(--color-accent)' : 'var(--opp)'
}

/** Leading side saturated, trailing side muted, level scores neutral. */
function runningScoreColor(ctx: GoalContext, side: TimelineSide): string {
  if (ctx.tied) return 'var(--color-fg-1)'
  if (ctx.leader !== side) return 'var(--color-fg-3)'
  return side === 'bgm' ? 'var(--color-accent)' : 'var(--opp)'
}

function pickActor(
  event: MatchEventRow,
  kind: 'goal' | 'penalty',
): { text: string; id: number | null } {
  if (kind === 'goal') {
    if (event.scorer) return { text: event.scorer.gamertag, id: event.scorer.id }
    if (event.scorerSnapshot) return { text: event.scorerSnapshot, id: null }
  } else {
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
    return null
  }
  if (event.secondaryAssist)
    return { text: event.secondaryAssist.gamertag, id: event.secondaryAssist.id }
  if (event.secondaryAssistSnapshot) return { text: event.secondaryAssistSnapshot, id: null }
  return null
}
