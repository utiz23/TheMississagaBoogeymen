import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  getClubFinalsOverview,
  type ClubFinalsOverview,
  type ClubFinalsPageAttempt,
  type ClubFinalsPageGame,
} from '@eanhl/db/queries'
import { Panel } from '@/components/ui/panel'
import { SectionHeader } from '@/components/ui/section-header'
import { formatMatchDate, formatMatchTime } from '@/lib/format'
import { resolveTitleFromSlug } from '@/lib/title-resolver'

export const metadata: Metadata = { title: 'Club Finals — Club Stats' }

// Rounds are derived by the worker after each pass (every 5 minutes).
export const revalidate = 300

const ROUND_COUNT = 4
const BOX_COUNT = 7

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function ClubFinalsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const result = await resolveTitleFromSlug(titleSlug, { liveOnly: true }).catch(() => null)
  if (result === null) return <EmptyState message="Unable to load Club Finals right now." />
  if (result.kind === 'invalid') redirect('/club-finals')
  if (result.kind === 'empty') return <EmptyState message="No game titles are configured yet." />
  const { gameTitle } = result.resolved

  let overview: ClubFinalsOverview
  try {
    overview = await getClubFinalsOverview(gameTitle.id)
  } catch {
    // Also the case before migration 0083 is applied.
    return <EmptyState message="Club Finals is not available right now." />
  }

  const attemptsNewestFirst = [...overview.attempts].reverse()

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1.5">
        <h1 className="font-condensed text-xl font-extrabold uppercase tracking-[0.08em] text-zinc-50 sm:text-[26px]">
          Club Finals
        </h1>
        <span className="font-condensed text-[11px] font-bold uppercase tracking-[0.18em] text-fg-4">
          {gameTitle.name} · 6v6
        </span>
      </header>

      {overview.attempts.length === 0 ? (
        <EmptyState message={`No Club Finals games for ${gameTitle.name} yet.`} />
      ) : (
        <>
          <p className="max-w-3xl font-condensed text-xs font-semibold uppercase tracking-[0.14em] text-fg-4">
            A round is first to 4 wins. 4 losses in a round end the attempt: back to round 1. Round
            4 is the final. A DNF or an OT loss counts as a loss.
          </p>

          <div className="grid gap-4 lg:grid-cols-3">
            <CurrentAttempt overview={overview} className="lg:col-span-2" />
            <BestRecord best={overview.best} />
          </div>

          <section className="space-y-4">
            <SectionHeader
              label="Attempts"
              subtitle="Newest first · every game links to its page"
            />
            {attemptsNewestFirst.map((attempt) => (
              <AttemptCard key={attempt.attempt} attempt={attempt} />
            ))}
          </section>
        </>
      )}
    </div>
  )
}

// ── Current attempt (the panel's look) ────────────────────────────────────────

