'use client'

import { useState } from 'react'
import { formatPosition } from '@/lib/format'
import './club-stats-tabs.css'

interface SeasonRow {
  gameTitleId: number
  gameTitleName: string
  favoritePosition: string | null

  gamesPlayed: number
  gamesCompleted: number
  gamesCompletedFc: number
  playerQuitDisc: number

  skaterGp: number
  lwGp: number
  rwGp: number
  cGp: number
  dGp: number

  skaterWins: number
  skaterLosses: number
  skaterOtl: number
  skaterWinnerByDnf: number
  skaterWinPct: number
  skaterDnf: number

  goals: number
  assists: number
  points: number
  pointsPerGame: string | null
  powerPlayGoals: number
  shortHandedGoals: number
  gameWinningGoals: number
  hatTricks: number
  plusMinus: number
  pim: number
  prevGoals: number
  prevAssists: number

  shots: number
  shotPct: string | null
  shotsPerGame: string | null
  shotAttempts: number
  shotOnNetPct: string | null
  breakaways: number
  breakawayGoals: number
  breakawayPct: string | null

  passes: number
  passAttempts: number
  passPct: string | null
  interceptions: number
  dekes: number
  dekesMade: number
  deflections: number
  saucerPasses: number
  screenChances: number
  screenGoals: number
  possessionSeconds: number
  xfactorZoneUsed: number

  hits: number
  hitsPerGame: string | null
  fights: number
  fightsWon: number
  blockedShots: number
  pkClearZone: number
  offsides: number
  offsidesPerGame: string | null
  penaltiesDrawn: number
  takeaways: number
  giveaways: number

  faceoffTotal: number
  faceoffWins: number
  faceoffLosses: number
  faceoffPct: string | null
  penaltyShotAttempts: number
  penaltyShotGoals: number
  penaltyShotPct: string | null
  toiSeconds: number | null

  // ── Goalie fields ──────────────────────────────────────────────────────
  goalieGp: number
  goalieWins: number | null
  goalieLosses: number | null
  goalieOtl: number | null
  goalieSavePct: string | null
  goalieGaa: string | null
  goalieShutouts: number | null
  goalieSaves: number | null
  goalieShots: number | null
  goalieGoalsAgainst: number | null
  goalieToiSeconds: number | null

  goalieGamesCompleted: number | null
  goalieGamesCompletedFc: number | null
  goalieDnf: number | null
  goalieDnfMm: number | null
  goalieWinnerByDnf: number | null
  goalieQuitDisc: number | null
  goalieWinPct: string | null

  goalieDesperationSaves: number | null
  goaliePokeChecks: number | null
  goaliePkClearZone: number | null
  goalieShutoutPeriods: number | null

  goaliePenShots: number | null
  goaliePenSaves: number | null
  goaliePenSavePct: string | null

  goalieBrkShots: number | null
  goalieBrkSaves: number | null
  goalieBrkSavePct: string | null

  goalieSoShots: number | null
  goalieSoSaves: number | null
  goalieSoSavePct: string | null

  goaliePrevWins: number | null
  goaliePrevShutouts: number | null
}

/** Same shape as SeasonRow plus playerId so we can identify the focal player. */
interface TeammateRow extends SeasonRow {
  playerId: number
}

type SkaterTabKey = 'overview' | 'scoring' | 'playmaking' | 'defense'
type GoalieTabKey = 'overview' | 'saves' | 'situations'
type TabKey = SkaterTabKey | GoalieTabKey

type Role = 'skater' | 'goalie'

const TABS_SKATER: { key: SkaterTabKey; label: string; ix: string }[] = [
  { key: 'overview', label: 'Overview', ix: '01' },
  { key: 'scoring', label: 'Scoring', ix: '02' },
  { key: 'playmaking', label: 'Playmaking', ix: '03' },
  { key: 'defense', label: 'Defense', ix: '04' },
]

const TABS_GOALIE: { key: GoalieTabKey; label: string; ix: string }[] = [
  { key: 'overview', label: 'Overview', ix: '01' },
  { key: 'saves', label: 'Saves', ix: '02' },
  { key: 'situations', label: 'Situations', ix: '03' },
]

/** Direction of "best" — used to rank the player against teammates. */
type RankDirection = 'desc' | 'asc'

interface CellSpec {
  label: string
  /** Whole-number / formatted main value. */
  value: string
  /** Optional small unit suffix after the main value (e.g. "%"). */
  unit?: string | undefined
  /** Numeric raw value used to size the bar. Percentages should be 0–100. */
  bar?: number | undefined
  /** Marks this cell as the lead (red glow). At most one per subsection. */
  lead?: boolean | undefined
  /** Rank lookup key — picks the same numeric value off teammate rows so the
   *  player's rank within the team can be computed. Omit to skip the rank. */
  rankKey?: ((row: SeasonRow) => number | null) | undefined
  /** Rank direction. Default 'desc' (higher = better). Use 'asc' for "lower is better"
   *  metrics like Giveaways or PIM. */
  rankDir?: RankDirection | undefined
  /** Per-game divisor — when present and > 0, render `value / perGame` as a /G stat. */
  perGameOf?: number | undefined
  /** Optional pre-formatted /G value (e.g. EA's pointsPerGame string). Wins over `perGameOf`. */
  perGameValue?: string | undefined
}

interface MarqueeSpec {
  label: string
  value: string
  unit?: string | undefined
  desc: string
  rankPick?:
    | { rankKey: (row: SeasonRow) => number | null; rankDir?: RankDirection | undefined }
    | undefined
}

interface SubsectionSpec {
  title: string
  cells: CellSpec[]
}

interface TabContent {
  marquee: MarqueeSpec
  subsections: SubsectionSpec[]
}

