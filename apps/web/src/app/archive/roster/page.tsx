import type { Metadata } from 'next'
import type { HistoricalGameMode } from '@eanhl/db'
import {
  getArchiveGameTitleBySlug,
  getHistoricalGoalieStats,
  getHistoricalSkaterStats,
  listArchiveGameTitles,
} from '@eanhl/db/queries'
import { GoalieStatsTable } from '@/components/stats/goalie-stats-table'
import { SkaterStatsTable } from '@/components/stats/skater-stats-table'
import { ArchiveEmptyState, ArchiveModeFilter, ArchiveTitleSelector } from '../_components'

export const metadata: Metadata = { title: 'Archive Roster — Club Stats' }

export const revalidate = 300

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function parseGameMode(raw: string | string[] | undefined): HistoricalGameMode {
  return raw === '3s' ? '3s' : '6s'
}

async function resolveArchiveTitle(titleSlug: string | undefined) {
  const titles = await listArchiveGameTitles()
  if (titleSlug) {
    const found = await getArchiveGameTitleBySlug(titleSlug)
    return { titles, selected: found, invalidRequested: !found }
  }
  return { titles, selected: titles[0] ?? null, invalidRequested: false }
}

export default async function ArchiveRosterPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const gameMode = parseGameMode(params.mode)
  const { titles, selected, invalidRequested } = await resolveArchiveTitle(titleSlug)

  if (titles.length === 0) {
    return <ArchiveEmptyState message="No archive titles are configured yet." />
  }

  if (invalidRequested || !selected) {
    return <ArchiveEmptyState message="That archive title is not available." />
  }

  const [skaterRows, goalieRows] = await Promise.all([
    getHistoricalSkaterStats(selected.id, gameMode),
    getHistoricalGoalieStats(selected.id, gameMode),
  ])

  const skaterCount = skaterRows.length
  const goalieCount = goalieRows.length
  const hasRows = skaterCount > 0 || goalieCount > 0

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="font-condensed text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Archive
          </p>
          <div className="mt-1 flex items-baseline gap-3">
            <h1 className="font-condensed text-2xl font-semibold uppercase tracking-wide text-zinc-50">
              Roster
            </h1>
            <span className="text-sm text-zinc-500">{selected.name}</span>
          </div>
          <p className="mt-2 text-sm text-zinc-500">Archive roster totals derived from reviewed historical imports.</p>
        </div>
        <ArchiveTitleSelector
          pathname="/archive/roster"
          titles={titles}
          activeTitleSlug={selected.slug}
          activeMode={gameMode}
        />
      </div>

      <ArchiveModeFilter pathname="/archive/roster" titleSlug={selected.slug} activeMode={gameMode} />

      {!hasRows ? (
        <ArchiveEmptyState message={`No archived roster totals for ${selected.name} ${gameMode} yet.`} />
      ) : (
        <>
          <section className="grid grid-cols-2 gap-px sm:grid-cols-4">
            <SummaryCard label="Skaters" value={skaterCount.toString()} />
            <SummaryCard label="Goalies" value={goalieCount.toString()} />
            <SummaryCard label="Mode" value={gameMode.toUpperCase()} />
            <SummaryCard label="Title" value={selected.name} />
          </section>

          {skaterRows.length > 0 ? (
            <section>
              <SkaterStatsTable rows={skaterRows} title="Skaters" subtitle="Archived season totals" />
            </section>
          ) : (
            <ArchiveEmptyState
              message={`No archived skater roster totals for ${selected.name} ${gameMode} yet.`}
            />
          )}

          {goalieRows.length > 0 ? (
            <section>
              <GoalieStatsTable rows={goalieRows} title="Goalies" subtitle="Archived season totals" />
            </section>
          ) : (
            <ArchiveEmptyState
              message={`No archived goalie roster totals for ${selected.name} ${gameMode} yet.`}
            />
          )}
        </>
      )}
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-zinc-800 bg-surface-raised px-4 py-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-zinc-600">{label}</div>
      <div className="mt-2 font-condensed text-xl font-semibold uppercase tracking-wide text-zinc-50">
        {value}
      </div>
    </div>
  )
}
