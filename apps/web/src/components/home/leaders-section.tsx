'use client'

import { useState } from 'react'
import Link from 'next/link'
import { PlayerLink } from '@/components/ui/player-link'
import type { GameMode } from '@eanhl/db'
import { formatPosition, formatSavePct } from '@/lib/format'
import './leaders-section.css'

/** Structural row that satisfies both `getRoster` and `getEARoster` outputs. */
export interface ScoringLeaderRow {
  playerId: number
  gamertag: string
  position: string | null
  favoritePosition: string | null
  jerseyNumber: number | null
  goals: number
  assists: number
  points: number
  skaterGp: number
  goalieGp: number
  goalieWins: number | null
  savePct: string | null
}

interface ScoringLeadersPanelProps {
  /** Top scorers (skaters), pre-sorted by points desc. */
  pointsLeaders: ScoringLeaderRow[]
  /** Top goal-scorers (skaters), pre-sorted by goals desc. */
  goalsLeaders: ScoringLeaderRow[]
  /** Goalies (any with goalieGp > 0). The component splits W and SV%. */
  goalieLeaders?: ScoringLeaderRow[] | undefined
  gameMode?: GameMode | null
  source?: string
  /** Total team GP for the footer caption. */
  teamGp?: number | undefined
}

type View = 'skaters' | 'goalies'
/** Which of the two columns the phone tab bar shows (0 = left, 1 = right). */
type Tab = 0 | 1
const ROWS_VISIBLE = 6

interface ColumnSpec {
  eyebrow: string
  listLabel: string
  listPip: string
  spotlightStats: (r: ScoringLeaderRow) => SpotlightStat[]
  rows: ScoringLeaderRow[]
  valueOf: (r: ScoringLeaderRow) => number | string
  /** Numeric value for the phone list's bar (value / leader value). */
  barOf: (r: ScoringLeaderRow) => number
}

/**
 * Scoring Leaders frame — broadcast-style "▌ Scoring · Points" module with
 * Skaters/Goalies tab toggle, two side-by-side columns (each = 200px spotlight
 * + ranked top-6 list), and a "View all →" footer.
 *
 * In skaters mode: Points leader column + Goals leader column.
 * In goalies mode: Wins leader column + Save % leader column.
 *
 * Phones (≤720px) show one column at a time: a Points/Goals (or Wins/Save %)
 * tab bar picks it. Above 720px the tab bar is hidden and both columns show.
 */
