'use client'

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { PlayerLink } from '@/components/ui/player-link'
import { Panel } from '@/components/ui/panel'
import { Toggle, ToggleGroup } from '@/components/ui/pill-toggle'
import { DASH } from './format.ts'
import './stats-table-shell.css'
import { metricLabel, resolveCell, type Metric, type MetricMap } from './metrics.ts'
import {
  EXPANDED_FETCH_FAILED_NOTE,
  EXPANDED_UNAVAILABLE_NOTE,
  collectFootnotes,
  expandedFailedNoteVisible,
  expandedKeyNoteVisible,
} from './notes.ts'
import { playerSubline, playerTooltip, type PlayerMeta } from './player-label.ts'
import { RetryButton } from './retry-button.tsx'
import { resolveScopeAvailability, resolveScopeState } from './scope-state.ts'
import { nextSort, sortRows, type SortState } from './sort.ts'
import type { BaseDisplayRow, CareerCoverage, StatsSource } from './types.ts'
import { resolveViews, visibleKeysFor, type ViewSpec } from './views.ts'

export interface ShellDataset<R> {
  rows: R[]
  source: StatsSource
  /** True when EA expanded stats were fetched for these rows (Active title + All mode only). */
  hasExpanded: boolean
}

/** A subset's rows for one scope, or why that scope can't show it. */
export type SubsetData<R> = ShellDataset<R> | { unavailable: string }

export interface ShellSubset<R> {
  key: string
  /** Pill text, e.g. "LW". */
  label: string
  /** Full name for hover text and messages, e.g. "Left wing". */
  title: string
  current: SubsetData<R>
  /** Omitted → unavailable in the All Time scope. */
  allTime?: SubsetData<R>
}

/**
 * Sub-category pills (e.g. Position: All · C · LW …). "All" shows the
 * table's own datasets; another pill swaps in that subset's datasets, with
 * their own source badge and notes.
 */
export interface ShellSubsets<R> {
  /** Row label, e.g. "Position". */
  label: string
  allLabel: string
  options: ShellSubset<R>[]
  /** Set when the subset data failed to load: every non-All pill is disabled with this reason. */
  disabledReason?: string
}

/**
 * Rows that are not players (e.g. one row per season) replace the Player
 * column with this label. The rows' input order becomes the default sort,
 * and clicking the label header flips it.
 */
export interface RowLabel<R> {
  header: string
  /** Stable row key; also the tiebreak when sorting by a stat. */
  id: (row: R) => string
  render: (row: R) => ReactNode
  /** Plain words for the input order and its reverse, e.g. "newest first". */
  order: { input: string; reversed: string }
}

export interface StatsTableShellProps<R extends BaseDisplayRow> {
  role: 'skaters' | 'goalies'
  title: string
  metrics: MetricMap<R>
  views: ViewSpec[]
  current: ShellDataset<R>
  /** Career rows. Omitted → no Current / All Time toggle. */
  allTime?: ShellDataset<R>
  /** All Time was requested but its query failed: toggle is shown disabled with a reason. */
  allTimeUnavailable?: boolean
  /** The table's own query failed: show an error, never an empty/zero table. */
  state?: 'ok' | 'error'
  /** The optional expanded-EA query failed: base metrics render, with a notice. */
  expandedFailed?: boolean
  emptyMessage?: string
  playerMeta?: Record<number, PlayerMeta>
  rowLabel?: RowLabel<R>
  subsets?: ShellSubsets<R>
}

/** Sort key for "the rows' input order" — only valid with a `rowLabel`. */
const INPUT_ORDER = '__input'

/**
 * `state` above describes the CURRENT dataset's load result ONLY. It must
 * never be read directly against the active scope — see `resolveScopeState`.
 * A failed Current query stays an error while Current is selected, but must
 * never keep showing once the viewer switches to a successfully loaded All
 * Time dataset (All Time only ever renders when it is itself a genuine
 * successful, non-empty result — see `resolveScopeAvailability`).
 */

const TAB_BASE =
  'px-3 py-2.5 font-condensed text-xs font-semibold uppercase tracking-widest transition-colors border-b-2 -mb-px whitespace-nowrap'
const TAB_ON = 'border-accent text-accent'
const TAB_OFF = 'border-transparent text-zinc-500 hover:text-zinc-300'

