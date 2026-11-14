import Link from 'next/link'
import type {
  ClubFinalsOverview,
  ClubFinalsPageAttempt,
  ClubFinalsPageGame,
} from '@eanhl/db/queries'
import { Panel } from '@/components/ui/panel'
import { formatMatchDate, formatMatchTime } from '@/lib/format'

// Club Finals on the home page (CF1). Everything shown is a stored value from the worker's derive
// (migration 0083); nothing is worked out here. A Server Component: the collapsed "All attempts"
// list is a native <details>, so there is no client code. The section id is the anchor `/#club-finals`.

const ROUND_COUNT = 4
const BOX_COUNT = 7
const LABEL = 'font-condensed text-[10px] font-semibold uppercase tracking-[0.16em] text-fg-5'

export function ClubFinalsCard({ overview }: { overview: ClubFinalsOverview }) {
  if (overview.attempts.length === 0) return null
  const lastAttempt = overview.attempts[overview.attempts.length - 1]
  const running = lastAttempt?.status === 'active' && overview.panel !== null
  return (
    <section id="club-finals" className="scroll-mt-24">
      {running ? <RunningCard overview={overview} /> : <QuietLine overview={overview} />}
    </section>
  )
}

// ── An attempt is running: the panel's look, compact ─────────────────────────