export function ScoringLeadersPanel({
  pointsLeaders,
  goalsLeaders,
  goalieLeaders = [],
  gameMode,
  source,
  teamGp,
}: ScoringLeadersPanelProps) {
  const [view, setView] = useState<View>('skaters')
  const [tab, setTab] = useState<Tab>(0)

  const hasGoalies = goalieLeaders.length > 0
  const hasSkaters = pointsLeaders.length > 0 || goalsLeaders.length > 0
  if (!hasSkaters && !hasGoalies) return null

  const winsBoard = [...goalieLeaders]
    .sort((a, b) => (b.goalieWins ?? 0) - (a.goalieWins ?? 0))
    .slice(0, ROWS_VISIBLE)
  const savePctBoard = [...goalieLeaders]
    .sort((a, b) => parseFloat(b.savePct ?? '0') - parseFloat(a.savePct ?? '0'))
    .slice(0, ROWS_VISIBLE)

  const columns: [ColumnSpec, ColumnSpec] =
    view === 'skaters'
      ? [
          {
            eyebrow: 'Points Leader',
            listLabel: 'Points',
            listPip: 'PTS',
            spotlightStats: (r) => [
              { label: 'PTS', value: r.points, lead: true },
              { label: 'G', value: r.goals },
              { label: 'A', value: r.assists },
            ],
            rows: pointsLeaders.slice(0, ROWS_VISIBLE),
            valueOf: (r) => r.points,
            barOf: (r) => r.points,
          },
          {
            eyebrow: 'Goals Leader',
            listLabel: 'Goals',
            listPip: 'G',
            spotlightStats: (r) => [
              { label: 'G', value: r.goals, lead: true },
              { label: 'A', value: r.assists },
              { label: 'PTS', value: r.points },
            ],
            rows: goalsLeaders.slice(0, ROWS_VISIBLE),
            valueOf: (r) => r.goals,
            barOf: (r) => r.goals,
          },
        ]
      : [
          {
            eyebrow: 'Wins Leader',
            listLabel: 'Wins',
            listPip: 'W',
            spotlightStats: (r) => [
              { label: 'W', value: r.goalieWins ?? 0, lead: true },
              { label: 'GP', value: r.goalieGp },
              { label: 'SV%', value: formatSavePct(r.savePct) },
            ],
            rows: winsBoard,
            valueOf: (r) => r.goalieWins ?? 0,
            barOf: (r) => r.goalieWins ?? 0,
          },
          {
            eyebrow: 'Save % Leader',
            listLabel: 'Save %',
            listPip: 'SV%',
            spotlightStats: (r) => [
              { label: 'SV%', value: formatSavePct(r.savePct), lead: true },
              { label: 'W', value: r.goalieWins ?? 0 },
              { label: 'GP', value: r.goalieGp },
            ],
            rows: savePctBoard,
            valueOf: (r) => formatSavePct(r.savePct),
            barOf: (r) => parseFloat(r.savePct ?? '0'),
          },
        ]

  const titleWord = view === 'skaters' ? 'Scoring' : 'Goaltending'
  // "Goaltending · Save %" does not fit beside the toggle on a phone.
  const titleWordShort = view === 'skaters' ? 'Scoring' : 'Goalies'
  // Desktop never changes `tab` (its tab bar is hidden), so it keeps the
  // first column's metric; phones name the tab they show.
  const titleMetric = columns[tab].listLabel

  const ctaHref = gameMode != null ? `/stats?mode=${gameMode}` : '/stats'
  const modeLabel = gameMode ?? 'All Modes'

  return (
    <section className="sl-frame">
      <div className="sl-ticker" />

      <header className="sl-head">
        <span className="sl-title">
          <span className="accent">▌</span>
          <span className="word-long">{titleWord}</span>
          <span className="word-short">{titleWordShort}</span>
          <span className="sep">·</span>
          <span className="metric">{titleMetric}</span>
        </span>
        <div className="sl-right">
          <div className="sl-group" role="group" aria-label="Leaders view">
            <button
              type="button"
              aria-pressed={view === 'skaters'}
              onClick={() => {
                setView('skaters')
              }}
            >
              Skaters
            </button>
            <button
              type="button"
              aria-pressed={view === 'goalies'}
              disabled={!hasGoalies}
              onClick={() => {
                if (hasGoalies) setView('goalies')
              }}
            >
              Goalies
            </button>
          </div>
        </div>
      </header>

      <div className="sl-tabs" role="tablist" aria-label="Metric">
        {columns.map((c, i) => (
          <button
            key={c.listLabel}
            type="button"
            role="tab"
            aria-selected={tab === i}
            onClick={() => {
              setTab(i as Tab)
            }}
          >
            {c.listLabel} <span className="pip">{c.listPip}</span>
          </button>
        ))}
      </div>

      <div className="sl-body">
        {columns.map((c, i) => (
          <LeaderColumn key={`${view}-${c.listLabel}`} active={tab === i} {...c} />
        ))}
      </div>

      <footer className="sl-foot">
        <span className="left">
          <span className="dot-live" />
          {teamGp != null ? (
            <>
              <b>{String(teamGp)}</b> GP ·{' '}
            </>
          ) : null}
          {source ?? null}
          {/* The local source already names its mode ("Tracked 6s games"). */}
          {gameMode == null && (
            <>
              {source ? ' · ' : null}
              <b>{modeLabel}</b>
            </>
          )}
        </span>
        <Link prefetch href={ctaHref}>
          View all →
        </Link>
      </footer>
    </section>
  )
}

// ─── Column ─────────────────────────────────────────────────────────────────

interface SpotlightStat {
  label: string
  value: number | string
  lead?: boolean
}