const RAIL = [
  'inset 2px 0 0 var(--color-accent)',
  'inset 2px 0 0 rgba(232, 65, 49, 0.55)',
  'inset 2px 0 0 rgba(232, 65, 49, 0.30)',
]

export function StatsTableShell<R extends BaseDisplayRow>(props: StatsTableShellProps<R>) {
  const {
    role,
    title,
    metrics,
    views,
    current,
    allTime,
    allTimeUnavailable,
    playerMeta,
    rowLabel,
    subsets,
  } = props
  const currentState = props.state ?? 'ok'

  const [scope, setScope] = useState<'current' | 'allTime'>('current')
  const [viewId, setViewId] = useState('all')
  const [sort, setSort] = useState<SortState>({ key: null, asc: null })
  const [perGameMode, setPerGameMode] = useState(false)
  const [keyOpen, setKeyOpen] = useState(false)
  const [subsetKey, setSubsetKey] = useState<string | null>(null)

  const { canAllTime, activeScope } = resolveScopeAvailability(scope, allTime?.rows.length ?? 0)
  const baseActive: ShellDataset<R> = activeScope === 'allTime' && allTime ? allTime : current
  const subsetFor = (o: ShellSubset<R>): SubsetData<R> =>
    subsets?.disabledReason !== undefined
      ? { unavailable: subsets.disabledReason }
      : ((activeScope === 'allTime' ? o.allTime : o.current) ?? {
          unavailable: `${o.title} isn’t available for All Time.`,
        })
  const subset = subsetKey !== null ? subsets?.options.find((o) => o.key === subsetKey) : undefined
  const subsetData = subset ? subsetFor(subset) : undefined
  const subsetUnavailable =
    subsetData !== undefined && 'unavailable' in subsetData ? subsetData.unavailable : null
  const active: ShellDataset<R> =
    subsetData === undefined
      ? baseActive
      : 'unavailable' in subsetData
        ? { rows: [], source: baseActive.source, hasExpanded: baseActive.hasExpanded }
        : subsetData
  // The Current dataset's `state` never leaks into the All Time scope — see
  // `resolveScopeState`. A failed Current query stays visible as an error
  // only while Current is the active scope. A subset carries its own data.
  const state = subset ? 'ok' : resolveScopeState(activeScope, currentState)
  const emptyMessage =
    subsetUnavailable ??
    (subset
      ? `No ${title.toLowerCase()} with games at ${subset.title.toLowerCase()} here yet.`
      : props.emptyMessage)

  const resolved = useMemo(
    () => resolveViews(views, metrics, active.hasExpanded),
    [views, metrics, active.hasExpanded],
  )
  const view = resolved.find((v) => v.id === viewId) ?? resolved[0]
  const visibleKeys = view ? visibleKeysFor(view) : ['gp']

  const defaultKey = rowLabel ? INPUT_ORDER : (view?.defaultSort ?? 'gp')
  const activeKey =
    sort.key !== null &&
    (visibleKeys.includes(sort.key) || (rowLabel !== undefined && sort.key === INPUT_ORDER))
      ? sort.key
      : defaultKey
  const inputOrder = activeKey === INPUT_ORDER
  const activeMetric: Metric<R> | undefined = metrics[activeKey]
  const activeAsc = sort.asc ?? activeMetric?.sortAsc ?? false

  const anyRate = visibleKeys.some((k) => metrics[k]?.perGame !== undefined)
  const rateOn = perGameMode && anyRate

  const sorted = useMemo(() => {
    if (!activeMetric) return activeAsc ? active.rows.slice().reverse() : active.rows
    return sortRows(
      active.rows,
      (r) => resolveCell(activeMetric, r, rateOn).value,
      (r) => (rowLabel ? rowLabel.id(r) : r.gamertag),
      activeAsc,
    )
  }, [active.rows, activeMetric, rateOn, activeAsc, rowLabel])

  const footnotes = collectFootnotes({
    role,
    scope: activeScope,
    source: active.source,
    visibleKeys,
    activeRows: active.rows.map((r) => {
      const toiCoverage = (r as { toiCoverage?: CareerCoverage }).toiCoverage
      const gaaCoverage = (r as { gaaCoverage?: CareerCoverage }).gaaCoverage
      return {
        recordUnavailable: (r as { recordUnavailable?: boolean }).recordUnavailable === true,
        ...(toiCoverage !== undefined ? { toiCoverage } : {}),
        ...(gaaCoverage !== undefined ? { gaaCoverage } : {}),
      }
    }),
  })
  if (expandedFailedNoteVisible(activeScope, props.expandedFailed === true)) {
    footnotes.push(EXPANDED_FETCH_FAILED_NOTE)
  }

  const showExpandedKeyNote = expandedKeyNoteVisible({
    hasExpanded: active.hasExpanded,
    sourceKind: active.source.kind,
    scope: activeScope,
    expandedFailed: props.expandedFailed === true,
  })
  const activeSortDesc = activeMetric ? metricLabel(activeMetric, rateOn) : activeKey

  function onSortClick(key: string) {
    setSort(nextSort(activeKey, activeAsc, key))
  }

  // Rank accents follow the sort but only for rows that actually have a value.
  let ranked = 0
  const rankOf = new Map<R, number>()
  for (const r of sorted) {
    const v = activeMetric ? resolveCell(activeMetric, r, rateOn).value : null
    if (v !== null && Number.isFinite(v)) rankOf.set(r, ranked++)
  }

  const cols = view ? view.keys : []
  const colCount = 2 + cols.length

  return (
    <div>
      {/* Title, source, scope + category tabs */}
      <div className="mb-px flex flex-wrap items-center justify-between gap-y-1 border-b border-zinc-800">
        <div className="st-px flex flex-col gap-1 py-2 pl-4 pr-3">
          <h3 className="st-title flex items-center gap-2 font-condensed text-base font-black uppercase tracking-[0.18em] text-zinc-50 sm:text-lg">
            <span className="text-accent" aria-hidden>
              ▌
            </span>
            {title}
          </h3>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {active.source.label !== '' && (
              <span className="border border-accent-line bg-accent-soft px-1.5 py-0.5 font-condensed text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
                {active.source.label}
              </span>
            )}
            {active.source.description !== undefined && (
              <span className="max-w-xl text-xs text-zinc-500">{active.source.description}</span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-stretch">
          {(canAllTime || allTimeUnavailable === true) && (
            <div className="flex border-r border-zinc-800/80" role="group" aria-label="Scope">
              {(['current', 'allTime'] as const).map((s) => {
                const disabled = s === 'allTime' && !canAllTime
                return (
                  <button
                    key={s}
                    type="button"
                    disabled={disabled}
                    aria-pressed={activeScope === s}
                    title={disabled ? 'All Time is unavailable right now' : undefined}
                    onClick={() => {
                      setScope(s)
                    }}
                    className={[
                      TAB_BASE,
                      activeScope === s ? TAB_ON : TAB_OFF,
                      disabled ? 'cursor-not-allowed opacity-40 hover:text-zinc-500' : '',
                    ].join(' ')}
                  >
                    {s === 'current' ? 'Current' : 'All Time'}
                  </button>
                )
              })}
            </div>
          )}
          <div role="tablist" aria-label={`${title} stat categories`} className="flex flex-wrap">
            {resolved.map((v) => (
              <button
                key={v.id}
                type="button"
                role="tab"
                aria-selected={view?.id === v.id}
                onClick={() => {
                  setViewId(v.id)
                  setSort({ key: null, asc: null })
                }}
                className={[TAB_BASE, view?.id === v.id ? TAB_ON : TAB_OFF].join(' ')}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {subsets && (
        <div className="st-px flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-800/60 px-4 py-2">
          <span className="font-condensed text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
            {subsets.label}
          </span>
          <ToggleGroup label={`${title} by ${subsets.label.toLowerCase()}`} pill>
            <Toggle
              pill
              pressed={subset === undefined}
              onClick={() => {
                setSubsetKey(null)
              }}
            >
              {subsets.allLabel}
            </Toggle>
            {subsets.options.map((o) => {
              const d = subsetFor(o)
              const reason = 'unavailable' in d ? d.unavailable : undefined
              return (
                <Toggle
                  pill
                  key={o.key}
                  pressed={subset?.key === o.key}
                  disabled={reason !== undefined && subset?.key !== o.key}
                  title={reason ?? o.title}
                  onClick={() => {
                    setSubsetKey(o.key)
                  }}
                >
                  {o.label}
                </Toggle>
              )
            })}
          </ToggleGroup>
        </div>
      )}

      {state === 'ok' && (
        <div className="st-px st-controls flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-zinc-800/60 px-4 py-2">
          <div className="st-controls flex flex-wrap items-center gap-x-4 gap-y-2">
            <div role="group" aria-label="Value type" className="flex gap-1">
              {[false, true].map((pg) => {
                const disabled = pg && !anyRate
                const on = pg ? rateOn : !rateOn
                return (
                  <button
                    key={String(pg)}
                    type="button"
                    disabled={disabled}
                    aria-pressed={on}
                    title={disabled ? 'No per-game rate for the stats in this view' : undefined}
                    onClick={() => {
                      setPerGameMode(pg)
                    }}
                    className={[
                      'border px-2.5 py-1 font-condensed text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors',
                      on
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-zinc-700 text-zinc-400 hover:text-zinc-200',
                      disabled ? 'cursor-not-allowed opacity-35 hover:text-zinc-400' : '',
                    ].join(' ')}
                  >
                    {pg ? 'Per GP' : 'Totals'}
                  </button>
                )
              })}
            </div>
            <p className="font-condensed text-[11px] uppercase tracking-wider text-zinc-500">
              {inputOrder && rowLabel ? (
                <>
                  Sorted by {rowLabel.header} {activeAsc ? '↑' : '↓'}
                  <span className="st-sort-long">
                    {' '}
                    {activeAsc ? rowLabel.order.reversed : rowLabel.order.input} · click a stat to
                    rank
                  </span>
                </>
              ) : (
                <>
                  Sorted by {activeSortDesc} {activeAsc ? '↑' : '↓'}
                  <span className="st-sort-long">
                    {' '}
                    {activeAsc ? 'low to high' : 'high to low'} · rank follows sort, no minimum GP
                  </span>
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            aria-expanded={keyOpen}
            onClick={() => {
              setKeyOpen((o) => !o)
            }}
            className="border border-zinc-700 px-2.5 py-1 font-condensed text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-300 transition-colors hover:text-zinc-100"
          >
            {keyOpen ? 'Hide stat key' : 'Stat key'}
          </button>
        </div>
      )}

      {state === 'ok' && keyOpen && (
        <div className="st-px border-b border-zinc-800/60 bg-zinc-900/40 px-4 py-3">
          <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {visibleKeys.map((k) => {
              const m = metrics[k]
              if (!m) return null
              return (
                <div key={k} className="flex items-baseline gap-2">
                  <dt className="min-w-[3.5rem] shrink-0 font-condensed text-xs font-bold tracking-wide text-zinc-100">
                    {metricLabel(m, rateOn)}
                  </dt>
                  <dd className="text-xs leading-snug text-zinc-500">
                    {m.full}
                    {rateOn && m.perGame ? ' (per game)' : ''}
                  </dd>
                </div>
              )
            })}
          </dl>
          {showExpandedKeyNote && (
            <p className="mt-2 text-xs leading-snug text-zinc-500">{EXPANDED_UNAVAILABLE_NOTE}</p>
          )}
        </div>
      )}

      {state === 'error' ? (
        <Panel className="flex flex-col items-start gap-3 px-4 py-8">
          <div role="alert" className="flex flex-col items-start gap-3">
            <p className="font-condensed text-sm font-bold uppercase tracking-[0.12em] text-rose-400">
              Unable to load {role === 'skaters' ? 'skater' : 'goalie'} stats right now
            </p>
            <p className="text-sm text-zinc-500">
              The stats were not received. This is not a zero-stat result.
            </p>
            <RetryButton />
          </div>
        </Panel>
      ) : (
        <Panel className="overflow-x-auto">
          <div role="tabpanel" aria-label={`${title} ${view?.label ?? ''}`.trim()}>
            <table className="st-table w-full min-w-[520px] border-separate border-spacing-0 [--pw:8.5rem] sm:[--pw:11rem]">
              <thead>
                {view && view.groups.length > 0 && (
                  <tr className="bg-surface-raised">
                    <th
                      colSpan={2}
                      className="sticky left-0 z-20 border-b border-zinc-800 bg-surface-raised"
                    />
                    {view.groups.map((g, i) => (
                      <th
                        key={g.label}
                        colSpan={g.keys.length}
                        scope="colgroup"
                        className={[
                          'whitespace-nowrap border-b border-zinc-800 px-2 pb-1 pt-2 text-center font-condensed text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-500',
                          i > 0 ? 'border-l border-l-zinc-800' : '',
                        ].join(' ')}
                      >
                        {g.label}
                      </th>
                    ))}
                  </tr>
                )}
                <tr className="bg-surface-raised">
                  {rowLabel ? (
                    <th
                      scope="col"
                      aria-sort={inputOrder ? (activeAsc ? 'ascending' : 'descending') : 'none'}
                      className="sticky left-0 z-20 w-[var(--pw)] min-w-[var(--pw)] max-w-[var(--pw)] border-b border-zinc-800 bg-surface-raised p-0 text-left"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          onSortClick(INPUT_ORDER)
                        }}
                        aria-label={`${rowLabel.header}, ${
                          inputOrder
                            ? `sorted ${activeAsc ? rowLabel.order.reversed : rowLabel.order.input}`
                            : 'sort'
                        }`}
                        className={[
                          'st-name-head flex w-full items-center gap-1 py-2 pl-4 pr-2 font-condensed text-[10px] font-semibold uppercase tracking-widest transition-colors',
                          inputOrder ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
                        ].join(' ')}
                      >
                        {rowLabel.header}
                        <span aria-hidden className="min-w-[0.6rem] text-[10px] text-accent">
                          {inputOrder ? (activeAsc ? '↑' : '↓') : ''}
                        </span>
                      </button>
                    </th>
                  ) : (
                    <th
                      scope="col"
                      className="st-name-head sticky left-0 z-20 w-[var(--pw)] min-w-[var(--pw)] max-w-[var(--pw)] border-b border-zinc-800 bg-surface-raised py-2 pl-4 pr-2 text-left font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500"
                    >
                      Player
                    </th>
                  )}
                  {[...(metrics.gp ? ['gp'] : []), ...cols].map((k) => {
                    const m = metrics[k]
                    if (!m) return null
                    const isActive = k === activeKey
                    const isGp = k === 'gp'
                    const groupStart =
                      !isGp && view?.groups.some((g, i) => i > 0 && g.keys[0] === k) === true
                    return (
                      <th
                        key={k}
                        scope="col"
                        aria-sort={isActive ? (activeAsc ? 'ascending' : 'descending') : 'none'}
                        title={`${metricLabel(m, rateOn)}: ${m.full}`}
                        className={[
                          'border-b border-zinc-800 bg-surface-raised p-0 text-right',
                          isGp ? 'sticky left-[var(--pw)] z-20 border-r border-r-zinc-800' : '',
                          groupStart ? 'border-l border-l-zinc-800' : '',
                        ].join(' ')}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            onSortClick(k)
                          }}
                          aria-label={`${metricLabel(m, rateOn)}, ${m.full}${
                            isActive
                              ? `, sorted ${activeAsc ? 'ascending' : 'descending'}`
                              : ', sort'
                          }`}
                          className={[
                            'flex w-full items-center justify-end gap-1 whitespace-nowrap px-2 py-2 font-condensed text-[11px] font-bold uppercase tracking-wider transition-colors',
                            isActive ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300',
                          ].join(' ')}
                        >
                          {metricLabel(m, rateOn)}
                          <span aria-hidden className="min-w-[0.6rem] text-[10px] text-accent">
                            {isActive ? (activeAsc ? '↑' : '↓') : ''}
                          </span>
                        </button>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 ? (
                  <tr>
                    <td
                      colSpan={colCount}
                      className="py-10 text-center font-condensed text-sm uppercase tracking-wider text-zinc-500"
                    >
                      {emptyMessage ?? `No ${role === 'skaters' ? 'skater' : 'goalie'} data yet.`}
                    </td>
                  </tr>
                ) : (
                  sorted.map((row) => {
                    const rank = rankOf.get(row)
                    const meta =
                      row.playerId !== null && playerMeta ? playerMeta[row.playerId] : undefined
                    const fallbackPos = (row as { position?: string | null }).position ?? null
                    const sub = playerSubline(meta, fallbackPos)
                    const tip = playerTooltip(meta, row.gamertag, fallbackPos)
                    return (
                      <tr
                        key={
                          rowLabel
                            ? rowLabel.id(row)
                            : row.playerId !== null
                              ? `p${row.playerId.toString()}`
                              : `g${row.gamertag}`
                        }
                        className="group transition-colors"
                      >
                        <td
                          className="st-name sticky left-0 z-10 w-[var(--pw)] min-w-[var(--pw)] max-w-[var(--pw)] border-b border-zinc-800/40 bg-surface py-2 pl-4 pr-2 group-hover:bg-surface-raised"
                          style={
                            rank !== undefined && rank < 3 ? { boxShadow: RAIL[rank] } : undefined
                          }
                        >
                          {rowLabel ? (
                            rowLabel.render(row)
                          ) : (
                            <div className="flex min-w-0 flex-col gap-0.5">
                              {row.playerId !== null ? (
                                <PlayerLink
                                  playerId={row.playerId}
                                  title={tip}
                                  className="st-name-text truncate font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-200 transition-colors hover:text-accent"
                                  guestClassName="st-name-text truncate font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-200"
                                >
                                  {row.gamertag}
                                </PlayerLink>
                              ) : (
                                <span
                                  title="Unmatched gamertag: no current player profile"
                                  className="st-name-text truncate font-condensed text-sm font-semibold uppercase tracking-wide text-zinc-400"
                                >
                                  {row.gamertag}
                                </span>
                              )}
                              {(sub.jersey !== null ||
                                sub.pos !== null ||
                                row.playerId === null) && (
                                <span className="flex gap-1.5 whitespace-nowrap font-condensed text-[10px] uppercase tracking-[0.12em] text-zinc-500">
                                  {sub.jersey !== null && (
                                    <span className="tabular-nums">{sub.jersey}</span>
                                  )}
                                  {sub.pos !== null && <span>{sub.pos}</span>}
                                  {row.playerId === null && (
                                    <span className="border border-amber-500/40 px-1 text-amber-500">
                                      No profile
                                    </span>
                                  )}
                                </span>
                              )}
                            </div>
                          )}
                        </td>
                        {[...(metrics.gp ? ['gp'] : []), ...cols].map((k) => {
                          const m = metrics[k]
                          if (!m) return null
                          const isGp = k === 'gp'
                          const c = resolveCell(m, row, rateOn && !isGp)
                          const isActive = k === activeKey
                          const groupStart =
                            !isGp && view?.groups.some((g, i) => i > 0 && g.keys[0] === k) === true
                          let color = c.text === DASH ? 'text-zinc-600' : 'text-zinc-300'
                          if (k === 'pm' && c.value !== null) {
                            color =
                              c.value > 0
                                ? 'text-emerald-400'
                                : c.value < 0
                                  ? 'text-rose-400'
                                  : 'text-zinc-400'
                          }
                          return (
                            <td
                              key={k}
                              className={[
                                'st-cell whitespace-nowrap border-b border-zinc-800/40 px-2 py-2 text-right font-condensed text-sm tabular-nums transition-colors',
                                color,
                                isActive ? 'bg-accent-soft font-semibold' : '',
                                isGp
                                  ? 'sticky left-[var(--pw)] z-10 border-r border-r-zinc-800 bg-surface group-hover:bg-surface-raised'
                                  : 'group-hover:bg-surface-raised',
                                groupStart ? 'border-l border-l-zinc-800' : '',
                              ].join(' ')}
                            >
                              {c.annotation ? (
                                <span title={c.annotation.srText}>
                                  {c.text}
                                  {c.annotation.marker !== undefined && (
                                    <span aria-hidden className="text-accent">
                                      {c.annotation.marker}
                                    </span>
                                  )}
                                  <span className="sr-only"> {c.annotation.srText}</span>
                                </span>
                              ) : (
                                c.text
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {state === 'ok' && footnotes.length > 0 && (
        <ol className="st-px flex flex-col gap-1 border-t border-zinc-800/60 px-4 py-2.5">
          {footnotes.map((n) => (
            <li key={n} className="flex gap-2 text-xs leading-snug text-zinc-500">
              <span aria-hidden className="font-bold text-amber-500">
                ·
              </span>
              <span>{n}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
