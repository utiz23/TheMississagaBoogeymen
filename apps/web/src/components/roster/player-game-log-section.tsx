'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { GameMode } from '@eanhl/db'
import { ResultPill } from '@/components/ui/result-pill'
import { Panel } from '@/components/ui/panel'
import { SectionHeader } from '@/components/ui/section-header'
import { formatMatchDate, formatScore } from '@/lib/format'

interface PlayerGameLogRow {
  matchId: number
  playedAt: Date
  opponentName: string
  gameMode: GameMode | null
  result: 'WIN' | 'LOSS' | 'OTL' | 'DNF'
  scoreFor: number
  scoreAgainst: number
  goals: number
  assists: number
  plusMinus: number
  saves: number | null
  isGoalie: boolean
}

interface PlayerGameLogSectionProps {
  playerId: number
  gameMode: GameMode | null
  rows: PlayerGameLogRow[]
  total: number
  logPage: number
  totalPages: number
  showMode: boolean
}

export function PlayerGameLogSection({
  playerId,
  gameMode,
  rows,
  total,
  logPage,
  totalPages,
  showMode,
}: PlayerGameLogSectionProps) {
  const [expanded, setExpanded] = useState(false)
  const visibleRows = expanded ? rows : rows.slice(0, 5)
  const hiddenCount = Math.max(0, Math.min(rows.length, total) - visibleRows.length)

  return (
    <section id="game-log" className="space-y-4 scroll-mt-24">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeader
          label="Game Log"
          subtitle={`Local tracked appearances${gameMode !== null ? ` · filtered to ${gameMode}` : ''}`}
        />
        <div className="flex items-center gap-4">
          <GameModeFilter playerId={playerId} activeMode={gameMode} />
          {total > 0 && (
            <span className="shrink-0 font-condensed text-[11px] font-semibold uppercase tracking-wider tabular-nums text-zinc-600">
              {expanded ? Math.min(rows.length, total) : Math.min(5, rows.length)} / {total}
            </span>
          )}
        </div>
      </div>

      {rows.length === 0 && total > 0 ? (
        <Panel className="flex min-h-[6rem] flex-col items-center justify-center gap-3">
          <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
            Page {logPage} is beyond the available games.
          </p>
          <Link
            href={gameLogPageHref(playerId, gameMode, 1)}
            className="font-condensed text-xs font-semibold uppercase tracking-wider text-accent hover:underline"
          >
            Back to first page
          </Link>
        </Panel>
      ) : rows.length === 0 ? (
        <EmptyPanel
          message={
            gameMode !== null ? `No ${gameMode} games recorded yet.` : 'No games recorded yet.'
          }
        />
      ) : (
        <>
          <GameLogTable rows={visibleRows} showMode={showMode} />
          {rows.length > 5 && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => {
                  setExpanded((v) => !v)
                }}
                className="rounded-full border border-zinc-700 bg-zinc-900/70 px-4 py-2 font-condensed text-xs font-semibold uppercase tracking-[0.18em] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
              >
                {expanded ? 'Show less' : `Show ${hiddenCount.toString()} more`}
              </button>
            </div>
          )}
          {expanded && totalPages > 1 ? (
            <GameLogPaginationNav
              playerId={playerId}
              gameMode={gameMode}
              logPage={logPage}
              totalPages={totalPages}
            />
          ) : null}
        </>
      )}
    </section>
  )
}

