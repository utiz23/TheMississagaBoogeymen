'use client'

import { useState, type ReactNode } from 'react'
import {
  MISSING,
  SOURCE_SHORT,
  formatAverage,
  formatCount,
  formatGoalDiff,
  formatPercent,
  formatRecord,
  formatToa,
  type Aggregate,
  type GroupBy,
  type PlaylistFamily,
  type SourceAggregate,
  type TeamHistoryGroup,
  type TeamHistoryRow,
  type TeamHistorySource,
} from '@/lib/team-history'
import './team-history-mobile.css'

/** Spelled out for the footnote (SOURCE_LABEL repeats the short name). */
const SOURCE_NOTE: Record<TeamHistorySource, string> = {
  live: 'derived from matches',
  archive: 'reviewed screenshot import',
}

interface Props {
  /** Every row before filtering — decides which source columns the totals card shows. */
  allSources: ReadonlySet<TeamHistorySource>
  titles: readonly string[]
  families: readonly PlaylistFamily[]
  /** Unsorted groups for the current filter and grouping. */
  groups: readonly TeamHistoryGroup[]
  summary: readonly SourceAggregate[]
  rowCount: number
  scope: string
  lockedTitle: string | undefined
  selectedTitle: string | null
  family: string | null
  groupBy: GroupBy
  visibleSources: ReadonlySet<TeamHistorySource>
  anyApproximate: boolean
  onTitle: (title: string | null) => void
  onFamily: (family: string | null) => void
  onGroupBy: (groupBy: GroupBy) => void
  onReset: () => void
}

/**
 * Phone layout (≤720px) of Career Team Stats: a per-source totals card and one
 * collapsible card per group. State and data come from `TeamHistoryTable`;
 * the desktop table and this list are both rendered and CSS picks one.
 * Sources stay separate exactly as on desktop: a group that mixes local and
 * import rows shows one subtotal per source, never a blended number.
 */