function CurrentAttempt({
  overview,
  className,
}: {
  overview: ClubFinalsOverview
  className: string
}) {
  const { panel, lastGame, unplacedGames } = overview
  const lastAttempt = overview.attempts[overview.attempts.length - 1]
  return (
    <Panel className={`${className} overflow-hidden`}>
      <div className="ticker-strip ticker-strip-hero" />
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={LABEL}>Now</p>
            {panel === null ? (
              <p className="mt-1 font-condensed text-2xl font-black uppercase tracking-[0.06em] text-fg-1">
                Final won
              </p>
            ) : (
              <p className="mt-1 font-condensed text-4xl font-black uppercase leading-none tracking-[0.04em] text-fg-1 sm:text-5xl">
                Round {panel.round}
                {panel.round === ROUND_COUNT ? (
                  <span className="ml-3 align-middle text-base tracking-[0.2em] text-accent-readable">
                    Final
                  </span>
                ) : null}
              </p>
            )}
          </div>
          {panel !== null && panel.retry ? (
            <span className="border border-accent/60 bg-accent/10 px-3 py-1 font-condensed text-xs font-extrabold uppercase tracking-[0.2em] text-accent-readable">
              Retry
            </span>
          ) : null}
        </div>

        {panel === null ? (
          <p className="font-condensed text-sm uppercase tracking-[0.1em] text-fg-3">
            Attempt {lastAttempt?.attempt ?? '?'} won the final. What the panel shows after a won
            final is not known yet, so no current state is shown.
            {unplacedGames > 0
              ? ` ${String(unplacedGames)} later game${unplacedGames === 1 ? '' : 's'} not placed.`
              : ''}
          </p>
        ) : (
          <>
            <RoundTrack round={panel.round} />
            <div>
              <p className={LABEL}>This round</p>
              <RoundBoxes boxes={panel.boxes} className="mt-2" />
            </div>
            <div className="flex flex-wrap items-end gap-x-8 gap-y-2 border-t border-border-subtle pt-4">
              <div>
                <p className={LABEL}>Attempt record</p>
                <p className="font-condensed text-3xl font-black tabular-nums text-fg-1">
                  {panel.attemptWins}
                  <span className="text-fg-5">–</span>
                  {panel.attemptLosses}
                </p>
              </div>
              {lastGame !== null ? (
                <div>
                  <p className={LABEL}>Last game</p>
                  <Link
                    prefetch
                    href={`/games/${String(lastGame.matchId)}`}
                    className="font-condensed text-sm font-bold uppercase tracking-[0.1em] text-fg-2 transition-colors hover:text-fg-1"
                  >
                    {lastGame.result === 'WIN' ? 'W' : 'L'} {String(lastGame.scoreFor)}–
                    {String(lastGame.scoreAgainst)} vs {lastGame.opponentName}
                    <span className="ml-2 text-fg-5">
                      {formatMatchDate(lastGame.playedAt)} · {formatMatchTime(lastGame.playedAt)}
                    </span>
                  </Link>
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </Panel>
  )
}

function BestRecord({ best }: { best: ClubFinalsPageAttempt | null }) {
  return (
    <Panel className="p-4 sm:p-6">
      <p className={LABEL}>Best attempt</p>
      {best === null ? (
        <p className="mt-2 font-condensed text-sm uppercase tracking-[0.1em] text-fg-4">Unknown</p>
      ) : (
        <>
          <p className="mt-1 font-condensed text-4xl font-black tabular-nums leading-none text-fg-1">
            {best.wins}
            <span className="text-fg-5">–</span>
            {best.losses}
          </p>
          <p className="mt-3 font-condensed text-sm font-bold uppercase tracking-[0.1em] text-fg-2">
            {reached(best)}
          </p>
          <p className="mt-1 font-condensed text-xs uppercase tracking-[0.14em] text-fg-4">
            Attempt {best.attempt} · {formatMatchDate(best.startedAt)}
          </p>
          <p className="mt-3 font-condensed text-[11px] uppercase tracking-[0.12em] text-fg-5">
            Furthest round first, then most wins.
          </p>
        </>
      )}
    </Panel>
  )
}

// ── Attempts ──────────────────────────────────────────────────────────────────

function AttemptCard({ attempt }: { attempt: ClubFinalsPageAttempt }) {
  const rounds = new Map<number, ClubFinalsPageGame[]>()
  for (const g of attempt.gameRows) {
    const list = rounds.get(g.round) ?? []
    list.push(g)
    rounds.set(g.round, list)
  }
  const sameDay =
    formatMatchDate(attempt.startedAt) === formatMatchDate(attempt.endedAt)
      ? formatMatchDate(attempt.startedAt)
      : `${formatMatchDate(attempt.startedAt)} – ${formatMatchDate(attempt.endedAt)}`
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border-subtle px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h3 className="font-condensed text-lg font-black uppercase tracking-[0.08em] text-fg-1">
            Attempt {attempt.attempt}
          </h3>
          <span className="font-condensed text-xs font-bold uppercase tracking-[0.14em] text-fg-4">
            {sameDay}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-condensed text-xl font-black tabular-nums text-fg-1">
            {attempt.wins}
            <span className="text-fg-5">–</span>
            {attempt.losses}
          </span>
          <StatusChip status={attempt.status} reachedText={reached(attempt)} />
        </div>
      </div>
      <ul className="divide-y divide-border-subtle">
        {[...rounds.entries()].map(([round, games]) => {
          const last = games[games.length - 1]
          return (
            <li
              key={round}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5"
            >
              <span className="w-24 font-condensed text-xs font-extrabold uppercase tracking-[0.18em] text-fg-3">
                Round {round}
                {round === ROUND_COUNT ? (
                  <span className="text-accent-readable"> · Final</span>
                ) : null}
              </span>
              <RoundGameLinks games={games} />
              <span className="font-condensed text-xs font-bold uppercase tracking-[0.14em] text-fg-4">
                {last?.finalWon
                  ? 'Final won'
                  : last?.roundWon
                    ? 'Round won'
                    : last?.eliminated
                      ? 'Eliminated'
                      : 'In progress'}
                {last !== undefined
                  ? ` · ${String(last.roundWinsAfter)}–${String(last.roundLossesAfter)}`
                  : ''}
              </span>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}

function reached(a: Pick<ClubFinalsPageAttempt, 'roundReached' | 'status' | 'roundsWon'>): string {
  if (a.status === 'final_won') return 'Won the final'
  if (a.roundReached === ROUND_COUNT)
    return a.status === 'active' ? 'In the final' : 'Reached the final'
  return `Reached round ${String(a.roundReached)}`
}

function StatusChip({
  status,
  reachedText,
}: {
  status: ClubFinalsPageAttempt['status']
  reachedText: string
}) {
  const text = status === 'active' ? 'Running' : status === 'final_won' ? 'Final won' : 'Eliminated'
  const tone =
    status === 'active'
      ? 'border-accent/60 bg-accent/10 text-accent-readable'
      : status === 'final_won'
        ? 'border-emerald-700 bg-emerald-950/40 text-emerald-300'
        : 'border-zinc-600 bg-zinc-900 text-fg-3'
  return (
    <span className="flex items-center gap-2">
      <span className="font-condensed text-xs font-bold uppercase tracking-[0.12em] text-fg-4">
        {reachedText}
      </span>
      <span
        className={`border px-2 py-0.5 font-condensed text-[10px] font-extrabold uppercase tracking-[0.16em] ${tone}`}
      >
        {text}
      </span>
    </span>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────────

const LABEL = 'font-condensed text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-5'

/** Four rounds as a track: done, current, to come. The last one is the final. */
function RoundTrack({ round }: { round: number }) {
  return (
    <ol
      className="flex items-center gap-2"
      aria-label={`Round ${String(round)} of ${String(ROUND_COUNT)}`}
    >
      {Array.from({ length: ROUND_COUNT }, (_, i) => i + 1).map((r) => {
        const tone =
          r < round
            ? 'border-zinc-600 bg-zinc-800 text-fg-3'
            : r === round
              ? 'border-accent bg-accent/15 text-accent-readable'
              : 'border-zinc-800 bg-transparent text-fg-6'
        return (
          <li
            key={r}
            className={`flex h-9 flex-1 items-center justify-center border font-condensed text-xs font-extrabold uppercase tracking-[0.16em] ${tone}`}
          >
            {r === ROUND_COUNT ? 'Final' : `R${String(r)}`}
          </li>
        )
      })}
    </ol>
  )
}

/** The panel's seven round boxes: W green, L red, empty grey. */
function RoundBoxes({ boxes, className = '' }: { boxes: string; className?: string }) {
  return (
    <ul
      className={`flex gap-1.5 ${className}`}
      aria-label={`Round results: ${boxes || 'none yet'}`}
    >
      {Array.from({ length: BOX_COUNT }, (_, i) => {
        const c = boxes[i]
        const tone =
          c === 'W'
            ? 'border-emerald-600 bg-emerald-950/60 text-emerald-300'
            : c === 'L'
              ? 'border-rose-700 bg-rose-950/60 text-rose-300'
              : 'border-zinc-800 bg-zinc-950/40 text-fg-6'
        return (
          <li
            key={i}
            className={`flex h-11 w-11 items-center justify-center border font-condensed text-lg font-black ${tone}`}
          >
            {c ?? ''}
          </li>
        )
      })}
    </ul>
  )
}

/** One round's games as boxes that open the game. */
function RoundGameLinks({ games }: { games: ClubFinalsPageGame[] }) {
  return (
    <ul className="flex flex-wrap gap-1.5">
      {games.map((g) => {
        const win = g.result === 'WIN'
        const detail =
          g.result === 'OTL' ? 'OT loss' : g.result === 'DNF' ? 'DNF' : win ? 'Win' : 'Loss'
        return (
          <li key={g.matchId}>
            <Link
              prefetch
              href={`/games/${String(g.matchId)}`}
              title={`Game ${String(g.gameInRound)}: ${detail} ${String(g.scoreFor)}–${String(g.scoreAgainst)} vs ${g.opponentName}`}
              aria-label={`Round ${String(g.round)} game ${String(g.gameInRound)}: ${detail} ${String(g.scoreFor)} to ${String(g.scoreAgainst)} against ${g.opponentName}`}
              className={`flex h-9 min-w-9 flex-col items-center justify-center border px-1.5 font-condensed font-black leading-none transition-colors hover:text-white ${
                win
                  ? 'border-emerald-700 bg-emerald-950/50 text-emerald-300 hover:border-emerald-500'
                  : 'border-rose-800 bg-rose-950/50 text-rose-300 hover:border-rose-500'
              }`}
            >
              <span className="text-sm">{win ? 'W' : 'L'}</span>
              {g.result === 'OTL' || g.result === 'DNF' ? (
                <span className="text-[8px] tracking-[0.1em]">
                  {g.result === 'OTL' ? 'OT' : 'DNF'}
                </span>
              ) : null}
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <Panel className="flex min-h-[12rem] flex-col items-center justify-center gap-3">
      <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">{message}</p>
    </Panel>
  )
}
