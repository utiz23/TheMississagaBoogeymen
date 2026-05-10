import Link from 'next/link'
import type { MatchEventRow } from '@eanhl/db/queries'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'

interface EventLogProps {
  events: MatchEventRow[]
  opponentLabel: string
}

/**
 * Period-grouped goal + penalty event log. Hides itself if no goals/penalties
 * are present (shots/hits/faceoffs alone aren't worth a section).
 */
export function EventLog({ events, opponentLabel }: EventLogProps) {
  const visible = events.filter((e) => e.eventType === 'goal' || e.eventType === 'penalty')
  if (visible.length === 0) return null

  // Group by periodLabel preserving canonical order.
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
      <Panel className="px-4 py-4">
        <div className="space-y-5">
          {groups.map(([periodNumber, periodEvents]) => {
            const label = periodEvents[0]?.periodLabel ?? `Period ${String(periodNumber)}`
            return (
              <div key={periodNumber} className="space-y-2">
                <div className="flex items-center gap-3">
                  <h3 className="font-condensed text-xs font-bold uppercase tracking-[0.22em] text-zinc-400">
                    {cleanPeriodLabel(label)}
                  </h3>
                  <div className="h-px flex-1 bg-zinc-800" />
                </div>
                <ul className="space-y-1.5">
                  {periodEvents.map((ev) => (
                    <EventRow key={ev.id} event={ev} opponentLabel={opponentLabel} />
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </Panel>
    </section>
  )
}

function cleanPeriodLabel(raw: string): string {
  // Strip OCR ornaments like "RT" / "LT" prefixes that survived through the
  // schema layer — the label is for display only here.
  return raw
    .replace(/^\s*(?:RT|LT|RB|LB)\s+/i, '')
    .replace(/\s+(?:RT|LT|RB|LB)\s*$/i, '')
    .trim()
}

function EventRow({ event, opponentLabel }: { event: MatchEventRow; opponentLabel: string }) {
  const teamLabel =
    event.teamSide === 'for' ? 'BGM' : (event.teamAbbreviation ?? opponentLabel.slice(0, 4).toUpperCase())
  const teamClass = event.teamSide === 'for' ? 'text-accent' : 'text-zinc-500'

  return (
    <li className="flex items-baseline gap-3 text-sm">
      <span className={`w-12 shrink-0 font-condensed text-xs font-bold uppercase tracking-widest ${teamClass}`}>
        {teamLabel}
      </span>
      <span className="w-12 shrink-0 tabular-nums font-mono text-xs text-zinc-500">
        {event.clock ?? '—'}
      </span>
      <span className="flex-1 leading-snug text-zinc-300">
        {event.eventType === 'goal' ? <GoalDescription event={event} /> : <PenaltyDescription event={event} />}
      </span>
    </li>
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

  const goalNumberSuffix = event.goalNumberInGame !== null ? ` (${String(event.goalNumberInGame)})` : ''

  const assists: React.ReactNode[] = []
  if (event.primaryAssist || event.primaryAssistSnapshot) {
    assists.push(<AssistName key="primary" id={event.primaryAssist?.id} text={event.primaryAssist?.gamertag ?? event.primaryAssistSnapshot ?? ''} />)
  }
  if (event.secondaryAssist || event.secondaryAssistSnapshot) {
    if (assists.length > 0) assists.push(<span key="comma">, </span>)
    assists.push(<AssistName key="secondary" id={event.secondaryAssist?.id} text={event.secondaryAssist?.gamertag ?? event.secondaryAssistSnapshot ?? ''} />)
  }

  return (
    <span>
      {scorer}
      <span className="text-zinc-500">{goalNumberSuffix}</span>
      {assists.length > 0 ? (
        <span className="text-zinc-500"> — assists </span>
      ) : null}
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
