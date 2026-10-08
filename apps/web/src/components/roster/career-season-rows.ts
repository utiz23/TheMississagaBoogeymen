import type {
  ArchiveGoalieDetail,
  ArchiveSeasonDetail,
  ArchiveSkaterDetail,
  PlayerCareerSeasonRow,
  PlayerPositionSeason,
  SkaterPosition,
  getPlayerEASeasonStats,
} from '@eanhl/db/queries'
import {
  NULL_DETAIL,
  POSITION_OPTIONS,
  detailToExpanded,
  lineToDisplayFields,
  pct,
  positionNotes,
} from '../stats/stats-table/position-adapters.ts'
import type {
  GoalieDisplayRow,
  GoalieExpanded,
  PartialExpanded,
  SkaterDisplayRow,
  SkaterExpanded,
  StatsSource,
} from '../stats/stats-table/types.ts'

type EASeasonRow = Awaited<ReturnType<typeof getPlayerEASeasonStats>>[number]

/** The EA fields the season table reads (a full `getPlayerEASeasonStats` row satisfies it). */
export type EASeasonDetail = Pick<
  EASeasonRow,
  | 'gameTitleId'
  | 'toiSeconds'
  | 'goalieToiSeconds'
  | keyof SkaterExpanded
  | 'goalieShutoutPeriods'
  | 'goalieDesperationSaves'
  | 'goalieBrkShots'
  | 'goalieBrkSaves'
  | 'goalieBrkSavePct'
  | 'goaliePenShots'
  | 'goaliePenSaves'
  | 'goaliePenSavePct'
  | 'goaliePokeChecks'
  | 'goaliePkClearZone'
>

export interface SeasonLabel {
  gameTitleId: number
  gameTitleName: string
  gameTitleSlug: string
  /** 'tracked' = the site's own per-game rows (position views only). */
  source: 'ea' | 'historical' | 'tracked'
}

export type SeasonSkaterRow = SkaterDisplayRow & { season: SeasonLabel }
export type SeasonGoalieRow = GoalieDisplayRow & { season: SeasonLabel }

/** Per-position season rows for the Position pills ('error' → pills disabled). */
export type SeasonPositions =
  | Record<SkaterPosition, { rows: SeasonSkaterRow[]; source: StatsSource }>
  | 'error'

export type SeasonTable =
  | { role: 'skater'; rows: SeasonSkaterRow[]; source: StatsSource; positions?: SeasonPositions }
  | { role: 'goalie'; rows: SeasonGoalieRow[]; source: StatsSource }

const ARCHIVE_SKATER_NOTE =
  'Archive seasons come from reviewed screenshots, which didn’t show possession or time on ice; those cells show —. Their percentages are computed from the screenshot counts.'
const ARCHIVE_GOALIE_NOTE =
  'Archive seasons come from reviewed screenshots, which didn’t show shutout periods or poke checks; those cells show —. Their shots against (saves + goals against), GAA and save percentages are computed from the screenshot counts.'

function eaSkaterExpanded(e: EASeasonDetail): SkaterExpanded {
  return {
    powerPlayGoals: e.powerPlayGoals,
    shortHandedGoals: e.shortHandedGoals,
    gameWinningGoals: e.gameWinningGoals,
    hatTricks: e.hatTricks,
    shotPct: e.shotPct,
    shotOnNetPct: e.shotOnNetPct,
    passes: e.passes,
    passAttempts: e.passAttempts,
    saucerPasses: e.saucerPasses,
    possessionSeconds: e.possessionSeconds,
    dekes: e.dekes,
    dekesMade: e.dekesMade,
    deflections: e.deflections,
    faceoffWins: e.faceoffWins,
    faceoffLosses: e.faceoffLosses,
    blockedShots: e.blockedShots,
    interceptions: e.interceptions,
    pkClearZone: e.pkClearZone,
    penaltiesDrawn: e.penaltiesDrawn,
    offsides: e.offsides,
    fights: e.fights,
    fightsWon: e.fightsWon,
    breakaways: e.breakaways,
    breakawayGoals: e.breakawayGoals,
    breakawayPct: e.breakawayPct,
    penaltyShotAttempts: e.penaltyShotAttempts,
    penaltyShotGoals: e.penaltyShotGoals,
    penaltyShotPct: e.penaltyShotPct,
  }
}

/**
 * Archive seasons carry the screenshot counts (`ArchiveSkaterDetail`); a
 * count the screenshots lacked is null (rendered "—"), never 0. Rates are
 * derived with EA's formulas since the archive's own rates are rounded
 * display strings that can't be combined across 6s + 3s.
 */
