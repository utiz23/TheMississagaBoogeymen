import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  getPlayerWithProfile,
  getPlayerCareerStats,
  getPlayerGamertagHistory,
  getPlayerGameLog,
} from '@eanhl/db/queries'
import type { GameMode } from '@eanhl/db'
import { GAME_MODE } from '@eanhl/db'
import { ResultBadge } from '@/components/ui/result-badge'
import { formatMatchDate, formatScore, formatPosition } from '@/lib/format'

// Roster aggregates update after each ingestion cycle (~5 min). Cache for 1 hour.
export const revalidate = 3600

type SearchParams = Promise<Record<string, string | string[] | undefined>>

interface Props {
  params: Promise<{ id: string }>
  searchParams: SearchParams
}

function parseGameMode(raw: string | string[] | undefined): GameMode | null {
  if (typeof raw !== 'string') return null
  return (GAME_MODE as readonly string[]).includes(raw) ? (raw as GameMode) : null
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) return { title: 'Player Not Found — Club Stats' }
  try {
    const player = await getPlayerWithProfile(id)
    if (!player) return { title: 'Player Not Found — Club Stats' }
    return { title: `${player.gamertag} — Club Stats` }
  } catch {
    return { title: 'Player — Club Stats' }
  }
}

export default async function PlayerPage({ params, searchParams }: Props) {
  const { id: idStr } = await params
  const sp = await searchParams
  const gameMode = parseGameMode(sp.mode)
  const id = parseInt(idStr, 10)

  if (isNaN(id)) notFound()

  let player: Awaited<ReturnType<typeof getPlayerWithProfile>> = null
  let careerStats: Awaited<ReturnType<typeof getPlayerCareerStats>> = []
  let history: Awaited<ReturnType<typeof getPlayerGamertagHistory>> = []
  let gameLog: Awaited<ReturnType<typeof getPlayerGameLog>> = []

  try {
    ;[player, careerStats, history, gameLog] = await Promise.all([
      getPlayerWithProfile(id),
      getPlayerCareerStats(id, gameMode),
      getPlayerGamertagHistory(id),
      getPlayerGameLog(id, gameMode),
    ])
  } catch {
    return <ErrorState message="Unable to load player data right now." />
  }

  if (!player) notFound()

  // Show history section only when there are closed (past) entries
  const hasHistory = history.some((h) => h.seenUntil !== null)

  // True when the player exists (from member ingest) but has no locally captured match data.
  // This is the expected state for players who joined the club but whose games have not
  // yet been ingested — not an error, just an honest data-absence signal.
  const hasNoLocalData = careerStats.length === 0 && gameLog.length === 0

  return (
    <div className="space-y-8">
      {/* Back link */}
      <Link
        href="/roster"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <span aria-hidden>←</span> Roster
      </Link>

      {/* Player header */}
      <div className="border border-zinc-800 border-l-4 border-l-accent bg-surface px-6 py-5">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-baseline gap-3">
            {player.jerseyNumber != null && (
              <span className="font-condensed text-2xl font-bold text-accent">
                #{player.jerseyNumber}
              </span>
            )}
            <h1 className="font-condensed text-4xl font-bold uppercase tracking-wide text-zinc-50">
              {player.gamertag}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {/* preferredPosition overrides auto-detected position when set */}
            {(() => {
              const pos = player.preferredPosition ?? player.position
              return pos ? (
                <span className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  {formatPosition(pos)}
                </span>
              ) : null
            })()}
            {player.nationality && (
              <span className="rounded border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                {player.nationality}
              </span>
            )}
            {!player.isActive && (
              <span className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Inactive
              </span>
            )}
          </div>
          <span className="sm:ml-auto text-xs text-zinc-600">
            Last seen {formatMatchDate(player.lastSeenAt)}
          </span>
        </div>
        {player.bio && (
          <p className="mt-3 text-sm text-zinc-400 leading-relaxed max-w-2xl">{player.bio}</p>
        )}
      </div>

      {/* Member-only notice — shown when player exists but has no local match data yet */}
      {hasNoLocalData && (
        <div className="rounded border border-zinc-700 bg-zinc-900 px-4 py-3">
          <p className="text-sm text-zinc-400">
            <span className="font-semibold text-zinc-300">No local match history yet.</span> This
            player is registered as a team member but has not appeared in any locally recorded
            match. Stats and game log will populate automatically as games are ingested.
          </p>
        </div>
      )}

      {/* Page-level mode filter — applies to both Career Stats and Recent Games */}
      <div className="flex items-center justify-end">
        <GameModeFilter playerId={id} activeMode={gameMode} />
      </div>

      {/* Career stats */}
      <section>
        <div className="mb-3">
          <h2 className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Career Stats
          </h2>
        </div>
        {careerStats.length === 0 ? (
          <div className="flex min-h-[6rem] items-center justify-center border border-zinc-800 bg-surface">
            <p className="text-sm text-zinc-500">
              {gameMode !== null
                ? `No ${gameMode} career stats recorded yet.`
                : 'No career stats recorded yet.'}
            </p>
          </div>
        ) : (
          <CareerStatsTable rows={careerStats} />
        )}
      </section>

      {/* Recent game log */}
      <section>
        <h2 className="mb-3 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
          {gameMode !== null ? `Recent ${gameMode} Games` : 'Recent Games'}
        </h2>
        {gameLog.length === 0 ? (
          <div className="flex min-h-[6rem] items-center justify-center border border-zinc-800 bg-surface">
            <p className="text-sm text-zinc-500">
              {gameMode !== null ? `No ${gameMode} games recorded yet.` : 'No games recorded yet.'}
            </p>
          </div>
        ) : (
          <GameLog rows={gameLog} showMode={gameMode === null} />
        )}
      </section>

      {/* Gamertag history */}
      {hasHistory && (
        <section>
          <h2 className="mb-3 font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Gamertag History
          </h2>
          <div className="border border-zinc-800 bg-surface divide-y divide-zinc-800/60">
            {history.map((entry) => (
              <div key={entry.id} className="flex items-center gap-4 px-4 py-3">
                <span
                  className={`text-sm font-medium ${entry.seenUntil === null ? 'text-zinc-200' : 'text-zinc-500'}`}
                >
                  {entry.gamertag}
                </span>
                <span className="ml-auto text-xs text-zinc-600">
                  {formatMatchDate(entry.seenFrom)}
                  {entry.seenUntil !== null && ` → ${formatMatchDate(entry.seenUntil)}`}
                  {entry.seenUntil === null && (
                    <span className="ml-1.5 rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                      current
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ─── Game mode filter ─────────────────────────────────────────────────────────

const MODE_LABELS: { mode: GameMode | null; label: string }[] = [
  { mode: null, label: 'All' },
  { mode: '6s', label: '6s' },
  { mode: '3s', label: '3s' },
]

function gameModeHref(playerId: number, mode: GameMode | null): string {
  const qs = new URLSearchParams()
  if (mode !== null) qs.set('mode', mode)
  const qs_str = qs.toString()
  return `/roster/${playerId.toString()}${qs_str ? `?${qs_str}` : ''}`
}

function GameModeFilter({
  playerId,
  activeMode,
}: {
  playerId: number
  activeMode: GameMode | null
}) {
  return (
    <div className="flex gap-1">
      {MODE_LABELS.map(({ mode, label }) => {
        const isActive = mode === activeMode
        return (
          <Link
            key={label}
            href={gameModeHref(playerId, mode)}
            className={[
              'px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded border transition-colors',
              isActive
                ? 'border-accent bg-accent/10 text-accent'
                : 'border-zinc-700 bg-transparent text-zinc-500 hover:border-zinc-500 hover:text-zinc-300',
            ].join(' ')}
          >
            {label}
          </Link>
        )
      })}
    </div>
  )
}

// ─── Career stats table ───────────────────────────────────────────────────────

type CareerRow = Awaited<ReturnType<typeof getPlayerCareerStats>>[number]

function CareerStatsTable({ rows }: { rows: CareerRow[] }) {
  // Show goalie columns if any row has goalie data
  const hasGoalie = rows.some((r) => r.wins !== null)

  return (
    <div className="overflow-x-auto border border-zinc-800 bg-surface">
      <table className="w-full min-w-[560px]">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="py-2 pl-4 pr-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Season
            </th>
            {SKATER_COLS.map((col) => (
              <th
                key={col.key}
                className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600"
              >
                {col.label}
              </th>
            ))}
            {hasGoalie &&
              GOALIE_COLS.map((col) => (
                <th
                  key={col.key}
                  className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600"
                >
                  {col.label}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <CareerRow key={row.gameTitleId} row={row} hasGoalie={hasGoalie} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

interface StatCol {
  key: string
  label: string
  render: (row: CareerRow) => React.ReactNode
}

const SKATER_COLS: StatCol[] = [
  { key: 'gp', label: 'GP', render: (r) => r.skaterGp },
  { key: 'g', label: 'G', render: (r) => r.goals },
  { key: 'a', label: 'A', render: (r) => r.assists },
  { key: 'pts', label: 'PTS', render: (r) => r.points },
  {
    key: 'pm',
    label: '+/-',
    render: (r) => {
      const n = r.plusMinus
      return (
        <span className={n > 0 ? 'text-emerald-400' : n < 0 ? 'text-rose-400' : 'text-zinc-400'}>
          {n > 0 ? `+${n.toString()}` : n}
        </span>
      )
    },
  },
  { key: 'sog', label: 'SOG', render: (r) => r.shots },
  { key: 'hits', label: 'Hits', render: (r) => r.hits },
  { key: 'pim', label: 'PIM', render: (r) => r.pim },
  { key: 'ta', label: 'TA', render: (r) => r.takeaways },
  { key: 'gv', label: 'GV', render: (r) => r.giveaways },
]

const GOALIE_COLS: StatCol[] = [
  { key: 'ggp', label: 'G-GP', render: (r) => r.goalieGp },
  { key: 'w', label: 'W', render: (r) => r.wins ?? '—' },
  { key: 'l', label: 'L', render: (r) => r.losses ?? '—' },
  { key: 'svpct', label: 'SV%', render: (r) => (r.savePct !== null ? `${r.savePct}%` : '—') },
  { key: 'gaa', label: 'GAA', render: (r) => r.gaa ?? '—' },
]

function CareerRow({ row, hasGoalie }: { row: CareerRow; hasGoalie: boolean }) {
  return (
    <tr className="border-b border-zinc-800/60 last:border-0 hover:bg-surface-raised transition-colors">
      <td className="py-2.5 pl-4 pr-2 text-sm font-medium text-zinc-300">{row.gameTitleName}</td>
      {SKATER_COLS.map((col) => (
        <td key={col.key} className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
          {col.render(row)}
        </td>
      ))}
      {hasGoalie &&
        GOALIE_COLS.map((col) => (
          <td key={col.key} className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
            {col.render(row)}
          </td>
        ))}
    </tr>
  )
}

// ─── Game log ────────────────────────────────────────────────────────────────

type GameLogRow = Awaited<ReturnType<typeof getPlayerGameLog>>[number]

function GameLog({ rows, showMode }: { rows: GameLogRow[]; showMode: boolean }) {
  return (
    <div className="overflow-x-auto border border-zinc-800 bg-surface">
      <table className="w-full min-w-[520px]">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="py-2 pl-4 pr-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Date
            </th>
            <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Opponent
            </th>
            {showMode && (
              <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
                Mode
              </th>
            )}
            <th className="px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Result
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              Score
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              G
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              A
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              PTS
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              +/-
            </th>
            <th className="px-2 py-2 text-right text-xs font-semibold uppercase tracking-wider text-zinc-600">
              SV
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <GameLogRow key={row.matchId} row={row} showMode={showMode} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GameLogRow({ row, showMode }: { row: GameLogRow; showMode: boolean }) {
  const pts = row.goals + row.assists
  const pm = row.plusMinus

  return (
    <tr className="border-b border-zinc-800/60 last:border-0 hover:bg-surface-raised transition-colors">
      <td className="py-2.5 pl-4 pr-2 text-sm text-zinc-500 tabular whitespace-nowrap">
        {formatMatchDate(row.playedAt)}
      </td>
      <td className="max-w-[12rem] truncate px-2 py-2.5">
        <Link
          href={`/games/${row.matchId.toString()}`}
          className="text-sm font-medium text-zinc-200 hover:text-accent transition-colors"
        >
          {row.opponentName}
        </Link>
      </td>
      {showMode && (
        <td className="px-2 py-2.5">
          {row.gameMode != null ? (
            <span className="rounded border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {row.gameMode}
            </span>
          ) : (
            <span className="text-zinc-700">—</span>
          )}
        </td>
      )}
      <td className="px-2 py-2.5">
        <ResultBadge result={row.result} />
      </td>
      <td className="px-2 py-2.5 text-right font-condensed text-sm font-semibold text-zinc-100 tabular">
        {formatScore(row.scoreFor, row.scoreAgainst)}
      </td>
      {/* Skater line — shown as — for goalies */}
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {row.isGoalie ? '—' : row.goals}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {row.isGoalie ? '—' : row.assists}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {row.isGoalie ? '—' : pts}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular">
        {row.isGoalie ? (
          <span className="text-zinc-500">—</span>
        ) : (
          <span
            className={pm > 0 ? 'text-emerald-400' : pm < 0 ? 'text-rose-400' : 'text-zinc-400'}
          >
            {pm > 0 ? `+${pm.toString()}` : pm}
          </span>
        )}
      </td>
      {/* Saves — shown as — for skaters */}
      <td className="px-2 py-2.5 text-right text-sm tabular text-zinc-300">
        {row.isGoalie ? (row.saves ?? '—') : '—'}
      </td>
    </tr>
  )
}

// ─── Error state ──────────────────────────────────────────────────────────────

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
      <p className="text-sm text-zinc-500">{message}</p>
    </div>
  )
}
