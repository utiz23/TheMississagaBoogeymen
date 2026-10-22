import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import type { MatchResult } from '@eanhl/db'
import { abbreviateTeamName } from '@/lib/format'
import './games-filter.css'

// ─── Filter panel ─────────────────────────────────────────────────────────────

/** Colour family of a tile: its dot, and its frame/fill when active. */
export type FilterTone = 'accent' | 'win' | 'loss' | 'otl' | 's6' | 's3' | 'dev'

export interface FilterTile {
  key: string
  label: string
  /** Matches this option shows with the other current filters applied. */
  count: number
  href: string
  active: boolean
  tone: FilterTone
  /** Show the coloured dot before the label (Mode and Result tiles). */
  dot?: boolean
}

export interface FilterGroup {
  key: string
  legend: string
  tiles: FilterTile[]
}

/**
 * The Scores page filter: numbered groups of count tiles (01 Title, 02 Mode,
 * 03 Result). Each tile is a link; its bar is its count against the largest
 * count in the group. A tile with 0 matches is dimmed and not a link, unless
 * it is the active one. `children` renders as a footer row (search, totals).
 */
export function GamesFilterPanel({
  groups,
  children,
}: {
  groups: FilterGroup[]
  children?: ReactNode
}) {
  // Wider columns for groups with more tiles (2 / 4 / 4 → 1fr 2fr 2fr).
  const columns = groups
    .map((group) => `minmax(0, ${Math.max(1, group.tiles.length).toString()}fr)`)
    .join(' ')

  return (
    <section className="gf-panel" aria-label="Game filter">
      <div className="gf-strip" aria-hidden />
      <div className="gf-groups" style={{ '--gf-group-cols': columns } as CSSProperties}>
        {groups.map((group, i) => (
          <FilterGroupView key={group.key} group={group} index={i + 1} />
        ))}
      </div>
      {children ? <div className="gf-foot">{children}</div> : null}
    </section>
  )
}

function FilterGroupView({ group, index }: { group: FilterGroup; index: number }) {
  const max = Math.max(0, ...group.tiles.map((tile) => tile.count))
  const legendId = `gf-legend-${group.key}`

  return (
    <div className="gf-group" role="group" aria-labelledby={legendId}>
      <div id={legendId} className="gf-lbl gf-legend">
        <b aria-hidden>{index.toString().padStart(2, '0')}</b>
        {group.legend}
      </div>
      <div
        className="gf-tiles"
        style={{ '--gf-cols': group.tiles.length.toString() } as CSSProperties}
      >
        {group.tiles.map((tile) => (
          <FilterTileView key={tile.key} tile={tile} max={max} />
        ))}
      </div>
    </div>
  )
}

function FilterTileView({ tile, max }: { tile: FilterTile; max: number }) {
  const pct = max > 0 ? (tile.count / max) * 100 : 0
  const className = `gf-tile gf-tone-${tile.tone}`
  const label = `${tile.label}, ${tile.count.toString()} ${tile.count === 1 ? 'match' : 'matches'}`
  const body = (
    <>
      <span className="gf-tl" aria-hidden>
        {tile.dot ? <span className="gf-dot" /> : null}
        {tile.label}
      </span>
      <span className="gf-tc" aria-hidden>
        {tile.count}
      </span>
      <span className="gf-bar" aria-hidden>
        <span style={{ width: `${pct.toFixed(1)}%` }} />
      </span>
    </>
  )

  if (!tile.active && tile.count === 0) {
    return (
      <span className={className} aria-disabled="true" aria-label={label} role="link">
        {body}
      </span>
    )
  }

  return (
    <Link
      prefetch
      href={tile.href}
      className={className}
      aria-current={tile.active ? 'true' : undefined}
      aria-label={label}
    >
      {body}
    </Link>
  )
}

// ─── Last 10 strip ────────────────────────────────────────────────────────────

interface LastTenMatch {
  id: number
  result: MatchResult
  scoreFor: number
  scoreAgainst: number
  opponentName: string
}

