'use client'

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import type { CareerActionRow } from '@eanhl/db/queries'
import { RinkSvg } from '@/components/branding/rink'
import {
  GoalMarker,
  HitMarker,
  PenaltyMarker,
  ShotMarker,
} from '@/components/branding/event-markers'
import { FACEOFF_NOTE } from '@/components/matches/action-tracker/shared'
import {
  ALL_TYPES_ON,
  PERIOD_FILTERS,
  buildGroups,
  buildMarkers,
  buildPin,
  limitGroups,
  rowIndexOf,
  filterCounts,
  notPlotted,
  visibleEvents,
  type ActionMarker,
  type ActionRow,
  type ActionType,
  type MarkerType,
  type PeriodFilter,
  type RoleFilter,
  type SortMode,
} from './action-map-model'
import './career-action-map.css'

/** Rows the event list renders per batch (page weight; more load as you scroll). */
const LIST_BATCH = 60

const BY_FILL = 'var(--color-accent)'
const ON_FILL = '#81878D'
const PERIOD_LABEL: Record<PeriodFilter, string> = {
  all: 'All',
  1: '1st',
  2: '2nd',
  3: '3rd',
  ot: 'OT',
}
const TYPE_LABEL: Record<ActionType, string> = {
  goal: 'Goals',
  shot: 'Shots',
  hit: 'Hits',
  penalty: 'Penalties',
  faceoff: 'Faceoffs',
}

function Glyph({ type, role, size }: { type: MarkerType; role: 'by' | 'on'; size: number }) {
  const props = {
    side: 'home' as const,
    size,
    homeColor: role === 'by' ? BY_FILL : ON_FILL,
    ink: role === 'by' ? '#fff' : '#1A1819',
  }
  if (type === 'goal') return <GoalMarker {...props} />
  if (type === 'shot') return <ShotMarker {...props} />
  if (type === 'hit') return <HitMarker {...props} />
  return <PenaltyMarker {...props} />
}

/**
 * Career Action Map (Player Action Map.dc.html; spec Part 5): every reviewed
 * event the player made (By) or received (On), every period turned so BGM
 * attacks right. Click a marker or a card to pin it.
 */
