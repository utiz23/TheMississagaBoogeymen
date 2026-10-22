'use client'

import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import type {
  PairWinMatrix as PairWinMatrixData,
  PairWinMatrixCell,
  PairWinMatrixPlayer,
} from '@eanhl/db/queries'
import './pair-win-matrix.css'

interface Props {
  data: PairWinMatrixData
  /** Title context — e.g. "NHL 26", "Boogeymen". */
  titleName: string
  clubName: string
  /** Optional ISO date / freshness label rendered in the header meta. */
  updatedLabel?: string | undefined
  scope?: string | undefined
  /** Initial value for the min-shared-GP slider (default 3). */
  defaultMinPairGp?: number | undefined
}

/** Slider bounds — reasonable range for a small club roster. */
const MIN_THRESHOLD = 1
const MAX_THRESHOLD = 25

type OrderId = 'gp' | 'pct' | 'pairAvg' | 'name'

const ORDER_OPTIONS: { id: OrderId; label: string; tooltip: string }[] = [
  { id: 'gp', label: 'GP', tooltip: 'Sort by total games played in BGM matches (default)' },
  { id: 'pct', label: 'Win%', tooltip: "Sort by player's overall team win % (highest first)" },
  {
    id: 'pairAvg',
    label: 'Pair avg',
    tooltip:
      'Sort by the average win % across this player’s qualifying pair cells (above the slider)',
  },
  { id: 'name', label: 'Name', tooltip: 'Alphabetical by gamertag' },
]

/**
 * Map a 0–100 win percentage to one of the 6 heat tiers from the design.
 * Boundaries match the source HTML: 70+ excellent, 60+ good, 50+ neutral,
 * 40+ mid-low, 25+ poor, else bad.
 */
function tier(p: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (p >= 70) return 5
  if (p >= 60) return 4
  if (p >= 50) return 3
  if (p >= 40) return 2
  if (p >= 25) return 1
  return 0
}

/** Display record string. OTL is collapsed into Losses per project convention,
 *  so the cell label is always W-L. DNF is excluded from both numerator and
 *  denominator (surfaced in the tooltip when present). */
function recordString(c: { wins: number; losses: number; otl: number }): string {
  return `${String(c.wins)}–${String(c.losses + c.otl)}`
}

/**
 * Short label shown in column headers + row labels.
 *
 * Rules (in order):
 *   1. If a player_name is set with a space, use the **last word** ("Igor
 *      Orlov" → "Orlov").
 *   2. If a player_name is set without a space, use it verbatim ("Silky").
 *   3. Otherwise derive from the gamertag: strip trailing digits and pick the
 *      first underscore- or dash-separated chunk ("HighFortniteGuy" stays the
 *      same; "Bill_Hicks4_Life" → "Bill"; "silkyjoker85" → "silkyjoker").
 *
 * Tooltips on the same labels still show the full gamertag for identity.
 */
function displayAlias(playerName: string | null, gamertag: string): string {
  if (playerName !== null && playerName.trim() !== '') {
    const trimmed = playerName.trim()
    const parts = trimmed.split(/\s+/)
    const last = parts[parts.length - 1]
    return last !== undefined && last !== '' ? last : trimmed
  }
  const cleaned = gamertag.replace(/[0-9]+$/, '').replace(/[_-]+$/, '')
  const firstChunk = cleaned.split(/[_\s-]+/)[0]
  return firstChunk !== undefined && firstChunk.length > 0 ? firstChunk : gamertag
}

/** Long-form tooltip — names + record + DNF disclosure when relevant.
 *  Uses gamertags (full identity) here even when the rendered label is the
 *  short alias, so a hover always reveals who's actually being compared. */
function pairTooltip(
  rowGamertag: string,
  colGamertag: string,
  cell: PairWinMatrixCell,
  belowThreshold: boolean,
  threshold: number,
): string {
  const base = `${rowGamertag} + ${colGamertag} · ${String(cell.pct)}% · ${recordString(cell)}`
  const dnfNote = cell.dnf > 0 ? ` · ${String(cell.dnf)} DNF excluded` : ''
  const sample = ` · ${String(cell.gp)} GP together`
  const dim = belowThreshold ? ` · below ${String(threshold)} GP threshold` : ''
  return `${base}${sample}${dnfNote}${dim}`
}

