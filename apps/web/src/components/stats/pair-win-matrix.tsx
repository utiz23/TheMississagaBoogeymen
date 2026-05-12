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
  /** Footer sheet ID. */
  sheetCode?: string | undefined
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
  return `${String(c.wins)}-${String(c.losses + c.otl)}`
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
  sheetCode = 'BGM/PAIR/0001',
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
  const filteredPairs = useMemo(() => {
    if (minPairGp <= 1) return pairs
    const out: typeof pairs = {}
    for (const [k, v] of Object.entries(pairs)) {
      if (v.gp >= minPairGp) out[k] = v
    }
    return out
  }, [pairs, minPairGp])

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
        list.sort(
          (a, b) => b.pct - a.pct || b.gp - a.gp || a.gamertag.localeCompare(b.gamertag),
        )
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
  const visiblePairCount = useMemo(
    () => Object.keys(filteredPairs).length,
    [filteredPairs],
  )

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
        <span className="seg" role="tablist" aria-label="Order matrix by">
          {ORDER_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              role="tab"
              title={o.tooltip}
              aria-selected={orderId === o.id}
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
        <span>
          Sheet <b>{sheetCode}</b>
        </span>
      </footer>
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