/** W / L / OT run key. DNF counts as a loss, as in the W-L-OTL record. */
type RunKey = 'W' | 'L' | 'OT'

function runKey(result: MatchResult): RunKey {
  if (result === 'WIN') return 'W'
  if (result === 'OTL') return 'OT'
  return 'L'
}

const CHIP_LETTER: Record<MatchResult, string> = { WIN: 'W', LOSS: 'L', OTL: 'OT', DNF: 'DNF' }
const RESULT_WORD: Record<MatchResult, string> = {
  WIN: 'win',
  LOSS: 'loss',
  OTL: 'overtime loss',
  DNF: 'did not finish',
}

/**
 * Recent form: W-L-OTL record, one tile per game (newest first, each a link
 * to its game), the current streak and the goals for/against over the window.
 */
export function LastTenStrip({
  matches,
  listContextQuery,
}: {
  matches: LastTenMatch[]
  /** Query string carried to the game page, as the score cards do. */
  listContextQuery: string
}) {
  const n = matches.length
  const wins = matches.filter((m) => m.result === 'WIN').length
  const losses = matches.filter((m) => m.result === 'LOSS' || m.result === 'DNF').length
  const otl = matches.filter((m) => m.result === 'OTL').length
  const goalsFor = matches.reduce((sum, m) => sum + m.scoreFor, 0)
  const goalsAgainst = matches.reduce((sum, m) => sum + m.scoreAgainst, 0)

  const first = matches[0]
  const streakKey = first ? runKey(first.result) : null
  let streak = 0
  for (const m of matches) {
    if (runKey(m.result) === streakKey) streak++
    else break
  }

  return (
    <section className="gf-panel gf-form" aria-labelledby="gf-form-h">
      <div className="gf-fl">
        <h2 id="gf-form-h" className="gf-lbl">
          Last <span className="tabular-nums">{n}</span>
        </h2>
        <div
          className="gf-frec"
          aria-label={`${wins.toString()} wins, ${losses.toString()} losses, ${otl.toString()} overtime losses`}
        >
          <span className="gf-c-win">{wins}</span>
          <span className="gf-sep">–</span>
          <span className="gf-c-loss">{losses}</span>
          <span className="gf-sep">–</span>
          <span className="gf-c-otl">{otl}</span>
        </div>
        <span className="gf-lbl gf-newest">Newest first</span>
      </div>

      <ol className="gf-chips" aria-label={`Last ${n.toString()} results, newest first`}>
        {matches.map((m) => {
          const abbrev = abbreviateTeamName(m.opponentName)
          return (
            <li key={m.id} className="gf-chip-cell">
              <Link
                prefetch
                href={`/games/${m.id.toString()}${listContextQuery ? `?${listContextQuery}` : ''}`}
                className={`gf-chip gf-res-${m.result}`}
                aria-label={`${RESULT_WORD[m.result]} ${m.scoreFor.toString()}–${m.scoreAgainst.toString()} against ${m.opponentName}`}
                title={m.opponentName}
              >
                <span className="gf-cr" aria-hidden>
                  {CHIP_LETTER[m.result]}
                </span>
                <span className="gf-cs" aria-hidden>
                  {m.scoreFor}–{m.scoreAgainst}
                </span>
                <span className="gf-co" aria-hidden>
                  {abbrev}
                </span>
              </Link>
            </li>
          )
        })}
      </ol>

      <div className="gf-fr">
        {streakKey ? (
          <span className="gf-stat">
            <span className="gf-lbl">Streak</span>
            <span className={`gf-streak gf-run-${streakKey}`}>
              {streakKey}
              {streak}
            </span>
          </span>
        ) : null}
        <span className="gf-stat">
          <span className="gf-lbl">GF–GA</span>
          <span className="gf-num">
            {goalsFor}–{goalsAgainst}
          </span>
        </span>
      </div>
    </section>
  )
}
