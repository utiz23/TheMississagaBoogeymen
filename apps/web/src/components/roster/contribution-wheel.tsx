'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import './contribution-wheel.css'
import { formatDataDay } from '@/lib/format'

/** Subset of the EA season row needed to compute the wheel inputs. */
export interface ContributionWheelSeason {
  goals: number
  assists: number
  shots: number
  hits: number
  blockedShots: number
  takeaways: number
  faceoffWins: number
  pim: number
  giveaways: number
  gamesPlayed: number
  skaterGp: number
  goalieGp: number
  goalieSaves: number | null
  goalieGoalsAgainst: number | null
  goalieDesperationSaves: number | null
  goalieBrkSaves: number | null
  goaliePenSaves: number | null
  goaliePokeChecks: number | null
}

/** A teammate row used to rank the focal player on each stat. */
export interface ContributionWheelTeammate extends ContributionWheelSeason {
  playerId: number
}

interface Props {
  /** Which stat set drives the wheel (goalies: saves-based Game Score). */
  role?: 'skater' | 'goalie' | undefined
  season: ContributionWheelSeason
  /** Other team members in the same game title; drives `#X of Y` rank chips. */
  teammates?: ContributionWheelTeammate[] | undefined
  /** Player's own playerId so the rank computation can exclude themself. */
  playerId?: number | undefined
  gamertag?: string | undefined
  gameTitleName?: string | undefined
  /** Real freshness timestamp from the EA season row. */
  updatedAt?: Date | string | undefined
}

/**
 * Real Dom Luszczyszyn Game Score weights (per-stat coefficient, points).
 * Reference: https://hockey-graphs.com/2016/07/13/measuring-single-game-productivity-an-introduction-to-game-score/
 *
 * `extract` pulls the stat off a season row.
 * `sign` is +1 for positive contributors, −1 for liabilities (PIM, Giveaways).
 */
type StatId =
  | 'goals'
  | 'assists'
  | 'shots'
  | 'blocks'
  | 'takeaways'
  | 'hits'
  | 'faceoffWins'
  | 'pim'
  | 'giveaways'
  | 'saves'
  | 'despSaves'
  | 'brkSaves'
  | 'penSaves'
  | 'pokeChecks'
  | 'goalsAgainst'

interface StatDef {
  id: StatId
  name: string
  short: string
  /** Shorter label for the wheel callouts when `name` would clip at the edge. */
  callout?: string
  color: string
  weight: number
  sign: 1 | -1
  extract: (s: ContributionWheelSeason) => number
}

const SKATER_STATS: StatDef[] = [
  {
    id: 'goals',
    name: 'Goals',
    short: 'G',
    color: '#e84131',
    weight: 0.75,
    sign: 1,
    extract: (s) => s.goals,
  },
  {
    id: 'assists',
    name: 'Assists',
    short: 'A',
    color: '#38bdf8',
    weight: 0.7,
    sign: 1,
    extract: (s) => s.assists,
  },
  {
    id: 'shots',
    name: 'Shots',
    short: 'SH',
    color: '#14b8a6',
    weight: 0.075,
    sign: 1,
    extract: (s) => s.shots,
  },
  {
    id: 'blocks',
    name: 'Blocks',
    short: 'BL',
    color: '#ece335',
    weight: 0.05,
    sign: 1,
    extract: (s) => s.blockedShots,
  },
  {
    id: 'takeaways',
    name: 'Takeaways',
    short: 'TK',
    color: '#22c55e',
    weight: 0.05,
    sign: 1,
    extract: (s) => s.takeaways,
  },
  {
    id: 'hits',
    name: 'Hits',
    short: 'H',
    color: '#fb923c',
    weight: 0.05,
    sign: 1,
    extract: (s) => s.hits,
  },
  {
    id: 'faceoffWins',
    name: 'Faceoffs Won',
    short: 'FOW',
    color: '#a855f7',
    weight: 0.01,
    sign: 1,
    extract: (s) => s.faceoffWins,
  },
  {
    id: 'giveaways',
    name: 'Giveaways',
    short: 'GA',
    color: '#f87171',
    weight: 0.05,
    sign: -1,
    extract: (s) => s.giveaways,
  },
  {
    id: 'pim',
    name: 'Penalty Minutes',
    short: 'PIM',
    color: '#f97316',
    weight: 0.15,
    sign: -1,
    extract: (s) => s.pim,
  },
]