export function TeamHistoryMobile(props: Props) {
  const { groups, groupBy, titles, families, lockedTitle } = props

  // Open cards, by group key. The newest title and the first playlist family
  // start open; picking a chip opens that card too.
  const [openKeys, setOpenKeys] = useState<ReadonlySet<string>>(() => {
    const first = new Set<string>()
    const title = lockedTitle ?? titles[0]
    if (title !== undefined) first.add(`t:${title}`)
    const fam = families[0]
    if (fam !== undefined) first.add(`f:${fam.key}`)
    return first
  })

  function setOpen(key: string, open: boolean) {
    setOpenKeys((prev) => {
      if (prev.has(key) === open) return prev
      const next = new Set(prev)
      if (open) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const columns = (['live', 'archive'] as const).filter((s) => props.allSources.has(s))

  return (
    <section className="thm" aria-labelledby="career-team-stats-heading-m">
      <div className="thm-head">
        <div className="thm-head-text">
          <h2 id="career-team-stats-heading-m">Career Team Stats</h2>
          {/* Each segment stays whole; lines break only at the separators. */}
          <p className="thm-scope">
            {[
              ...props.scope.split(' · '),
              `${String(props.rowCount)} ${props.rowCount === 1 ? 'row' : 'rows'}`,
            ].map((part, i) => (
              <span key={i}>
                {i > 0 ? ' · ' : ''}
                <span className="thm-nowrap">{part}</span>
              </span>
            ))}
          </p>
        </div>
        <div role="group" aria-label="Group rows by" className="thm-seg">
          {(
            [
              ['title', 'Title'],
              ['playlist', 'Playlist'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={groupBy === value}
              onClick={() => {
                props.onGroupBy(value)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        {lockedTitle === undefined ? (
          <div role="group" aria-label="Filter by title" className="thm-chips">
            <Chip
              pressed={props.selectedTitle === null}
              onClick={() => {
                props.onTitle(null)
              }}
            >
              All Titles
            </Chip>
            {titles.map((t) => (
              <Chip
                key={t}
                pressed={props.selectedTitle === t}
                onClick={() => {
                  props.onTitle(t)
                  setOpen(`t:${t}`, true)
                }}
              >
                {t}
              </Chip>
            ))}
          </div>
        ) : null}
        <div role="group" aria-label="Filter by playlist" className="thm-chips">
          <Chip
            pressed={props.family === null}
            onClick={() => {
              props.onFamily(null)
            }}
          >
            All
          </Chip>
          {families.map((f) => (
            <Chip
              key={f.key}
              pressed={props.family === f.key}
              onClick={() => {
                props.onFamily(f.key)
                setOpen(`f:${f.key}`, true)
              }}
            >
              {f.label}
            </Chip>
          ))}
        </div>
      </div>

      {columns.length > 0 ? <TotalsCard columns={columns} summary={props.summary} /> : null}

      {groups.length === 0 ? (
        <div className="thm-empty">
          <p>No rows match this filter.</p>
          <button type="button" onClick={props.onReset}>
            Reset filters
          </button>
        </div>
      ) : (
        <div className="thm-groups">
          {groups.map((g) => (
            <GroupCard
              key={g.key}
              group={g}
              groupBy={groupBy}
              open={openKeys.has(g.key)}
              onToggle={(open) => {
                setOpen(g.key, open)
              }}
            />
          ))}
        </div>
      )}

      <details className="thm-how">
        <summary>How totals are calculated</summary>
        <ul>
          {columns.map((s) => (
            <li key={s}>
              {SOURCE_SHORT[s]} = {SOURCE_NOTE[s]}.
            </li>
          ))}
          <li>W% = W ÷ (W + L + OTL). GD/G = GF/G − GA/G.</li>
          <li>Local and import rows are totalled separately. They are never combined.</li>
          {props.visibleSources.has('live') ? (
            <li>Local GP includes DNF games, so it can exceed W + L + OTL.</li>
          ) : null}
          {props.visibleSources.has('archive') ? (
            <li>
              Import rows are reviewed in-game CLUB STATS screenshots. PP% and PK% show only where
              the screenshot captured them.
            </li>
          ) : null}
          {props.anyApproximate ? (
            <li>
              ≈ = approximate. A total over more than one playlist is a GP-weighted mean of
              per-playlist averages that were already rounded at the source.
            </li>
          ) : null}
          <li>TOA, PP% and PK% are not totalled. — = not available or not totalled.</li>
          <li>
            Playlist filters group equivalent labels: EASHL 6v6 = Clubs 6v6, 6P Full Team = Clubs
            6P, EASHL 3v3 = Clubs 3v3. Threes and Quickplay 3v3 stay separate.
          </li>
        </ul>
      </details>
    </section>
  )
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function Chip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button type="button" aria-pressed={pressed} onClick={onClick} className="thm-chip">
      <span>{children}</span>
    </button>
  )
}

function TotalsCard({
  columns,
  summary,
}: {
  columns: readonly TeamHistorySource[]
  summary: readonly SourceAggregate[]
}) {
  const aggs = columns.map((s) => summary.find((e) => e.source === s)?.aggregate ?? null)
  const cells = (render: (a: Aggregate) => ReactNode, className?: string) =>
    aggs.map((a, i) => (
      <td key={columns[i]} className={className}>
        {a === null ? <Missing /> : render(a)}
      </td>
    ))
  return (
    <div className="thm-totals">
      <table>
        <caption className="sr-only">
          Career totals for the filtered rows. Local and import totals are kept separate.
        </caption>
        <thead>
          <tr>
            <th scope="col">Totals</th>
            {columns.map((s, i) => {
              const n = aggs[i]?.rowCount ?? 0
              return (
                <th key={s} scope="col">
                  <span className="thm-src">
                    <span aria-hidden className="thm-dot" data-source={s} />
                    {SOURCE_SHORT[s]}
                  </span>
                  <span className="thm-src-count">
                    {String(n)} {n === 1 ? 'row' : 'rows'}
                  </span>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Win%</th>
            {cells(
              (a) => (
                <Value text={formatPercent(a.wpct)} />
              ),
              'thm-big',
            )}
          </tr>
          <tr>
            <th scope="row">GP</th>
            {cells(
              (a) => (
                <Value text={formatCount(a.gp)} />
              ),
              'thm-gp',
            )}
          </tr>
          <tr>
            <th scope="row">W–L–OTL</th>
            {cells((a) => (
              <Value text={formatRecord(a.w, a.l, a.otl)} />
            ))}
          </tr>
          <tr>
            <th scope="row">GF/G</th>
            {cells((a) => (
              <Value text={formatAverage(a.gfg)} approx={a.averagesApproximate} />
            ))}
          </tr>
          <tr>
            <th scope="row">GA/G</th>
            {cells((a) => (
              <Value text={formatAverage(a.gag)} approx={a.averagesApproximate} />
            ))}
          </tr>
          <tr>
            <th scope="row">GD/G</th>
            {aggs.map((a, i) => (
              <td key={columns[i]} className={a === null ? undefined : gdTone(a.gdg)}>
                {a === null ? (
                  <Missing />
                ) : (
                  <Value text={formatGoalDiff(a.gdg)} approx={a.averagesApproximate} />
                )}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  )
}

function GroupCard({
  group,
  groupBy,
  open,
  onToggle,
}: {
  group: TeamHistoryGroup
  groupBy: GroupBy
  open: boolean
  onToggle: (open: boolean) => void
}) {
  const single = group.subtotals.length === 1 ? group.subtotals[0] : undefined
  const n = group.rows.length
  const meta =
    groupBy === 'title'
      ? `${String(n)} ${n === 1 ? 'playlist' : 'playlists'}`
      : `${String(n)} ${n === 1 ? 'title' : 'titles'}`
  return (
    <details
      className="thm-group"
      open={open}
      onToggle={(e) => {
        onToggle(e.currentTarget.open)
      }}
    >
      <summary>
        <span className="thm-g-main">
          <span className="thm-g-line">
            <span className="thm-g-name">{group.label}</span>
            {group.hasLive && single !== undefined ? <span className="thm-live">Live</span> : null}
            <span className="thm-g-meta">{meta}</span>
          </span>
          {single !== undefined ? (
            <span className="thm-g-agg">
              {formatCount(single.aggregate.gp)} GP ·{' '}
              {formatRecord(single.aggregate.w, single.aggregate.l, single.aggregate.otl)} · GD{' '}
              <span className={gdTone(single.aggregate.gdg)}>
                <Value
                  text={formatGoalDiff(single.aggregate.gdg)}
                  approx={single.aggregate.averagesApproximate}
                />
              </span>
            </span>
          ) : (
            <span className="thm-g-note">Local + import · totalled separately</span>
          )}
        </span>
        {single !== undefined ? (
          <span className="thm-g-win">
            <span>
              <Value text={formatPercent(single.aggregate.wpct)} />
            </span>
            <WinBar value={single.aggregate.wpct} />
          </span>
        ) : null}
        <svg
          aria-hidden
          className="thm-chev"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </summary>
      <ul className="thm-rows">
        {single === undefined
          ? group.subtotals.map((s) => <SubtotalItem key={s.source} entry={s} />)
          : null}
        {group.rows.map((row) => (
          <RowItem key={row.key} row={row} groupBy={groupBy} />
        ))}
      </ul>
    </details>
  )
}

/** Per-source subtotal inside a mixed group. TOA / PP% / PK% are not aggregated. */
function SubtotalItem({ entry }: { entry: SourceAggregate }) {
  const a = entry.aggregate
  const approx = a.averagesApproximate
  return (
    <li className="thm-row" data-subtotal="">
      <div className="thm-r-head">
        <div className="thm-r-id">
          <span className="thm-r-name">{SOURCE_SHORT[entry.source]} total</span>
          <span className="thm-r-sub">
            <span aria-hidden className="thm-dot" data-source={entry.source} />
            {String(a.rowCount)} {a.rowCount === 1 ? 'row' : 'rows'}
          </span>
        </div>
        <span className="thm-r-win">
          <Value text={formatPercent(a.wpct)} />
        </span>
        <WinBar value={a.wpct} />
      </div>
      <dl className="thm-grid">
        <Stat label="GP" text={formatCount(a.gp)} />
        <Stat label="W–L–OTL" text={formatRecord(a.w, a.l, a.otl)} />
        <Stat label="GF/G" text={formatAverage(a.gfg)} approx={approx} />
        <Stat label="GA/G" text={formatAverage(a.gag)} approx={approx} />
        <Stat label="GD/G" text={formatGoalDiff(a.gdg)} approx={approx} tone={gdTone(a.gdg)} />
      </dl>
    </li>
  )
}

function RowItem({ row, groupBy }: { row: TeamHistoryRow; groupBy: GroupBy }) {
  const label = groupBy === 'title' ? row.family.label : row.titleName
  // The raw slug label adds era detail ("Clubs 6v6") the family label hides.
  const rawDiffers = row.playlistLabel !== row.family.label
  return (
    <li className="thm-row">
      <div className="thm-r-head">
        <div className="thm-r-id">
          <span className="thm-r-name">{label}</span>
          <span className="thm-r-sub">
            <span aria-hidden className="thm-dot" data-source={row.source} />
            {rawDiffers ? `${row.playlistLabel} · ` : ''}
            {SOURCE_SHORT[row.source]}
          </span>
        </div>
        <span className="thm-r-win">
          <Value text={formatPercent(row.wpct)} />
        </span>
        <WinBar value={row.wpct} />
      </div>
      <dl className="thm-grid">
        <Stat label="GP" text={formatCount(row.gp)} />
        <Stat label="W–L–OTL" text={formatRecord(row.w, row.l, row.otl)} />
        <Stat label="GF/G" text={formatAverage(row.gfg)} />
        <Stat label="GA/G" text={formatAverage(row.gag)} />
        <Stat label="GD/G" text={formatGoalDiff(row.gdg)} tone={gdTone(row.gdg)} />
        <Stat label="TOA" text={formatToa(row.toaSeconds)} />
        <Stat label="PP%" text={formatPercent(row.pp, 2)} />
        <Stat label="PK%" text={formatPercent(row.pk, 2)} />
      </dl>
    </li>
  )
}

function Stat({
  label,
  text,
  approx = false,
  tone,
}: {
  label: string
  text: string
  approx?: boolean
  tone?: string | undefined
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={text === MISSING ? undefined : tone}>
        <Value text={text} approx={approx} />
      </dd>
    </div>
  )
}

/** A formatted value; "—" reads as "Not available", ≈ as "approximately". */
function Value({ text, approx = false }: { text: string; approx?: boolean }) {
  if (text === MISSING) return <Missing />
  if (!approx) return <>{text}</>
  return (
    <>
      <span aria-hidden>≈</span>
      <span className="sr-only">approximately </span>
      {text}
    </>
  )
}

function Missing() {
  return (
    <>
      <span aria-hidden className="thm-missing">
        {MISSING}
      </span>
      <span className="sr-only">Not available</span>
    </>
  )
}

function WinBar({ value }: { value: number | null }) {
  if (value === null) return null
  return (
    <span aria-hidden className="thm-bar">
      <span style={{ width: `${String(Math.min(100, Math.max(0, value)))}%` }} />
      <span />
    </span>
  )
}

/** Same rule as the desktop table: ±0.00 stays neutral. */
function gdTone(value: number | null): string | undefined {
  if (value === null || formatGoalDiff(value).replace(/^[+−]/u, '') === '0.00') return undefined
  return value > 0 ? 'thm-win' : 'thm-loss'
}
