'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { BroadcastPanel } from '@/components/ui/broadcast-panel'
import { SectionHeader } from '@/components/ui/section-header'
import {
  MISSING,
  SOURCE_LABEL,
  SOURCE_SHORT,
  aggregateBySource,
  buildGroups,
  filterRows,
  formatAverage,
  formatCount,
  formatGoalDiff,
  formatPercent,
  formatRecord,
  formatToa,
  listFamilies,
  listTitles,
  nextSort,
  toTeamHistoryRow,
  type Aggregate,
  type GroupBy,
  type SortKey,
  type SortState,
  type SourceAggregate,
  type TeamHistoryInput,
  type TeamHistoryRow,
  type TeamHistorySource,
} from '@/lib/team-history'

interface Props {
  rows: TeamHistoryInput[]
}

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

interface ColumnDef {
  key: SortKey
  /** Visible header text. */
  label: string
  /** Spoken name for the sort button. */
  sortName: string
  align: 'left' | 'right'
}

/** By-title groups list playlist families in the first column; by-playlist groups list titles. */
function columnsFor(groupBy: GroupBy): ColumnDef[] {
  return [
    {
      key: 'label',
      label: groupBy === 'title' ? 'Playlist' : 'Title',
      sortName: groupBy === 'title' ? 'playlist' : 'title',
      align: 'left',
    },
    { key: 'gp', label: 'GP', sortName: 'games played', align: 'right' },
    { key: 'record', label: 'W–L–OTL', sortName: 'wins', align: 'right' },
    { key: 'wpct', label: 'W%', sortName: 'win percentage', align: 'left' },
    { key: 'gfg', label: 'GF/G', sortName: 'goals for per game', align: 'right' },
    { key: 'gag', label: 'GA/G', sortName: 'goals against per game', align: 'right' },
    { key: 'gdg', label: 'GD/G', sortName: 'goal difference per game', align: 'right' },
    { key: 'toa', label: 'TOA', sortName: 'average time on attack', align: 'right' },
    { key: 'pp', label: 'PP%', sortName: 'power play percentage', align: 'right' },
    { key: 'pk', label: 'PK%', sortName: 'penalty kill percentage', align: 'right' },
  ]
}

const COLUMN_COUNT = 10

/** Shown instead of the table when a required team-history query failed. */
export function TeamHistoryUnavailable() {
  return (
    <section className="space-y-3">
      <SectionHeader label="Career Team Stats" />
      <BroadcastPanel
        intensity="soft"
        ticker={false}
        className="flex min-h-[8rem] items-center justify-center"
      >
        <p
          role="status"
          className="px-4 text-center font-condensed text-sm uppercase tracking-wider text-fg-4"
        >
          Career Team Stats unavailable right now
        </p>
      </BroadcastPanel>
    </section>
  )
}

/**
 * Career Team Stats — per title × playlist rows from two distinct sources
 * (see `lib/team-history.ts`): local match-derived rows for active titles and
 * reviewed screenshot-import rows for archive titles. Totals are computed per
 * source and never blended. All logic lives in the lib; this file renders.
 */