/**
 * Goalies: Luszczyszyn's goalie Game Score (Saves 0.10, Goals Against −0.75)
 * plus the site's own bonuses for hard saves (lib/match-recap goalie model),
 * so the wheel has more than one slice. Breakaway/penalty/desperation saves
 * are also inside Saves — the bonus is on top, as in the per-game model.
 */
const GOALIE_STATS: StatDef[] = [
  {
    id: 'saves',
    name: 'Saves',
    short: 'SV',
    color: '#38bdf8',
    weight: 0.1,
    sign: 1,
    extract: (s) => s.goalieSaves ?? 0,
  },
  {
    id: 'despSaves',
    name: 'Desperation Saves',
    short: 'DSV',
    callout: 'Desperation',
    color: '#e84131',
    weight: 0.5,
    sign: 1,
    extract: (s) => s.goalieDesperationSaves ?? 0,
  },
  {
    id: 'brkSaves',
    name: 'Breakaway Saves',
    short: 'BKS',
    callout: 'Breakaways',
    color: '#14b8a6',
    weight: 0.8,
    sign: 1,
    extract: (s) => s.goalieBrkSaves ?? 0,
  },
  {
    id: 'penSaves',
    name: 'Penalty-Shot Saves',
    short: 'PSS',
    callout: 'Pen. Shots',
    color: '#ece335',
    weight: 0.8,
    sign: 1,
    extract: (s) => s.goaliePenSaves ?? 0,
  },
  {
    id: 'pokeChecks',
    name: 'Pokechecks',
    short: 'PK',
    color: '#a855f7',
    weight: 0.15,
    sign: 1,
    extract: (s) => s.goaliePokeChecks ?? 0,
  },
  {
    id: 'goalsAgainst',
    name: 'Goals Against',
    short: 'GA',
    color: '#f87171',
    weight: 0.75,
    sign: -1,
    extract: (s) => s.goalieGoalsAgainst ?? 0,
  },
]

const CX = 210
const CY = 210
/** SVG coordinates to 2 decimals: server and browser trig can differ in the
 *  last digit, which broke hydration on every profile. */
const px = (n: number) => Math.round(n * 100) / 100
/** Callout name: 10px condensed caps with tracking ≈ 7.4 units a character
 *  (measured: "GOALS" = 37). The frame leaves ~24 units beside the drawing. */
const CALLOUT_CHAR_W = 7.4
const CALLOUT_MARGIN = 24
const R_OUTER = 170
const R_INNER = 110

interface EnrichedStat extends StatDef {
  total: number
  imp: number
  pct: number
  pg: number
  rank?: { rank: number; total: number } | undefined
}