export function ClubStatsTabs({
  season,
  gamertag,
  sheetCode = 'BGM/CST/0010',
  updatedDate,
  teammates,
  role = 'skater',
}: {
  season: SeasonRow
  gamertag?: string | undefined
  sheetCode?: string | undefined
  updatedDate?: string | undefined
  teammates?: TeammateRow[] | undefined
  role?: Role | undefined
}) {
  const [active, setActive] = useState<TabKey>('overview')

  const tabs = role === 'goalie' ? TABS_GOALIE : TABS_SKATER
  const builders: Record<string, TabBuilder> =
    role === 'goalie' ? TAB_BUILDERS_GOALIE : TAB_BUILDERS_SKATER
  const builder = builders[active] ?? builders.overview ?? TAB_BUILDERS_SKATER.overview
  const { marquee, subsections } = builder(season)

  // Rank pool — match like with like. Goalies are ranked vs other goalies on
  // the team; skaters vs skaters.
  const pool: TeammateRow[] =
    role === 'goalie'
      ? (teammates ?? []).filter((t) => t.goalieGp > 0)
      : (teammates ?? []).filter((t) => t.skaterGp > 0 || t.gamesPlayed > 0)

  const today = updatedDate ?? new Date().toISOString().slice(0, 10)
  const subtitle =
    `EA-Reported · Full Season · ${season.gameTitleName}` +
    (gamertag ? ` · ${gamertag}` : '')

  return (
    <section className="cs-module">
      <header className="cs-head">
        <div className="cs-title">
          <h2>
            <span className="accent">▌</span>Club Stats
          </h2>
          <span className="scope">{subtitle}</span>
        </div>
        <div className="cs-meta">
          <span>
            <b>{String(season.gamesPlayed)}</b> Games Played
          </span>
          <span className="dot">·</span>
          <span>
            Sheet <b>{sheetCode}</b>
          </span>
          <span className="dot">·</span>
          <span>
            Updated <b>{today}</b>
          </span>
        </div>
      </header>

      <div className="cs-ticker" />

      <nav className="cs-tabs" role="tablist" aria-label="Stat category">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active === t.key}
            className="cs-tab"
            data-tab={t.key}
            onClick={() => {
              setActive(t.key)
            }}
          >
            <span className="ix">{t.ix}</span>
            {t.label}
          </button>
        ))}
      </nav>

      <div className="cs-panel">
        <div className="cs-panel-grid">
          <Marquee marquee={marquee} pool={pool} season={season} />
          <div className="cs-subsections">
            {subsections.map((sub) => (
              <Subsection
                key={sub.title}
                title={sub.title}
                cells={sub.cells}
                pool={pool}
              />
            ))}
          </div>
        </div>
      </div>

      <footer className="cs-foot">
        <span>
          Source <b>EA NHL · Boogeymen</b>
        </span>
        <span className="center">— Player Stats · {gamertag ?? 'BGM'} —</span>
        <span className="right">
          Sheet <b>{sheetCode}</b>
        </span>
      </footer>
    </section>
  )
}

// ─── Marquee renderer ───────────────────────────────────────────────────────

function Marquee({
  marquee,
  pool,
  season,
}: {
  marquee: MarqueeSpec
  pool: TeammateRow[]
  season: SeasonRow
}) {
  const rank =
    marquee.rankPick && pool.length > 0
      ? computeRankFromValue(
          marquee.rankPick.rankKey(season) ?? null,
          pool,
          marquee.rankPick.rankKey,
          marquee.rankPick.rankDir ?? 'desc',
        )
      : null

  return (
    <aside className="cs-marquee">
      <div className="cs-marquee-eyebrow">
        <span className="dot" />
        Lead Stat
      </div>
      <div className="cs-marquee-key">{marquee.label}</div>
      <div className="cs-marquee-value">
        {marquee.value}
        {marquee.unit ? <small>{marquee.unit}</small> : null}
      </div>
      <p className="cs-marquee-desc">{marquee.desc}</p>
      {rank !== null ? (
        <div className="cs-marquee-rank">
          <span className="num">#{String(rank.rank)}</span>
          <span className="of">of {String(rank.total)} skaters</span>
        </div>
      ) : null}
    </aside>
  )
}

// ─── Subsection renderer ────────────────────────────────────────────────────