export function CareerActionMap({
  events,
  gamertag,
}: {
  events: CareerActionRow[]
  gamertag: string
}) {
  const [period, setPeriod] = useState<PeriodFilter>('all')
  const [role, setRole] = useState<RoleFilter>('all')
  const [types, setTypes] = useState<Record<ActionType, boolean>>({ ...ALL_TYPES_ON })
  const [sort, setSort] = useState<SortMode>('game')
  const [pin, setPin] = useState<number | null>(null)
  const [iso, setIso] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const moreRef = useRef<HTMLDivElement>(null)
  const [limit, setLimit] = useState(LIST_BATCH)

  const uid = useId().replace(/[^\w-]/g, '')
  // Each stage recomputes only when its inputs change: a pin tap rebuilds the
  // markers and two list rows, not the counts, groups or the whole list.
  const filters = useMemo(
    () => ({ period, role, types, isoMatchId: iso }),
    [period, role, types, iso],
  )
  const counts = useMemo(() => filterCounts(events, filters), [events, filters])
  const visible = useMemo(() => visibleEvents(events, filters), [events, filters])
  const markers = useMemo(() => buildMarkers(visible, pin), [visible, pin])
  const groups = useMemo(() => buildGroups(visible, sort), [visible, sort])
  const shown = useMemo(() => limitGroups(groups, limit), [groups, limit])
  // pinEvent reads the latest groups without changing identity (the list rows are memoized).
  const groupsRef = useRef(groups)
  // A new filter or sort starts the list over at the first batch.
  useEffect(() => {
    groupsRef.current = groups
    setLimit(LIST_BATCH)
  }, [groups])
  // Next batch when the end of the list scrolls into view.
  useEffect(() => {
    const box = listRef.current
    const sentinel = moreRef.current
    if (!box || !sentinel || shown.hidden === 0) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLimit((l) => l + LIST_BATCH)
      },
      { root: box, rootMargin: '200px' },
    )
    io.observe(sentinel)
    return () => {
      io.disconnect()
    }
  }, [shown.hidden])
  const pinView = useMemo(() => buildPin(visible, pin), [visible, pin])
  const unplottedCount = useMemo(() => notPlotted(visible), [visible])
  const gameCount = useMemo(() => new Set(events.map((e) => e.matchId)).size, [events])
  const isoGroup = useMemo(
    () =>
      iso === null
        ? null
        : buildGroups(
            events.filter((e) => e.matchId === iso),
            'game',
          )[0],
    [events, iso],
  )

  const pinEvent = useCallback((id: number, scroll: boolean) => {
    setPin((p) => (p === id ? null : id))
    if (!scroll) return
    // A marker's row may sit beyond the rendered batch: render up to it first.
    const at = rowIndexOf(groupsRef.current, id)
    if (at >= 0) setLimit((l) => Math.max(l, at + 1 + LIST_BATCH / 2))
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const box = listRef.current
        const el = box?.querySelector<HTMLElement>(`[data-ev="${String(id)}"]`)
        if (!box || !el) return
        box.scrollTop = el.offsetTop - 44
      })
    })
  }, [])
  const pinFromList = useCallback(
    (id: number) => {
      pinEvent(id, false)
    },
    [pinEvent],
  )
  const markerKey = (m: ActionMarker) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key !== 'Enter' && e.key !== ' ') return
    e.preventDefault()
    pinEvent(m.id, true)
  }

  return (
    <section className="am" aria-label="Career Action Map">
      <div className="am-head">
        <div>
          <h2 className="am-title">Career Action Map</h2>
          <p className="am-sub">All positioned events across reviewed matches</p>
        </div>
        <span className="am-who">
          {gamertag} · {gameCount} reviewed games
        </span>
      </div>

      <div className="am-panel">
        <div className="am-panel-head">
          <h3 className="am-panel-title">
            <span className="am-mark" aria-hidden>
              ▰
            </span>
            Action Tracker Map · Career
          </h3>
          <span className="am-hint">
            <span className="am-hint-click">Click</span>
            <span className="am-hint-tap">Tap</span> a marker or card to pin it
          </span>
        </div>

        <div className="am-stack">
          <div className="am-filters">
            <div className="am-segs" role="group" aria-label="Period">
              {PERIOD_FILTERS.map((p) => {
                const n = counts.periods[p]
                return (
                  <button
                    key={String(p)}
                    type="button"
                    className="am-seg"
                    aria-pressed={period === p}
                    disabled={p !== 'all' && n === 0}
                    onClick={() => {
                      setPeriod(p)
                    }}
                  >
                    <span>{PERIOD_LABEL[p]}</span>
                    <span className="am-count">{n}</span>
                  </button>
                )
              })}
            </div>
            <div className="am-segs" role="group" aria-label="By or on">
              {(['all', 'by', 'on'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  className="am-seg"
                  data-tone={r}
                  aria-pressed={role === r}
                  title={
                    r === 'by'
                      ? `Events made by ${gamertag}`
                      : r === 'on'
                        ? `Events against ${gamertag}`
                        : undefined
                  }
                  onClick={() => {
                    setRole(r)
                  }}
                >
                  <span>{r === 'all' ? 'All' : r === 'by' ? 'By' : 'On'}</span>
                  <span className="am-count">{counts.roles[r]}</span>
                </button>
              ))}
            </div>
            {isoGroup !== undefined && isoGroup !== null && (
              <button
                type="button"
                className="am-iso"
                onClick={() => {
                  setIso(null)
                }}
              >
                <span className="am-iso-k">Game</span>
                <span>
                  {isoGroup.label} · {isoGroup.sub.split(' · ')[0]}
                </span>
                <span className="am-iso-x" aria-hidden>
                  ✕
                </span>
              </button>
            )}
            <div className="am-chips" role="group" aria-label="Event types">
              {(['goal', 'shot', 'hit', 'penalty', 'faceoff'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  className="am-chip"
                  aria-pressed={types[t]}
                  data-empty={counts.types[t] === 0}
                  data-dashed={t === 'faceoff'}
                  title={t === 'faceoff' ? FACEOFF_NOTE : undefined}
                  onClick={() => {
                    setTypes((s) => ({ ...s, [t]: !s[t] }))
                  }}
                >
                  {t === 'faceoff' ? (
                    <span className="am-fo-ring" aria-hidden />
                  ) : (
                    <Glyph type={t} role="by" size={14} />
                  )}
                  <span>{TYPE_LABEL[t]}</span>
                  <span className="am-count">{counts.types[t]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="am-body">
            <div className="am-rink-col">
              <div className="am-rink-head">
                <span className="am-rink-label">Event map · all games · normalized</span>
                <div className="am-axis">
                  <span className="am-axis-opp">Opp ←</span>
                  <span className="am-axis-mid">defends · attacks</span>
                  <span className="am-axis-bgm">→ BGM</span>
                </div>
              </div>
              <div className="am-rink">
                <RinkSvg />
                <svg
                  viewBox="0 0 2405 1025"
                  preserveAspectRatio="xMidYMid meet"
                  role="group"
                  aria-label="Event markers"
                >
                  <defs>
                    {GLYPH_VARIANTS.map(([type, r]) => (
                      <symbol
                        key={`${type}-${r}`}
                        id={`${uid}-${type}-${r}`}
                        viewBox="0 0 56 56"
                        overflow="visible"
                      >
                        <Glyph type={type} role={r} size={56} />
                      </symbol>
                    ))}
                  </defs>
                  {markers.map((m) => (
                    <g
                      key={m.id}
                      className="am-marker"
                      transform={`translate(${(m.cx + m.dx).toFixed(1)},${(m.cy + m.dy).toFixed(1)})`}
                      opacity={m.opacity}
                      role="button"
                      tabIndex={0}
                      aria-label={m.tip}
                      aria-pressed={m.pinned}
                      onClick={() => {
                        pinEvent(m.id, true)
                      }}
                      onKeyDown={markerKey(m)}
                    >
                      <title>{m.tip}</title>
                      {/* Scaled up in CSS on narrow screens, where the rink renders small. */}
                      <g className="am-glyph">
                        <circle
                          className="am-focus"
                          r={m.size * 0.95}
                          fill="none"
                          stroke={m.pinned ? '#ebebeb' : 'transparent'}
                          strokeWidth={5}
                          strokeDasharray="14 10"
                        />
                        <use
                          href={`#${uid}-${m.type}-${m.role}`}
                          x={-m.size / 2}
                          y={-m.size / 2}
                          width={m.size}
                          height={m.size}
                        />
                      </g>
                    </g>
                  ))}
                </svg>
              </div>

              {pinView !== null && (
                <div className="am-pin">
                  <span className="am-pill" data-role={pinView.role}>
                    {pinView.label}
                  </span>
                  <span className="am-names">
                    {pinView.actor}
                    <span className="am-arrow">›</span>
                    <span className="am-target">{pinView.target}</span>
                  </span>
                  <span className="am-clock">{pinView.clock}</span>
                  <span className="am-meta">{pinView.period}</span>
                  <span className="am-meta">
                    vs {pinView.opp} · {pinView.date} · {pinView.mode}
                  </span>
                  <span className="am-res" data-tone={pinView.tone}>
                    {pinView.result}
                  </span>
                  <button
                    type="button"
                    className="am-clear"
                    onClick={() => {
                      setPin(null)
                    }}
                  >
                    Clear pin
                  </button>
                </div>
              )}

              <div className="am-legend">
                <span>Legend</span>
                <LegendKey color={BY_FILL}>By {gamertag}</LegendKey>
                <LegendKey color={ON_FILL}>On {gamertag}</LegendKey>
                <span>Hex goal · circle shot · square hit · diamond penalty</span>
                <span>
                  <b>{unplottedCount}</b> not plotted
                </span>
              </div>
            </div>

            <div className="am-list-col">
              <div className="am-list-box">
                <div className="am-list-head">
                  <span className="am-list-title">Events</span>
                  <select
                    className="am-sort"
                    aria-label="Sort events"
                    value={sort}
                    onChange={(e) => {
                      setSort(e.target.value as SortMode)
                    }}
                  >
                    <option value="game">By game</option>
                    <option value="newest">Newest first</option>
                    <option value="type">By type</option>
                  </select>
                  <span className="am-shown">
                    <b>{visible.length}</b> shown
                  </span>
                </div>
                <div ref={listRef} className="am-list">
                  {visible.length === 0 && (
                    <p className="am-empty">No events match these filters.</p>
                  )}
                  {shown.groups.map((g) => {
                    const head = (
                      <>
                        <span className="am-group-label">{g.label}</span>
                        <span className="am-group-sub">{g.sub}</span>
                        <span className="am-group-rule" />
                        {g.result !== null && (
                          <span className="am-res" data-tone={g.tone ?? undefined}>
                            {g.result}
                          </span>
                        )}
                        <span className="am-group-n">{g.count} ev</span>
                      </>
                    )
                    const matchId = g.matchId
                    return (
                      <div key={g.key} className="am-group">
                        {matchId !== null ? (
                          <button
                            type="button"
                            className="am-group-head"
                            aria-pressed={iso === matchId}
                            title={
                              iso === matchId ? 'Show all games' : 'Isolate this game on the map'
                            }
                            onClick={() => {
                              setIso((cur) => (cur === matchId ? null : matchId))
                              setPin(null)
                            }}
                          >
                            {head}
                          </button>
                        ) : (
                          <div className="am-group-head">{head}</div>
                        )}
                        {g.rows.map((r) => (
                          <EventRow key={r.id} row={r} pinned={pin === r.id} onPin={pinFromList} />
                        ))}
                      </div>
                    )
                  })}
                  {shown.hidden > 0 && (
                    <div ref={moreRef} className="am-more">
                      <button
                        type="button"
                        className="am-clear"
                        onClick={() => {
                          setLimit((l) => l + LIST_BATCH)
                        }}
                      >
                        Show more ({shown.hidden})
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="am-foot">
        <span>
          Source action tracker · {gameCount} reviewed games · all directions normalized to BGM
          attacking right
        </span>
      </div>
    </section>
  )
}

const GLYPH_VARIANTS = (['goal', 'shot', 'hit', 'penalty'] as const).flatMap((t) =>
  (['by', 'on'] as const).map((r) => [t, r] as const),
)

/** One list row. Memoised: a pin change re-renders only the old and new pinned rows. */
const EventRow = memo(function EventRow({
  row: r,
  pinned,
  onPin,
}: {
  row: ActionRow
  pinned: boolean
  onPin: (id: number) => void
}) {
  return (
    <button
      type="button"
      className="am-row"
      data-ev={r.id}
      data-role={r.role}
      aria-pressed={pinned}
      onClick={() => {
        onPin(r.id)
      }}
    >
      <span className="am-rail" aria-hidden />
      <span className="am-avatar" aria-hidden />
      <span className="am-row-main">
        <span className="am-row-names">
          {r.actor}
          <span className="am-arrow">›</span>
          <span className="am-target">{r.target}</span>
        </span>
        <span className="am-row-sub">
          <span className="am-pill" data-role={r.role}>
            {r.label}
          </span>
          <span className="am-clock">{r.clock}</span>
          <span className="am-meta">{r.meta}</span>
        </span>
      </span>
      {r.plotted ? (
        <span className="am-dot" data-type={r.type} aria-hidden />
      ) : (
        <span className="am-noplot" title="Not plotted" aria-label="Not plotted" />
      )}
    </button>
  )
})

function LegendKey({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="am-key">
      <span className="am-swatch" style={{ background: color }} />
      {children}
    </span>
  )
}
