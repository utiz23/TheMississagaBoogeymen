import Link from 'next/link'
import type { MatchEventRow } from '@eanhl/db/queries'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'
import { GoalMarker, PenaltyMarker } from '@/components/branding/event-markers'

interface EventLogProps {
  events: MatchEventRow[]
  opponentLabel: string
}

/**
 * Vertical-timeline goal + penalty log. The rail runs down the centre; each
 * event aligns left (BGM) or right (opponent). Period chips break the rail.
 * Hides itself when neither goals nor penalties exist.
 */
export function EventLog({ events, opponentLabel }: EventLogProps) {
  const visible = events.filter((e) => e.eventType === 'goal' || e.eventType === 'penalty')
  if (visible.length === 0) return null

  const gwgEventId = findGameWinningGoalId(events)

  // Group by period; preserve canonical period order.
  const order: Record<number, number> = {}
  visible.forEach((e, i) => {
    if (!(e.periodNumber in order)) order[e.periodNumber] = i
  })
  const groups = Array.from(
    visible.reduce((acc, ev) => {
      const key = ev.periodNumber
      if (!acc.has(key)) acc.set(key, [])
      acc.get(key)!.push(ev)
      return acc
    }, new Map<number, MatchEventRow[]>()),
  ).sort(([a], [b]) => (order[a] ?? 0) - (order[b] ?? 0))

  return (
    <section className="space-y-3">
      <SectionHeader label="Event Log" subtitle="Goals + penalties — OCR-derived" />
      <Panel className="px-2 py-5 sm:px-6">
        <div className="relative mx-auto max-w-3xl">
          {/* Vertical rail */}
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-zinc-800" aria-hidden />

          <ol className="relative space-y-4">
            {groups.map(([periodNumber, periodEvents], gi) => (
              <li key={periodNumber} className="space-y-3">
                <PeriodChip label={periodEvents[0]?.periodLabel ?? `P${String(periodNumber)}`} isFirst={gi === 0} />
                <ol className="space-y-2">
                  {periodEvents.map((ev) => (
                    <TimelineRow
                      key={ev.id}
                      event={ev}
                      opponentLabel={opponentLabel}
                      isGwg={ev.id === gwgEventId}
                    />
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </div>
      </Panel>
    </section>
  )
}

function PeriodChip({ label, isFirst }: { label: string; isFirst: boolean }) {
  return (
    <div className={`flex justify-center ${isFirst ? '' : 'pt-1'}`}>
      <span className="relative z-10 bg-surface px-3 py-0.5 font-condensed text-[10px] font-bold uppercase tracking-[0.22em] text-zinc-400">
        {cleanPeriodLabel(label)}
      </span>
    </div>
  )
}

function cleanPeriodLabel(raw: string): string {
  return raw
    .replace(/^\s*(?:RT|LT|RB|LB)\s+/i, '')
    .replace(/\s+(?:RT|LT|RB|LB)\s*$/i, '')
    .trim()
}

function TimelineRow({
  event,
  opponentLabel,
  isGwg,
}: {
  event: MatchEventRow
  opponentLabel: string
  isGwg: boolean
}) {
  const isBgm = event.teamSide === 'for'
  const side: 'home' | 'away' = isBgm ? 'home' : 'away'
  const markerSize = isGwg ? 30 : 22

  // Two-column grid: BGM side gets right-aligned content + marker; OPP side gets marker + left-aligned content.
  return (
    <li className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      {/* Left column (BGM) */}
      <div className={isBgm ? 'flex justify-end pr-2 text-right' : ''}>
        {isBgm ? (
          <EventBody event={event} opponentLabel={opponentLabel} side="home" isGwg={isGwg} alignRight />
        ) : null}
      </div>

      {/* Centre marker (sits on the rail) */}
      <div className="flex flex-col items-center">
        {event.eventType === 'goal' ? (
          <GoalMarker side={side} size={markerSize} />
        ) : (
          <PenaltyMarker side={side} size={markerSize} />
        )}
        {isGwg ? (
          <span className="mt-0.5 font-condensed text-[9px] font-bold uppercase tracking-[0.18em] text-[#ce202f]">
            GWG
          </span>
        ) : null}
      </div>

      {/* Right column (OPP) */}
      <div className={!isBgm ? 'pl-2' : ''}>
        {!isBgm ? (
          <EventBody event={event} opponentLabel={opponentLabel} side="away" isGwg={isGwg} />
        ) : null}
      </div>
    </li>
  )
}

function EventBody({
  event,
  opponentLabel,
  side,
  isGwg,
  alignRight = false,
}: {
  event: MatchEventRow
  opponentLabel: string
  side: 'home' | 'away'
  isGwg: boolean
  alignRight?: boolean
}) {
  const teamLabel =
    side === 'home'
      ? 'BGM'
      : (event.teamAbbreviation ?? opponentLabel.slice(0, 4).toUpperCase())
  const teamClass = side === 'home' ? 'text-[#ce202f]' : 'text-[#7d8db0]'
  const metaRow = (
    <div
      className={`flex items-baseline gap-2 ${alignRight ? 'justify-end' : ''} font-condensed text-[10px] uppercase tracking-widest text-zinc-500`}
    >
      <span className={`font-bold ${teamClass}`}>{teamLabel}</span>
      <span className="tabular-nums font-mono text-zinc-500">{event.clock ?? '—'}</span>
      {isGwg ? <span className="font-bold text-[#ce202f]">Winner</span> : null}
    </div>
  )
  return (
    <div className="space-y-0.5">
      {metaRow}
      <div className={`text-sm leading-snug text-zinc-300 ${alignRight ? 'text-right' : ''}`}>
        {event.eventType === 'goal' ? (
          <GoalDescription event={event} />
        ) : (
          <PenaltyDescription event={event} />
        )}
      </div>
    </div>
  )
}

function GoalDescription({ event }: { event: MatchEventRow }) {
  const scorer = event.actor ? (
    <Link
      href={`/roster/${String(event.actor.id)}`}
      className="font-semibold text-zinc-100 hover:text-accent"
    >
      {event.actor.gamertag}
    </Link>
  ) : (
    <span className="font-semibold text-zinc-100" title="Unresolved gamertag — display name only">
      {event.scorerSnapshot ?? event.actorGamertagSnapshot ?? '?'}
    </span>
  )

  const goalNumberSuffix =
    event.goalNumberInGame !== null ? ` (${String(event.goalNumberInGame)})` : ''

  const assists: React.ReactNode[] = []
  if (event.primaryAssist || event.primaryAssistSnapshot) {
    assists.push(
      <AssistName
        key="primary"
        id={event.primaryAssist?.id}
        text={event.primaryAssist?.gamertag ?? event.primaryAssistSnapshot ?? ''}
      />,
    )
  }
  if (event.secondaryAssist || event.secondaryAssistSnapshot) {
    if (assists.length > 0) assists.push(<span key="comma">, </span>)
    assists.push(
      <AssistName
        key="secondary"
        id={event.secondaryAssist?.id}
        text={event.secondaryAssist?.gamertag ?? event.secondaryAssistSnapshot ?? ''}
      />,
    )
  }

  return (
    <span>
      {scorer}
      <span className="text-zinc-500">{goalNumberSuffix}</span>
      {assists.length > 0 ? <span className="text-zinc-500"> — assists </span> : null}
      {assists}
    </span>
  )
}

function AssistName({ id, text }: { id: number | undefined; text: string }) {
  if (!text) return null
  if (id !== undefined) {
    return (
      <Link href={`/roster/${String(id)}`} className="text-zinc-400 hover:text-accent">
        {text}
      </Link>
    )
  }
  return (
    <span className="text-zinc-500" title="Unresolved">
      {text}
    </span>
  )
}

function PenaltyDescription({ event }: { event: MatchEventRow }) {
  const culprit = event.culprit ? (
    <Link
      href={`/roster/${String(event.culprit.id)}`}
      className="font-semibold text-zinc-100 hover:text-accent"
    >
      {event.culprit.gamertag}
    </Link>
  ) : (
    <span className="font-semibold text-zinc-100" title="Unresolved gamertag">
      {event.culpritSnapshot ?? event.actorGamertagSnapshot ?? '?'}
    </span>
  )
  const minutesText =
    event.penaltyMinutes !== null
      ? `${String(event.penaltyMinutes)}min`
      : event.penaltyType === 'Major'
        ? '5min'
        : '2min'
  return (
    <span>
      {culprit}{' '}
      <span className="text-zinc-400">{event.infraction ?? 'Penalty'}</span>{' '}
      <span className="text-zinc-500">
        ({event.penaltyType ?? 'Minor'}, {minutesText})
      </span>
    </span>
  )
}

/**
 * Identify the game-winning goal among the events.
 *
 * NHL definition: the GWG is the winning side's `(loser_total + 1)`-th goal
 * in chronological order. Returns `null` if the match is tied (no GWG by
 * convention) or if there are no goals.
 *
 * Walks the full chronological event list (not the filtered `visible`) so
 * that suppressing shots/hits/faceoffs doesn't shift the goal count.
 */
function findGameWinningGoalId(events: MatchEventRow[]): number | null {
  const goals = events.filter((e) => e.eventType === 'goal')
  if (goals.length === 0) return null

  let bgmTotal = 0
  let oppTotal = 0
  for (const g of goals) {
    if (g.teamSide === 'for') bgmTotal++
    else oppTotal++
  }
  if (bgmTotal === oppTotal) return null
  const winningSide: 'for' | 'against' = bgmTotal > oppTotal ? 'for' : 'against'
  const target = Math.min(bgmTotal, oppTotal) + 1 // (loser_total + 1)-th goal on winning side

  let runningCount = 0
  for (const g of goals) {
    if (g.teamSide !== winningSide) continue
    runningCount++
    if (runningCount === target) return g.id
  }
  return null
}
