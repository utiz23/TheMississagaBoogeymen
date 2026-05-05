import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { and, eq } from 'drizzle-orm'
import type { HistoricalClubTeamReviewStatus } from '../schema/index.js'
import type * as ClientNs from '../client.js'
import type * as SchemaNs from '../schema/index.js'

type DbModule = typeof ClientNs
type SchemaModule = typeof SchemaNs
type TxArg = Parameters<Parameters<DbModule['db']['transaction']>[0]>[0]
type DbLike = DbModule['db'] | TxArg

interface ClubTeamRecord {
  titleSlug: string
  playlist: string
  importBatch: string
  reviewStatus?: HistoricalClubTeamReviewStatus
  confidenceScore?: number | string | null
  notes?: string | null
  metrics: Record<string, unknown>
  sources: string[]
  rawExtract?: Record<string, unknown>
}

type RawClubTeamRecord = Partial<ClubTeamRecord> & {
  metrics?: unknown
  sources?: unknown
}

const INT_KEYS = [
  'games_played',
  'wins',
  'losses',
  'otl',
  'win_loss_streak',
  'dnf_wins',
  'division_titles',
  'club_finals_gp',
  'goals_for',
  'goals_against',
  'goal_difference',
  'shots_for',
  'shots_against',
  'hits',
  'pim',
  'power_plays',
  'power_play_goals',
  'times_shorthanded',
  'short_handed_goals',
  'short_handed_goals_against',
  'faceoffs_won',
  'breakaways',
  'one_timer_goals',
  'passes',
  'pass_attempts',
  'blocked_shots',
] as const
const DEC_KEYS = [
  'did_not_finish_pct',
  'avg_goals_for',
  'avg_goals_against',
  'avg_win_margin',
  'avg_loss_margin',
  'shots_per_game',
  'avg_shots_against',
  'shooting_pct',
  'hits_per_game',
  'avg_pim',
  'power_play_pct',
  'power_play_kill_pct',
  'faceoff_pct',
  'breakaway_pct',
  'one_timer_pct',
  'passing_pct',
] as const
const TEXT_KEYS = ['avg_time_on_attack'] as const

const KEY_TO_COLUMN: Record<string, string> = {
  games_played: 'gamesPlayed',
  wins: 'wins',
  losses: 'losses',
  otl: 'otl',
  win_loss_streak: 'winLossStreak',
  did_not_finish_pct: 'didNotFinishPct',
  dnf_wins: 'dnfWins',
  division_titles: 'divisionTitles',
  club_finals_gp: 'clubFinalsGp',
  goals_for: 'goalsFor',
  goals_against: 'goalsAgainst',
  goal_difference: 'goalDifference',
  avg_goals_for: 'avgGoalsFor',
  avg_goals_against: 'avgGoalsAgainst',
  avg_win_margin: 'avgWinMargin',
  avg_loss_margin: 'avgLossMargin',
  shots_for: 'shotsFor',
  shots_against: 'shotsAgainst',
  shots_per_game: 'shotsPerGame',
  avg_shots_against: 'avgShotsAgainst',
  shooting_pct: 'shootingPct',
  hits: 'hits',
  hits_per_game: 'hitsPerGame',
  pim: 'pim',
  avg_pim: 'avgPim',
  power_plays: 'powerPlays',
  power_play_goals: 'powerPlayGoals',
  power_play_pct: 'powerPlayPct',
  power_play_kill_pct: 'powerPlayKillPct',
  times_shorthanded: 'timesShorthanded',
  short_handed_goals: 'shortHandedGoals',
  short_handed_goals_against: 'shortHandedGoalsAgainst',
  faceoffs_won: 'faceoffsWon',
  faceoff_pct: 'faceoffPct',
  breakaways: 'breakaways',
  breakaway_pct: 'breakawayPct',
  one_timer_goals: 'oneTimerGoals',
  one_timer_pct: 'oneTimerPct',
  passes: 'passes',
  pass_attempts: 'passAttempts',
  passing_pct: 'passingPct',
  blocked_shots: 'blockedShots',
  avg_time_on_attack: 'avgTimeOnAttack',
}