function Subsection({
  title,
  cells,
  pool,
}: {
  title: string
  cells: CellSpec[]
  pool: TeammateRow[]
}) {
  // Bars normalize within the subsection so each block's lead cell tends
  // to dominate visually.
  const barMax = computeBarMax(cells)
  const cols = Math.min(4, Math.max(1, cells.length))

  return (
    <div className="cs-subsection">
      <h3 className="cs-subsection-head">
        <span className="accent">▌</span>
        {title}
        <span className="rule" />
      </h3>
      <div
        className="cs-grid"
        style={{ gridTemplateColumns: `repeat(${String(cols)}, minmax(0, 1fr))` }}
      >
        {cells.map((c) => {
          const pct = computeBarPct(c, barMax)
          const rank =
            c.rankKey && pool.length > 0
              ? computeRank(c.rankKey, pool, c.rankDir ?? 'desc', c.bar)
              : null
          const perGame = computePerGame(c)
          const diff =
            c.rankKey && pool.length > 0
              ? computeDiffVsAvg(c.rankKey, pool, c.bar, c.unit === '%')
              : null
          const diffClass = diff
            ? diffClassFor(diff.diff, c.rankDir ?? 'desc')
            : null
          return (
            <div key={c.label} className={`cs-cell${c.lead ? ' lead' : ''}`}>
              <div className="cs-cell-head">
                <span className="k">{c.label}</span>
                {diff && diffClass ? (
                  <span className={`cs-delta ${diffClass}`}>{diff.label}</span>
                ) : null}
              </div>
              <span className="v">
                {c.value}
                {c.unit ? <small>{c.unit}</small> : null}
              </span>
              <div className="bar">
                <i style={{ width: `${String(pct)}%` }} />
              </div>
              <div className="pct-rank">
                <span>{rank ?? ''}</span>
                <span className="pg">{perGame ?? ''}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Builders per tab ───────────────────────────────────────────────────────

type TabBuilder = (s: SeasonRow) => TabContent

const TAB_BUILDERS_SKATER: Record<SkaterTabKey, TabBuilder> = {
  overview: (s) => {
    const gp = s.gamesPlayed
    const ppg = s.pointsPerGame ?? perGameNumber(s.points, gp)
    return {
      marquee: {
        label: 'Points',
        value: String(s.points),
        desc:
          `${String(s.points)} points across ${String(gp)} games — ` +
          `${ppg} per game with ${String(s.goals)} goals and ${String(s.assists)} assists.`,
        rankPick: { rankKey: (r) => r.points, rankDir: 'desc' },
      },
      subsections: [
        {
          title: 'Production',
          cells: [
            {
              label: 'Points',
              value: String(s.points),
              bar: s.points,
              lead: true,
              rankKey: (r) => r.points,
              perGameOf: gp,
              perGameValue: ppg,
            },
            {
              label: 'Goals',
              value: String(s.goals),
              bar: s.goals,
              rankKey: (r) => r.goals,
              perGameOf: gp,
            },
            {
              label: 'Assists',
              value: String(s.assists),
              bar: s.assists,
              rankKey: (r) => r.assists,
              perGameOf: gp,
            },
            {
              label: 'Plus / Minus',
              value: formatPlusMinus(s.plusMinus),
              bar: percentileFromPm(s.plusMinus),
              rankKey: (r) => r.plusMinus,
            },
          ],
        },
        {
          title: 'Results',
          cells: [
            {
              label: 'Games Played',
              value: String(s.gamesPlayed),
              bar: s.gamesPlayed,
              rankKey: (r) => r.gamesPlayed,
            },
            {
              label: 'Games Completed',
              value: String(s.gamesCompleted),
              bar: s.gamesCompleted,
              rankKey: (r) => r.gamesCompleted,
            },
            {
              label: 'Wins',
              value: String(s.skaterWins),
              bar: s.skaterWins,
              lead: true,
              rankKey: (r) => r.skaterWins,
            },
            {
              label: 'Losses',
              value: String(s.skaterLosses),
              bar: s.skaterLosses,
              rankKey: (r) => r.skaterLosses,
              rankDir: 'asc',
            },
            {
              label: 'Overtime Losses',
              value: String(s.skaterOtl),
              bar: s.skaterOtl,
              rankKey: (r) => r.skaterOtl,
              rankDir: 'asc',
            },
            {
              label: 'Win Percentage',
              value: s.skaterWinPct.toFixed(1),
              unit: '%',
              bar: s.skaterWinPct,
              rankKey: (r) => r.skaterWinPct,
            },
            {
              label: 'Record',
              value: formatRecord(s.skaterWins, s.skaterLosses, s.skaterOtl),
            },
            {
              label: 'Did Not Finish',
              value: String(s.skaterDnf),
              bar: s.skaterDnf,
              rankKey: (r) => r.skaterDnf,
              rankDir: 'asc',
            },
            {
              label: 'Wins by DNF',
              value: String(s.skaterWinnerByDnf),
              bar: s.skaterWinnerByDnf,
              rankKey: (r) => r.skaterWinnerByDnf,
            },
            {
              label: 'Favorite Position',
              value: s.favoritePosition ? formatPosition(s.favoritePosition) : '—',
            },
            {
              label: 'Quit Disconnects',
              value: String(s.playerQuitDisc),
              bar: s.playerQuitDisc,
              rankKey: (r) => r.playerQuitDisc,
              rankDir: 'asc',
            },
            {
              label: 'Forced Completions',
              value: String(s.gamesCompletedFc),
              bar: s.gamesCompletedFc,
              rankKey: (r) => r.gamesCompletedFc,
            },
          ],
        },
      ],
    }
  },

  scoring: (s) => {
    const gp = s.gamesPlayed
    const shootingPct = parsePct(s.shotPct)
    const shotOnNetPct = parsePct(s.shotOnNetPct)
    const breakawayPct = parsePct(s.breakawayPct)
    const psPct = parsePct(s.penaltyShotPct)

    return {
      marquee: {
        label: 'Goals',
        value: String(s.goals),
        desc:
          `${String(s.goals)} goals on ${String(s.shots)} shots ` +
          (shootingPct != null ? `(${shootingPct.toFixed(1)}% shooting) ` : '') +
          `with ${String(s.powerPlayGoals)} on the power play and ` +
          `${String(s.gameWinningGoals)} game-winners.`,
        rankPick: { rankKey: (r) => r.goals, rankDir: 'desc' },
      },
      subsections: [
        {
          title: 'Scoring',
          cells: [
            {
              label: 'Goals',
              value: String(s.goals),
              bar: s.goals,
              lead: true,
              rankKey: (r) => r.goals,
              perGameOf: gp,
            },
            {
              label: 'Assists',
              value: String(s.assists),
              bar: s.assists,
              rankKey: (r) => r.assists,
              perGameOf: gp,
            },
            {
              label: 'Points',
              value: String(s.points),
              bar: s.points,
              rankKey: (r) => r.points,
              perGameOf: gp,
            },
            {
              label: 'Points / Game',
              value: s.pointsPerGame ?? perGameNumber(s.points, gp),
              bar: parseFloat(s.pointsPerGame ?? perGameNumber(s.points, gp)) || 0,
              rankKey: (r) =>
                r.pointsPerGame !== null
                  ? parseFloat(r.pointsPerGame)
                  : r.gamesPlayed > 0
                    ? r.points / r.gamesPlayed
                    : 0,
            },
            {
              label: 'Power Play Goals',
              value: String(s.powerPlayGoals),
              bar: s.powerPlayGoals,
              rankKey: (r) => r.powerPlayGoals,
              perGameOf: gp,
            },
            {
              label: 'Short Handed Goals',
              value: String(s.shortHandedGoals),
              bar: s.shortHandedGoals,
              rankKey: (r) => r.shortHandedGoals,
            },
            {
              label: 'Game Winning Goals',
              value: String(s.gameWinningGoals),
              bar: s.gameWinningGoals,
              rankKey: (r) => r.gameWinningGoals,
            },
            {
              label: 'Hat Tricks',
              value: String(s.hatTricks),
              bar: s.hatTricks,
              rankKey: (r) => r.hatTricks,
            },
          ],
        },
        {
          title: 'Shooting',
          cells: [
            {
              label: 'Shots',
              value: formatThousands(s.shots),
              bar: s.shots,
              lead: true,
              rankKey: (r) => r.shots,
              perGameOf: gp,
              perGameValue: s.shotsPerGame ?? undefined,
            },
            {
              label: 'Shots / Game',
              value: s.shotsPerGame ?? perGameNumber(s.shots, gp),
              bar: parseFloat(s.shotsPerGame ?? perGameNumber(s.shots, gp)) || 0,
              rankKey: (r) =>
                r.shotsPerGame !== null
                  ? parseFloat(r.shotsPerGame)
                  : r.gamesPlayed > 0
                    ? r.shots / r.gamesPlayed
                    : 0,
            },
            {
              label: 'Shot Attempts',
              value: formatThousands(s.shotAttempts),
              bar: s.shotAttempts,
              rankKey: (r) => r.shotAttempts,
              perGameOf: gp,
            },
            {
              label: 'Shots on Net %',
              value: shotOnNetPct != null ? shotOnNetPct.toFixed(1) : '—',
              unit: shotOnNetPct != null ? '%' : undefined,
              bar: shotOnNetPct ?? 0,
              rankKey: (r) => parsePct(r.shotOnNetPct),
            },
          ],
        },
        {
          title: 'Finishing',
          cells: [
            {
              label: 'Shooting %',
              value: shootingPct != null ? shootingPct.toFixed(1) : '—',
              unit: shootingPct != null ? '%' : undefined,
              bar: shootingPct ?? 0,
              lead: true,
              rankKey: (r) => parsePct(r.shotPct),
            },
            {
              label: 'Breakaways',
              value: String(s.breakaways),
              bar: s.breakaways,
              rankKey: (r) => r.breakaways,
            },
            {
              label: 'Breakaway Goals',
              value: String(s.breakawayGoals),
              bar: s.breakawayGoals,
              rankKey: (r) => r.breakawayGoals,
            },
            {
              label: 'Breakaway %',
              value: breakawayPct != null ? breakawayPct.toFixed(1) : '—',
              unit: breakawayPct != null ? '%' : undefined,
              bar: breakawayPct ?? 0,
              rankKey: (r) => parsePct(r.breakawayPct),
            },
          ],
        },
        {
          title: 'Penalty Shots',
          cells: [
            {
              label: 'Penalty Shot Attempts',
              value: String(s.penaltyShotAttempts),
              bar: s.penaltyShotAttempts,
              rankKey: (r) => r.penaltyShotAttempts,
            },
            {
              label: 'Penalty Shot Goals',
              value: String(s.penaltyShotGoals),
              bar: s.penaltyShotGoals,
              rankKey: (r) => r.penaltyShotGoals,
            },
            {
              label: 'Penalty Shot %',
              value: psPct != null ? psPct.toFixed(1) : '—',
              unit: psPct != null ? '%' : undefined,
              bar: psPct ?? 0,
              lead: true,
              rankKey: (r) => parsePct(r.penaltyShotPct),
            },
          ],
        },
      ],
    }
  },

  playmaking: (s) => {
    const gp = s.gamesPlayed
    const passPct = parsePct(s.passPct)
    return {
      marquee: {
        label: 'Pass Completion',
        value: passPct != null ? passPct.toFixed(1) : '—',
        unit: passPct != null ? '%' : undefined,
        desc:
          `${formatThousands(s.passes)} of ${formatThousands(s.passAttempts)} passes connected ` +
          `over ${String(gp)} games — ${formatThousands(s.assists)} resulting assists.`,
        rankPick: { rankKey: (r) => parsePct(r.passPct), rankDir: 'desc' },
      },
      subsections: [
        {
          title: 'Passing',
          cells: [
            {
              label: 'Passes',
              value: formatThousands(s.passes),
              bar: s.passes,
              lead: true,
              rankKey: (r) => r.passes,
              perGameOf: gp,
            },
            {
              label: 'Pass Attempts',
              value: formatThousands(s.passAttempts),
              bar: s.passAttempts,
              rankKey: (r) => r.passAttempts,
              perGameOf: gp,
            },
            {
              label: 'Passing %',
              value: passPct != null ? passPct.toFixed(1) : '—',
              unit: passPct != null ? '%' : undefined,
              bar: passPct ?? 0,
              rankKey: (r) => parsePct(r.passPct),
            },
            {
              label: 'Saucer Passes',
              value: formatThousands(s.saucerPasses),
              bar: s.saucerPasses,
              rankKey: (r) => r.saucerPasses,
              perGameOf: gp,
            },
          ],
        },
        {
          title: 'Skill',
          cells: [
            {
              label: 'Dekes',
              value: formatThousands(s.dekes),
              bar: s.dekes,
              rankKey: (r) => r.dekes,
              perGameOf: gp,
            },
            {
              label: 'Dekes Made',
              value: formatThousands(s.dekesMade),
              bar: s.dekesMade,
              lead: true,
              rankKey: (r) => r.dekesMade,
              perGameOf: gp,
            },
            {
              label: 'X-Factor Used',
              value: String(s.xfactorZoneUsed),
              bar: s.xfactorZoneUsed,
              rankKey: (r) => r.xfactorZoneUsed,
            },
            {
              label: 'Possession',
              value: formatHrsMin(s.possessionSeconds),
              bar: s.possessionSeconds,
              rankKey: (r) => r.possessionSeconds,
            },
          ],
        },
        {
          title: 'Net Presence',
          cells: [
            {
              label: 'Screen Chances',
              value: formatThousands(s.screenChances),
              bar: s.screenChances,
              lead: true,
              rankKey: (r) => r.screenChances,
              perGameOf: gp,
            },
            {
              label: 'Screen Goals',
              value: formatThousands(s.screenGoals),
              bar: s.screenGoals,
              rankKey: (r) => r.screenGoals,
            },
            {
              label: 'Deflections',
              value: formatThousands(s.deflections),
              bar: s.deflections,
              rankKey: (r) => r.deflections,
              perGameOf: gp,
            },
          ],
        },
        {
          title: 'Utility',
          cells: [
            {
              label: 'Time on Ice',
              value: s.toiSeconds !== null ? formatHrsMin(s.toiSeconds) : '—',
              bar: s.toiSeconds ?? 0,
              lead: true,
              rankKey: (r) => r.toiSeconds,
            },
            {
              label: 'Plus / Minus',
              value: formatPlusMinus(s.plusMinus),
              bar: percentileFromPm(s.plusMinus),
              rankKey: (r) => r.plusMinus,
            },
            {
              label: 'Goals (Previous Season)',
              value: String(s.prevGoals),
              bar: s.prevGoals,
              rankKey: (r) => r.prevGoals,
            },
            {
              label: 'Assists (Previous Season)',
              value: String(s.prevAssists),
              bar: s.prevAssists,
              rankKey: (r) => r.prevAssists,
            },
          ],
        },
      ],
    }
  },

  defense: (s) => {
    const gp = s.gamesPlayed
    const foPct = parsePct(s.faceoffPct)
    const hitsPerGameVal = s.hitsPerGame ? parseFloat(s.hitsPerGame) : gp > 0 ? s.hits / gp : 0
    return {
      marquee: {
        label: 'Takeaways',
        value: String(s.takeaways),
        desc:
          `${String(s.takeaways)} takeaways and ${String(s.interceptions)} interceptions, ` +
          `paired with ${String(s.hits)} hits and a ${formatPlusMinus(s.plusMinus)} plus/minus.`,
        rankPick: { rankKey: (r) => r.takeaways, rankDir: 'desc' },
      },
      subsections: [
        {
          title: 'Physicality',
          cells: [
            {
              label: 'Hits',
              value: formatThousands(s.hits),
              bar: s.hits,
              lead: true,
              rankKey: (r) => r.hits,
              perGameOf: gp,
              perGameValue: s.hitsPerGame ?? undefined,
            },
            {
              label: 'Hits per Game',
              value: hitsPerGameVal.toFixed(2),
              bar: hitsPerGameVal,
              rankKey: (r) =>
                r.hitsPerGame !== null
                  ? parseFloat(r.hitsPerGame)
                  : r.gamesPlayed > 0
                    ? r.hits / r.gamesPlayed
                    : 0,
            },
            {
              label: 'Fights',
              value: String(s.fights),
              bar: s.fights,
              rankKey: (r) => r.fights,
            },
            {
              label: 'Fights Won',
              value: String(s.fightsWon),
              bar: s.fightsWon,
              rankKey: (r) => r.fightsWon,
            },
          ],
        },
        {
          title: 'Puck Management',
          cells: [
            {
              label: 'Blocked Shots',
              value: formatThousands(s.blockedShots),
              bar: s.blockedShots,
              rankKey: (r) => r.blockedShots,
              perGameOf: gp,
            },
            {
              label: 'Giveaways',
              value: formatThousands(s.giveaways),
              bar: s.giveaways,
              rankKey: (r) => r.giveaways,
              rankDir: 'asc',
              perGameOf: gp,
            },
            {
              label: 'Takeaways',
              value: formatThousands(s.takeaways),
              bar: s.takeaways,
              lead: true,
              rankKey: (r) => r.takeaways,
              perGameOf: gp,
            },
            {
              label: 'Interceptions',
              value: formatThousands(s.interceptions),
              bar: s.interceptions,
              rankKey: (r) => r.interceptions,
              perGameOf: gp,
            },
          ],
        },
        {
          title: 'Discipline',
          cells: [
            {
              label: 'Offsides',
              value: String(s.offsides),
              bar: s.offsides,
              rankKey: (r) => r.offsides,
              rankDir: 'asc',
            },
            {
              label: 'Penalty Kill Zone Clears',
              value: String(s.pkClearZone),
              bar: s.pkClearZone,
              rankKey: (r) => r.pkClearZone,
            },
            {
              label: 'Penalty Minutes',
              value: String(s.pim),
              bar: s.pim,
              lead: true,
              rankKey: (r) => r.pim,
              rankDir: 'asc',
              perGameOf: gp,
            },
            {
              label: 'Penalties Drawn',
              value: String(s.penaltiesDrawn),
              bar: s.penaltiesDrawn,
              rankKey: (r) => r.penaltiesDrawn,
            },
          ],
        },
        {
          title: 'Faceoffs',
          cells: [
            {
              label: 'Faceoffs Taken',
              value: formatThousands(s.faceoffTotal),
              bar: s.faceoffTotal,
              rankKey: (r) => r.faceoffTotal,
              perGameOf: gp,
            },
            {
              label: 'Faceoffs Won',
              value: formatThousands(s.faceoffWins),
              bar: s.faceoffWins,
              rankKey: (r) => r.faceoffWins,
              perGameOf: gp,
            },
            {
              label: 'Faceoffs Lost',
              value: formatThousands(s.faceoffLosses),
              bar: s.faceoffLosses,
              rankKey: (r) => r.faceoffLosses,
              rankDir: 'asc',
            },
            {
              label: 'Faceoff %',
              value: foPct != null ? foPct.toFixed(1) : '—',
              unit: foPct != null ? '%' : undefined,
              bar: foPct ?? 0,
              lead: true,
              rankKey: (r) => parsePct(r.faceoffPct),
            },
          ],
        },
      ],
    }
  },
}

// ─── Goalie builders ────────────────────────────────────────────────────────

const TAB_BUILDERS_GOALIE: Record<GoalieTabKey, TabBuilder> = {
  overview: (s) => {
    const gp = s.goalieGp
    const wins = s.goalieWins ?? 0
    const losses = s.goalieLosses ?? 0
    const otl = s.goalieOtl ?? 0
    const decided = wins + losses + otl
    const winPctRaw = parsePct(s.goalieWinPct)
    const winPct =
      winPctRaw ?? (decided > 0 ? (wins / decided) * 100 : 0)
    const sv = parsePct(s.goalieSavePct)
    const gaa = parseFloat(s.goalieGaa ?? 'NaN')
    const gamesCompleted = s.goalieGamesCompleted ?? decided

    return {
      marquee: {
        label: 'Save %',
        value: sv != null ? sv.toFixed(2) : '—',
        unit: sv != null ? '%' : undefined,
        desc:
          `${formatThousands(s.goalieSaves ?? 0)} saves on ${formatThousands(s.goalieShots ?? 0)} ` +
          `shots across ${String(gp)} games — ` +
          `${Number.isFinite(gaa) ? gaa.toFixed(2) : '—'} GAA, ` +
          `${String(s.goalieShutouts ?? 0)} shutouts.`,
        rankPick: { rankKey: (r) => parsePct(r.goalieSavePct), rankDir: 'desc' },
      },
      subsections: [
        {
          title: 'Production',
          cells: [
            {
              label: 'Games Played',
              value: String(gp),
              bar: gp,
              lead: true,
              rankKey: (r) => r.goalieGp,
            },
            {
              label: 'Save %',
              value: sv != null ? sv.toFixed(2) : '—',
              unit: sv != null ? '%' : undefined,
              bar: sv ?? 0,
              rankKey: (r) => parsePct(r.goalieSavePct),
            },
            {
              label: 'Goals Against Average',
              value: Number.isFinite(gaa) ? gaa.toFixed(2) : '—',
              bar: Number.isFinite(gaa) ? Math.max(0, 6 - gaa) * 16.6 : 0,
              rankKey: (r) => {
                const v = parseFloat(r.goalieGaa ?? 'NaN')
                return Number.isFinite(v) ? v : null
              },
              rankDir: 'asc',
            },
            {
              label: 'Shutouts',
              value: String(s.goalieShutouts ?? 0),
              bar: s.goalieShutouts ?? 0,
              rankKey: (r) => r.goalieShutouts,
            },
          ],
        },
        {
          title: 'Record',
          cells: [
            {
              label: 'Wins',
              value: String(wins),
              bar: wins,
              lead: true,
              rankKey: (r) => r.goalieWins,
            },
            {
              label: 'Losses',
              value: String(losses),
              bar: losses,
              rankKey: (r) => r.goalieLosses,
              rankDir: 'asc',
            },
            {
              label: 'Overtime Losses',
              value: String(otl),
              bar: otl,
              rankKey: (r) => r.goalieOtl,
              rankDir: 'asc',
            },
            {
              label: 'Win Percentage',
              value: winPct.toFixed(1),
              unit: '%',
              bar: winPct,
              rankKey: (r) => {
                const w = r.goalieWins ?? 0
                const l = r.goalieLosses ?? 0
                const o = r.goalieOtl ?? 0
                const d = w + l + o
                return d > 0 ? (w / d) * 100 : null
              },
            },
          ],
        },
        {
          title: 'Disposition',
          cells: [
            {
              label: 'Games Completed',
              value: String(gamesCompleted),
              bar: gamesCompleted,
              rankKey: (r) => r.goalieGamesCompleted,
            },
            {
              label: 'Did Not Finish',
              value: String(s.goalieDnf ?? 0),
              bar: s.goalieDnf ?? 0,
              rankKey: (r) => r.goalieDnf,
              rankDir: 'asc',
            },
            {
              label: 'Wins by DNF',
              value: String(s.goalieWinnerByDnf ?? 0),
              bar: s.goalieWinnerByDnf ?? 0,
              rankKey: (r) => r.goalieWinnerByDnf,
            },
            {
              label: 'Quit Disconnects',
              value: String(s.goalieQuitDisc ?? 0),
              bar: s.goalieQuitDisc ?? 0,
              rankKey: (r) => r.goalieQuitDisc,
              rankDir: 'asc',
            },
          ],
        },
      ],
    }
  },

  saves: (s) => {
    const gp = s.goalieGp
    const sv = parsePct(s.goalieSavePct)
    const gaa = parseFloat(s.goalieGaa ?? 'NaN')
    const shotsAgainst = s.goalieShots ?? 0
    const saves = s.goalieSaves ?? 0
    const goalsAgainst = s.goalieGoalsAgainst ?? 0
    const savesPerGame = gp > 0 ? saves / gp : 0
    const gaPerGame = gp > 0 ? goalsAgainst / gp : 0
    const toi = s.goalieToiSeconds ?? 0
    const toiPerGame = gp > 0 ? toi / gp : 0

    return {
      marquee: {
        label: 'Saves',
        value: formatThousands(saves),
        desc:
          `${formatThousands(saves)} saves of ${formatThousands(shotsAgainst)} shots ` +
          (sv != null ? `(${sv.toFixed(2)}% save percentage) ` : '') +
          `with ${String(s.goalieShutouts ?? 0)} shutouts and a ` +
          `${Number.isFinite(gaa) ? gaa.toFixed(2) : '—'} goals-against average.`,
        rankPick: { rankKey: (r) => r.goalieSaves, rankDir: 'desc' },
      },
      subsections: [
        {
          title: 'Performance',
          cells: [
            {
              label: 'Shots Against',
              value: formatThousands(shotsAgainst),
              bar: shotsAgainst,
              rankKey: (r) => r.goalieShots,
              perGameOf: gp,
            },
            {
              label: 'Saves',
              value: formatThousands(saves),
              bar: saves,
              lead: true,
              rankKey: (r) => r.goalieSaves,
              perGameOf: gp,
            },
            {
              label: 'Save %',
              value: sv != null ? sv.toFixed(2) : '—',
              unit: sv != null ? '%' : undefined,
              bar: sv ?? 0,
              rankKey: (r) => parsePct(r.goalieSavePct),
            },
            {
              label: 'Desperation Saves',
              value: String(s.goalieDesperationSaves ?? 0),
              bar: s.goalieDesperationSaves ?? 0,
              rankKey: (r) => r.goalieDesperationSaves,
              perGameOf: gp,
            },
          ],
        },
        {
          title: 'Goals Against',
          cells: [
            {
              label: 'Goals Against',
              value: String(goalsAgainst),
              bar: goalsAgainst,
              rankKey: (r) => r.goalieGoalsAgainst,
              rankDir: 'asc',
              perGameOf: gp,
            },
            {
              label: 'Goals Against Average',
              value: Number.isFinite(gaa) ? gaa.toFixed(2) : '—',
              bar: Number.isFinite(gaa) ? Math.max(0, 6 - gaa) * 16.6 : 0,
              lead: true,
              rankKey: (r) => {
                const v = parseFloat(r.goalieGaa ?? 'NaN')
                return Number.isFinite(v) ? v : null
              },
              rankDir: 'asc',
            },
            {
              label: 'Shutouts',
              value: String(s.goalieShutouts ?? 0),
              bar: s.goalieShutouts ?? 0,
              rankKey: (r) => r.goalieShutouts,
            },
            {
              label: 'Shutout Periods',
              value: String(s.goalieShutoutPeriods ?? 0),
              bar: s.goalieShutoutPeriods ?? 0,
              rankKey: (r) => r.goalieShutoutPeriods,
            },
          ],
        },
        {
          title: 'Workload',
          cells: [
            {
              label: 'Time on Ice',
              value: formatHrsMin(toi),
              bar: toi,
              lead: true,
              rankKey: (r) => r.goalieToiSeconds ?? null,
            },
            {
              label: 'Saves per Game',
              value: gp > 0 ? savesPerGame.toFixed(2) : '—',
              bar: savesPerGame,
              rankKey: (r) => (r.goalieGp > 0 ? (r.goalieSaves ?? 0) / r.goalieGp : null),
            },
            {
              label: 'Goals Against per Game',
              value: gp > 0 ? gaPerGame.toFixed(2) : '—',
              bar: gaPerGame,
              rankKey: (r) => (r.goalieGp > 0 ? (r.goalieGoalsAgainst ?? 0) / r.goalieGp : null),
              rankDir: 'asc',
            },
            {
              label: 'Time on Ice per Game',
              value: gp > 0 ? formatMinutes(toiPerGame) : '—',
              bar: toiPerGame,
              rankKey: (r) =>
                r.goalieGp > 0 ? (r.goalieToiSeconds ?? 0) / r.goalieGp : null,
            },
          ],
        },
        {
          title: 'Defensive Plays',
          cells: [
            {
              label: 'Poke Checks',
              value: String(s.goaliePokeChecks ?? 0),
              bar: s.goaliePokeChecks ?? 0,
              rankKey: (r) => r.goaliePokeChecks,
            },
            {
              label: 'Penalty Kill Zone Clears',
              value: String(s.goaliePkClearZone ?? 0),
              bar: s.goaliePkClearZone ?? 0,
              rankKey: (r) => r.goaliePkClearZone,
            },
          ],
        },
      ],
    }
  },

  situations: (s) => {
    const penShots = s.goaliePenShots ?? 0
    const penSaves = s.goaliePenSaves ?? 0
    const penSavePct = parsePct(s.goaliePenSavePct)

    const brkShots = s.goalieBrkShots ?? 0
    const brkSaves = s.goalieBrkSaves ?? 0
    const brkSavePct = parsePct(s.goalieBrkSavePct)

    const soShots = s.goalieSoShots ?? 0
    const soSaves = s.goalieSoSaves ?? 0
    const soSavePct = parsePct(s.goalieSoSavePct)

    return {
      marquee: {
        label: 'Breakaway Saves',
        value: String(brkSaves),
        desc:
          `${String(brkSaves)} breakaway saves on ${String(brkShots)} attempts ` +
          (brkSavePct != null ? `(${brkSavePct.toFixed(2)}%) ` : '') +
          `· ${String(penSaves)} of ${String(penShots)} penalty shots stopped` +
          (soShots > 0 ? ` · ${String(soSaves)}/${String(soShots)} in shootouts.` : '.'),
        rankPick: { rankKey: (r) => r.goalieBrkSaves, rankDir: 'desc' },
      },
      subsections: [
        {
          title: 'Breakaways',
          cells: [
            {
              label: 'Breakaway Shots Faced',
              value: String(brkShots),
              bar: brkShots,
              rankKey: (r) => r.goalieBrkShots,
            },
            {
              label: 'Breakaway Saves',
              value: String(brkSaves),
              bar: brkSaves,
              rankKey: (r) => r.goalieBrkSaves,
            },
            {
              label: 'Breakaway Save %',
              value: brkSavePct != null ? brkSavePct.toFixed(2) : '—',
              unit: brkSavePct != null ? '%' : undefined,
              bar: brkSavePct ?? 0,
              lead: true,
              rankKey: (r) => parsePct(r.goalieBrkSavePct),
            },
          ],
        },
        {
          title: 'Penalty Shots',
          cells: [
            {
              label: 'Penalty Shots Faced',
              value: String(penShots),
              bar: penShots,
              rankKey: (r) => r.goaliePenShots,
            },
            {
              label: 'Penalty Shot Saves',
              value: String(penSaves),
              bar: penSaves,
              rankKey: (r) => r.goaliePenSaves,
            },
            {
              label: 'Penalty Shot Save %',
              value: penSavePct != null ? penSavePct.toFixed(2) : '—',
              unit: penSavePct != null ? '%' : undefined,
              bar: penSavePct ?? 0,
              lead: true,
              rankKey: (r) => parsePct(r.goaliePenSavePct),
            },
          ],
        },
        {
          title: 'Shootouts',
          cells: [
            {
              label: 'Shootout Shots Faced',
              value: String(soShots),
              bar: soShots,
              rankKey: (r) => r.goalieSoShots,
            },
            {
              label: 'Shootout Saves',
              value: String(soSaves),
              bar: soSaves,
              rankKey: (r) => r.goalieSoSaves,
            },
            {
              label: 'Shootout Save %',
              value: soSavePct != null ? soSavePct.toFixed(2) : '—',
              unit: soSavePct != null ? '%' : undefined,
              bar: soSavePct ?? 0,
              lead: true,
              rankKey: (r) => parsePct(r.goalieSoSavePct),
            },
          ],
        },
      ],
    }
  },
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeBarMax(cells: CellSpec[]): number {
  let max = 0
  for (const c of cells) {
    if (typeof c.bar === 'number' && c.bar > max) max = c.bar
  }
  return max
}

function computeBarPct(cell: CellSpec, max: number): number {
  if (typeof cell.bar !== 'number' || cell.bar <= 0) return 0
  if (cell.unit === '%') return Math.max(0, Math.min(100, cell.bar))
  if (max <= 0) return 0
  return Math.max(0, Math.min(100, (cell.bar / max) * 100))
}

function parsePct(s: string | null): number | null {
  if (s === null) return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function perGameNumber(value: number, gp: number): string {
  if (gp <= 0) return '—'
  return (value / gp).toFixed(2)
}

function computePerGame(c: CellSpec): string | null {
  if (c.perGameValue) return `${c.perGameValue}/G`
  if (c.perGameOf !== undefined && c.perGameOf > 0 && typeof c.bar === 'number') {
    if (c.unit === '%') return null // percentage stats don't get a /G readout
    return `${(c.bar / c.perGameOf).toFixed(2)}/G`
  }
  return null
}

interface RankResult {
  rank: number
  total: number
}

function computeRank(
  rankKey: (row: SeasonRow) => number | null,
  pool: TeammateRow[],
  dir: RankDirection,
  focalValue: number | undefined,
): string | null {
  if (focalValue === undefined) return null
  const result = computeRankFromValue(focalValue, pool, rankKey, dir)
  if (result === null) return null
  return `#${String(result.rank)} of ${String(result.total)}`
}

function computeRankFromValue(
  focalValue: number | null,
  pool: TeammateRow[],
  rankKey: (row: SeasonRow) => number | null,
  dir: RankDirection,
): RankResult | null {
  if (focalValue === null || !Number.isFinite(focalValue)) return null
  let strictlyBetter = 0
  let total = 0
  for (const t of pool) {
    const v = rankKey(t)
    if (v === null || !Number.isFinite(v)) continue
    total += 1
    if (dir === 'desc' ? v > focalValue : v < focalValue) strictlyBetter += 1
  }
  if (total === 0) return null
  return { rank: strictlyBetter + 1, total }
}

interface DiffResult {
  diff: number
  label: string
}

/**
 * Diff vs team average for a stat. `isPct` controls formatting: percentages
 * render with 1 decimal, counts round to whole numbers.
 */
function computeDiffVsAvg(
  rankKey: (row: SeasonRow) => number | null,
  pool: TeammateRow[],
  focalValue: number | undefined,
  isPct: boolean,
): DiffResult | null {
  if (focalValue === undefined || !Number.isFinite(focalValue)) return null
  let sum = 0
  let count = 0
  for (const t of pool) {
    const v = rankKey(t)
    if (v === null || !Number.isFinite(v)) continue
    sum += v
    count += 1
  }
  if (count === 0) return null
  const avg = sum / count
  const diff = focalValue - avg
  return { diff, label: formatDiff(diff, isPct) }
}

function formatDiff(diff: number, isPct: boolean): string {
  if (isPct) {
    if (diff > 0.05) return `+${diff.toFixed(1)}`
    if (diff < -0.05) return `−${Math.abs(diff).toFixed(1)}`
    return '±0.0'
  }
  const r = Math.round(diff)
  if (r > 0) return `+${String(r)}`
  if (r < 0) return `−${String(Math.abs(r))}`
  return '±0'
}

/**
 * Color the diff chip. For "lower is better" stats (rankDir='asc'), invert
 * the green/red sense — a positive diff means the player is WORSE than avg.
 */
function diffClassFor(diff: number, dir: RankDirection): string {
  const eps = 0.05
  if (Math.abs(diff) < eps) return 'eq'
  if (dir === 'desc') return diff > 0 ? 'up' : 'dn'
  return diff > 0 ? 'dn' : 'up'
}

function formatPlusMinus(v: number): string {
  if (v > 0) return `+${String(v)}`
  return String(v)
}

function percentileFromPm(v: number): number {
  return Math.max(0, Math.min(100, ((v + 50) / 100) * 100))
}

function formatRecord(w: number, l: number, otl: number): string {
  return `${String(w)}-${String(l)}-${String(otl)}`
}

function formatThousands(v: number): string {
  return v.toLocaleString('en-US')
}

function formatHrsMin(seconds: number): string {
  if (seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${String(h)}h ${String(m)}m`
  return `${String(m)}m`
}

/** Format a per-game TOI value (seconds) as MM:SS. */
function formatMinutes(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—'
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m)}:${String(s).padStart(2, '0')}`
}
