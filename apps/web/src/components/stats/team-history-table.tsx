'use client'

import { useMemo, useState } from 'react'
import type { HistoricalClubTeamBatchRow } from '@eanhl/db/queries'
import { BroadcastPanel } from '@/components/ui/broadcast-panel'
import { SectionHeader } from '@/components/ui/section-header'
import { formatPct, formatWinPct } from '@/lib/format'

const PLAYLIST_LABEL: Record<string, string> = {
  eashl_6v6: 'EASHL 6v6',
  eashl_3v3: 'EASHL 3v3',
  clubs_6v6: 'Clubs 6v6',
  clubs_3v3: 'Clubs 3v3',
  '6_player_full_team': '6P Full Team',
  clubs_6_players: 'Clubs 6P',
  threes: 'Threes',
  quickplay_3v3: 'Quickplay 3v3',
}

const ALL_KEY = '__all__'

type Row = HistoricalClubTeamBatchRow & { titleName: string }

interface Props {
  rows: Row[]
}

/**
 * Career Team Stats — single section with a Title selector (All Titles · NHL 26
 * · NHL 25 · …) instead of a giant grouped table. Mirrors the leader-section
 * pattern on the home page.
 *
 * Live NHL 26 rows are synthesized from `matches` (one per game_mode) and
 * pre-merged into `rows` by the page so the renderer just filters by title.
 */
export function TeamHistoryTable({ rows }: Props) {
  const titles = useMemo(() => {
    const seen = new Map<string, { name: string; titleId: number }>()
    for (const r of rows) {
      if (r.titleName === '') continue
      seen.set(r.titleName, { name: r.titleName, titleId: r.gameTitleId })
    }
    // Title-name "NHL 26" / "NHL 25" / … sorts naturally desc, so a reverse
    // string compare puts the most recent title first.
    return [...seen.values()].sort((a, b) => b.name.localeCompare(a.name))
  }, [rows])

  const [active, setActive] = useState<string>(ALL_KEY)

  const visibleRows = useMemo(() => {
    if (active === ALL_KEY) return rows
    return rows.filter((r) => r.titleName === active)
  }, [rows, active])

  const sorted = useMemo(() => {
    return [...visibleRows].sort((a, b) => {
      if (a.titleName !== b.titleName) return b.titleName.localeCompare(a.titleName)
      return (b.gamesPlayed ?? 0) - (a.gamesPlayed ?? 0)
    })
  }, [visibleRows])

  const subtitle =
    active === ALL_KEY
      ? `Per title × playlist · ${String(rows.length)} rows`
      : `${active} · ${String(visibleRows.length)} playlist${visibleRows.length === 1 ? '' : 's'}`

  if (rows.length === 0) {
    return (
      <section className="space-y-3">
        <SectionHeader label="Career Team Stats" subtitle="No data yet" />
        <BroadcastPanel
          intensity="soft"
          ticker={false}
          className="flex min-h-[8rem] items-center justify-center"
        >
          <p className="px-4 text-center font-condensed text-sm uppercase tracking-wider text-zinc-500">
            No reviewed archive team stats yet.
          </p>
        </BroadcastPanel>
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <SectionHeader label="Career Team Stats" subtitle={subtitle} />
        <div
          role="tablist"
          aria-label="Career team stats title"
          className="inline-flex flex-wrap items-center gap-1.5"
        >
          <TitleTab
            label="All Titles"
            active={active === ALL_KEY}
            onClick={() => {
              setActive(ALL_KEY)
            }}
          />
          {titles.map((t) => (
            <TitleTab
              key={t.titleId}
              label={t.name}
              active={active === t.name}
              onClick={() => {
                setActive(t.name)
              }}
            />
          ))}
        </div>
      </div>
      <BroadcastPanel intensity="soft" ticker={false} className="overflow-x-auto">
        <table className="w-full min-w-[760px] tabular-nums">
          <thead>
            <tr className="border-b border-zinc-800 bg-surface-raised text-right font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
              {/* Show the Title column only when "All Titles" is active —
                  filtering to one title makes that column constant noise. */}
              {active === ALL_KEY ? <th className="px-3 py-2 text-left">Title</th> : null}
              <th className="px-3 py-2 text-left">Playlist</th>
              <th className="px-3 py-2">GP</th>
              <th className="px-3 py-2 text-accent">W</th>
              <th className="px-3 py-2">L</th>
              <th className="px-3 py-2">OTL</th>
              <th className="px-3 py-2">W%</th>
              <th className="px-3 py-2">GF/G</th>
              <th className="px-3 py-2">GA/G</th>
              <th className="px-3 py-2">TOA</th>
              <th className="px-3 py-2">PP%</th>
              <th className="px-3 py-2">PK%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {sorted.map((row, i) => {
              const gp = row.gamesPlayed ?? 0
              const w = row.wins ?? 0
              const l = row.losses ?? 0
              const otl = row.otl ?? 0
              const prev = i > 0 ? sorted[i - 1] : null
              const titleGroupBreak =
                active === ALL_KEY &&
                prev !== undefined &&
                prev !== null &&
                prev.titleName !== row.titleName
              return (
                <tr
                  key={`${row.titleName}-${row.playlist}`}
                  className={`text-right transition-colors hover:bg-surface-raised ${
                    titleGroupBreak ? 'border-t-2 border-t-zinc-700' : ''
                  }`}
                >
                  {active === ALL_KEY ? (
                    <td className="px-3 py-3 text-left font-condensed text-xs font-bold uppercase tracking-widest text-zinc-300">
                      {row.titleName}
                    </td>
                  ) : null}
                  <td className="px-3 py-3 text-left font-medium text-zinc-300">
                    {PLAYLIST_LABEL[row.playlist] ?? row.playlist}
                  </td>
                  <td className="px-3 py-3 text-zinc-300">{gp}</td>
                  <td className="px-3 py-3 font-semibold text-accent">{w}</td>
                  <td className="px-3 py-3 text-zinc-400">{l}</td>
                  <td className="px-3 py-3 text-zinc-500">{otl}</td>
                  <td className="px-3 py-3 text-zinc-300">{formatWinPct(w, w + l + otl)}</td>
                  <td className="px-3 py-3 text-zinc-300">{row.avgGoalsFor ?? '—'}</td>
                  <td className="px-3 py-3 text-zinc-400">{row.avgGoalsAgainst ?? '—'}</td>
                  <td className="px-3 py-3 text-zinc-400">{row.avgTimeOnAttack ?? '—'}</td>
                  <td className="px-3 py-3 text-zinc-400">{formatPct(row.powerPlayPct)}</td>
                  <td className="px-3 py-3 text-zinc-400">{formatPct(row.powerPlayKillPct)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </BroadcastPanel>
    </section>
  )
}

function TitleTab({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'rounded-full border px-3 py-1 font-condensed text-[11px] font-bold uppercase tracking-[0.18em] transition-colors',
        active
          ? 'border-[rgba(232,65,49,0.85)] bg-[rgba(232,65,49,0.10)] text-[#e84131]'
          : 'border-zinc-800 bg-surface text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200',
      ].join(' ')}
    >
      {label}
    </button>
  )
}