export function TeamHistoryTable({ rows: inputs }: Props) {
  const rows = useMemo(() => inputs.map(toTeamHistoryRow), [inputs])
  const titles = useMemo(() => listTitles(rows), [rows])
  const families = useMemo(() => listFamilies(rows), [rows])

  const [title, setTitle] = useState<string | null>(null)
  const [family, setFamily] = useState<string | null>(null)
  const [groupBy, setGroupBy] = useState<GroupBy>('title')
  const [sort, setSort] = useState<SortState | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const filtered = useMemo(() => filterRows(rows, title, family), [rows, title, family])
  const groups = useMemo(() => buildGroups(filtered, groupBy, sort), [filtered, groupBy, sort])
  const summary = useMemo(() => aggregateBySource(filtered), [filtered])
  const columns = useMemo(() => columnsFor(groupBy), [groupBy])

  if (rows.length === 0) {
    return (
      <section className="space-y-3">
        <SectionHeader label="Career Team Stats" subtitle="No data yet" />
        <BroadcastPanel
          intensity="soft"
          ticker={false}
          className="flex min-h-[8rem] items-center justify-center"
        >
          <p className="px-4 text-center font-condensed text-sm uppercase tracking-wider text-fg-4">
            No reviewed archive team stats yet.
          </p>
        </BroadcastPanel>
      </section>
    )
  }

  const visibleSources = new Set(filtered.map((r) => r.source))
  const anyApproximate =
    groups.some((g) => g.subtotals.some((s) => s.aggregate.averagesApproximate)) ||
    summary.some((s) => s.aggregate.averagesApproximate)
  const scope = [
    title ?? 'All titles',
    family === null ? 'all playlists' : (families.find((f) => f.key === family)?.label ?? family),
  ].join(' · ')

  function onSort(col: ColumnDef) {
    const next = nextSort(sort, col.key)
    setSort(next)
    setAnnouncement(
      next === null
        ? 'Sort cleared. Rows are in default order.'
        : `Sorted by ${col.sortName}, ${next.dir === 'asc' ? 'ascending' : 'descending'}. Missing values last.`,
    )
  }

  function resetFilters() {
    setTitle(null)
    setFamily(null)
  }

  return (
    <section className="space-y-3" aria-labelledby="career-team-stats-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h2
            id="career-team-stats-heading"
            className="font-condensed text-xs font-semibold uppercase tracking-widest text-zinc-500 sm:text-sm"
          >
            Career Team Stats
          </h2>
          <p className="font-condensed text-[11px] uppercase tracking-wider text-fg-4">
            {scope} · {String(filtered.length)} {filtered.length === 1 ? 'row' : 'rows'}
          </p>
        </div>
        <ToggleGroup label="Group rows by">
          <Toggle
            pressed={groupBy === 'title'}
            onClick={() => {
              setGroupBy('title')
              setSort(null)
            }}
          >
            By Title
          </Toggle>
          <Toggle
            pressed={groupBy === 'playlist'}
            onClick={() => {
              setGroupBy('playlist')
              setSort(null)
            }}
          >
            By Playlist
          </Toggle>
        </ToggleGroup>
      </div>

      <SourceLegend sources={visibleSources} />

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <ToggleGroup label="Filter by title" pill>
          <Toggle
            pill
            pressed={title === null}
            onClick={() => {
              setTitle(null)
            }}
          >
            All Titles
          </Toggle>
          {titles.map((t) => (
            <Toggle
              pill
              key={t}
              pressed={title === t}
              onClick={() => {
                setTitle(t)
              }}
            >
              {t}
            </Toggle>
          ))}
        </ToggleGroup>
        <ToggleGroup label="Filter by playlist" pill>
          <Toggle
            pill
            pressed={family === null}
            onClick={() => {
              setFamily(null)
            }}
          >
            All
          </Toggle>
          {families.map((f) => (
            <Toggle
              pill
              key={f.key}
              pressed={family === f.key}
              onClick={() => {
                setFamily(f.key)
              }}
            >
              {f.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </div>

      {summary.length > 0 ? (
        <div className="space-y-2">
          {summary.map((s) => (
            <SummaryStrip
              key={s.source}
              entry={s}
              labelled={summary.length > 1 || visibleSources.size > 1}
            />
          ))}
        </div>
      ) : null}

      <BroadcastPanel intensity="soft" ticker={false}>
        {groups.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <p className="font-condensed text-sm uppercase tracking-wider text-fg-4">
              No rows match this filter.
            </p>
            <button
              type="button"
              onClick={resetFilters}
              className={`rounded-none border border-zinc-700 px-3 py-1.5 font-condensed text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-300 transition-colors motion-reduce:transition-none hover:bg-zinc-800 ${FOCUS_RING}`}
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div
            role="region"
            aria-label="Career team stats table — scrolls horizontally on narrow screens"
            tabIndex={0}
            className={`overflow-x-auto ${FOCUS_RING}`}
          >
            <table className="w-full min-w-[920px] border-collapse tabular-nums">
              <caption className="sr-only">
                Career team stats by {groupBy === 'title' ? 'title' : 'playlist'}. Local rows are
                derived from matches; import rows come from reviewed screenshots.
              </caption>
              <thead>
                <tr className="border-b border-zinc-800 bg-surface-raised font-condensed text-[10px] font-semibold uppercase tracking-widest text-fg-4">
                  {columns.map((col, i) => {
                    const active = sort?.key === col.key
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        aria-sort={
                          active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                        }
                        className={`p-0 ${col.align === 'left' ? 'text-left' : 'text-right'} ${
                          i === 0 ? 'sticky left-0 z-20 bg-surface-raised' : ''
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSort(col)
                          }}
                          aria-label={`${col.label}: sort by ${col.sortName}`}
                          className={`flex w-full min-h-9 items-center gap-1 px-3 py-2 uppercase tracking-widest transition-colors motion-reduce:transition-none hover:text-zinc-100 ${FOCUS_RING} ${
                            col.align === 'left' ? 'justify-start' : 'justify-end'
                          } ${active ? 'text-zinc-50' : ''}`}
                        >
                          {col.label}
                          <span aria-hidden className="w-2 text-accent">
                            {active ? (sort.dir === 'asc' ? '↑' : '↓') : ''}
                          </span>
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              {groups.map((group) => {
                const mixed = group.subtotals.length > 1
                const single = group.subtotals[0]
                return (
                  <tbody key={group.key} className="border-t-2 border-zinc-800">
                    <tr className="bg-surface-raised">
                      <th
                        scope="rowgroup"
                        className="sticky left-0 z-10 whitespace-nowrap bg-surface-raised px-3 py-2.5 text-left"
                      >
                        <span className="flex items-center gap-2">
                          <span className="font-condensed text-[15px] font-black uppercase tracking-wider text-zinc-50">
                            {group.label}
                          </span>
                          {group.hasLive && group.subtotals.length === 1 ? (
                            <span className="border border-accent-line bg-accent-soft px-1.5 py-px font-condensed text-[9px] font-bold uppercase tracking-[0.18em] text-accent">
                              Live
                            </span>
                          ) : null}
                          <span className="font-condensed text-[11px] font-normal uppercase tracking-wider text-fg-5">
                            {String(group.rows.length)}{' '}
                            {groupBy === 'title'
                              ? group.rows.length === 1
                                ? 'playlist'
                                : 'playlists'
                              : group.rows.length === 1
                                ? 'title'
                                : 'titles'}
                          </span>
                        </span>
                      </th>
                      {mixed || single === undefined ? (
                        <td
                          colSpan={COLUMN_COUNT - 1}
                          className="px-3 py-2.5 text-left font-condensed text-[11px] uppercase tracking-wider text-fg-5"
                        >
                          Mixed sources — totals shown separately below
                        </td>
                      ) : (
                        <AggregateCells agg={single.aggregate} strong />
                      )}
                    </tr>
                    {mixed
                      ? group.subtotals.map((s) => (
                          <tr key={s.source} className="border-t border-zinc-800/60 bg-surface">
                            <th
                              scope="row"
                              className="sticky left-0 z-10 whitespace-nowrap bg-surface py-2 pl-7 pr-3 text-left font-condensed text-[11px] font-semibold uppercase tracking-wider text-fg-3"
                            >
                              {SOURCE_SHORT[s.source]} total
                            </th>
                            <AggregateCells agg={s.aggregate} />
                          </tr>
                        ))
                      : null}
                    {group.rows.map((row) => (
                      <DataRow key={row.key} row={row} groupBy={groupBy} />
                    ))}
                  </tbody>
                )
              })}
            </table>
          </div>
        )}
      </BroadcastPanel>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <Footnote
        showLive={visibleSources.has('live')}
        showArchive={visibleSources.has('archive')}
        anyApproximate={anyApproximate}
      />
    </section>
  )
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

function DataRow({ row, groupBy }: { row: TeamHistoryRow; groupBy: GroupBy }) {
  const label = groupBy === 'title' ? row.family.label : row.titleName
  // Show the raw slug label when it adds era detail the family label hides.
  const rawDiffers = groupBy === 'title' && row.playlistLabel !== row.family.label
  return (
    <tr className="border-t border-zinc-800/60 bg-surface transition-colors motion-reduce:transition-none hover:bg-surface-raised">
      <th
        scope="row"
        className="sticky left-0 z-10 bg-inherit py-2 pl-7 pr-3 text-left font-normal"
      >
        <span className="flex items-baseline gap-2 whitespace-nowrap">
          <span className="font-condensed text-sm font-bold uppercase tracking-wider text-fg-2">
            {label}
          </span>
          <span className="font-condensed text-[10px] uppercase tracking-widest text-fg-5">
            {rawDiffers ? `${row.playlistLabel} · ` : ''}
            {row.source === 'live' ? 'Local' : 'Import'}
          </span>
        </span>
      </th>
      <Cell className="text-fg-2">{formatCount(row.gp)}</Cell>
      <Cell className="text-fg-3">{formatRecord(row.w, row.l, row.otl)}</Cell>
      <WinPctCell value={row.wpct} />
      <Cell className="text-fg-3">{formatAverage(row.gfg)}</Cell>
      <Cell className="text-fg-3">{formatAverage(row.gag)}</Cell>
      <GdCell value={row.gdg} />
      <Cell className="text-fg-3">{formatToa(row.toaSeconds)}</Cell>
      <Cell className="text-fg-3">{formatPercent(row.pp, 2)}</Cell>
      <Cell className="text-fg-3">{formatPercent(row.pk, 2)}</Cell>
    </tr>
  )
}

/** Subtotal cells: GP → GD/G aggregated; TOA / PP% / PK% are not aggregated. */
function AggregateCells({ agg, strong = false }: { agg: Aggregate; strong?: boolean }) {
  const weight = strong ? 'font-bold' : ''
  const approx = agg.averagesApproximate
  return (
    <>
      <Cell className={`${weight} text-zinc-50`}>{formatCount(agg.gp)}</Cell>
      <Cell className={`${weight} text-fg-2`}>{formatRecord(agg.w, agg.l, agg.otl)}</Cell>
      <WinPctCell value={agg.wpct} strong={strong} />
      <Cell className={`${weight} text-fg-2`}>
        <Approx on={approx && agg.gfg !== null}>{formatAverage(agg.gfg)}</Approx>
      </Cell>
      <Cell className={`${weight} text-fg-2`}>
        <Approx on={approx && agg.gag !== null}>{formatAverage(agg.gag)}</Approx>
      </Cell>
      <GdCell value={agg.gdg} strong={strong} approx={approx} />
      <NotAggregated />
      <NotAggregated />
      <NotAggregated />
    </>
  )
}

function Cell({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <td className={`px-3 py-2 text-right text-sm ${className}`}>
      {children === MISSING ? <Missing /> : children}
    </td>
  )
}

function Missing() {
  return (
    <>
      <span aria-hidden className="text-fg-6">
        {MISSING}
      </span>
      <span className="sr-only">Not available</span>
    </>
  )
}

function NotAggregated() {
  return (
    <td className="px-3 py-2 text-right text-sm">
      <span aria-hidden className="text-fg-6">
        {MISSING}
      </span>
      <span className="sr-only">Not aggregated</span>
    </td>
  )
}

function Approx({ on, children }: { on: boolean; children: ReactNode }) {
  if (children === MISSING) return <Missing />
  if (!on) return <>{children}</>
  return (
    <>
      <span aria-hidden>≈</span>
      <span className="sr-only">approximately </span>
      {children}
    </>
  )
}

function WinPctCell({ value, strong = false }: { value: number | null; strong?: boolean }) {
  return (
    <td className="px-3 py-2 text-left text-sm">
      <span className="flex items-center gap-2">
        <span
          className={`w-12 text-right ${strong ? 'font-bold text-zinc-50' : 'font-semibold text-fg-1'}`}
        >
          {value === null ? <Missing /> : formatPercent(value)}
        </span>
        {value !== null ? (
          <span aria-hidden className="relative block h-[3px] w-16 bg-zinc-800">
            <span
              className="absolute inset-y-0 left-0 bg-accent"
              style={{ width: `${String(Math.min(100, Math.max(0, value)))}%` }}
            />
            <span className="absolute -inset-y-0.5 left-1/2 w-px bg-zinc-500" />
          </span>
        ) : null}
      </span>
    </td>
  )
}

function GdCell({
  value,
  strong = false,
  approx = false,
}: {
  value: number | null
  strong?: boolean
  approx?: boolean
}) {
  const text = formatGoalDiff(value)
  const tone =
    value === null || text.replace(/^[+−]/u, '') === '0.00'
      ? 'text-fg-3'
      : value > 0
        ? 'text-win'
        : 'text-loss'
  return (
    <td
      className={`px-3 py-2 text-right text-sm ${strong ? 'font-bold' : 'font-semibold'} ${tone}`}
    >
      {value === null ? <Missing /> : <Approx on={approx}>{text}</Approx>}
    </td>
  )
}

// ─── Chrome ───────────────────────────────────────────────────────────────────

function SourceLegend({ sources }: { sources: Set<TeamHistorySource> }) {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 font-condensed text-[11px] uppercase tracking-wider text-fg-4">
      {(['live', 'archive'] as const)
        .filter((s) => sources.has(s))
        .map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className={`h-1.5 w-1.5 ${s === 'live' ? 'bg-accent' : 'bg-zinc-500'}`}
            />
            <span className="text-fg-3">{SOURCE_SHORT[s]}</span> = {SOURCE_LABEL[s]}
          </span>
        ))}
    </p>
  )
}

function SummaryStrip({ entry, labelled }: { entry: SourceAggregate; labelled: boolean }) {
  const a = entry.aggregate
  const approx = a.averagesApproximate
  const items: { label: string; value: ReactNode; tone?: string | undefined }[] = [
    { label: 'GP', value: formatCount(a.gp) },
    { label: 'W–L–OTL', value: formatRecord(a.w, a.l, a.otl) },
    { label: 'Win%', value: formatPercent(a.wpct), tone: 'text-accent' },
    {
      label: 'GF/G',
      value: <Approx on={approx && a.gfg !== null}>{formatAverage(a.gfg)}</Approx>,
    },
    {
      label: 'GA/G',
      value: <Approx on={approx && a.gag !== null}>{formatAverage(a.gag)}</Approx>,
    },
    {
      label: 'GD/G',
      value: <Approx on={approx && a.gdg !== null}>{formatGoalDiff(a.gdg)}</Approx>,
      tone:
        a.gdg === null || formatGoalDiff(a.gdg).replace(/^[+−]/u, '') === '0.00'
          ? undefined
          : a.gdg > 0
            ? 'text-win'
            : 'text-loss',
    },
  ]
  return (
    <div className="relative border border-zinc-800 bg-surface">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-accent-strong via-accent to-accent-strong"
      />
      {labelled ? (
        <p className="border-b border-zinc-800/60 px-4 pt-2.5 pb-1.5 font-condensed text-[10px] font-semibold uppercase tracking-[0.2em] text-fg-4">
          {SOURCE_LABEL[entry.source]} · {String(a.rowCount)} {a.rowCount === 1 ? 'row' : 'rows'}
        </p>
      ) : null}
      <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((it) => (
          <div
            key={it.label}
            className="flex flex-col gap-1 border-b border-r border-zinc-800/60 px-4 py-3 last:border-r-0"
          >
            <dt className="font-condensed text-[10px] font-semibold uppercase tracking-[0.2em] text-fg-5">
              {it.label}
            </dt>
            <dd
              className={`whitespace-nowrap font-condensed text-[22px] font-black leading-none tabular-nums ${it.tone ?? 'text-zinc-50'}`}
            >
              {it.value === MISSING ? <Missing /> : it.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function Footnote({
  showLive,
  showArchive,
  anyApproximate,
}: {
  showLive: boolean
  showArchive: boolean
  anyApproximate: boolean
}) {
  return (
    <div className="space-y-1 text-[11px] leading-snug text-fg-5">
      <p>
        W% = W ÷ (W + L + OTL) · GD/G = GF/G − GA/G · — = not available or not aggregated · Local
        and import rows are totalled separately, never combined.
      </p>
      {showLive ? <p>Local GP includes DNF games, so it can exceed W + L + OTL.</p> : null}
      {showArchive ? (
        <p>
          Import rows are reviewed in-game CLUB STATS screenshots; PP% and PK% appear only where the
          screenshot captured them.
        </p>
      ) : null}
      {anyApproximate ? (
        <p>
          ≈ Totals over several playlists are GP-weighted means of per-playlist averages that were
          already rounded at the source, so treat them as approximate. TOA, PP% and PK% are not
          aggregated.
        </p>
      ) : null}
      <p>
        Playlist filters group equivalent era labels (EASHL 6v6 = Clubs 6v6, 6P Full Team = Clubs
        6P, EASHL 3v3 = Clubs 3v3). Threes and Quickplay 3v3 are kept separate.
      </p>
    </div>
  )
}

function ToggleGroup({
  label,
  pill = false,
  children,
}: {
  label: string
  pill?: boolean
  children: ReactNode
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={
        pill
          ? 'flex flex-wrap items-center gap-1.5'
          : 'inline-flex border border-zinc-800 bg-surface'
      }
    >
      {children}
    </div>
  )
}

function Toggle({
  pressed,
  pill = false,
  onClick,
  children,
}: {
  pressed: boolean
  pill?: boolean
  onClick: () => void
  children: ReactNode
}) {
  const base =
    'font-condensed font-bold uppercase transition-colors motion-reduce:transition-none ' +
    FOCUS_RING
  const cls = pill
    ? `${base} min-h-8 rounded-full border px-3 py-1 text-[11px] tracking-[0.18em] ${
        pressed
          ? 'border-[rgba(232,65,49,0.85)] bg-accent-soft text-accent'
          : 'border-zinc-800 bg-surface text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
      }`
    : `${base} min-h-9 px-3 py-1.5 text-[11px] tracking-[0.18em] ${
        pressed
          ? 'bg-surface-raised text-zinc-50 shadow-[inset_0_-2px_0_var(--color-accent)]'
          : 'bg-transparent text-fg-4 hover:text-zinc-200'
      }`
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className={cls}>
      {children}
    </button>
  )
}