function archiveSkaterExpanded(
  row: PlayerCareerSeasonRow,
  a: ArchiveSkaterDetail | null,
): PartialExpanded<SkaterExpanded> {
  return detailToExpanded(a === null ? NULL_DETAIL : { ...a, possessionSeconds: null }, row)
}

function eaGoalieExpanded(e: EASeasonDetail): GoalieExpanded {
  return {
    shutoutPeriods: e.goalieShutoutPeriods,
    desperationSaves: e.goalieDesperationSaves,
    breakawayShots: e.goalieBrkShots,
    breakawaySaves: e.goalieBrkSaves,
    breakawaySavePct: e.goalieBrkSavePct,
    penaltyShots: e.goaliePenShots,
    penaltyShotSaves: e.goaliePenSaves,
    penaltyShotSavePct: e.goaliePenSavePct,
    pokeChecks: e.goaliePokeChecks,
    pkClearZone: e.goaliePkClearZone,
  }
}

function archiveGoalieExpanded(g: ArchiveGoalieDetail | null): PartialExpanded<GoalieExpanded> {
  const n = <K extends keyof ArchiveGoalieDetail>(k: K) => g?.[k] ?? null
  return {
    shutoutPeriods: null,
    desperationSaves: n('desperationSaves'),
    breakawayShots: n('breakawayShots'),
    breakawaySaves: n('breakawaySaves'),
    breakawaySavePct: pct(n('breakawaySaves'), n('breakawayShots')),
    penaltyShots: n('penaltyShots'),
    penaltyShotSaves: n('penaltyShotSaves'),
    penaltyShotSavePct: pct(n('penaltyShotSaves'), n('penaltyShots')),
    pokeChecks: null,
    pkClearZone: n('pkClearZone'),
  }
}

function label(row: PlayerCareerSeasonRow): SeasonLabel {
  return {
    gameTitleId: row.gameTitleId,
    gameTitleName: row.gameTitleName,
    gameTitleSlug: row.gameTitleSlug,
    source: row.source,
  }
}

function seasonSource(sources: readonly SeasonLabel['source'][], archiveNote: string): StatsSource {
  const hasEa = sources.includes('ea')
  const hasArchive = sources.includes('historical')
  return {
    kind: 'unspecified',
    label: hasEa && hasArchive ? 'EA + archive' : hasEa ? 'EA season totals' : 'Archive',
    description:
      'One row per game. Each season comes from one source: EA’s season totals when EA has them, otherwise the reviewed archive.',
    ...(hasArchive ? { notes: [archiveNote] } : {}),
  }
}

function goalieBase(row: PlayerCareerSeasonRow): Omit<SeasonGoalieRow, 'toiSeconds' | 'expanded'> {
  return {
    playerId: null,
    gamertag: row.gameTitleName,
    gamesPlayed: row.goalieGp,
    wins: row.wins,
    losses: row.losses,
    otl: row.otl,
    savePct: row.savePct,
    gaa: row.gaa,
    shutouts: row.shutouts,
    totalSaves: row.saves,
    totalShotsAgainst: row.shotsAgainst,
    totalGoalsAgainst: row.goalsAgainst,
    recordUnavailable: false,
    season: label(row),
  }
}

/**
 * Season-by-season rows for the selected role, in the input order (newest
 * title first). Each row takes its detail from the same single source as its
 * base stats — EA detail for `source='ea'`, archive detail for 'historical' —
 * so sources are never mixed within a season.
 */