function usage(): never {
  throw new Error(
    'Usage: node dist/tools/import-club-team-reviewed.js <reviewed-json-path> [import-batch]',
  )
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid ${label}: expected non-empty string`)
  }
  return value.trim()
}

function stringifyUnknown(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readOptionalInt(stats: Record<string, unknown>, key: string): number | null {
  const value = stats[key]
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.replace(/,/g, '').trim(), 10)
    if (!Number.isNaN(parsed)) return parsed
  }
  throw new Error(`Invalid integer for ${key}: ${stringifyUnknown(value)}`)
}

function readOptionalDecimal(stats: Record<string, unknown>, key: string): string | null {
  const value = stats[key]
  if (value === undefined || value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2)
  if (typeof value === 'string') {
    const normalized = value.replace(/%/g, '').replace(/,/g, '').trim()
    const parsed = Number.parseFloat(normalized)
    if (!Number.isNaN(parsed)) return parsed.toFixed(2)
  }
  throw new Error(`Invalid decimal for ${key}: ${stringifyUnknown(value)}`)
}

function readOptionalText(stats: Record<string, unknown>, key: string): string | null {
  const value = stats[key]
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value.trim() || null
  return JSON.stringify(value)
}

export function buildColumns(metrics: Record<string, unknown>): Record<string, unknown> {
  const known = new Set<string>([...INT_KEYS, ...DEC_KEYS, ...TEXT_KEYS])
  const out: Record<string, unknown> = {}

  for (const key of Object.keys(metrics)) {
    if (!known.has(key)) {
      throw new Error(`Unknown metric key: ${key}`)
    }
  }

  for (const key of INT_KEYS) {
    const column = KEY_TO_COLUMN[key]
    if (!column) throw new Error(`Missing column mapping for ${key}`)
    out[column] = readOptionalInt(metrics, key)
  }
  for (const key of DEC_KEYS) {
    const column = KEY_TO_COLUMN[key]
    if (!column) throw new Error(`Missing column mapping for ${key}`)
    out[column] = readOptionalDecimal(metrics, key)
  }
  for (const key of TEXT_KEYS) {
    const column = KEY_TO_COLUMN[key]
    if (!column) throw new Error(`Missing column mapping for ${key}`)
    out[column] = readOptionalText(metrics, key)
  }

  return out
}

async function getGameTitleId(
  db: DbLike,
  gameTitles: SchemaModule['gameTitles'],
  titleSlug: string,
): Promise<number> {
  const rows = await db.select().from(gameTitles).where(eq(gameTitles.slug, titleSlug)).limit(1)
  const row = rows[0]
  if (!row) throw new Error(`Unknown game title slug: ${titleSlug}`)
  return row.id
}

async function main(): Promise<void> {
  const [, , inputPath, importBatchOverride] = process.argv
  if (!inputPath) usage()

  const [{ db, sql }, schema] = await Promise.all([
    import('../client.js'),
    import('../schema/index.js'),
  ])
  const { gameTitles, historicalClubTeamStats } = schema

  let imported = 0
  let updated = 0
  const skipped = 0

  try {
    const raw = JSON.parse(await readFile(inputPath, 'utf8')) as unknown
    const records = Array.isArray(raw)
      ? raw
      : raw !== null &&
          typeof raw === 'object' &&
          Array.isArray((raw as { records?: unknown }).records)
        ? (raw as { records: unknown[] }).records
        : null
    if (records === null) {
      throw new Error('Input must be a JSON array or an object with a records array')
    }

    await db.transaction(async (tx) => {
      for (const item of records) {
        const record = item as RawClubTeamRecord
        const titleSlug = requireString(record.titleSlug, 'titleSlug')
        const playlist = requireString(record.playlist, 'playlist')
        if (!Array.isArray(record.sources) || record.sources.length === 0) {
          throw new Error(`At least one source path required for ${titleSlug}/${playlist}`)
        }
        if (!isPlainRecord(record.metrics)) {
          throw new Error(`Invalid metrics payload for ${titleSlug}/${playlist}`)
        }
        const importBatch =
          importBatchOverride?.trim() ?? requireString(record.importBatch, 'importBatch')
        const reviewStatus: HistoricalClubTeamReviewStatus = record.reviewStatus ?? 'pending_review'
        const confidence =
          record.confidenceScore === null || record.confidenceScore === undefined
            ? null
            : Number(record.confidenceScore).toFixed(2)
        const gameTitleId = await getGameTitleId(tx, gameTitles, titleSlug)
        const columns = buildColumns(record.metrics)
        const now = new Date()

        const existingRows = await tx
          .select({ id: historicalClubTeamStats.id })
          .from(historicalClubTeamStats)
          .where(
            and(
              eq(historicalClubTeamStats.gameTitleId, gameTitleId),
              eq(historicalClubTeamStats.playlist, playlist),
            ),
          )
          .limit(1)
        const found = existingRows[0]
        const baseValues: Record<string, unknown> = {
          gameTitleId,
          playlist,
          ...columns,
          sourceAssetPaths: record.sources,
          rawExtractJson: record.rawExtract ?? {},
          importBatch,
          reviewStatus,
          confidenceScore: confidence,
          notes: record.notes ?? null,
          updatedAt: now,
        }

        type InsertShape = typeof historicalClubTeamStats.$inferInsert
        if (found) {
          await tx
            .update(historicalClubTeamStats)
            .set(baseValues as Partial<InsertShape>)
            .where(eq(historicalClubTeamStats.id, found.id))
          updated += 1
        } else {
          await tx
            .insert(historicalClubTeamStats)
            .values({ ...baseValues, createdAt: now } as InsertShape)
          imported += 1
        }
      }
    })

    console.log(JSON.stringify({ inputPath, imported, updated, skipped }, null, 2))
  } finally {
    await sql.end({ timeout: 5 })
  }
}

function isDirectRun(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
}

const run = isDirectRun() ? main() : Promise.resolve()

run.catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