function RunningCard({ overview }: { overview: ClubFinalsOverview }) {
  const { panel, lastGame, best } = overview
  const lastAttempt = overview.attempts[overview.attempts.length - 1]
  if (panel === null || lastAttempt === undefined) return null
  return (
    <Panel className="overflow-hidden">
      <div className="ticker-strip ticker-strip-hero" />
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500 sm:text-sm">
              Club Finals
            </h2>
            <span className="font-condensed text-[11px] font-bold uppercase tracking-[0.18em] text-fg-4">
              Attempt {lastAttempt.attempt} · 6v6
            </span>
          </div>
          {panel.retry ? (
            <span className="border border-accent/60 bg-accent/10 px-2.5 py-0.5 font-condensed text-[10px] font-extrabold uppercase tracking-[0.2em] text-accent-readable">
              Retry
            </span>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end md:gap-8">
          <div className="space-y-3">
            <p className="font-condensed text-3xl font-black uppercase leading-none tracking-[0.04em] text-fg-1 sm:text-4xl">
              Round {panel.round}
              {panel.round === ROUND_COUNT ? (
                <span className="ml-3 align-middle text-sm tracking-[0.2em] text-accent-readable">
                  Final
                </span>
              ) : null}
            </p>
            <RoundTrack round={panel.round} />
            <RoundBoxes boxes={panel.boxes} />
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-3 md:flex-col md:items-end md:gap-y-3 md:text-right">
            <div>
              <p className={LABEL}>Attempt record</p>
              <p className="font-condensed text-3xl font-black tabular-nums text-fg-1">
                {panel.attemptWins}
                <span className="text-fg-5">–</span>
                {panel.attemptLosses}
              </p>
            </div>
            <div>
              <p className={LABEL}>Best attempt</p>
              {best === null ? (
                <p className="font-condensed text-sm font-bold uppercase tracking-[0.1em] text-fg-4">
                  Unknown
                </p>
              ) : (
                <p className="font-condensed text-sm font-bold uppercase tracking-[0.1em] text-fg-2">
                  <span className="text-lg font-black tabular-nums text-fg-1">
                    {best.wins}–{best.losses}
                  </span>{' '}
                  {reached(best)}
                </p>
              )}
            </div>
          </div>
        </div>

        {lastGame !== null ? <LastGameLine game={lastGame} /> : null}
        <AllAttempts attempts={overview.attempts} />
      </div>
    </Panel>
  )
}

// ── No attempt running: one small line, past attempts behind it ──────────────

function QuietLine({ overview }: { overview: ClubFinalsOverview }) {
  const { best, panel, unplacedGames } = overview
  const lastAttempt = overview.attempts[overview.attempts.length - 1]
  const finalWon = lastAttempt?.status === 'final_won'
  return (
    <Panel className="p-3 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <h2 className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500 sm:text-sm">
          Club Finals
        </h2>
        <p className="font-condensed text-sm font-bold uppercase tracking-[0.1em] text-fg-2">
          {finalWon
            ? `Attempt ${String(lastAttempt?.attempt ?? '?')} won the final. What comes next is not known yet.`
            : best === null
              ? 'Best attempt unknown'
              : `Best ${String(best.wins)}–${String(best.losses)}, ${reached(best).toLowerCase()}`}
          {finalWon && unplacedGames > 0 ? ` ${String(unplacedGames)} later games not placed.` : ''}
          {!finalWon && panel !== null && panel.retry ? (
            <span className="ml-3 border border-accent/60 bg-accent/10 px-2 py-0.5 text-[10px] font-extrabold tracking-[0.2em] text-accent-readable">
              Retry
            </span>
          ) : null}
        </p>
      </div>
      <div className="mt-2">
        <AllAttempts attempts={overview.attempts} />
      </div>
    </Panel>
  )
}

function LastGameLine({ game }: { game: ClubFinalsPageGame }) {
  return (
    <p className="border-t border-border-subtle pt-3 font-condensed text-xs uppercase tracking-[0.1em]">
      <span className={LABEL}>Last game </span>
      <Link
        prefetch
        href={`/games/${String(game.matchId)}`}
        className="font-bold text-fg-2 transition-colors hover:text-fg-1"
      >
        {game.result === 'WIN' ? 'W' : 'L'} {String(game.scoreFor)}–{String(game.scoreAgainst)} vs{' '}
        {game.opponentName}
        <span className="ml-2 font-normal text-fg-5">
          {formatMatchDate(game.playedAt)} · {formatMatchTime(game.playedAt)}
        </span>
      </Link>
    </p>
  )
}

// ── All attempts (collapsed) ─────────────────────────────────────────────────

function AllAttempts({ attempts }: { attempts: ClubFinalsPageAttempt[] }) {
  const newestFirst = [...attempts].reverse()
  return (
    <details className="group">
      <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-2 font-condensed text-xs font-bold uppercase tracking-[0.16em] text-fg-3 transition-colors hover:text-fg-1 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-accent transition-transform group-open:rotate-90">
          ▸
        </span>
        All attempts ({attempts.length})
      </summary>
      <div className="mt-2 space-y-3">
        {newestFirst.map((a) => (
          <AttemptBlock key={a.attempt} attempt={a} />
        ))}
      </div>
    </details>
  )
}

function AttemptBlock({ attempt }: { attempt: ClubFinalsPageAttempt }) {
  const rounds = new Map<number, ClubFinalsPageGame[]>()
  for (const g of attempt.gameRows) {
    const list = rounds.get(g.round) ?? []
    list.push(g)
    rounds.set(g.round, list)
  }
  const start = formatMatchDate(attempt.startedAt)
  const end = formatMatchDate(attempt.endedAt)
  const status =
    attempt.status === 'active'
      ? 'Running'
      : attempt.status === 'final_won'
        ? 'Final won'
        : 'Eliminated'
  return (
    <div className="border border-zinc-800 bg-zinc-950/30">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-border-subtle px-3 py-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h3 className="font-condensed text-sm font-black uppercase tracking-[0.08em] text-fg-1">
            Attempt {attempt.attempt}
          </h3>
          <span className="font-condensed text-[11px] font-bold uppercase tracking-[0.14em] text-fg-4">
            {start === end ? start : `${start} – ${end}`}
          </span>
        </div>
        <span className="font-condensed text-xs font-bold uppercase tracking-[0.12em] text-fg-3">
          <span className="mr-2 text-base font-black tabular-nums text-fg-1">
            {attempt.wins}–{attempt.losses}
          </span>
          {reached(attempt)} · {status}
        </span>
      </div>
      <ul className="divide-y divide-border-subtle">
        {[...rounds.entries()].map(([round, games]) => {
          const last = games[games.length - 1]
          return (
            <li key={round} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
              <span className="w-20 font-condensed text-[11px] font-extrabold uppercase tracking-[0.16em] text-fg-3">
                {round === ROUND_COUNT ? 'Final' : `Round ${String(round)}`}
              </span>
              <RoundGameLinks games={games} />
              <span className="font-condensed text-[11px] font-bold uppercase tracking-[0.12em] text-fg-4">
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
    </div>
  )
}

function reached(a: Pick<ClubFinalsPageAttempt, 'roundReached' | 'status'>): string {
  if (a.status === 'final_won') return 'Won the final'
  if (a.roundReached === ROUND_COUNT) {
    return a.status === 'active' ? 'In the final' : 'Reached the final'
  }
  return `Reached round ${String(a.roundReached)}`
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/** Four rounds as a track: done, current, to come. The last one is the final. */
function RoundTrack({ round }: { round: number }) {
  return (
    <ol
      className="flex items-center gap-1.5"
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
            className={`flex h-7 flex-1 items-center justify-center border font-condensed text-[11px] font-extrabold uppercase tracking-[0.16em] ${tone}`}
          >
            {r === ROUND_COUNT ? 'Final' : `R${String(r)}`}
          </li>
        )
      })}
    </ol>
  )
}

/** The panel's seven round boxes: W green, L red, empty grey. */
function RoundBoxes({ boxes }: { boxes: string }) {
  return (
    <ul className="flex gap-1.5" aria-label={`Round results: ${boxes || 'none yet'}`}>
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
            className={`flex h-9 w-9 items-center justify-center border font-condensed text-base font-black sm:h-10 sm:w-10 ${tone}`}
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
              className={`flex h-8 min-w-8 flex-col items-center justify-center border px-1.5 font-condensed font-black leading-none transition-colors hover:text-white ${
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
