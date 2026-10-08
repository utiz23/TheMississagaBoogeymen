import type {
  PositionDetail,
  PositionPlayerRow,
  PositionTable,
  SkaterPosition,
} from '@eanhl/db/queries'
import { POSITION_COVERAGE_NOTE, WING_SPLIT_NOTE } from './notes.ts'
import type { ShellDataset, ShellSubsets, SubsetData } from './stats-table-shell.tsx'
import type { PartialExpanded, SkaterDisplayRow, SkaterExpanded, StatsSource } from './types.ts'

/** Pill order and names (mirrors the db's SKATER_POSITIONS; kept here so this module stays db-free). */
export const POSITION_OPTIONS = [
  { key: 'C', title: 'Center' },
  { key: 'LW', title: 'Left wing' },
  { key: 'RW', title: 'Right wing' },
  { key: 'W', title: 'Wing (LW + RW)' },
  { key: 'D', title: 'Defense' },
] as const satisfies readonly { key: SkaterPosition; title: string }[]

/** Percentage string (2 dp) of num/den, or null when it can't be computed. */
export function pct(num: number | null, den: number | null): string | null {
  return num === null || den === null || den <= 0 ? null : ((num / den) * 100).toFixed(2)
}

/**
 * Detail counts → the table's expanded payload. Rates use EA's formulas
 * (S% = G ÷ SOG, SOG% = SOG ÷ attempts …) since the sources' own rates
 * can't be recombined. Missing counts stay null ("—"), never 0.
 */
export function detailToExpanded(
  d: PositionDetail,
  base: { goals: number; shots: number; shotAttempts: number },
): PartialExpanded<SkaterExpanded> {
  return {
    powerPlayGoals: d.powerPlayGoals,
    shortHandedGoals: d.shortHandedGoals,
    gameWinningGoals: d.gameWinningGoals,
    hatTricks: d.hatTricks,
    shotPct: pct(base.goals, base.shots),
    shotOnNetPct: pct(base.shots, base.shotAttempts),
    passes: d.passes,
    passAttempts: d.passAttempts,
    saucerPasses: d.saucerPasses,
    possessionSeconds: d.possessionSeconds,
    dekes: d.dekes,
    dekesMade: d.dekesMade,
    deflections: d.deflections,
    faceoffWins: d.faceoffWins,
    faceoffLosses: d.faceoffLosses,
    blockedShots: d.blockedShots,
    interceptions: d.interceptions,
    pkClearZone: d.pkClearZone,
    penaltiesDrawn: d.penaltiesDrawn,
    offsides: d.offsides,
    fights: d.fights,
    fightsWon: d.fightsWon,
    breakaways: d.breakaways,
    breakawayGoals: d.breakawayGoals,
    breakawayPct: pct(d.breakawayGoals, d.breakaways),
    penaltyShotAttempts: d.penaltyShotAttempts,
    penaltyShotGoals: d.penaltyShotGoals,
    penaltyShotPct: pct(d.penaltyShotGoals, d.penaltyShotAttempts),
  }
}

/** FO% from complete win/loss counts only (a missing count is unknown, not 0). */
export function faceoffPctOf(d: Pick<PositionDetail, 'faceoffWins' | 'faceoffLosses'>) {
  return d.faceoffWins === null || d.faceoffLosses === null
    ? null
    : pct(d.faceoffWins, d.faceoffWins + d.faceoffLosses)
}

export function toPositionDisplayRow(row: PositionPlayerRow): SkaterDisplayRow {
  const l = row.line
  return {
    playerId: row.playerId,
    gamertag: row.gamertag,
    position: row.position,
    gamesPlayed: l.gp,
    goals: l.goals,
    assists: l.assists,
    points: l.points,
    plusMinus: l.plusMinus,
    pim: l.pim,
    shots: l.shots,
    hits: l.hits,
    takeaways: l.takeaways,
    giveaways: l.giveaways,
    faceoffPct: faceoffPctOf(l.detail),
    passPct: pct(l.detail.passes, l.detail.passAttempts),
    shotAttempts: l.shotAttempts,
    toiSeconds: l.toiSeconds,
    expanded: detailToExpanded(l.detail, l),
    ...(l.coverage !== null ? { gpCoverage: l.coverage } : {}),
    ...(l.wingSplit6sOnly ? { wingSplit6sOnly: true } : {}),
  }
}

export type PositionSourceKind = 'local' | 'archive' | 'career'

/** Source badge + notes for one position's rows. */
export function positionSource(
  kind: PositionSourceKind,
  title: string,
  rows: readonly SkaterDisplayRow[],
): StatsSource {
  const name = title.toLowerCase()
  const notes: string[] = []
  if (rows.some((r) => r.gpCoverage?.state === 'partial')) notes.push(POSITION_COVERAGE_NOTE)
  if (rows.some((r) => r.wingSplit6sOnly === true)) notes.push(WING_SPLIT_NOTE)
  const base =
    kind === 'local'
      ? {
          kind: 'local-tracked' as const,
          label: 'Tracked games',
          description: `Only games played at ${name}, from the games this site tracked.`,
        }
      : kind === 'archive'
        ? {
            kind: 'archive-player-card' as const,
            label: 'Player-card totals',
            description: `Only games at ${name}, from each player’s reviewed season screenshots (may include other clubs).`,
          }
        : {
            kind: 'career' as const,
            label: 'Career by position',
            description: `Games at ${name} across every title: season screenshots through NHL 25, tracked games after that.`,
          }
  return notes.length > 0 ? { ...base, notes } : base
}

function dataset(
  kind: PositionSourceKind,
  title: string,
  rows: readonly PositionPlayerRow[],
): ShellDataset<SkaterDisplayRow> {
  const display = rows.map(toPositionDisplayRow)
  return { rows: display, source: positionSource(kind, title, display), hasExpanded: true }
}

export interface PositionData {
  /** One title × playlist; 'error' → pills disabled. */
  current: PositionTable | 'error'
  /** Career rows; omitted → unavailable under All Time. */
  allTime?: Record<SkaterPosition, PositionPlayerRow[]> | 'error'
}

export const POSITION_UNAVAILABLE_REASON = 'Position stats are unavailable right now.'

/** Position pills for a player table (roster / stats). */
export function positionSubsets(data: PositionData): ShellSubsets<SkaterDisplayRow> {
  const { current, allTime } = data
  return {
    label: 'Position',
    allLabel: 'All',
    ...(current === 'error' ? { disabledReason: POSITION_UNAVAILABLE_REASON } : {}),
    options: POSITION_OPTIONS.map((o) => {
      const slot = current === 'error' ? null : current.positions[o.key]
      const cur: SubsetData<SkaterDisplayRow> =
        slot === null
          ? { unavailable: POSITION_UNAVAILABLE_REASON }
          : 'unavailable' in slot
            ? { unavailable: slot.unavailable }
            : dataset(current === 'error' ? 'local' : current.source, o.title, slot.rows)
      return {
        key: o.key,
        label: o.key,
        title: o.title,
        current: cur,
        ...(allTime === undefined
          ? {}
          : {
              allTime:
                allTime === 'error'
                  ? { unavailable: POSITION_UNAVAILABLE_REASON }
                  : dataset('career', o.title, allTime[o.key]),
            }),
      }
    }),
  }
}