function GameModeFilter({
  playerId,
  activeMode,
}: {
  playerId: number
  activeMode: GameMode | null
}) {
  const modes: { mode: GameMode | null; label: string }[] = [
    { mode: null, label: 'All' },
    { mode: '6s', label: '6s' },
    { mode: '3s', label: '3s' },
  ]

  return (
    <div className="flex gap-1">
      {modes.map(({ mode, label }) => {
        const isActive = mode === activeMode
        return (
          <Link
            key={label}
            href={gameLogPageHref(playerId, mode, 1)}
            className={[
              'rounded border px-3 py-1 font-condensed text-xs font-semibold uppercase tracking-wider transition-colors',
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

function gameLogPageHref(playerId: number, gameMode: GameMode | null, logPage: number): string {
  const qs = new URLSearchParams()
  if (gameMode !== null) qs.set('mode', gameMode)
  if (logPage > 1) qs.set('logPage', logPage.toString())
  const s = qs.toString()
  return `/roster/${playerId.toString()}${s ? `?${s}` : ''}`
}

function GameLogPaginationNav({
  playerId,
  gameMode,
  logPage,
  totalPages,
}: {
  playerId: number
  gameMode: GameMode | null
  logPage: number
  totalPages: number
}) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between gap-3">
      <Link
        href={gameLogPageHref(playerId, gameMode, Math.max(1, logPage - 1))}
        className={`font-condensed text-xs font-semibold uppercase tracking-wider ${logPage > 1 ? 'text-zinc-300 hover:text-accent' : 'pointer-events-none text-zinc-700'}`}
      >
        ← Older
      </Link>
      <span className="font-condensed text-[11px] font-semibold uppercase tracking-wider tabular-nums text-zinc-600">
        Page {logPage} / {totalPages}
      </span>
      <Link
        href={gameLogPageHref(playerId, gameMode, Math.min(totalPages, logPage + 1))}
        className={`font-condensed text-xs font-semibold uppercase tracking-wider ${logPage < totalPages ? 'text-zinc-300 hover:text-accent' : 'pointer-events-none text-zinc-700'}`}
      >
        Newer →
      </Link>
    </div>
  )
}

function GameLogTable({ rows, showMode }: { rows: PlayerGameLogRow[]; showMode: boolean }) {
  const thBase = 'font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500'
  return (
    <Panel className="overflow-x-auto">
      <table className="w-full min-w-[520px]">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className={`py-2 pl-4 pr-2 text-left ${thBase}`}>Date</th>
            <th className={`px-2 py-2 text-left ${thBase}`}>Opponent</th>
            {showMode ? <th className={`px-2 py-2 text-left ${thBase}`}>Mode</th> : null}
            <th className={`px-2 py-2 text-left ${thBase}`}>Result</th>
            <th className={`px-2 py-2 text-right ${thBase}`}>Score</th>
            <th className={`px-2 py-2 text-right ${thBase}`}>G</th>
            <th className={`px-2 py-2 text-right ${thBase}`}>A</th>
            <th className={`px-2 py-2 text-right ${thBase}`}>PTS</th>
            <th className={`px-2 py-2 text-right ${thBase}`}>+/-</th>
            <th className={`px-2 py-2 text-right ${thBase}`}>SV</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <GameLogDataRow key={row.matchId} row={row} showMode={showMode} />
          ))}
        </tbody>
      </table>
    </Panel>
  )
}

function GameLogDataRow({ row, showMode }: { row: PlayerGameLogRow; showMode: boolean }) {
  const points = row.goals + row.assists

  return (
    <tr className="border-b border-zinc-800/60 transition-colors last:border-0 hover:bg-surface-raised">
      <td className="whitespace-nowrap py-2.5 pl-4 pr-2 font-condensed text-sm tabular-nums text-zinc-500">
        {formatMatchDate(row.playedAt)}
      </td>
      <td className="max-w-[12rem] truncate px-2 py-2.5">
        <Link
          href={`/games/${row.matchId.toString()}`}
          className="font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-200 transition-colors hover:text-accent"
        >
          {row.opponentName}
        </Link>
      </td>
      {showMode ? (
        <td className="px-2 py-2.5">
          {row.gameMode ? (
            <span className="border border-zinc-700 bg-zinc-900 px-1.5 py-0.5 font-condensed text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              {row.gameMode}
            </span>
          ) : (
            <span className="text-zinc-700">—</span>
          )}
        </td>
      ) : null}
      <td className="px-2 py-2.5">
        <ResultPill result={row.result} size="sm" />
      </td>
      <td className="px-2 py-2.5 text-right font-condensed text-sm font-semibold tabular-nums text-zinc-100">
        {formatScore(row.scoreFor, row.scoreAgainst)}
      </td>
      <td className="px-2 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-300">
        {row.isGoalie ? '—' : row.goals}
      </td>
      <td className="px-2 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-300">
        {row.isGoalie ? '—' : row.assists}
      </td>
      <td className="px-2 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-300">
        {row.isGoalie ? '—' : points}
      </td>
      <td className="px-2 py-2.5 text-right font-condensed text-sm tabular-nums">
        {row.isGoalie ? (
          <span className="text-zinc-500">—</span>
        ) : (
          <span className={signedClass(row.plusMinus)}>{formatSigned(row.plusMinus)}</span>
        )}
      </td>
      <td className="px-2 py-2.5 text-right font-condensed text-sm tabular-nums text-zinc-300">
        {row.isGoalie ? (row.saves ?? '—') : '—'}
      </td>
    </tr>
  )
}

function signedClass(value: number) {
  if (value > 0) return 'text-emerald-400'
  if (value < 0) return 'text-rose-400'
  return 'text-zinc-400'
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value.toString()}` : value.toString()
}

function EmptyPanel({ message }: { message: string }) {
  return (
    <Panel className="flex min-h-[8rem] items-center justify-center">
      <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">{message}</p>
    </Panel>
  )
}
