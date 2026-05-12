'use client'

import { useMemo, useState, type ReactNode } from 'react'
import type { ShotLocations } from '@eanhl/db'
import { EA_ICE_INDEX_TO_ZONE, ICE_ZONE_SHAPES } from './shot-map-zones'
import type { IceZoneId } from './shot-map-zones'
import './shot-map.css'

type View = 'ice' | 'goal'
type Mode = 'sog' | 'goals' | 'pct'
type Bucket = 'all' | 'hd' | 'mr' | 'lr'
type Rank = 1 | 2 | 3 | 4
type Role = 'skater' | 'goalie'

interface Props {
  player: ShotLocations | null
  /**
   * Comparison map (e.g. team-average for player profile). When omitted, the
   * "vs Team Avg" ledger and the per-bucket delta columns are hidden — useful
   * when this component is rendered for the team itself, where there's no
   * meaningful peer baseline.
   */
  teamAverage?: ShotLocations | undefined
  hasData: boolean
  /**
   * 'skater' (default): player's shots taken / goals scored — SOG / Goals / Shooting %.
   * 'goalie': shots faced / goals allowed / save % — ice flipped 180° so the
   * goalie's net is at the bottom (defending) and the offensive zone at the top.
   */
  role?: Role | undefined
  /** Used in the rink legend + footer center cell. */
  gamertag?: string | undefined
  /** Player games played (NHL 26 skater). Drives shots/game calc. */
  playerGp?: number | undefined
  /** Team-average games played (NHL 26 skaters with GP≥5). Drives team shots/game. */
  teamAvgGp?: number | undefined
  /** Optional rank summary card data (e.g. points rank within the club). */
  pointsRank?: { rank: number; total: number } | undefined
  /** Sheet code in the footer. */
  sheetCode?: string | undefined
  /** ISO date for the "Updated" cell. */
  updatedDate?: string | undefined
  /**
   * Override the title's role word ("Skater"/"Goalie"). Set to "Team" when
   * the component represents team-level aggregates instead of a single player.
   */
  subject?: string | undefined
  /**
   * Optional control rendered on the right side of the Ice/Goal toggle row
   * (same level, opposite side). Used by the team shot map to host an
   * Offense/Defense toggle styled to match the Ice/Goal segmented control.
   */
  headerSlot?: ReactNode
}

/* Distance buckets — only the 8 inner zones are bucketed (matches design). */
const BUCKETS: Record<Exclude<Bucket, 'all'>, IceZoneId[]> = {
  hd: ['Crease', 'LowSlot'],
  mr: ['LCircle', 'HighSlot', 'RCircle'],
  lr: ['LPoint', 'CenterPoint', 'RPoint'],
}
const BUCKETED_ZONES: IceZoneId[] = [...BUCKETS.hd, ...BUCKETS.mr, ...BUCKETS.lr]

/* 5-zone net layout (TL, TR, BL, BR, 5H) — net SVG geometry from the design. */
const NET_ZONE_DEFS = [
  { id: 'TL', label: 'Top Shelf L', x: 80,  y: 80,  w: 220, h: 150, lx: 190, ly: 155 },
  { id: 'TR', label: 'Top Shelf R', x: 300, y: 80,  w: 220, h: 150, lx: 410, ly: 155 },
  { id: 'BL', label: 'Low L',       x: 80,  y: 230, w: 220, h: 150, lx: 190, ly: 305 },
  { id: 'BR', label: 'Low R',       x: 300, y: 230, w: 220, h: 150, lx: 410, ly: 305 },
  { id: '5H', label: 'Five-Hole',   x: 240, y: 305, w: 120, h: 75,  lx: 300, ly: 342 },
] as const

/* Number-bubble label positions for each ice zone — sourced from design SVG
 * (matrix scale 3.1358 in the original; converted to viewBox units here). */
