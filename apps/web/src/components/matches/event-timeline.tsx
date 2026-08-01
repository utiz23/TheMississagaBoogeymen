'use client'

import { useId, useMemo, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import type { MatchEventRow } from '@eanhl/db/queries'
import { abbreviateTeamName } from '@/lib/format'
import { cssVars, delayVar, durationVar } from '@/lib/motion'
import { MotionReveal } from './motion'
import {
  buildTimeline,
  leadChangeLabel,
  periodCountLabel,
  sideOf,
  toElapsedClock,
  type GoalContext,
  type TimelineModel,
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
 * Ported to `Game Sheet copy.dc.html` — the same design of record the Box
 * Score and Team Stats modules follow. That pass brings the 12px type floor
 * (every micro-cap here was 10-11px), the prototype's card geometry, the
 * card hover elevation, and the game-winner's static top strip.
 *
 * Every derivation lives in `lib/event-timeline.ts` — this file only renders.
 *
 * Motion: the game replays. The rail lays the spine, the opening face-off
 * drops in, then dividers and goals cascade top to bottom with each card
 * gliding in from its own side, and FINAL lands last. See buildCascade.
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
  const cascade = buildCascade(model)

  return (
    <section>
      <MotionReveal className="flex flex-col border border-border bg-surface px-3.5 pb-3.5 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 pb-1">
          {/* House module header — the same 12px / semibold / 0.16em / fg-4
              with an fg-5 ornament that Box Score, Top Performers, DtW and
              Lineup carry. The accent belongs to the data, not to the label. */}
          <h2 className="font-condensed text-[12px] font-semibold uppercase tracking-[0.16em] text-fg-4">
            <span aria-hidden className="pr-1 text-fg-5">
              ▰
            </span>
            Event Timeline
          </h2>
          {model.isEmpty ? null : (
            <span className="font-condensed text-[12px] font-bold uppercase tracking-[0.14em] text-fg-4">
              {expanded ? 'Full game' : 'Condensed'}
            </span>
          )}
        </div>

        {model.isEmpty ? (
          <EmptyTimeline />
        ) : (
          <>
            {/* The prototype states the split in a visible subtitle. Which side
                a card sits on is positional and its colour is decorative —
                neither survives being read aloud — so the orientation is kept
                for screen readers where the layout carries it visually. */}
            <p className="sr-only">
              Goals and penalties in order. {BGM_LABEL} events are on the left of the rail,{' '}
              {oppAbbrev} events on the right.
            </p>

            <div className="relative" id={listId}>
              <Rail />
              <Anchor label="Opening face-off" />
              {model.periods.map((period) => (
                <PeriodBlock
                  key={period.periodNumber}
                  period={period}
                  goalContext={model.goalContext}
                  oppAbbrev={oppAbbrev}
                  showPenalties={expanded}
                  slotBase={cascade.slotOf(period.periodNumber)}
                  stepMs={cascade.stepMs}
                />
              ))}
            </div>

            <FinalLine
              bgm={model.final.bgm}
              opp={model.final.opp}
              winner={model.final.winner}
              oppAbbrev={oppAbbrev}
              delayMs={cascade.finalDelayMs}
            />

            {model.final.complete ? null : (
              <p className="pt-1.5 text-center font-condensed text-[12px] font-semibold uppercase tracking-[0.12em] text-fg-3">
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
                className="group/cta mt-2.5 flex w-full items-center justify-center gap-[7px] border border-border bg-charcoal px-3 py-2.5 transition-colors hover:border-accent hover:bg-[var(--color-accent-soft)]"
              >
                <span className="font-condensed text-[12px] font-extrabold uppercase tracking-[0.16em] text-fg-2 transition-colors group-hover/cta:text-accent">
                  {showPenalties
                    ? 'Hide penalties'
                    : `Show ${String(model.penaltyCount)} ${
                        model.penaltyCount === 1 ? 'penalty' : 'penalties'
                      }`}
                </span>
                {/* Glyph, so sized by eye rather than to the 12px label beside it. */}
                <span
                  aria-hidden
                  className={`gs-chevron inline-block font-condensed text-[14px] leading-none text-fg-2 group-hover/cta:text-accent ${
                    showPenalties ? 'rotate-180' : ''
                  }`}
                >
                  ⌄
                </span>
              </button>
            ) : null}
          </>
        )}
      </MotionReveal>
    </section>
  )
}

// ─── Cascade schedule ───────────────────────────────────────────────────────

/**
 * When each part of the timeline reveals, so the match appears to replay in
 * order: rail → opening face-off → period dividers and goals, top to bottom →
 * FINAL last.
 *
 * Three rules keep this honest on real data rather than the prototype's twelve
 * hand-placed rows:
 *
 *   1. The stagger FITS A FIXED SPAN, like the prototype's, rather than
 *      running at a fixed step until a cap. Row count is data-driven, and a
 *      capped `index * step` made the tail of a busy game share one delay and
 *      arrive as a clump; here the step shrinks instead, so every row keeps a
 *      distinct beat and the last one still lands on time.
 *   2. The whole entrance stays inside the spec's 2.4s ceiling: the last row
 *      begins at 1.70s at the very latest, FINAL at 1.95s, and its 0.38s rise
 *      completes at 2.33s.
 *   3. Penalties are NOT in the cascade. They start hidden behind the
 *      condensed toggle, so they can only ever appear on expand — and the
 *      guardrail is explicit that the remainder appears instantly rather than
 *      replaying a stale entrance delay.
 */
const CASCADE_START_MS = 650
const CASCADE_STEP_MS = 150
const CASCADE_SPAN_MS = 1050
const FINAL_GAP_MS = 250

interface CascadeSchedule {
  /**
   * Slot INDEX of a period's divider — not its delay. Children hold the index
   * and convert it with `slotDelay`, so the schedule has one owner.
   */
  slotOf: (periodNumber: number) => number
  /** Gap between consecutive slots, compressed to fit the span. */
  stepMs: number
  finalDelayMs: number
}

function buildCascade(model: TimelineModel<MatchEventRow>): CascadeSchedule {
  const slots = new Map<number, number>()
  let slot = 0

  for (const period of model.periods) {
    slots.set(period.periodNumber, slot)
    slot += 1 + period.rows.filter((row) => row.eventType !== 'penalty').length
  }

  const gaps = Math.max(slot - 1, 1)
  const stepMs = Math.min(CASCADE_STEP_MS, CASCADE_SPAN_MS / gaps)

  return {
    slotOf: (periodNumber) => slots.get(periodNumber) ?? 0,
    stepMs,
    finalDelayMs: slotDelay(Math.max(slot - 1, 0), stepMs) + FINAL_GAP_MS,
  }
}

function slotDelay(slot: number, stepMs: number): number {
  return CASCADE_START_MS + slot * stepMs
}

// ─── Degraded state ─────────────────────────────────────────────────────────

function EmptyTimeline() {
  return (
    <div className="flex flex-col gap-1.5 pb-0.5">
      <span className="font-condensed text-[13px] font-extrabold uppercase tracking-[0.14em] text-fg-3">
        No play-by-play captured
      </span>
      <p className="max-w-[62ch] font-condensed text-[12px] font-semibold leading-relaxed tracking-[0.04em] text-fg-3">
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
      {/* The spine is laid before any event: it grows top-down, then both
          end-caps ignite as it lands. The caps hold their glow rather than
          breathing it — the design of record demotes them to static dots and
          keeps the page's one persistent loop on the scorebug ticker.

          Caps are SIBLINGS of the spine, as in the prototype, not children:
          `gs-grow-y` is a scaleY, and anything inside it is squashed flat for
          the length of the draw. */}
      <div
        className="gs-grow-y h-full w-[2px] bg-[var(--color-accent-line)]"
        style={durationVar(620)}
      />
      <RailCap className="-top-[3px]" />
      <RailCap className="-bottom-[3px]" />
    </div>
  )
}

function RailCap({ className }: { className: string }) {
  return (
    <span
      className={`gs-fade-in absolute -left-[3px] block h-2 w-2 rounded-full bg-accent [box-shadow:0_0_5px_rgba(232,65,49,0.16)] ${className}`}
      style={delayVar(560)}
    />
  )
}

function Anchor({ label }: { label: string }) {
  return (
    <div className="gs-fade-in relative flex justify-center pb-2 pt-0.5" style={delayVar(350)}>
      <span className="relative z-10 inline-flex items-center gap-[9px] border border-border bg-charcoal px-4 py-1.5 font-condensed text-[12px] font-extrabold uppercase tracking-[0.24em] text-fg-4">
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
  delayMs,
}: {
  bgm: number
  opp: number
  winner: TimelineSide | null
  oppAbbrev: string
  delayMs: number
}) {
  const tone =
    winner === null
      ? { border: 'var(--color-border)', color: 'var(--color-fg-1)' }
      : winner === 'bgm'
        ? { border: 'var(--color-accent-line)', color: 'var(--color-accent)' }
        : { border: 'var(--opp-line)', color: 'var(--opp)' }
  // The result, arriving at the end — after every event has landed. The flare
  // follows the winner; a timeline with no winner rises in without one.
  const flare = winner === null ? '' : winner === 'bgm' ? 'gs-flare-accent' : 'gs-flare-opp'

  return (
    <div className="pt-3 text-center">
      <span
        className={`gs-block-rise ${flare} inline-flex items-baseline gap-1.5 border bg-surface px-3.5 py-[5px] font-condensed text-[12px] font-extrabold uppercase tabular-nums tracking-[0.1em]`}
        style={{ borderColor: tone.border, color: tone.color, ...delayVar(delayMs) }}
      >
        <span className="text-fg-4">Final</span>
        <span aria-hidden className="text-fg-5">
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
  slotBase,
  stepMs,
}: {
  period: TimelinePeriod<MatchEventRow>
  goalContext: Map<number, GoalContext>
  oppAbbrev: string
  showPenalties: boolean
  /** Cascade slot index of this period's divider — see buildCascade. */
  slotBase: number
  stepMs: number
}) {
  // Only goals advance the cascade. A penalty row can never be part of the
  // opening reveal (it starts hidden), so it appears immediately when the
  // toggle reveals it rather than replaying a delay from a run it missed.
  let goalSlot = 0

  return (
    <div>
      <PeriodDivider
        label={period.label}
        countLabel={periodCountLabel(period.goals, period.penalties)}
        scoreless={period.goals === 0}
        delayMs={slotDelay(slotBase, stepMs)}
      />
      <ol>
        {period.rows.map((event) => {
          const isPenalty = event.eventType === 'penalty'
          if (!isPenalty) goalSlot += 1
          return (
            <li key={event.id} className={isPenalty && !showPenalties ? 'hidden' : undefined}>
              <EventRow
                event={event}
                shortLabel={period.shortLabel}
                ctx={goalContext.get(event.id) ?? null}
                oppAbbrev={oppAbbrev}
                delayMs={isPenalty ? 0 : slotDelay(slotBase + goalSlot, stepMs)}
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
  delayMs,
}: {
  label: string
  countLabel: string
  scoreless: boolean
  delayMs: number
}) {
  return (
    <div
      className="gs-fade-in relative flex items-center justify-center pb-2.5 pt-3.5"
      style={delayVar(delayMs)}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-1/2 h-px bg-[linear-gradient(to_right,transparent,var(--color-border)_28%,var(--color-border)_72%,transparent)]"
      />
      <span
        className="relative z-10 inline-flex items-center gap-3 border bg-charcoal px-[15px] py-[5px]"
        style={{
          borderColor: scoreless ? 'var(--color-border)' : 'var(--color-accent-line)',
        }}
      >
        <span
          className={`font-condensed text-[15px] font-black uppercase tracking-[0.2em] ${
            scoreless ? 'text-fg-4' : 'text-accent'
          }`}
        >
          {label}
        </span>
        <span aria-hidden className="h-[15px] w-px bg-border" />
        <span
          className={`font-condensed text-[12px] font-bold uppercase tracking-[0.16em] ${
            scoreless ? 'text-fg-5' : 'text-fg-2'
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
  delayMs,
}: {
  event: MatchEventRow
  shortLabel: string
  ctx: GoalContext | null
  oppAbbrev: string
  delayMs: number
}) {
  const side = sideOf(event.teamSide)
  const isBgm = side === 'bgm'
  // Cards glide in from their own side, mirroring the layout: the direction
  // itself says whose goal it was, before any label is read.
  const slide = isBgm ? 'gs-slide-left' : 'gs-slide-right'
  return (
    <div className="relative z-10 my-[7px] grid grid-cols-1 items-center gap-1.5 sm:grid-cols-[1fr_76px_1fr]">
      <div className="flex justify-start sm:col-start-2 sm:row-start-1 sm:justify-center">
        <ClockPill clock={toElapsedClock(event.clock)} period={shortLabel} delayMs={delayMs} />
      </div>
      <div
        className={`${slide} flex min-w-0 justify-start sm:row-start-1 ${
          isBgm ? 'sm:col-start-1 sm:justify-end' : 'sm:col-start-3'
        }`}
        style={delayVar(delayMs)}
      >
        <EventCard event={event} side={side} ctx={ctx} oppAbbrev={oppAbbrev} />
      </div>
    </div>
  )
}

function ClockPill({
  clock,
  period,
  delayMs,
}: {
  clock: string | null
  period: string
  delayMs: number
}) {
  return (
    <span
      className="gs-pop inline-flex flex-col items-center gap-px border border-[var(--color-accent-line)] bg-background px-2 py-1"
      style={delayVar(delayMs)}
    >
      <span className="font-condensed text-[12px] font-extrabold leading-none tabular-nums tracking-[0.06em] text-fg-1">
        {clock ?? '—'}
      </span>
      <span className="font-condensed text-[12px] font-bold uppercase leading-none tracking-[0.1em] text-fg-4">
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

/**
 * Shared card geometry: BGM cards hug the rail from the left, opp from the
 * right. Frame colours are NOT set here — they ride `--tl-*` custom properties
 * so the `.gs-tl-card` hover rule in globals.css can step over them; an inline
 * `border` would win against any hover rule.
 */
function cardLayout(side: TimelineSide) {
  const isBgm = side === 'bgm'
  return {
    // 300px rather than the prototype's 340: the widest thing a card ever has
    // to hold is a two-assist line (~230px measured), so the extra 40px was
    // slack that only made the cards read heavy against the rail. Still above
    // the 240px floor. The corpus's longest assist pair (36 chars) wraps A2 to
    // a second line here and does NOT overflow the card — checked, not assumed.
    box: `gs-tl-card flex w-full max-w-[300px] flex-col gap-1.5 px-[13px] py-[9px] sm:min-w-[240px] ${
      isBgm ? 'sm:items-end sm:text-right' : 'sm:items-start sm:text-left'
    }`,
    row: isBgm ? 'sm:flex-row-reverse' : 'sm:flex-row',
    justify: isBgm ? 'sm:justify-end' : 'sm:justify-start',
  }
}

/** The team edge, which the hover rule reads but never recolours. */
function edgeVar(side: TimelineSide): Record<string, string> {
  return { '--tl-edge': side === 'bgm' ? 'var(--color-accent)' : 'var(--opp)' }
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

  // The winner's card is the loud one on both sides of the rail, because "this
  // goal won it" outranks "this is their goal". Four cues stack, and all of
  // them are STANDING treatment or fire exactly once — none loop:
  //   · a solid accent frame, where every other card gets a hairline
  //   · a lit resting glow, so the card carries weight after the entrance
  //   · the static top strip `.gs-tl-gwg` draws
  //   · one arrival flare, and the scorer's name blooming with it
  // It drops the team edge, so the frame reads as one closed accent box rather
  // than a bar plus a border.
  const frame: CSSProperties = isGwg
    ? cssVars({
        '--tl-border': 'var(--color-accent)',
        '--tl-border-hover': 'var(--color-accent)',
        '--tl-glow': '0 0 18px rgba(232,65,49,0.35)',
        '--tl-glow-hover': '0 0 26px rgba(232,65,49,0.5)',
      })
    : cssVars(edgeVar(side))
  const kickerColor = isGwg || isBgm ? 'var(--color-accent)' : 'var(--opp)'

  // `--gs-delay` is inherited from the row wrapper, so the arrival flare and
  // the scorer's bloom land with the card rather than on their own clock.
  return (
    <div
      className={`${layout.box} ${isGwg ? 'gs-tl-gwg gs-flare-accent' : ''}`}
      data-side={isGwg ? undefined : side}
      style={frame}
    >
      <div className={`flex items-center gap-[7px] ${layout.row}`}>
        <span
          aria-hidden
          className="block h-1.5 w-1.5 flex-none rounded-full"
          style={{ background: kickerColor }}
        />
        <span
          className="font-condensed text-[12px] font-extrabold uppercase tracking-[0.2em]"
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
          isGwg ? 'gs-bloom-accent text-accent' : 'text-fg-1'
        }`}
      />

      <AssistLine event={event} justify={layout.justify} />

      {ctx ? (
        <div
          className={`mt-px flex w-full items-center gap-2.5 border-t border-border-subtle pt-[7px] ${layout.row} ${layout.justify}`}
        >
          {/* Phase 6/7 colour rule: the side in front is saturated, the side
              behind is muted. A shut-out team's 0 in full opponent colour read
              louder than the lead it was losing to. */}
          <span className="font-condensed text-[13px] font-black tabular-nums tracking-[0.02em]">
            <span style={{ color: runningScoreColor(ctx, 'bgm') }}>{String(ctx.bgmAfter)}</span>
            <span className="px-[3px] text-fg-6">–</span>
            <span style={{ color: runningScoreColor(ctx, 'opp') }}>{String(ctx.oppAfter)}</span>
          </span>
          <span
            className="font-condensed text-[12px] font-bold uppercase tracking-[0.14em]"
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
  // Hover brightens the amber rather than stepping to the accent line the goal
  // cards use: one meaning per frame, and red here would read as "BGM".
  return (
    <div
      className={layout.box}
      data-side={side}
      style={cssVars({
        ...edgeVar(side),
        '--tl-border': 'rgba(245,158,11,0.32)',
        '--tl-border-hover': 'rgba(245,158,11,0.55)',
        '--tl-tint': 'linear-gradient(180deg,rgba(245,158,11,0.05),transparent)',
      })}
    >
      <div className={`flex items-center gap-[7px] ${layout.row}`}>
        <span
          aria-hidden
          className="block h-1.5 w-1.5 flex-none rounded-full bg-[var(--color-otl)]"
        />
        <span className="font-condensed text-[12px] font-extrabold uppercase tracking-[0.2em] text-[var(--color-otl)]">
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
        <span className="font-condensed text-[12px] font-extrabold tabular-nums tracking-[0.06em] text-fg-3">
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

/**
 * Assists, ranked explicitly.
 *
 * The prototype prints one "A" over a comma-joined list, which loses which
 * pass was the primary — a distinction this data has (`primary_assist_*` and
 * `secondary_assist_*` are separate columns) and one that matters on a stats
 * page. So each assist gets its own labelled slot instead.
 *
 * Natural order on both sides of the rail, alignment only: mirroring would put
 * A2 ahead of A1 on the BGM cards. This follows the penalty card's precedent —
 * only single-label rows mirror.
 */
function AssistLine({ event, justify }: { event: MatchEventRow; justify: string }) {
  const primary = pickAssist(event, 'primary')
  const secondary = pickAssist(event, 'secondary')

  if (!primary && !secondary) {
    return (
      <div className={`flex items-center gap-1.5 ${justify}`}>
        <AssistLabel>A</AssistLabel>
        <span className="font-condensed text-[12px] font-semibold italic tracking-[0.02em] text-fg-3">
          Unassisted
        </span>
      </div>
    )
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 ${justify}`}>
      {primary ? <AssistSlot label="A1" assist={primary} /> : null}
      {secondary ? <AssistSlot label="A2" assist={secondary} /> : null}
    </div>
  )
}

function AssistSlot({ label, assist }: { label: string; assist: Actor }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <AssistLabel>{label}</AssistLabel>
      <AssistName name={assist.text} id={assist.id} />
    </span>
  )
}

function AssistLabel({ children }: { children: string }) {
  return (
    <span className="font-condensed text-[12px] font-extrabold uppercase tracking-[0.16em] text-fg-5">
      {children}
    </span>
  )
}

function AssistName({ name, id }: { name: string; id: number | null }) {
  const base = 'font-condensed text-[12px] font-semibold tracking-[0.02em] text-fg-2'
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

function swingColor(ctx: GoalContext): string {
  if (ctx.tied) return 'var(--color-otl)'
  return ctx.leader === 'bgm' ? 'var(--color-accent)' : 'var(--opp)'
}

/** Leading side saturated, trailing side muted, level scores neutral. */
function runningScoreColor(ctx: GoalContext, side: TimelineSide): string {
  if (ctx.tied) return 'var(--color-fg-1)'
  if (ctx.leader !== side) return 'var(--color-fg-4)'
  return side === 'bgm' ? 'var(--color-accent)' : 'var(--opp)'
}

interface Actor {
  text: string
  id: number | null
}

function pickActor(event: MatchEventRow, kind: 'goal' | 'penalty'): Actor {
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

function pickAssist(event: MatchEventRow, which: 'primary' | 'secondary'): Actor | null {
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