export function ContributionWheel({
  role = 'skater',
  season,
  teammates,
  playerId,
  gamertag = 'player',
  gameTitleName = 'NHL 26',
  updatedAt,
}: Props) {
  const updatedLabel = useMemo(() => formatDataDay(updatedAt), [updatedAt])
  const goalie = role === 'goalie'
  const statDefs = goalie ? GOALIE_STATS : SKATER_STATS
  const gp = goalie ? season.goalieGp : season.skaterGp || season.gamesPlayed || 0
  const lowSample = gp > 0 && gp < 10

  /** Positive segments only — these define the wheel's geometry/share %. */
  const positives = useMemo<EnrichedStat[]>(() => {
    return statDefs
      .filter((d) => d.sign === 1)
      .map((d) => buildEnriched(d, season, gp, teammates, playerId, role))
      .filter((s) => s.imp > 0)
      .sort((a, b) => b.imp - a.imp)
  }, [statDefs, season, gp, teammates, playerId, role])

  /** Negative liabilities — rendered in their own ledger group, NOT in the
   *  wheel (they reduce the net score but don't take up share-of-impact slices). */
  const negatives = useMemo<EnrichedStat[]>(() => {
    return statDefs
      .filter((d) => d.sign === -1)
      .map((d) => buildEnriched(d, season, gp, teammates, playerId, role))
      .filter((s) => s.total > 0)
      .sort((a, b) => b.total * b.weight - a.total * a.weight)
  }, [statDefs, season, gp, teammates, playerId, role])

  /** Total positive / negative / net contribution in Game Score units. */
  const totals = useMemo(() => {
    const pos = positives.reduce((sum, s) => sum + s.imp, 0)
    const neg = negatives.reduce((sum, s) => sum + s.imp, 0) // imp is signed
    return { pos, neg, net: pos + neg }
  }, [positives, negatives])

  // share % is share of POSITIVE impact (so the wheel's slices sum to 100%).
  const sumPos = totals.pos
  const positivesWithShare = useMemo(
    () =>
      positives.map((s) => ({
        ...s,
        pct: sumPos > 0 ? (s.imp / sumPos) * 100 : 0,
      })),
    [positives, sumPos],
  )

  const lead = positivesWithShare[0]
  const [activeId, setActiveId] = useState<StatId | null>(null)
  const [lockedId, setLockedId] = useState<StatId | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // ESC unlocks; click-outside also unlocks.
  useEffect(() => {
    if (lockedId === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLockedId(null)
        setActiveId(null)
      }
    }
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setLockedId(null)
        setActiveId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onDoc)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onDoc)
    }
  }, [lockedId])

  const effectiveActiveId = lockedId ?? activeId

  if (!lead || sumPos <= 0) {
    return (
      <section className="cw-frame">
        <Notches />
        <header className="cw-head">
          <div>
            <h2>
              <span className="accent">▌</span>Contribution
              <span className="cw-h2-tail"> Wheel</span>
            </h2>
            <span className="scope">{gameTitleName}</span>
          </div>
        </header>
        <div className="cw-ticker" />
        <p className="cw-empty">Not enough season data to build a contribution wheel yet.</p>
      </section>
    )
  }

  const focused: EnrichedStat =
    (effectiveActiveId !== null
      ? [...positivesWithShare, ...negatives].find((s) => s.id === effectiveActiveId)
      : null) ?? lead

  // Build wheel arcs from positive segments only.
  const TWO_PI = Math.PI * 2
  const GAP = 0.012 // radians between segments
  let acc = -Math.PI / 2 // start at top
  const segments = positivesWithShare.map((s) => {
    const slice = (s.pct / 100) * TWO_PI
    const a1 = acc + GAP / 2
    const a2 = acc + Math.max(slice - GAP / 2, GAP / 2 + 0.001)
    const am = (a1 + a2) / 2
    const d = arcPath(CX, CY, R_OUTER, R_INNER, a1, a2)
    acc += slice
    return { ...s, a1, a2, am, d }
  })

  // Top-3 callouts (by share).
  const callouts = segments.slice(0, 3).map((s) => {
    const r1 = R_OUTER + 4
    const r2 = R_OUTER + 22
    const x1 = px(CX + Math.cos(s.am) * r1)
    const y1 = px(CY + Math.sin(s.am) * r1)
    const x2 = px(CX + Math.cos(s.am) * r2)
    const y2 = px(CY + Math.sin(s.am) * r2)
    const tx = px(CX + Math.cos(s.am) * (r2 + 10))
    const ty = px(CY + Math.sin(s.am) * (r2 + 10))
    const cosAm = Math.cos(s.am)
    const anchor: 'start' | 'middle' | 'end' =
      cosAm > 0.2 ? 'start' : cosAm < -0.2 ? 'end' : 'middle'
    const dx = anchor === 'start' ? 4 : anchor === 'end' ? -4 : 0
    const x = tx + dx
    // A side label that would run past the frame (CALLOUT_MARGIN) falls back
    // to its short callout, then its stat code.
    const fits = (label: string) => {
      const w = label.length * CALLOUT_CHAR_W
      const left = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x
      return left >= -CALLOUT_MARGIN && left + w <= 420 + CALLOUT_MARGIN
    }
    const label = [s.name, s.callout, s.short].find((l): l is string => l !== undefined && fits(l))
    return { ...s, x1, y1, x2, y2, tx: x, ty, anchor, label: label ?? s.short }
  })

  const maxImpAll = Math.max(
    ...positivesWithShare.map((s) => s.imp),
    ...negatives.map((s) => Math.abs(s.imp)),
    1,
  )

  // Micro tier (≤480px) shows only the top 3 ledger rows; everything below
  // folds into one summary row. Hidden by CSS on wider tiers.
  const minor = positivesWithShare.slice(3)
  const minorImp = minor.reduce((sum, s) => sum + s.imp, 0)
  const minorPct = minor.reduce((sum, s) => sum + s.pct, 0)

  const onSelect = (id: StatId) => {
    if (lockedId === id) {
      setLockedId(null)
      setActiveId(null)
    } else {
      setLockedId(id)
      setActiveId(id)
    }
  }

  return (
    <section className="cw-frame" ref={containerRef}>
      <Notches />

      <header className="cw-head">
        <div>
          <h2>
            <span className="accent">▌</span>Contribution<span className="cw-h2-tail"> Wheel</span>
          </h2>
          <span className="scope">
            Game-Score share · {role} · {gamertag}
          </span>
        </div>
        <div className="cw-meta">
          <span>
            <b>{gameTitleName}</b>
          </span>
          <span className="dot">·</span>
          <span>{String(gp)} GP</span>
          <span className="dot updated">·</span>
          <span className="updated">
            Updated <b>{updatedLabel}</b>
          </span>
        </div>
      </header>

      <div className="cw-ticker" />

      <div className="cw-main">
        {/* Wheel */}
        <div className="cw-wheel-col">
          <div className={`cw-wheel-wrap${effectiveActiveId !== null ? ' dim' : ''}`}>
            <span className="cw-corners">
              <i className="tl" />
              <i className="tr" />
              <i className="bl" />
              <i className="br" />
            </span>
            <svg
              viewBox="0 0 420 420"
              role="img"
              aria-label={`Contribution wheel — ${String(positivesWithShare.length)} positive contributors, ${totals.net.toFixed(1)} net Game Score`}
            >
              {/* Inner faint track ring */}
              <circle
                cx={CX}
                cy={CY}
                r={(R_OUTER + R_INNER) / 2}
                fill="none"
                stroke="rgba(73,71,72,0.18)"
                strokeWidth={R_OUTER - R_INNER}
              />

              {/* Tick ring */}
              <TickRing />

              {/* Cardinal labels */}
              {(['0', '25', '50', '75'] as const).map((label, i) => {
                const a = (i / 4) * TWO_PI - Math.PI / 2
                const r = 202
                return (
                  <text
                    key={label}
                    className="cw-cardinal-label"
                    x={px(CX + Math.cos(a) * r)}
                    y={px(CY + Math.sin(a) * r) + 3}
                    textAnchor="middle"
                  >
                    {label}%
                  </text>
                )
              })}

              {/* Arc segments */}
              {segments.map((s) => (
                <path
                  key={s.id}
                  className={`cw-seg${effectiveActiveId === s.id ? ' active' : ''}`}
                  d={s.d}
                  fill={s.color}
                  stroke="rgba(0,0,0,0.5)"
                  strokeWidth={1}
                  style={cssVars(s.color)}
                  role="button"
                  aria-label={segmentAria(s)}
                  aria-pressed={lockedId === s.id}
                  tabIndex={0}
                  onMouseEnter={() => {
                    setActiveId(s.id)
                  }}
                  onMouseLeave={() => {
                    setActiveId(null)
                  }}
                  onFocus={() => {
                    setActiveId(s.id)
                  }}
                  onBlur={() => {
                    setActiveId(null)
                  }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelect(s.id)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect(s.id)
                    }
                  }}
                />
              ))}

              {/* Inner hub */}
              <circle
                cx={CX}
                cy={CY}
                r={R_INNER - 6}
                fill="rgba(0,0,0,0.55)"
                stroke="rgba(73,71,72,0.6)"
                strokeWidth={1}
              />
              <circle
                cx={CX}
                cy={CY}
                r={R_INNER - 12}
                fill="none"
                stroke="rgba(232,65,49,0.20)"
                strokeDasharray="2 4"
              />

              {/* Top-3 callouts */}
              {callouts.map((c) => (
                <g key={c.id} style={cssVars(c.color)}>
                  <line className="cw-callout-line" x1={c.x1} y1={c.y1} x2={c.x2} y2={c.y2} />
                  <text className="cw-callout-pct" x={c.tx} y={c.ty} textAnchor={c.anchor}>
                    {c.pct.toFixed(0)}%
                  </text>
                  <text className="cw-callout-name" x={c.tx} y={c.ty + 12} textAnchor={c.anchor}>
                    {c.label.toUpperCase()}
                  </text>
                </g>
              ))}
            </svg>

            {/* Center overlay */}
            <div className="cw-center">
              <div className="small-lab">
                {effectiveActiveId === null ? 'Net Game Score' : focused.name}
              </div>
              <div className="big">
                {effectiveActiveId === null ? splitDecimal(totals.net) : splitDecimal(focused.imp)}
              </div>
              <div className="unit">
                {effectiveActiveId === null
                  ? `Game Score · ${String(gp)} GP`
                  : focused.sign < 0
                    ? 'Liability'
                    : `${focused.pct.toFixed(0)}% share`}
              </div>
              <div className="row-meta">
                {effectiveActiveId === null ? (
                  <>
                    <span>
                      <b className="pos">+{totals.pos.toFixed(1)}</b> positive
                    </span>
                    <span className="sep" />
                    <span>
                      <b className="neg">−{Math.abs(totals.neg).toFixed(1)}</b> liabilities
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      <b>{formatCount(focused.total)}</b> total
                    </span>
                    <span className="sep" />
                    <span>
                      <b>{focused.pg.toFixed(2)}</b>/g
                    </span>
                    {focused.rank ? (
                      <>
                        <span className="sep" />
                        <span>
                          <b>#{String(focused.rank.rank)}</b> of {String(focused.rank.total)}
                        </span>
                      </>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Ledger */}
        <div className="cw-legend">
          <div className="cw-leg-head">
            <span>
              <b>Stat Ledger</b> · sorted by impact
              {/* The click-to-lock was undiscoverable (polish backlog). */}
              <span className="cw-leg-hint"> · click a stat to pin it</span>
            </span>
            <span>RANK · TOTAL · /GM · IMPACT</span>
          </div>

          {positivesWithShare.map((s, i) => (
            <LedgerRow
              key={s.id}
              stat={s}
              rankIndex={i}
              maxImp={maxImpAll}
              active={effectiveActiveId === s.id}
              locked={lockedId === s.id}
              onEnter={() => {
                setActiveId(s.id)
              }}
              onLeave={() => {
                setActiveId(null)
              }}
              onSelect={() => {
                onSelect(s.id)
              }}
            />
          ))}

          {minor.length > 0 ? (
            <div className="cw-leg-row cw-leg-other" style={cssVars('#6b6869')}>
              <div className="name">
                <span className="lbl">Other {String(minor.length)}</span>
              </div>
              <span className="share">{minorPct.toFixed(1)}%</span>
              <span className="imp">{minorImp.toFixed(1)}</span>
              <span className="bar">
                <i style={{ width: `${((minorImp / maxImpAll) * 100).toFixed(1)}%` }} />
              </span>
            </div>
          ) : null}

          {negatives.length > 0 ? (
            <>
              <div className="cw-leg-divider">
                <span>Liabilities</span>
                <span className="rule" />
                <span className="hint">subtract from net Game Score</span>
              </div>
              {negatives.map((s) => (
                <LedgerRow
                  key={s.id}
                  stat={s}
                  rankIndex={null}
                  maxImp={maxImpAll}
                  active={effectiveActiveId === s.id}
                  locked={lockedId === s.id}
                  onEnter={() => {
                    setActiveId(s.id)
                  }}
                  onLeave={() => {
                    setActiveId(null)
                  }}
                  onSelect={() => {
                    onSelect(s.id)
                  }}
                  negative
                />
              ))}
            </>
          ) : null}
        </div>
      </div>

      {/* Micro tier (≤480px): liabilities collapse to a one-line strip. */}
      {negatives.length > 0 ? (
        <div className="cw-liab-strip">
          <span className="lab">Liabilities</span>
          <span className="vals">
            {negatives.map((s) => (
              <span key={s.id} style={cssVars(s.color)}>
                {s.short} <b>−{Math.abs(s.imp).toFixed(1)}</b>
              </span>
            ))}
          </span>
        </div>
      ) : null}

      <div className="cw-cap">
        <svg
          className="ic"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </svg>
        <span>
          {goalie
            ? 'Game Score weights — Saves 0.10 (Luszczyszyn) plus bonuses for hard saves: Desperation 0.50, Breakaway 0.80, Penalty Shot 0.80, Pokechecks 0.15. Goals Against (−0.75) reduces the net score.'
            : 'Game Score weights — Goals 0.75, Assists 0.70, Shots 0.075, Blocks/Takeaways/Hits 0.05, Faceoffs Won 0.01. Penalty Minutes (−0.15) and Giveaways (−0.05) reduce the net score.'}{' '}
          Wheel slices show share of <b>positive</b> impact only; the center number reflects net
          Game Score over {String(gp)} GP.
          {lowSample ? (
            <>
              {' '}
              <b className="cw-warn">Sample: {String(gp)} GP — projections refine after ~15.</b>
            </>
          ) : null}
        </span>
      </div>

      <footer className="cw-foot">
        <span>
          Source <b>EA NHL · Boogeymen</b>
        </span>
        <span>
          Method <b>Σ(stat × Game Score weight × sign)</b>
        </span>
      </footer>
    </section>
  )
}

// ─── Ledger row ─────────────────────────────────────────────────────────────

function LedgerRow({
  stat,
  rankIndex,
  maxImp,
  active,
  locked,
  onEnter,
  onLeave,
  onSelect,
  negative = false,
}: {
  stat: EnrichedStat
  rankIndex: number | null
  maxImp: number
  active: boolean
  locked: boolean
  onEnter: () => void
  onLeave: () => void
  onSelect: () => void
  negative?: boolean
}) {
  const barPct = maxImp > 0 ? (Math.abs(stat.imp) / maxImp) * 100 : 0
  return (
    <div
      className={[
        'cw-leg-row',
        active ? 'active' : '',
        locked ? 'locked' : '',
        negative ? 'negative' : '',
        rankIndex !== null && rankIndex >= 3 ? 'minor' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={cssVars(stat.color)}
      role="button"
      aria-pressed={locked}
      tabIndex={0}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onFocus={onEnter}
      onBlur={onLeave}
      onClick={(e) => {
        e.stopPropagation()
        onSelect()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <span className="rank">
        {rankIndex !== null ? String(rankIndex + 1).padStart(2, '0') : '—'}
      </span>
      <div className="name">
        <span className="lbl">{stat.name}</span>
        <span className="sub">
          {stat.pg.toFixed(2)} / GM
          {stat.rank ? (
            <>
              {' · '}#{String(stat.rank.rank)} of {String(stat.rank.total)}
            </>
          ) : null}
          {!negative && stat.pct > 0 ? <> · {stat.pct.toFixed(1)}% SHARE</> : null}
        </span>
      </div>
      <span className="total">{formatCount(stat.total)}</span>
      <span className="pg">{stat.pg.toFixed(2)}</span>
      {!negative ? <span className="share">{stat.pct.toFixed(1)}%</span> : null}
      <span className="imp">
        {negative ? '−' : ''}
        {Math.abs(stat.imp).toFixed(1)}
      </span>
      <span className="bar">
        <i style={{ width: `${barPct.toFixed(1)}%` }} />
      </span>
    </div>
  )
}

// ─── Static SVG bits ────────────────────────────────────────────────────────

const TICK_LINES = (() => {
  const lines: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = []
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2 - Math.PI / 2
    const major = i % 6 === 0
    const ri = major ? 176 : 178
    const ro = major ? 193 : 190
    lines.push({
      x1: px(CX + Math.cos(a) * ri),
      y1: px(CY + Math.sin(a) * ri),
      x2: px(CX + Math.cos(a) * ro),
      y2: px(CY + Math.sin(a) * ro),
      major,
    })
  }
  return lines
})()

function TickRing() {
  return (
    <g>
      {TICK_LINES.map((t, i) => (
        <line
          key={i}
          className={t.major ? 'cw-tick-major' : 'cw-tick-line'}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
        />
      ))}
    </g>
  )
}

function Notches() {
  return (
    <>
      <span className="cw-notch tl" />
      <span className="cw-notch tr" />
      <span className="cw-notch bl" />
      <span className="cw-notch br" />
    </>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildEnriched(
  d: StatDef,
  s: ContributionWheelSeason,
  gp: number,
  teammates: ContributionWheelTeammate[] | undefined,
  playerId: number | undefined,
  role: 'skater' | 'goalie',
): EnrichedStat {
  const total = d.extract(s)
  const imp = total * d.weight * d.sign
  const pg = gp > 0 ? total / gp : 0
  const rank = teammates ? computeRank(d, total, teammates, playerId, role) : undefined
  return { ...d, total, imp, pct: 0, pg, rank: rank ?? undefined }
}

/** Rank focal player vs all teammates with ≥1 GP for this stat. For "lower is
 *  better" (negative-sign) stats, ranking is ascending so #1 = fewest. */
function computeRank(
  d: StatDef,
  focalValue: number,
  teammates: ContributionWheelTeammate[],
  playerId: number | undefined,
  role: 'skater' | 'goalie',
): { rank: number; total: number } | null {
  // Ranked against teammates in the same role (goalies vs goalies).
  const others = teammates.filter(
    (t) =>
      (role === 'goalie' ? t.goalieGp : t.skaterGp) > 0 &&
      (playerId === undefined || t.playerId !== playerId),
  )
  if (others.length === 0) return null
  let strictlyBetter = 0
  for (const t of others) {
    const v = d.extract(t)
    if (d.sign === 1 ? v > focalValue : v < focalValue) strictlyBetter += 1
  }
  return { rank: strictlyBetter + 1, total: others.length + 1 }
}

function arcPath(cx: number, cy: number, rO: number, rI: number, a1: number, a2: number): string {
  const large = a2 - a1 > Math.PI ? 1 : 0
  const x1o = px(cx + Math.cos(a1) * rO)
  const y1o = px(cy + Math.sin(a1) * rO)
  const x2o = px(cx + Math.cos(a2) * rO)
  const y2o = px(cy + Math.sin(a2) * rO)
  const x1i = px(cx + Math.cos(a2) * rI)
  const y1i = px(cy + Math.sin(a2) * rI)
  const x2i = px(cx + Math.cos(a1) * rI)
  const y2i = px(cy + Math.sin(a1) * rI)
  return `M ${String(x1o)} ${String(y1o)} A ${String(rO)} ${String(rO)} 0 ${String(large)} 1 ${String(x2o)} ${String(y2o)} L ${String(x1i)} ${String(y1i)} A ${String(rI)} ${String(rI)} 0 ${String(large)} 0 ${String(x2i)} ${String(y2i)} Z`
}

function hexRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `${String((n >> 16) & 255)},${String((n >> 8) & 255)},${String(n & 255)}`
}

function cssVars(color: string): React.CSSProperties {
  return {
    ['--c' as never]: color,
    ['--c-rgb' as never]: hexRgb(color),
  } as React.CSSProperties
}

function formatCount(v: number): string {
  return v.toLocaleString('en-US')
}

function splitDecimal(v: number): React.ReactNode {
  const sign = v < 0 ? '−' : ''
  const abs = Math.abs(v)
  const intPart = Math.floor(abs)
  const dec = (abs - intPart).toFixed(1).slice(1) // ".4"
  return (
    <>
      {sign}
      {intPart}
      <small>{dec}</small>
    </>
  )
}

function segmentAria(s: EnrichedStat): string {
  const rank = s.rank ? `, ranked ${String(s.rank.rank)} of ${String(s.rank.total)}` : ''
  return `${s.name}: ${formatCount(s.total)} total, ${s.pg.toFixed(2)} per game, ${s.pct.toFixed(0)}% impact share, ${s.imp.toFixed(1)} Game Score${rank}`
}