const ZONE_LABEL_POS: Record<IceZoneId, { x: number; y: number }> = {
  LowSlot:      { x: 420.5, y: 226.1 },
  HighSlot:     { x: 420.5, y: 427.1 },
  Crease:       { x: 420.5, y: 131.7 },
  CenterPoint:  { x: 420.5, y: 632.2 },
  LCircle:      { x: 222.9, y: 414.2 },
  RCircle:      { x: 616.8, y: 412.9 },
  LPoint:       { x: 126.1, y: 605.5 },
  RPoint:       { x: 713.0, y: 604.2 },
  LNetSide:     { x: 240.5, y: 167.7 },
  RNetSide:     { x: 601.4, y: 167.4 },
  LCorner:      { x: 199.1, y: 76.2 },
  RCorner:      { x: 641.8, y: 76.5 },
  OutsideL:     { x: 105.7, y: 261.8 },
  OutsideR:     { x: 735.4, y: 261.2 },
  BehindTheNet: { x: 420.5, y: 73.7 },
  NeutralZone:  { x: 420.5, y: 794.0 },
}

const ALL_ZONES: IceZoneId[] = Object.values(EA_ICE_INDEX_TO_ZONE)

export function ShotMap(props: Props) {
  const role: Role = props.role ?? 'skater'
  const titleWord = props.subject ?? (role === 'goalie' ? 'Goalie' : 'Skater')

  if (!props.hasData || !props.player) {
    return (
      <section className="sm-module">
        <header className="sm-head">
          <div className="sm-title">
            <h2><span className="accent">▌</span>{titleWord} Zone Map · Season</h2>
            <span className="scope">NHL 26 · Regular</span>
          </div>
        </header>
        <div className="sm-ticker" />
        <p className="sm-empty">
          {role === 'goalie' ? 'Goalie shot' : 'Shot'} location data is only collected for{' '}
          <span style={{ fontWeight: 800, color: 'var(--color-fg-1)' }}>NHL 26</span>.
        </p>
      </section>
    )
  }
  return <ShotMapContent {...props} player={props.player} role={role} />
}