function LeaderColumn({
  active,
  eyebrow,
  listLabel,
  listPip,
  spotlightStats,
  rows,
  valueOf,
  barOf,
}: ColumnSpec & {
  /** Selected in the phone tab bar; phones hide the inactive column. */
  active: boolean
}) {
  // Local hover state — each column tracks its own focused row so hovering
  // one column's list doesn't change the other column's spotlight.
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const leader = rows[0]
  const leaderBar = leader ? barOf(leader) : 0
  const focusedIndex = hoveredIndex ?? 0
  const focused = rows[focusedIndex] ?? leader

  // Eyebrow swaps to show rank when previewing a non-leader; default to the
  // canonical "{category} Leader" copy when no row is hovered.
  const focusedEyebrow =
    hoveredIndex !== null && hoveredIndex > 0
      ? `Rank #${String(hoveredIndex + 1)} · ${listLabel}`
      : eyebrow

  return (
    <div className={active ? 'sl-col is-active' : 'sl-col'}>
      {focused ? (
        <PlayerLink playerId={focused.playerId} className="sl-spot" aria-live="polite">
          <span className="sl-spot-eyebrow">{focusedEyebrow}</span>
          <div className="sl-spot-frame">
            <SilhouetteIcon />
          </div>
          <div className="sl-spot-name">{focused.gamertag}</div>
          <div className="sl-spot-meta">
            <span
              className="pos"
              style={
                positionVar(focused) !== undefined
                  ? ({ ['--pos' as string]: positionVar(focused) } as React.CSSProperties)
                  : undefined
              }
            >
              {positionLabel(focused)}
            </span>
            {focused.jerseyNumber != null ? <span>#{String(focused.jerseyNumber)}</span> : null}
          </div>
          <div className="sl-spot-stats">
            {spotlightStats(focused).map((s) => (
              <div key={s.label} className={s.lead === true ? 'sl-spot-stat lead' : 'sl-spot-stat'}>
                <span className="l">{s.label}</span>
                <span className="v">{String(s.value)}</span>
              </div>
            ))}
          </div>
        </PlayerLink>
      ) : (
        <div className="sl-spot">
          <span className="sl-spot-eyebrow">{eyebrow}</span>
          <div className="sl-spot-frame">
            <SilhouetteIcon />
          </div>
          <div className="sl-spot-name">—</div>
        </div>
      )}

      <div
        className="sl-list"
        onMouseLeave={() => {
          setHoveredIndex(null)
        }}
      >
        <span className="sub">
          <span>
            <span className="sub-top">Top {String(rows.length)} · </span>
            {listLabel}
          </span>{' '}
          <span className="pip">{listPip}</span>
        </span>
        {rows.length === 0 ? (
          <p className="sl-list-empty">No qualifying players yet.</p>
        ) : (
          rows.map((r, i) => (
            <PlayerLink
              key={r.playerId}
              playerId={r.playerId}
              className={i === focusedIndex ? 'sl-row selected' : 'sl-row'}
              onMouseEnter={() => {
                setHoveredIndex(i)
              }}
              onFocus={() => {
                setHoveredIndex(i)
              }}
              onBlur={() => {
                setHoveredIndex(null)
              }}
            >
              <span className="sl-rank">{String(i + 1)}</span>
              <span className="sl-name-row">
                <span className="sl-dot">
                  <SilhouetteIcon />
                </span>
                {/* `display: contents` above 720px; the phone layout stacks
                    the name line over a thin value bar. */}
                <span className="sl-name-stack">
                  <span className="sl-name-line">
                    <span className="sl-name">{r.gamertag}</span>
                    <span
                      className="sl-pos-tag"
                      style={
                        positionVar(r) !== undefined
                          ? ({ ['--pos' as string]: positionVar(r) } as React.CSSProperties)
                          : undefined
                      }
                    >
                      {positionLabel(r)}
                    </span>
                  </span>
                  <span className={i === 0 ? 'sl-bar lead' : 'sl-bar'} aria-hidden>
                    <span style={{ width: `${String(barWidth(barOf(r), leaderBar))}%` }} />
                  </span>
                </span>
              </span>
              <span className="sl-val">{String(valueOf(r))}</span>
            </PlayerLink>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function SilhouetteIcon() {
  return (
    <svg viewBox="0 0 100 100" fill="currentColor" aria-hidden>
      <circle cx="50" cy="32" r="14" />
      <path d="M22 96 C22 72, 32 60, 50 60 C68 60, 78 72, 78 96 Z" />
    </svg>
  )
}

/** Bar width in percent of the leader's value, clamped to 0–100. */
function barWidth(value: number, leaderValue: number): number {
  if (!(leaderValue > 0) || !(value > 0)) return 0
  return Math.min(100, Math.round((value / leaderValue) * 100))
}

function positionLabel(r: ScoringLeaderRow): string {
  const raw = r.favoritePosition ?? r.position
  if (raw === null) return '—'
  return formatPosition(raw)
}

/**
 * Map a position string to its `--pos-*` token from `globals.css`. Returned as
 * a CSS-variable reference so the position pill picks up its color via the
 * shared `--pos` custom property pattern.
 */
function positionVar(r: ScoringLeaderRow): string | undefined {
  const raw = r.favoritePosition ?? r.position
  switch (raw) {
    case 'center':
      return 'var(--pos-c)'
    case 'leftWing':
      return 'var(--pos-lw)'
    case 'rightWing':
      return 'var(--pos-rw)'
    case 'leftDefenseMen':
      return 'var(--pos-ld)'
    case 'rightDefenseMen':
      return 'var(--pos-rd)'
    case 'defenseMen':
      return 'var(--pos-d)'
    case 'goalie':
      return 'var(--pos-g)'
    default:
      return undefined
  }
}
