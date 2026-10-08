import type {
  PlayerArchiveSkaterDetailRow,
  PlayerCareerSeasonRow,
  getPlayerEASeasonStats,
} from '@eanhl/db/queries'
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
  source: 'ea' | 'historical'
}

export type SeasonSkaterRow = SkaterDisplayRow & { season: SeasonLabel }
export type SeasonGoalieRow = GoalieDisplayRow & { season: SeasonLabel }

export type SeasonTable =
  | { role: 'skater'; rows: SeasonSkaterRow[]; source: StatsSource }
  | { role: 'goalie'; rows: SeasonGoalieRow[]; source: StatsSource }

const ARCHIVE_SKATER_NOTE =
  'Archive seasons come from reviewed screenshots, which never showed power-play goals, hat tricks, possession, dekes, breakaways, penalty shots or time on ice; those cells show —. Their S% and SOG% are computed from goals, shots and attempts.'
const ARCHIVE_GOALIE_NOTE =
  'Archive seasons come from reviewed screenshots, which never showed shots against, time in net or EA’s detailed goalie stats; those cells show —.'

/** Percentage string (2 dp) of num/den, or null when it can't be computed. */
function pct(num: number | null, den: number | null): string | null {
  return num === null || den === null || den <= 0 ? null : ((num / den) * 100).toFixed(2)
}

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
 * Archive seasons only carry the counts the screenshots showed; everything
 * else is null (rendered "—"), never 0. S% and SOG% are derived with EA's
 * formulas (goals ÷ SOG, SOG ÷ attempts) since the archive never stored them.
 */
function archiveSkaterExpanded(
  row: PlayerCareerSeasonRow,
  a: PlayerArchiveSkaterDetailRow | undefined,
): PartialExpanded<SkaterExpanded> {
  return {
    powerPlayGoals: null,
    shortHandedGoals: a?.shortHandedGoals ?? null,
    gameWinningGoals: a?.gameWinningGoals ?? null,
    hatTricks: null,
    shotPct: pct(row.goals, row.shots),
    shotOnNetPct: pct(row.shots, row.shotAttempts),
    passes: a?.passes ?? null,
    passAttempts: a?.passAttempts ?? null,
    saucerPasses: null,
    possessionSeconds: null,
    dekes: null,
    dekesMade: null,
    deflections: null,
    faceoffWins: a?.faceoffWins ?? null,
    faceoffLosses: a?.faceoffLosses ?? null,
    blockedShots: a?.blockedShots ?? null,
    interceptions: a?.interceptions ?? null,
    pkClearZone: null,
    penaltiesDrawn: null,
    offsides: null,
    fights: null,
    fightsWon: null,
    breakaways: null,
    breakawayGoals: null,
    breakawayPct: null,
    penaltyShotAttempts: null,
    penaltyShotGoals: null,
    penaltyShotPct: null,
  }
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

function label(row: PlayerCareerSeasonRow): SeasonLabel {
  return {
    gameTitleId: row.gameTitleId,
    gameTitleName: row.gameTitleName,
    gameTitleSlug: row.gameTitleSlug,
    source: row.source,
  }
}

function seasonSource(sources: readonly ('ea' | 'historical')[], archiveNote: string): StatsSource {
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

/**
 * Season-by-season rows for the selected role, in the input order (newest
 * title first). Each row takes its detail from the same single source as its
 * base stats — EA detail for `source='ea'`, archive detail for 'historical' —
 * so sources are never mixed within a season.
 */
export function buildSeasonTable(
  seasons: readonly PlayerCareerSeasonRow[],
  eaSeasons: readonly EASeasonDetail[],
  archiveSkater: readonly PlayerArchiveSkaterDetailRow[],
  role: 'skater' | 'goalie',
): SeasonTable {
  const eaByTitle = new Map(eaSeasons.map((e) => [e.gameTitleId, e]))
  const archiveByTitle = new Map(archiveSkater.map((a) => [a.gameTitleId, a]))
  const eaFor = (row: PlayerCareerSeasonRow) =>
    row.source === 'ea' ? eaByTitle.get(row.gameTitleId) : undefined

  if (role === 'goalie') {
    const rows = seasons
      .filter((row) => row.goalieGp > 0)
      .map((row): SeasonGoalieRow => {
        const ea = eaFor(row)
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
          toiSeconds: ea?.goalieToiSeconds ?? null,
          recordUnavailable: false,
          expanded: ea !== undefined ? eaGoalieExpanded(ea) : null,
          season: label(row),
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
        faceoffPct: row.faceoffPct,
        passPct: row.passPct,
        shotAttempts: row.shotAttempts,
        toiSeconds: ea?.toiSeconds ?? null,
        expanded:
          row.source === 'ea'
            ? ea !== undefined
              ? eaSkaterExpanded(ea)
              : null
            : archiveSkaterExpanded(row, archiveByTitle.get(row.gameTitleId)),
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
  }
}