function ShotMapContent({
  player,
  teamAverage,
  gamertag = 'player',
  playerGp,
  teamAvgGp,
  pointsRank,
  sheetCode,
  updatedDate,
  role,
  subject,
  headerSlot,
}: Props & { player: ShotLocations; role: Role }) {
  const [mode, setMode] = useState<Mode>('sog')
  const [view, setView] = useState<View>('ice')
  const [bucket, setBucket] = useState<Bucket>('all')

  const isGoalie = role === 'goalie'
  const titleWord = subject ?? (isGoalie ? 'Goalie' : 'Skater')
  const modeTabs = isGoalie
    ? ([
        { id: 'sog', label: 'Shots Against' },
        { id: 'goals', label: 'Goals Against' },
        { id: 'pct', label: 'Save %' },
      ] as const)
    : ([
        { id: 'sog', label: 'SOG' },
        { id: 'goals', label: 'Goals' },
        { id: 'pct', label: 'Shooting %' },
      ] as const)

  // ─── Per-zone values + density ranks ───────────────────────────────────
  const iceZoneValues = useMemo(
    () => buildIceZoneValues(player, mode, isGoalie),
    [player, mode, isGoalie],
  )
  const iceZoneRanks = useMemo(() => rankIceZones(iceZoneValues, mode), [iceZoneValues, mode])
  const netZoneValues = useMemo(
    () => buildNetZoneValues(player, mode, isGoalie),
    [player, mode, isGoalie],
  )
  const netZoneRanks = useMemo(() => rankNetZones(netZoneValues, mode), [netZoneValues, mode])

  // ─── Distance bucket totals + deltas vs team avg ───────────────────────
  const bucketStats = useMemo(
    () => buildBucketStats(player, teamAverage, mode, isGoalie),
    [player, teamAverage, mode, isGoalie],
  )

  // ─── vs Team Avg comparison rows — empty when no comparison map ────────
  const compRows = useMemo(
    () =>
      teamAverage !== undefined
        ? buildComparisons(player, teamAverage, playerGp, teamAvgGp, isGoalie)
        : [],
    [player, teamAverage, playerGp, teamAvgGp, isGoalie],
  )

  const hotZone = useMemo(() => findHotZone(player.shotsIce), [player.shotsIce])

  return (
    <section className="sm-module">
      {/* Header */}
      <header className="sm-head">
        <div className="sm-title">
          <h2>
            <span className="accent">▌</span>{titleWord} Zone Map · Season
          </h2>
          <span className="scope">NHL 26 · Regular</span>
        </div>
        <div className="sm-tabs" role="tablist">
          {modeTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={mode === t.id}
              className="sm-tab"
              onClick={() => {
                setMode(t.id)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="sm-ticker" />

      <div className="sm-body">
        {/* ── Map column ─────────────────────────────────────────────── */}
        <div className="sm-rink-col">
          <div className="sm-view-toggle-row">
            <div className="sm-view-toggle" role="tablist" aria-label="Map view">
              <button
                type="button"
                aria-selected={view === 'ice'}
                onClick={() => {
                  setView('ice')
                }}
              >
                Ice
              </button>
              <button
                type="button"
                aria-selected={view === 'goal'}
                onClick={() => {
                  setView('goal')
                }}
              >
                Goal
              </button>
            </div>
            {headerSlot}
          </div>

          {view === 'ice' ? (
            <IceRink
              zoneValues={iceZoneValues}
              zoneRanks={iceZoneRanks}
              bucket={bucket}
              mode={mode}
              isGoalie={isGoalie}
            />
          ) : (
            <GoalNet
              zoneValues={netZoneValues}
              zoneRanks={netZoneRanks}
              mode={mode}
              isGoalie={isGoalie}
            />
          )}

          <div className="sm-rink-legend">
            <ul className="sm-density-legend" aria-label="Density scale">
              <li>
                <span className="sw r1" />
                <span>Hot</span>
              </li>
              <li>
                <span className="sw r2" />
                <span>Warm</span>
              </li>
              <li>
                <span className="sw r3" />
                <span>Cold</span>
              </li>
              <li>
                <span className="sw r4" />
                <span>Empty</span>
              </li>
            </ul>
            <span className="axis">
              {gamertag} · {playerGp != null ? `${String(playerGp)} GP` : '—'}
            </span>
          </div>
        </div>

        {/* ── Ledger column ──────────────────────────────────────────── */}
        <aside className="sm-ledger">
          {view === 'ice' && (
            <div>
              <h3>
                <b>▌</b>Distance Buckets <span className="hint">— click to isolate</span>
              </h3>
              <div className="sm-bucket-filters" role="group">
                {(['all', 'hd', 'mr', 'lr'] as const).map((b) => (
                  <BucketButton
                    key={b}
                    bucket={b}
                    active={bucket === b}
                    stats={bucketStats[b]}
                    onClick={() => {
                      setBucket(b)
                    }}
                    mode={mode}
                  />
                ))}
              </div>
            </div>
          )}

          {compRows.length > 0 && (
            <div>
              <h3>
                <b>▌</b>vs BGM Team Avg
              </h3>
              {compRows.map((row) => (
                <div key={row.label} className="sm-row">
                  <span className="lbl">{row.label}</span>
                  <span className="v">{row.value}</span>
                  <span className={`sm-delta ${row.deltaDir}`}>{row.delta}</span>
                </div>
              ))}
            </div>
          )}

          <div className="sm-summary">
            {pointsRank ? (
              <div className="card acc">
                <span className="k">{isGoalie ? 'SV% Rank' : 'PTS Rank'}</span>
                <span className="v">#{String(pointsRank.rank)}</span>
                <span className="sub">
                  of {String(pointsRank.total)} {isGoalie ? 'goalies' : 'skaters'}
                </span>
              </div>
            ) : (
              <div className="card acc">
                <span className="k">{isGoalie ? 'Total Shots Against' : 'Total SOG'}</span>
                <span className="v">{String(player.shotsIce.reduce((a, b) => a + b, 0))}</span>
                <span className="sub">all zones</span>
              </div>
            )}
            <div className="card">
              <span className="k">{isGoalie ? 'Most Targeted' : 'Hot Zone'}</span>
              <span className="v">{hotZone.label}</span>
              <span className="sub">
                {String(hotZone.shots)} {isGoalie ? 'SA' : 'SOG'} · {hotZone.shareLabel}
              </span>
            </div>
          </div>
        </aside>
      </div>

      <footer className="sm-foot">
        <span>
          Updated <b>{updatedDate ?? '—'}</b> · Source <b>EA NHL · Boogeymen</b>
        </span>
        <span className="center">
          — {isGoalie ? 'Shots Faced' : 'Shot Locations'} · {subject ?? gamertag} —
        </span>
        <span className="right">
          Sheet <b>{sheetCode ?? (isGoalie ? 'BGM/GSM/0010' : 'BGM/SHM/0010')}</b>
        </span>
      </footer>
    </section>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function IceRink({
  zoneValues,
  zoneRanks,
  bucket,
  mode,
  isGoalie,
}: {
  zoneValues: Record<IceZoneId, number | string>
  zoneRanks: Record<IceZoneId, Rank>
  bucket: Bucket
  mode: Mode
  isGoalie: boolean
}) {
  const inBucket = (id: IceZoneId): boolean => {
    if (bucket === 'all') return true
    return BUCKETS[bucket].includes(id)
  }

  return (
    <div className="sm-rink-wrap">
      <svg
        className={`sm-rink${isGoalie ? ' sm-rink-flipped' : ''}`}
        data-bucket={bucket}
        viewBox="0 0 841.2 859.2"
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
        aria-label={isGoalie ? 'Goalie ice shot map' : 'Skater ice shot map'}
      >
        <defs>
          <clipPath id="sm-rink-clip">
            <path d="M5.81,854.08V279.82C5.74,128.18,128.61,5.19,280.25,5.12H560.69c151.7,0,274.69,123,274.7,274.66v574.3Z" />
          </clipPath>
        </defs>

        {/* Zone fills */}
        <g className="sm-zones" clipPath="url(#sm-rink-clip)">
          {ALL_ZONES.map((id) => {
            const rank = zoneRanks[id]
            const cls = `zone r${String(rank)}${inBucket(id) ? ' in-bucket' : ''}`
            return (
              <path
                key={id}
                className={cls}
                d={ICE_ZONE_SHAPES[id].d}
                data-zone={id}
              >
                <title>{tooltipForIceZone(id, zoneValues[id])}</title>
              </path>
            )
          })}
        </g>

        {/* Goal line + neutral-zone (blue) line, clipped to rink */}
        <g clipPath="url(#sm-rink-clip)">
          <rect className="line-red" x="0" y="110.23" width="841.2" height="2.04" />
          <rect className="line-blue" x="0" y="724.5" width="841.2" height="8" />
        </g>

        {/* Outer boundary */}
        <path
          className="ice-edge"
          d="M5.81,854.08V279.82C5.74,128.18,128.61,5.19,280.25,5.12H560.69c151.7,0,274.69,123,274.7,274.66v574.3Z"
        />

        {/* Crease */}
        <path
          className="crease"
          d="M421.1,170.5a60.63,60.63,0,0,1-60.69-59.7H449.2l32.69-.1a60.8,60.8,0,0,1-60.79,59.8Z"
        />

        {/* Net */}
        <rect className="net" x="408" y="95" width="26" height="15" rx="2" />

        {/* Zone number labels — outer <g> positions the bubble; inner <g>
            holds the rect+text and gets CSS-rotated 180° when the rink is
            flipped (goalie view) so the numbers stay upright. */}
        <g className="sm-zone-numbers">
          {ALL_ZONES.map((id) => {
            const pos = ZONE_LABEL_POS[id]
            const label = String(zoneValues[id])
            const len = label.length
            const w = len >= 4 ? 82 : len === 3 ? 63 : len === 2 ? 49 : 38
            const h = len <= 1 ? 38 : 44
            const fs = len <= 1 ? 29 : 33
            const cls = inBucket(id) ? 'in-bucket' : ''
            return (
              <g
                key={id}
                data-zone={id}
                className={cls}
                transform={`translate(${String(pos.x)} ${String(pos.y)})`}
              >
                <g className="sm-zone-num-inner">
                  <rect
                    className="num-bg"
                    x={-w / 2}
                    y={-h / 2}
                    width={w}
                    height={h}
                    rx={mode === 'pct' ? 10 : 16}
                  />
                  <text className="num-txt" x={0} y={0} fontSize={fs}>
                    {label}
                  </text>
                </g>
              </g>
            )
          })}
        </g>

        {/* Direction marker — for skater the shooter is at the bottom firing
            up; for goalie they are at the bottom defending against shots
            coming down. The SVG itself is flipped via CSS for the goalie
            case so we render a single label that ends up oriented correctly. */}
        <text
          className="sm-direction"
          x={isGoalie ? 811.2 : 30}
          y={isGoalie ? 18 : 850}
          fill="#a1a1aa"
          fontSize="14"
          fontFamily="ui-monospace, 'JetBrains Mono', monospace"
          letterSpacing="2"
          opacity="0.7"
          textAnchor={isGoalie ? 'end' : 'start'}
        >
          {isGoalie ? 'SHOT ORIGIN ↓' : 'SHOT DIRECTION ↑'}
        </text>
      </svg>
    </div>
  )
}

function GoalNet({
  zoneValues,
  zoneRanks,
  mode,
  isGoalie,
}: {
  zoneValues: Record<string, number | string>
  zoneRanks: Record<string, Rank>
  mode: Mode
  isGoalie: boolean
}) {
  const caption = isGoalie
    ? mode === 'sog'
      ? 'SHOTS FACED — NET ZONES'
      : mode === 'goals'
        ? 'GOALS ALLOWED — NET ZONES'
        : 'SAVE % — NET ZONES'
    : mode === 'sog'
      ? 'SHOTS ON GOAL — NET ZONES'
      : mode === 'goals'
        ? 'GOAL DISTRIBUTION — GOALS'
        : 'SHOOTING % — NET ZONES'

  return (
    <div className="sm-rink-wrap">
      <svg
        className="sm-goal-svg"
        viewBox="0 0 600 500"
        preserveAspectRatio="xMidYMid meet"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Player goal-net shot map"
      >
        <defs>
          <pattern id="sm-net-mesh" width="14" height="14" patternUnits="userSpaceOnUse">
            <path d="M 0 0 L 14 14 M 14 0 L 0 14" stroke="rgba(231,229,228,0.07)" strokeWidth="0.6" />
          </pattern>
        </defs>

        <rect x="80" y="80" width="440" height="300" fill="url(#sm-net-mesh)" />

        <g>
          {NET_ZONE_DEFS.map((z) => (
            <rect
              key={z.id}
              className={`gz r${String(zoneRanks[z.id] ?? 4)}`}
              x={z.x}
              y={z.y}
              width={z.w}
              height={z.h}
            >
              <title>{tooltipForNetZone(z.label, zoneValues[z.id])}</title>
            </rect>
          ))}
        </g>

        <line className="ice-line" x1="80" y1="380" x2="520" y2="380" />
        <path className="post-outline" d="M 80 380 V 80 H 520 V 380" />
        <path className="post" d="M 80 380 V 80 H 520 V 380" />

        <g>
          {NET_ZONE_DEFS.map((z) => {
            const value = String(zoneValues[z.id] ?? '—')
            const isFiveHole = z.id === '5H'
            return (
              <g key={z.id} transform={`translate(${String(z.lx)} ${String(z.ly)})`}>
                <text className="gz-num" x={0} y={-4} fontSize={isFiveHole ? 32 : 42}>
                  {value}
                </text>
                <text className="gz-lbl" x={0} y={isFiveHole ? 22 : 32}>
                  {z.label}
                </text>
              </g>
            )
          })}
        </g>

        <text
          x="300"
          y="50"
          fill="#a1a1aa"
          fontSize="14"
          fontFamily="ui-monospace, 'JetBrains Mono', monospace"
          letterSpacing="3"
          textAnchor="middle"
        >
          {caption}
        </text>
        <text
          x="300"
          y="488"
          fill="#71717a"
          fontSize="10"
          fontFamily="ui-monospace, 'JetBrains Mono', monospace"
          letterSpacing="3"
          textAnchor="middle"
        >
          {isGoalie ? 'SHOOTER → NET' : 'GOALIE → ICE'}
        </text>
      </svg>
    </div>
  )
}

function BucketButton({
  bucket,
  active,
  stats,
  onClick,
  mode,
}: {
  bucket: Bucket
  active: boolean
  stats: { value: string; delta: string; dir: 'up' | 'dn' | 'eq' }
  onClick: () => void
  mode: Mode
}) {
  const labels: Record<Bucket, string> = {
    all: 'All Locations',
    hd: 'High-Danger',
    mr: 'Mid-Range',
    lr: 'Long-Range',
  }
  return (
    <button
      type="button"
      className="sm-bf"
      aria-pressed={active}
      onClick={onClick}
      data-mode={mode}
    >
      <span>{labels[bucket]}</span>
      <span className={`v ${bucket === 'all' ? 'lead' : ''}`}>{stats.value}</span>
      <span className={`sm-delta ${stats.dir}`}>{stats.delta}</span>
    </button>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** For skaters, pct = shooting % (goals/shots). For goalies, pct = save %
 *  ((shots − goals)/shots), so a high % is a "good zone" for the goalie. */
function pctFor(shots: number, goals: number, isGoalie: boolean): string {
  if (shots <= 0) return '0.0%'
  const rate = isGoalie ? (shots - goals) / shots : goals / shots
  return `${(rate * 100).toFixed(1)}%`
}

function buildIceZoneValues(
  player: ShotLocations,
  mode: Mode,
  isGoalie: boolean,
): Record<IceZoneId, number | string> {
  const out: Partial<Record<IceZoneId, number | string>> = {}
  for (const [idxStr, zoneId] of Object.entries(EA_ICE_INDEX_TO_ZONE)) {
    const i = Number(idxStr) - 1
    const shots = player.shotsIce[i] ?? 0
    const goals = player.goalsIce[i] ?? 0
    if (mode === 'sog') out[zoneId] = shots
    else if (mode === 'goals') out[zoneId] = goals
    else out[zoneId] = pctFor(shots, goals, isGoalie)
  }
  return out as Record<IceZoneId, number | string>
}

function buildNetZoneValues(
  player: ShotLocations,
  mode: Mode,
  isGoalie: boolean,
): Record<string, number | string> {
  // EA net indices: 1=top_l (TL), 2=top_r (TR), 3=bot_l (BL), 4=bot_r (BR), 5=five_hole (5H)
  const map: Record<string, number> = { TL: 0, TR: 1, BL: 2, BR: 3, '5H': 4 }
  const out: Record<string, number | string> = {}
  for (const [id, i] of Object.entries(map)) {
    const shots = player.shotsNet[i] ?? 0
    const goals = player.goalsNet[i] ?? 0
    if (mode === 'sog') out[id] = shots
    else if (mode === 'goals') out[id] = goals
    else out[id] = pctFor(shots, goals, isGoalie)
  }
  return out
}

function rankIceZones(
  zoneValues: Record<IceZoneId, number | string>,
  mode: Mode,
): Record<IceZoneId, Rank> {
  const numeric: Record<IceZoneId, number> = {} as Record<IceZoneId, number>
  for (const id of ALL_ZONES) {
    numeric[id] = parseNumeric(zoneValues[id])
  }
  return rankByThresholds(numeric, mode === 'pct')
}

function rankNetZones(
  zoneValues: Record<string, number | string>,
  mode: Mode,
): Record<string, Rank> {
  const numeric: Record<string, number> = {}
  for (const id of Object.keys(zoneValues)) {
    numeric[id] = parseNumeric(zoneValues[id])
  }
  return rankByThresholds(numeric, mode === 'pct')
}

function parseNumeric(v: number | string | undefined): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = parseFloat(v.replace('%', ''))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/**
 * Density rank thresholds — derived from design's data:
 *   r1 (hot)  : value ≥ 50% of max
 *   r2 (warm) : value ≥ 10% of max
 *   r3 (cold) : value > 0
 *   r4 (null) : value === 0 (or below sample threshold for pct mode)
 */
function rankByThresholds<K extends string>(
  numeric: Record<K, number>,
  isPct: boolean,
): Record<K, Rank> {
  const values: number[] = Object.values(numeric)
  const max = values.length > 0 ? Math.max(...values) : 0
  const out = {} as Record<K, Rank>
  for (const [k, v] of Object.entries(numeric) as [K, number][]) {
    if (max <= 0 || v <= 0) {
      out[k] = 4
      continue
    }
    const ratio = v / max
    if (ratio >= 0.5) out[k] = 1
    else if (ratio >= 0.1) out[k] = 2
    else if (isPct ? ratio > 0 : v > 0) out[k] = 3
    else out[k] = 4
  }
  return out
}

function buildBucketStats(
  player: ShotLocations,
  team: ShotLocations | undefined,
  mode: Mode,
  isGoalie: boolean,
): Record<Bucket, { value: string; delta: string; dir: 'up' | 'dn' | 'eq' }> {
  const sumZones = (sl: ShotLocations, ids: IceZoneId[], pickGoals: boolean): number => {
    let total = 0
    for (const [idxStr, zoneId] of Object.entries(EA_ICE_INDEX_TO_ZONE)) {
      if (!ids.includes(zoneId)) continue
      const i = Number(idxStr) - 1
      total += (pickGoals ? sl.goalsIce[i] : sl.shotsIce[i]) ?? 0
    }
    return total
  }

  const compute = (ids: IceZoneId[]): { value: string; delta: string; dir: 'up' | 'dn' | 'eq' } => {
    if (mode === 'pct') {
      const ps = sumZones(player, ids, false)
      const pg = sumZones(player, ids, true)
      // Skater = shooting %, goalie = save %.
      const pPct = ps > 0 ? (isGoalie ? (ps - pg) / ps : pg / ps) * 100 : 0
      if (team === undefined) {
        return {
          value: ps > 0 ? `${pPct.toFixed(1)}%` : '—',
          delta: '',
          dir: 'eq',
        }
      }
      const ts = sumZones(team, ids, false)
      const tg = sumZones(team, ids, true)
      const tPct = ts > 0 ? (isGoalie ? (ts - tg) / ts : tg / ts) * 100 : 0
      const delta = pPct - tPct
      return {
        value: ps > 0 ? `${pPct.toFixed(1)}%` : '—',
        delta: formatDeltaPp(delta),
        dir: deltaDir(delta),
      }
    }
    const playerVal = Math.round(sumZones(player, ids, mode === 'goals'))
    if (team === undefined) {
      return { value: String(playerVal), delta: '', dir: 'eq' }
    }
    const teamVal = sumZones(team, ids, mode === 'goals')
    const delta = playerVal - teamVal
    return {
      value: String(playerVal),
      delta: formatDeltaCount(delta),
      // For goalies, FEWER shots / goals against in a bucket is *better*, so
      // invert the delta direction so the chip turns green on under-team-avg.
      dir: isGoalie ? deltaDir(-delta) : deltaDir(delta),
    }
  }

  return {
    all: compute(BUCKETED_ZONES),
    hd: compute(BUCKETS.hd),
    mr: compute(BUCKETS.mr),
    lr: compute(BUCKETS.lr),
  }
}

function buildComparisons(
  player: ShotLocations,
  team: ShotLocations,
  playerGp: number | undefined,
  teamAvgGp: number | undefined,
  isGoalie: boolean,
): { label: string; value: string; delta: string; deltaDir: 'up' | 'dn' | 'eq' }[] {
  const pShots = player.shotsIce.reduce((a, b) => a + b, 0)
  const pGoals = player.goalsIce.reduce((a, b) => a + b, 0)
  const tShots = team.shotsIce.reduce((a, b) => a + b, 0)
  const tGoals = team.goalsIce.reduce((a, b) => a + b, 0)

  const pSlot = sumByZones(player, BUCKETS.hd, false)
  const tSlot = sumByZones(team, BUCKETS.hd, false)
  const pSlotGoals = sumByZones(player, BUCKETS.hd, true)
  const tSlotGoals = sumByZones(team, BUCKETS.hd, true)

  const rows: { label: string; value: string; delta: string; deltaDir: 'up' | 'dn' | 'eq' }[] = []

  // Shots (faced or taken) / Game — only meaningful with both GPs.
  if (playerGp != null && playerGp > 0 && teamAvgGp != null && teamAvgGp > 0) {
    const pSpg = pShots / playerGp
    const tSpg = tShots / teamAvgGp
    const d = pSpg - tSpg
    rows.push({
      label: isGoalie ? 'Shots Faced / Game' : 'Shots / Game',
      value: pSpg.toFixed(2),
      delta: formatDeltaSigned(d, 2),
      // Goalie: more shots faced is more workload, neutral framing.
      deltaDir: deltaDir(d),
    })
  }

  // Shooting % / Save %.
  if (isGoalie) {
    const pSv = pShots > 0 ? ((pShots - pGoals) / pShots) * 100 : 0
    const tSv = tShots > 0 ? ((tShots - tGoals) / tShots) * 100 : 0
    rows.push({
      label: 'Save %',
      value: pShots > 0 ? `${pSv.toFixed(1)}%` : '—',
      delta: formatDeltaPp(pSv - tSv),
      deltaDir: deltaDir(pSv - tSv),
    })
  } else {
    const pPct = pShots > 0 ? (pGoals / pShots) * 100 : 0
    const tPct = tShots > 0 ? (tGoals / tShots) * 100 : 0
    rows.push({
      label: 'Shooting %',
      value: pShots > 0 ? `${pPct.toFixed(1)}%` : '—',
      delta: formatDeltaPp(pPct - tPct),
      deltaDir: deltaDir(pPct - tPct),
    })
  }

  // Slot Share / High-Danger Save %.
  if (isGoalie) {
    // Slot save % — the goalie's save rate on shots from the HD zones (Crease+LowSlot).
    const pHdSv = pSlot > 0 ? ((pSlot - pSlotGoals) / pSlot) * 100 : 0
    const tHdSv = tSlot > 0 ? ((tSlot - tSlotGoals) / tSlot) * 100 : 0
    rows.push({
      label: 'High-Danger Save %',
      value: pSlot > 0 ? `${pHdSv.toFixed(1)}%` : '—',
      delta: formatDeltaPp(pHdSv - tHdSv),
      deltaDir: deltaDir(pHdSv - tHdSv),
    })
  } else {
    const pSlotShare = pShots > 0 ? (pSlot / pShots) * 100 : 0
    const tSlotShare = tShots > 0 ? (tSlot / tShots) * 100 : 0
    rows.push({
      label: 'Slot Share',
      value: pShots > 0 ? `${pSlotShare.toFixed(1)}%` : '—',
      delta: formatDeltaPp(pSlotShare - tSlotShare),
      deltaDir: deltaDir(pSlotShare - tSlotShare),
    })
  }

  return rows
}

function sumByZones(sl: ShotLocations, ids: IceZoneId[], pickGoals: boolean): number {
  let total = 0
  for (const [idxStr, zoneId] of Object.entries(EA_ICE_INDEX_TO_ZONE)) {
    if (!ids.includes(zoneId)) continue
    const i = Number(idxStr) - 1
    total += (pickGoals ? sl.goalsIce[i] : sl.shotsIce[i]) ?? 0
  }
  return total
}

function findHotZone(shots: number[]): { id: IceZoneId; label: string; shots: number; shareLabel: string } {
  let bestI = -1
  let bestVal = -1
  for (let i = 0; i < shots.length; i++) {
    const v = shots[i] ?? 0
    if (v > bestVal) {
      bestVal = v
      bestI = i
    }
  }
  const total = shots.reduce((a, b) => a + b, 0)
  const id: IceZoneId = bestI >= 0 ? (EA_ICE_INDEX_TO_ZONE[bestI + 1] ?? 'NeutralZone') : 'NeutralZone'
  return {
    id,
    label: zoneLabel(id),
    shots: Math.round(bestVal > 0 ? bestVal : 0),
    shareLabel:
      total > 0 && bestVal > 0
        ? `${((bestVal / total) * 100).toFixed(0)}%`
        : '—',
  }
}

function zoneLabel(id: IceZoneId): string {
  const map: Record<IceZoneId, string> = {
    LowSlot: 'Low Slot',
    HighSlot: 'High Slot',
    Crease: 'Crease',
    CenterPoint: 'Center Pt',
    LCircle: 'L Circle',
    RCircle: 'R Circle',
    LPoint: 'L Point',
    RPoint: 'R Point',
    LNetSide: 'L Net Side',
    RNetSide: 'R Net Side',
    LCorner: 'L Corner',
    RCorner: 'R Corner',
    OutsideL: 'Outside L',
    OutsideR: 'Outside R',
    BehindTheNet: 'Behind Net',
    NeutralZone: 'Neutral',
  }
  return map[id]
}

function formatDeltaCount(d: number): string {
  const r = Math.round(d)
  if (r > 0) return `+${String(r)}`
  if (r < 0) return `−${String(Math.abs(r))}`
  return '0'
}

function formatDeltaPp(d: number): string {
  const r = d
  if (r > 0.05) return `+${r.toFixed(1)}`
  if (r < -0.05) return `−${Math.abs(r).toFixed(1)}`
  return '0.0'
}

function formatDeltaSigned(d: number, decimals: number): string {
  const abs = Math.abs(d)
  if (d > 0) return `+${d.toFixed(decimals)}`
  if (d < 0) return `−${abs.toFixed(decimals)}`
  return (0).toFixed(decimals)
}

function deltaDir(d: number): 'up' | 'dn' | 'eq' {
  if (d > 0.05) return 'up'
  if (d < -0.05) return 'dn'
  return 'eq'
}

function tooltipForIceZone(id: IceZoneId, value: number | string): string {
  return `${id}: ${String(value)}`
}

function tooltipForNetZone(label: string, value: number | string | undefined): string {
  return `${label}: ${String(value ?? '—')}`
}