/** Player row tooltip on the row label. */
function playerTooltip(p: PairWinMatrixPlayer): string {
  const realName = p.playerName !== null && p.playerName !== '' ? ` (${p.playerName})` : ''
  const dnfNote = p.dnf > 0 ? ` · ${String(p.dnf)} DNF excluded` : ''
  return `${p.gamertag}${realName} · ${String(p.pct)}% · ${recordString(p)} · ${String(p.gp)} GP${dnfNote}`
}

export function PairWinMatrix({
  data,
  titleName,
  clubName,
  updatedLabel,
  scope,
  defaultMinPairGp = 3,
}: Props) {
  const [hoverRow, setHoverRow] = useState<number | null>(null)
  const [hoverCol, setHoverCol] = useState<number | null>(null)
  const [minPairGp, setMinPairGp] = useState<number>(
    Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, defaultMinPairGp)),
  )
  const [orderId, setOrderId] = useState<OrderId>('gp')
  const [triOnly, setTriOnly] = useState<boolean>(false)

  const { players, pairs } = data

  /** Pairs whose shared GP meets the slider threshold. Used by the controls
   *  hint ("N pairs shown") and the `pairAvg` order-by computation. Cell
   *  rendering itself reads the unfiltered `pairs` so sub-threshold cells stay
   *  visible (dimmed) per the project's "keep everyone in the table" rule. */
  const playerIds = useMemo(() => new Set(players.map((p) => p.playerId)), [players])

  /** Pairs between two matrix players with at least one shared game. The query
   *  returns pairs for every skater, including skaters below its own GP floor
   *  who have no row, so those are dropped here — the counts and averages then
   *  describe the cells that are actually on screen. */
  const matrixPairs = useMemo(() => {
    const out: typeof pairs = {}
    for (const [k, v] of Object.entries(pairs)) {
      const [a, b] = k.split('-').map(Number)
      if (a === undefined || b === undefined) continue
      if (v.gp > 0 && playerIds.has(a) && playerIds.has(b)) out[k] = v
    }
    return out
  }, [pairs, playerIds])

  const filteredPairs = useMemo(() => {
    if (minPairGp <= 1) return matrixPairs
    const out: typeof pairs = {}
    for (const [k, v] of Object.entries(matrixPairs)) {
      if (v.gp >= minPairGp) out[k] = v
    }
    return out
  }, [matrixPairs, minPairGp])

  /** Every player from the underlying query is rendered — no row/col removal.
   *  Sub-threshold cells are dimmed in place. */
  const visiblePlayers = players

  /** Per-player average pair win % across their qualifying cells. Used for the
   *  `pairAvg` sort. Players with no qualifying pairs return 0 (sorts last). */
  const pairAvgByPlayerId = useMemo(() => {
    const sums = new Map<number, { total: number; count: number }>()
    for (const [key, cell] of Object.entries(filteredPairs)) {
      const [a, b] = key.split('-').map(Number)
      for (const id of [a, b]) {
        if (id === undefined) continue
        const cur = sums.get(id) ?? { total: 0, count: 0 }
        cur.total += cell.pct
        cur.count += 1
        sums.set(id, cur)
      }
    }
    const out = new Map<number, number>()
    for (const [id, { total, count }] of sums) {
      out.set(id, count > 0 ? total / count : 0)
    }
    return out
  }, [filteredPairs])

  const orderedPlayers = useMemo(() => {
    const list = visiblePlayers.slice()
    switch (orderId) {
      case 'gp':
        list.sort((a, b) => b.gp - a.gp || a.gamertag.localeCompare(b.gamertag))
        break
      case 'pct':
        list.sort((a, b) => b.pct - a.pct || b.gp - a.gp || a.gamertag.localeCompare(b.gamertag))
        break
      case 'pairAvg': {
        const avg = (id: number) => pairAvgByPlayerId.get(id) ?? 0
        list.sort(
          (a, b) =>
            avg(b.playerId) - avg(a.playerId) ||
            b.gp - a.gp ||
            a.gamertag.localeCompare(b.gamertag),
        )
        break
      }
      case 'name':
        list.sort((a, b) => a.gamertag.localeCompare(b.gamertag))
        break
    }
    return list
  }, [visiblePlayers, orderId, pairAvgByPlayerId])

  const playerCount = orderedPlayers.length
  const visiblePairCount = useMemo(() => Object.keys(filteredPairs).length, [filteredPairs])
  const totalPairCount = useMemo(() => Object.keys(matrixPairs).length, [matrixPairs])

  // Grid template: 110px row label + N × minmax(64px, 1fr) data columns +
  // 100px TEAM column. The data cells flex so the matrix fills the container
  // width; minmax floor keeps cells legible on narrow viewports.
  const gridStyle: CSSProperties = {
    gridTemplateColumns: `110px repeat(${String(playerCount)}, minmax(64px, 1fr)) 100px`,
  }

  const scopeLine =
    scope ??
    `Pairwise win % when both players appeared · ${String(playerCount)} skater${
      playerCount === 1 ? '' : 's'
    } · season-to-date`

  // Phone header meta: "NHL 27 · 7 skaters · season-to-date · upd 2026-10-12".
  // A caller-supplied scope (game-mode filter) replaces the middle part; its
  // generic lead-in is dropped because the Chemistry header already says it.
  const phoneMeta = [
    titleName,
    scope !== undefined
      ? scope.replace(/^Pairwise win % when both players appeared · /, '')
      : `${String(playerCount)} skater${playerCount === 1 ? '' : 's'} · season-to-date`,
    updatedLabel ? `upd ${updatedLabel}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  if (players.length === 0) {
    return (
      <section className="pwm-frame">
        <header className="pwm-head">
          <div className="pwm-title">
            <h2>
              <span className="acc">▌</span>Pair Win Matrix
            </h2>
            <span className="scope">{scopeLine}</span>
          </div>
        </header>
        <div className="pwm-ticker" />
        <div className="pwm-empty-state">No skaters with enough shared games yet.</div>
      </section>
    )
  }

  return (
    <section className="pwm-frame">
      <PhoneMatrix
        players={orderedPlayers}
        pairs={pairs}
        filteredPairs={filteredPairs}
        meta={phoneMeta}
        minPairGp={minPairGp}
        setMinPairGp={setMinPairGp}
        orderId={orderId}
        setOrderId={setOrderId}
        visiblePairCount={visiblePairCount}
        totalPairCount={totalPairCount}
      />
      {/* Desktop / tablet layout (hidden ≤720px, where PhoneMatrix shows). */}
      <div className="pwm-desk">
        <header className="pwm-head">
          <div className="pwm-title">
            <h2>
              <span className="acc">▌</span>Pair Win Matrix
            </h2>
            <span className="scope">{scopeLine}</span>
          </div>
          <div className="pwm-meta">
            <span>
              <b>{titleName}</b>
            </span>
            <span className="dot">·</span>
            <span>
              <b>{clubName}</b>
            </span>
            {updatedLabel ? (
              <>
                <span className="dot">·</span>
                <span>
                  Updated <b>{updatedLabel}</b>
                </span>
              </>
            ) : null}
          </div>
        </header>

        <div className="pwm-ticker" />

        <div className="pwm-caption">
          <span className="key">
            <b>Cell</b> · win % when paired
          </span>
          <span className="key">
            <b>Label</b> · W-L (OTL counted as L)
          </span>
          <span className="key">
            <b>TEAM</b> · player’s solo win %
          </span>
          <span className="key">
            <span className="pip" />
            <b>Diagonal</b> · same player
          </span>
        </div>

        <div className="pwm-controls">
          <span className="label">Min GP together</span>
          <span className={`value${minPairGp > 1 ? ' lead' : ''}`}>{String(minPairGp)}</span>
          <input
            type="range"
            className="slider"
            min={MIN_THRESHOLD}
            max={MAX_THRESHOLD}
            step={1}
            value={minPairGp}
            onChange={(e) => {
              setMinPairGp(Number(e.target.value))
            }}
            aria-label="Minimum games played together"
          />
          <span className="hint">
            {String(visiblePairCount)} pair{visiblePairCount === 1 ? '' : 's'} shown
          </span>

          <span className="divider" aria-hidden />

          <span className="label">Order by</span>
          <span className="seg" role="group" aria-label="Order matrix by">
            {ORDER_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                title={o.tooltip}
                aria-pressed={orderId === o.id}
                className={`seg-btn${orderId === o.id ? ' active' : ''}`}
                onClick={() => {
                  setOrderId(o.id)
                }}
              >
                {o.label}
              </button>
            ))}
          </span>

          <span className="divider" aria-hidden />

          <button
            type="button"
            aria-pressed={triOnly}
            title="Hide the upper triangle (matrix is symmetric)"
            className={`tri-btn${triOnly ? ' active' : ''}`}
            onClick={() => {
              setTriOnly((v) => !v)
            }}
          >
            ◣ {triOnly ? 'Triangle' : 'Full'}
          </button>
        </div>

        <div className="pwm-wrap">
          <div
            className={[
              'pwm-grid',
              hoverRow !== null ? 'hl-row' : '',
              hoverCol !== null ? 'hl-col' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={gridStyle}
            onMouseLeave={() => {
              setHoverRow(null)
              setHoverCol(null)
            }}
          >
            <div className="pwm-corner" />
            {orderedPlayers.map((p, i) => (
              <div
                key={`col-${String(p.playerId)}`}
                className={`pwm-col-label${hoverCol === i ? ' col-hi' : ''}`}
                title={playerTooltip(p)}
                onMouseEnter={() => {
                  setHoverCol(i)
                  setHoverRow(null)
                }}
              >
                {displayAlias(p.playerName, p.gamertag)}
              </div>
            ))}
            <div className="pwm-team-corner">TEAM</div>

            {orderedPlayers.map((rowP, r) => (
              <PlayerRow
                key={`row-${String(rowP.playerId)}`}
                rowIdx={r}
                rowPlayer={rowP}
                players={orderedPlayers}
                pairs={pairs}
                threshold={minPairGp}
                triOnly={triOnly}
                hoverRow={hoverRow}
                hoverCol={hoverCol}
                setHoverRow={setHoverRow}
                setHoverCol={setHoverCol}
              />
            ))}
          </div>
        </div>

        <div className="pwm-legend">
          <div className="pwm-scale-block">
            <div className="pwm-scale">
              <span>Low</span>
              <div className="gradient" />
              <span>High</span>
            </div>
            <div className="pwm-scale ticks">
              <span>0%</span>
              <span>50%</span>
              <span>70%</span>
              <span>100%</span>
            </div>
          </div>
          <div className="pwm-keys">
            <span className="pip-row pip-diag">
              <i />
              <b>Diagonal</b> · self
            </span>
            <span className="pip-row pip-empty">
              <i />
              <b>Empty</b> · 0 GP together
            </span>
            <span className="pip-row pip-dim">
              <i />
              <b>Dim</b> · below threshold
            </span>
            <span className="pip-row">
              <b>DNF</b> · excluded from win %
            </span>
          </div>
        </div>

        <footer className="pwm-foot">
          <span>
            Source <b>EA NHL · Boogeymen</b>
          </span>
        </footer>
      </div>
    </section>
  )
}

interface PlayerRowProps {
  rowIdx: number
  rowPlayer: PairWinMatrixPlayer
  players: PairWinMatrixPlayer[]
  /** Full pair map (pre-threshold). The row inspects `gp` itself so it can
   *  draw sub-threshold cells dimmed instead of as bare empties. */
  pairs: PairWinMatrixData['pairs']
  threshold: number
  triOnly: boolean
  hoverRow: number | null
  hoverCol: number | null
  setHoverRow: (n: number | null) => void
  setHoverCol: (n: number | null) => void
}

function PlayerRow({
  rowIdx,
  rowPlayer,
  players,
  pairs,
  threshold,
  triOnly,
  hoverRow,
  hoverCol,
  setHoverRow,
  setHoverCol,
}: PlayerRowProps) {
  const seat = String(rowIdx + 1).padStart(2, '0')
  return (
    <>
      <div
        className={`pwm-row-label${hoverRow === rowIdx ? ' row-hi' : ''}`}
        title={playerTooltip(rowPlayer)}
        onMouseEnter={() => {
          setHoverRow(rowIdx)
          setHoverCol(null)
        }}
      >
        <span>{displayAlias(rowPlayer.playerName, rowPlayer.gamertag)}</span>
        <span className="seat">{seat}</span>
      </div>
      {players.map((colP, c) => {
        const isUpper = c > rowIdx
        const hidden = triOnly && isUpper
        if (rowPlayer.playerId === colP.playerId) {
          return (
            <div
              key={`cell-${String(rowPlayer.playerId)}-${String(colP.playerId)}`}
              className={[
                'pwm-cell diag',
                hidden ? 'tri-hide' : '',
                hoverRow === rowIdx ? 'row-hi' : '',
                hoverCol === c ? 'col-hi' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseEnter={() => {
                setHoverRow(rowIdx)
                setHoverCol(c)
              }}
            />
          )
        }
        const minId = Math.min(rowPlayer.playerId, colP.playerId)
        const maxId = Math.max(rowPlayer.playerId, colP.playerId)
        const cell = pairs[`${String(minId)}-${String(maxId)}`]
        const isRowHi = hoverRow === rowIdx
        const isColHi = hoverCol === c
        if (!cell || cell.gp === 0) {
          return (
            <div
              key={`cell-${String(rowPlayer.playerId)}-${String(colP.playerId)}`}
              className={[
                'pwm-cell empty',
                hidden ? 'tri-hide' : '',
                isRowHi ? 'row-hi' : '',
                isColHi ? 'col-hi' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseEnter={() => {
                setHoverRow(rowIdx)
                setHoverCol(c)
              }}
            >
              <span className="em">—</span>
            </div>
          )
        }
        const belowThreshold = cell.gp < threshold
        const t = tier(cell.pct)
        const rec = recordString(cell)
        return (
          <div
            key={`cell-${String(rowPlayer.playerId)}-${String(colP.playerId)}`}
            className={[
              `pwm-cell t${String(t)}`,
              belowThreshold ? 'dim' : '',
              hidden ? 'tri-hide' : '',
              isRowHi ? 'row-hi' : '',
              isColHi ? 'col-hi' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            title={pairTooltip(rowPlayer.gamertag, colP.gamertag, cell, belowThreshold, threshold)}
            onMouseEnter={() => {
              setHoverRow(rowIdx)
              setHoverCol(c)
            }}
          >
            <span className="pct">{String(cell.pct)}%</span>
            <span className="rec">{rec}</span>
          </div>
        )
      })}
      {/* Row aggregate — player's solo team record across BGM matches. */}
      <div
        className={[
          'pwm-team-cell',
          `t${String(tier(rowPlayer.pct))}`,
          hoverRow === rowIdx ? 'row-hi' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        title={playerTooltip(rowPlayer)}
      >
        <span className="pct">{String(rowPlayer.pct)}%</span>
        <span className="rec">{recordString(rowPlayer)}</span>
      </div>
    </>
  )
}

// ─── Phone layout (≤720px) ────────────────────────────────────────────────────

/** Three-letter axis code from the short alias ("Orlov" → "ORL"). A clash
 *  falls back to first two letters + last letter ("Wang"/"Wanda" → "WAG"). */
function axisCodes(players: PairWinMatrixPlayer[]): Map<number, string> {
  const out = new Map<number, string>()
  const used = new Set<string>()
  for (const p of players) {
    const alias = displayAlias(p.playerName, p.gamertag)
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
    let code = alias.slice(0, 3)
    if (used.has(code) && alias.length > 3) code = alias.slice(0, 2) + alias.slice(-1)
    used.add(code)
    out.set(p.playerId, code || '?')
  }
  return out
}

function pairKey(a: number, b: number): string {
  return `${String(Math.min(a, b))}-${String(Math.max(a, b))}`
}

/** Signed point delta, "+10" / "−4" / "±0". */
function fmtDelta(d: number): string {
  if (d > 0) return `+${String(d)}`
  if (d < 0) return `−${String(Math.abs(d))}`
  return '±0'
}

function deltaClass(d: number): string {
  return d > 0 ? 'up' : d < 0 ? 'down' : 'flat'
}

/** Selection: a pair key ("12-40") or a single player id for a diagonal cell. */
type Selection = { kind: 'pair'; a: number; b: number } | { kind: 'solo'; id: number }

interface PhoneMatrixProps {
  /** Already ordered by the active Order-by option. */
  players: PairWinMatrixPlayer[]
  pairs: PairWinMatrixData['pairs']
  /** Matrix pairs at or above the min-GP threshold. */
  filteredPairs: PairWinMatrixData['pairs']
  meta: string
  minPairGp: number
  setMinPairGp: (n: number) => void
  orderId: OrderId
  setOrderId: (id: OrderId) => void
  visiblePairCount: number
  totalPairCount: number
}

/**
 * Lower-triangle matrix sized to fit a phone without sideways scroll. The
 * diagonal carries each player's solo win %; a tap on any cell fills the
 * detail card below. Shares min-GP / order state with the desktop grid.
 */
function PhoneMatrix({
  players,
  pairs,
  filteredPairs,
  meta,
  minPairGp,
  setMinPairGp,
  orderId,
  setOrderId,
  visiblePairCount,
  totalPairCount,
}: PhoneMatrixProps) {
  const [picked, setPicked] = useState<Selection | null>(null)
  const codes = useMemo(() => axisCodes(players), [players])
  const byId = useMemo(() => new Map(players.map((p) => [p.playerId, p])), [players])

  /** Until the user taps, show the best qualifying pair (highest win %, then
   *  most shared GP); with none qualifying, the most-played skater solo. */
  const selection: Selection | null = useMemo(() => {
    if (picked !== null) return picked
    let best: { key: string; pct: number; gp: number } | null = null
    for (const [key, c] of Object.entries(filteredPairs)) {
      if (best === null || c.pct > best.pct || (c.pct === best.pct && c.gp > best.gp)) {
        best = { key, pct: c.pct, gp: c.gp }
      }
    }
    if (best !== null) {
      const [a, b] = best.key.split('-').map(Number)
      if (a !== undefined && b !== undefined) {
        // Name the pair in matrix order (column player first), as a tap does.
        const ia = players.findIndex((p) => p.playerId === a)
        const ib = players.findIndex((p) => p.playerId === b)
        return ia <= ib ? { kind: 'pair', a, b } : { kind: 'pair', a: b, b: a }
      }
    }
    const first = players[0]
    return first ? { kind: 'solo', id: first.playerId } : null
  }, [picked, filteredPairs, players])

  const selIds = new Set<number>(
    selection === null
      ? []
      : selection.kind === 'pair'
        ? [selection.a, selection.b]
        : [selection.id],
  )
  const isSelPair = (a: number, b: number) =>
    selection?.kind === 'pair' && pairKey(selection.a, selection.b) === pairKey(a, b)

  const cols = `44px repeat(${String(players.length)}, minmax(0, 1fr))`
  const dense = players.length > 8

  return (
    <div className="pwm-phone">
      <div className="pwm-ph-ticker" aria-hidden />
      <div className="pwm-ph-body">
        <div className="pwm-ph-title">
          <h3>
            <span className="acc">▌</span>Pair Win Matrix
          </h3>
          <div className="meta">{meta}</div>
        </div>

        <div className="pwm-ph-min">
          <span className="pwm-ph-label">Min GP</span>
          <div className="stepper">
            <button
              type="button"
              className="step"
              aria-label="Decrease minimum games together"
              disabled={minPairGp <= MIN_THRESHOLD}
              onClick={() => {
                setMinPairGp(Math.max(MIN_THRESHOLD, minPairGp - 1))
              }}
            >
              −
            </button>
            <output aria-live="polite" aria-label="Minimum games together">
              {String(minPairGp)}
            </output>
            <button
              type="button"
              className="step"
              aria-label="Increase minimum games together"
              disabled={minPairGp >= MAX_THRESHOLD}
              onClick={() => {
                setMinPairGp(Math.min(MAX_THRESHOLD, minPairGp + 1))
              }}
            >
              +
            </button>
          </div>
          <span className="count">
            {String(visiblePairCount)} / {String(totalPairCount)} pairs
          </span>
        </div>

        <div className="pwm-ph-order">
          <span className="pwm-ph-label">Order by</span>
          <div role="group" aria-label="Order matrix by" className="segs">
            {ORDER_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                title={o.tooltip}
                aria-pressed={orderId === o.id}
                className={`seg${orderId === o.id ? ' on' : ''}`}
                onClick={() => {
                  setOrderId(o.id)
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div
          role="group"
          aria-label="Pair win matrix, lower triangle"
          className={`pwm-ph-grid${dense ? ' dense' : ''}`}
        >
          <div className="row head" style={{ gridTemplateColumns: cols }}>
            <div />
            {players.map((p) => (
              <div
                key={`c-${String(p.playerId)}`}
                className={`axis${selIds.has(p.playerId) ? ' hl' : ''}`}
                title={p.gamertag}
              >
                {codes.get(p.playerId)}
              </div>
            ))}
          </div>
          {players.map((rowP, r) => (
            <div
              key={`r-${String(rowP.playerId)}`}
              className="row"
              style={{ gridTemplateColumns: cols }}
            >
              <div
                className={`rowlab${selIds.has(rowP.playerId) ? ' hl' : ''}`}
                title={rowP.gamertag}
              >
                {codes.get(rowP.playerId)}
              </div>
              {players.map((colP, c) => {
                const k = `${String(rowP.playerId)}-${String(colP.playerId)}`
                if (c > r) return <div key={k} className="blank" />
                if (c === r) {
                  const on = selection?.kind === 'solo' && selection.id === rowP.playerId
                  return (
                    <button
                      key={k}
                      type="button"
                      className={`cell diag${on ? ' sel' : ''}`}
                      aria-pressed={on}
                      aria-label={`${rowP.gamertag} solo, ${String(rowP.pct)}%, ${recordString(rowP)}, ${String(rowP.gp)} GP`}
                      onClick={() => {
                        setPicked({ kind: 'solo', id: rowP.playerId })
                      }}
                    >
                      {String(rowP.pct)}
                    </button>
                  )
                }
                const cell = pairs[pairKey(rowP.playerId, colP.playerId)]
                if (!cell || cell.gp === 0) {
                  return (
                    <div
                      key={k}
                      className="cell empty"
                      aria-label={`${rowP.gamertag} + ${colP.gamertag}, no games together`}
                    >
                      —
                    </div>
                  )
                }
                const on = isSelPair(rowP.playerId, colP.playerId)
                const below = cell.gp < minPairGp
                return (
                  <button
                    key={k}
                    type="button"
                    className={`cell t${String(tier(cell.pct))}${below ? ' dim' : ''}${on ? ' sel' : ''}`}
                    aria-pressed={on}
                    aria-label={pairTooltip(rowP.gamertag, colP.gamertag, cell, below, minPairGp)}
                    onClick={() => {
                      setPicked({ kind: 'pair', a: colP.playerId, b: rowP.playerId })
                    }}
                  >
                    {String(cell.pct)}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {selection !== null ? (
          <PhoneDetail
            selection={selection}
            byId={byId}
            pairs={pairs}
            filteredPairs={filteredPairs}
            minPairGp={minPairGp}
          />
        ) : null}

        <div className="pwm-ph-legend">
          <div className="swatches" aria-hidden>
            {[0, 1, 2, 3, 4, 5].map((t) => (
              <i key={t} className={`t${String(t)}`} />
            ))}
          </div>
          <div className="ticks" aria-label="Colour scale: win % bands">
            <span>&lt;25</span>
            <span>25</span>
            <span>40</span>
            <span>50</span>
            <span>60</span>
            <span>70+</span>
          </div>
          <p className="keys">
            <b>Hatched</b> solo win % · <b>Dim</b> below min GP · <b>DNF</b> excluded from win %
          </p>
        </div>

        <footer className="pwm-ph-foot">
          Source <b>EA NHL · Boogeymen</b>
        </footer>
      </div>
    </div>
  )
}

interface PhoneDetailProps {
  selection: Selection
  byId: Map<number, PairWinMatrixPlayer>
  pairs: PairWinMatrixData['pairs']
  filteredPairs: PairWinMatrixData['pairs']
  minPairGp: number
}

/** Detail card under the phone matrix — the tapped pair (or solo player). */
function PhoneDetail({ selection, byId, pairs, filteredPairs, minPairGp }: PhoneDetailProps) {
  let kind: string
  let title: string
  let tags: string
  let stat: { pct: number; wins: number; losses: number; otl: number; gp: number; dnf: number }
  let below = false
  let lines: { label: string; mid: string; val: string; cls: string }[]

  if (selection.kind === 'pair') {
    const pa = byId.get(selection.a)
    const pb = byId.get(selection.b)
    const cell = pairs[pairKey(selection.a, selection.b)]
    if (!pa || !pb || !cell) return null
    const aliasA = displayAlias(pa.playerName, pa.gamertag)
    const aliasB = displayAlias(pb.playerName, pb.gamertag)
    kind = 'Selected pair'
    title = `${aliasA} + ${aliasB}`
    tags = `${pa.gamertag} · ${pb.gamertag}`
    stat = cell
    below = cell.gp < minPairGp
    lines = [
      { p: pa, alias: aliasA },
      { p: pb, alias: aliasB },
    ].map(({ p, alias }) => ({
      label: `vs ${alias} solo`,
      mid: `${String(p.pct)}%`,
      val: fmtDelta(cell.pct - p.pct),
      cls: deltaClass(cell.pct - p.pct),
    }))
  } else {
    const p = byId.get(selection.id)
    if (!p) return null
    kind = 'Solo · all games'
    title = displayAlias(p.playerName, p.gamertag)
    tags = p.gamertag
    stat = p
    const mates: { alias: string; cell: PairWinMatrixCell }[] = []
    for (const [key, cell] of Object.entries(filteredPairs)) {
      const [a, b] = key.split('-').map(Number)
      if (a !== p.playerId && b !== p.playerId) continue
      const mate = byId.get(a === p.playerId ? (b ?? -1) : (a ?? -1))
      if (mate) mates.push({ alias: displayAlias(mate.playerName, mate.gamertag), cell })
    }
    mates.sort((x, y) => y.cell.pct - x.cell.pct || y.cell.gp - x.cell.gp)
    const top = mates[0]
    const bottom = mates[mates.length - 1]
    lines =
      top && bottom
        ? [
            {
              label: `Best with ${top.alias}`,
              mid: recordString(top.cell),
              val: `${String(top.cell.pct)}%`,
              cls: 'up',
            },
            {
              label: `Worst with ${bottom.alias}`,
              mid: recordString(bottom.cell),
              val: `${String(bottom.cell.pct)}%`,
              cls: 'down',
            },
          ]
        : [{ label: 'No pair meets min GP', mid: '', val: '—', cls: 'flat' }]
  }

  return (
    <div className="pwm-ph-detail" aria-live="polite">
      <div className="top">
        <span className="kind">{kind}</span>
        {below ? <span className="chip">Below min GP</span> : null}
      </div>
      <div>
        <div className="name">{title}</div>
        <div className="tags">{tags}</div>
      </div>
      <div className="stats">
        <div>
          <span className="v acc">{String(stat.pct)}%</span>
          <span className="k">Win%</span>
        </div>
        <div>
          <span className="v">{recordString(stat)}</span>
          <span className="k">W–L</span>
        </div>
        <div>
          <span className="v">{String(stat.gp)}</span>
          <span className="k">GP</span>
        </div>
        <div>
          <span className="v soft">{String(stat.dnf)}</span>
          <span className="k">DNF excl.</span>
        </div>
      </div>
      <div className="lines">
        {lines.map((ln) => (
          <div key={ln.label} className="line">
            <span className="lab">{ln.label}</span>
            <span className="mid">{ln.mid}</span>
            <span className={`val ${ln.cls}`}>{ln.val}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