export function buildSeasonTable(
  seasons: readonly PlayerCareerSeasonRow[],
  eaSeasons: readonly EASeasonDetail[],
  archive: readonly ArchiveSeasonDetail[],
  role: 'skater' | 'goalie',
  positionSeasons?: readonly PlayerPositionSeason[] | 'error',
): SeasonTable {
  const eaByTitle = new Map(eaSeasons.map((e) => [e.gameTitleId, e]))
  const archiveByTitle = new Map(archive.map((a) => [a.gameTitleId, a]))
  const eaFor = (row: PlayerCareerSeasonRow) =>
    row.source === 'ea' ? eaByTitle.get(row.gameTitleId) : undefined
  const archiveFor = (row: PlayerCareerSeasonRow) =>
    row.source === 'historical' ? archiveByTitle.get(row.gameTitleId) : undefined

  if (role === 'goalie') {
    const rows = seasons
      .filter((row) => row.goalieGp > 0)
      .map((row): SeasonGoalieRow => {
        const ea = eaFor(row)
        if (row.source === 'ea') {
          return {
            ...goalieBase(row),
            toiSeconds: ea?.goalieToiSeconds ?? null,
            expanded: ea !== undefined ? eaGoalieExpanded(ea) : null,
          }
        }
        // Archive: TOI from the screenshot minutes; SA and GAA derived from
        // the counts when the archive row didn't store them.
        const g = archiveFor(row)?.goalie ?? null
        const toi = g?.minutesPlayed != null ? g.minutesPlayed * 60 : null
        const sv = row.saves
        const ga = row.goalsAgainst
        return {
          ...goalieBase(row),
          gaa:
            row.gaa ??
            (ga !== null && toi !== null && toi > 0 ? ((ga * 3600) / toi).toFixed(2) : null),
          totalShotsAgainst: row.shotsAgainst ?? (sv !== null && ga !== null ? sv + ga : null),
          toiSeconds: toi,
          expanded: archiveGoalieExpanded(g),
        }
      })
    return {
      role,
      rows,
      source: seasonSource(
        rows.map((r) => r.season.source),
        ARCHIVE_GOALIE_NOTE,
      ),
    }
  }

  const rows = seasons
    .filter((row) => row.skaterGp > 0)
    .map((row): SeasonSkaterRow => {
      const ea = eaFor(row)
      const sk = archiveFor(row)?.skater ?? null
      const archiveRates =
        sk === null
          ? null
          : {
              faceoffPct: pct(
                sk.faceoffWins,
                sk.faceoffWins !== null && sk.faceoffLosses !== null
                  ? sk.faceoffWins + sk.faceoffLosses
                  : null,
              ),
              passPct: pct(sk.passes, sk.passAttempts),
            }
      return {
        playerId: null,
        gamertag: row.gameTitleName,
        position: null,
        gamesPlayed: row.skaterGp,
        goals: row.goals,
        assists: row.assists,
        points: row.points,
        plusMinus: row.plusMinus,
        pim: row.pim,
        shots: row.shots,
        hits: row.hits,
        takeaways: row.takeaways,
        giveaways: row.giveaways,
        // Archive FO%/PASS% are recomputed from the complete-or-null screenshot
        // totals: the all-modes helper treats a missing count as 0 (a 3-0
        // faceoff record would read 100%).
        faceoffPct: archiveRates?.faceoffPct ?? (archiveRates ? null : row.faceoffPct),
        passPct: archiveRates?.passPct ?? (archiveRates ? null : row.passPct),
        shotAttempts: row.shotAttempts,
        toiSeconds: ea?.toiSeconds ?? null,
        expanded:
          row.source === 'ea'
            ? ea !== undefined
              ? eaSkaterExpanded(ea)
              : null
            : archiveSkaterExpanded(row, sk),
        season: label(row),
      }
    })
  return {
    role,
    rows,
    source: seasonSource(
      rows.map((r) => r.season.source),
      ARCHIVE_SKATER_NOTE,
    ),
    ...(positionSeasons === undefined
      ? {}
      : {
          positions: positionSeasons === 'error' ? 'error' : buildSeasonPositions(positionSeasons),
        }),
  }
}

/**
 * Per-position season rows (newest first): each season's line at that
 * position from the season screenshots where they exist, otherwise the
 * site's tracked games — never both for one season.
 */
export function buildSeasonPositions(
  seasons: readonly PlayerPositionSeason[],
): Exclude<SeasonPositions, 'error'> {
  const out = {} as Exclude<SeasonPositions, 'error'>
  for (const o of POSITION_OPTIONS) {
    const rows: SeasonSkaterRow[] = []
    for (const s of seasons) {
      const line = s.lines[o.key]
      if (line === null) continue
      rows.push({
        playerId: null,
        gamertag: s.gameTitleName,
        position: null,
        ...lineToDisplayFields(line),
        season: {
          gameTitleId: s.gameTitleId,
          gameTitleName: s.gameTitleName,
          gameTitleSlug: s.gameTitleSlug,
          source: s.source === 'archive' ? 'historical' : 'tracked',
        },
      })
    }
    const hasArchive = rows.some((r) => r.season.source === 'historical')
    const hasTracked = rows.some((r) => r.season.source === 'tracked')
    const notes = positionNotes(rows)
    out[o.key] = {
      rows,
      source: {
        kind: 'unspecified',
        label:
          hasArchive && hasTracked ? 'Archive + tracked' : hasArchive ? 'Archive' : 'Tracked games',
        description: `Games at ${o.title.toLowerCase()} each season: the season screenshots where they exist, otherwise the games this site tracked.`,
        ...(notes.length > 0 ? { notes } : {}),
      },
    }
  }
  return out
}
