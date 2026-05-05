import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { and, eq, isNull, sql as drizzleSql } from 'drizzle-orm'
import type {
  HistoricalClubMemberGameMode,
  HistoricalClubMemberRoleGroup,
  HistoricalClubMemberReviewStatus,
  HistoricalClubMemberSourceReviewStatus,
} from '../schema/index.js'
import type * as ClientNs from '../client.js'
import type * as SchemaNs from '../schema/index.js'

type DbModule = typeof ClientNs
type SchemaModule = typeof SchemaNs
type TxArg = Parameters<Parameters<DbModule['db']['transaction']>[0]>[0]
type DbLike = DbModule['db'] | TxArg

interface SourceContribution {
  sourceAssetPath: string
  sortedByMetricLabel: string
  contributedMetrics: string[]
  rawExtract: Record<string, unknown>
  reviewStatus?: HistoricalClubMemberSourceReviewStatus
  confidenceScore?: number | string | null
  extractedAt?: string | null
  reviewedAt?: string | null
}

interface ClubMemberRecord {
  titleSlug: string
  gameMode: HistoricalClubMemberGameMode
  roleGroup: HistoricalClubMemberRoleGroup
  gamertagSnapshot: string
  playerNameSnapshot?: string | null
  importBatch: string
  reviewStatus?: HistoricalClubMemberReviewStatus
  metrics: Record<string, unknown>
  sources: SourceContribution[]
}

type RawSourceContribution = Partial<SourceContribution> & Record<string, unknown>
type RawClubMemberRecord = Partial<ClubMemberRecord> & {
  metrics?: unknown
  sources?: unknown
}

const SKATER_INT_KEYS = [
  'skater_gp',
  'goalie_gp',
  'goals',
  'assists',
  'points',
  'plus_minus',
  'pim',
  'hits',
  'pp_goals',
  'sh_goals',
  'blocked_shots',
  'giveaways',
  'takeaways',
  'interceptions',
  'shots',
] as const
const SKATER_DEC_KEYS = ['dnf_pct', 'pass_pct', 'shooting_pct'] as const
const GOALIE_INT_KEYS = [
  'wins',
  'losses',
  'otl',
  'shutouts',
  'shutout_periods',
  'total_saves',
  'total_goals_against',
] as const
const GOALIE_DEC_KEYS = ['save_pct', 'gaa'] as const

function usage(): never {
  throw new Error(
    'Usage: node dist/tools/import-club-member-reviewed.js <reviewed-json-path> [import-batch]',
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

function normalizeTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) throw new Error(`Invalid timestamp: ${value}`)
  return dt
}

export function buildMetricColumns(
  metrics: Record<string, unknown>,
): Record<string, number | string | null> {
  const out: Record<string, number | string | null> = {}
  for (const key of SKATER_INT_KEYS) out[key] = readOptionalInt(metrics, key)
  for (const key of SKATER_DEC_KEYS) out[key] = readOptionalDecimal(metrics, key)
  for (const key of GOALIE_INT_KEYS) out[key] = readOptionalInt(metrics, key)
  for (const key of GOALIE_DEC_KEYS) out[key] = readOptionalDecimal(metrics, key)
  return out
}

const METRIC_KEY_TO_COLUMN: Record<string, string> = {
  skater_gp: 'skaterGp',
  goalie_gp: 'goalieGp',
  goals: 'goals',
  assists: 'assists',
  points: 'points',
  plus_minus: 'plusMinus',
  pim: 'pim',
  hits: 'hits',
  pp_goals: 'ppGoals',
  sh_goals: 'shGoals',
  dnf_pct: 'dnfPct',
  pass_pct: 'passPct',
  blocked_shots: 'blockedShots',
  giveaways: 'giveaways',
  takeaways: 'takeaways',
  interceptions: 'interceptions',
  shots: 'shots',
  shooting_pct: 'shootingPct',
  wins: 'wins',
  losses: 'losses',
  otl: 'otl',
  save_pct: 'savePct',
  gaa: 'gaa',
  shutouts: 'shutouts',
  shutout_periods: 'shutoutPeriods',
  total_saves: 'totalSaves',
  total_goals_against: 'totalGoalsAgainst',
}

export function snakeMetricsToCamel(
  snake: Record<string, number | string | null>,
): Record<string, number | string | null> {
  const out: Record<string, number | string | null> = {}
  for (const [key, value] of Object.entries(snake)) {
    const column = METRIC_KEY_TO_COLUMN[key]
    if (!column) throw new Error(`Unknown metric key: ${key}`)
    out[column] = value
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

async function matchPlayerId(
  db: DbLike,
  players: SchemaModule['players'],
  history: SchemaModule['playerGamertagHistory'],
  gamertag: string,
): Promise<number | null> {
  const tag = gamertag.toLowerCase()

  const current = await db
    .select({ id: players.id })
    .from(players)
    .where(drizzleSql`lower(${players.gamertag}) = ${tag}`)
    .limit(1)
  if (current[0]) return current[0].id

  const historical = await db
    .select({ playerId: history.playerId })
    .from(history)
    .where(drizzleSql`lower(${history.gamertag}) = ${tag}`)
    .limit(1)
  if (historical[0]) return historical[0].playerId

  return null
}

async function findExistingRow(
  db: DbLike,
  table: SchemaModule['historicalClubMemberSeasonStats'],
  args: {
    gameTitleId: number
    gameMode: HistoricalClubMemberGameMode
    roleGroup: HistoricalClubMemberRoleGroup
    playerId: number | null
    gamertagSnapshot: string
  },
): Promise<{ id: number } | null> {
  const { gameTitleId, gameMode, roleGroup, playerId, gamertagSnapshot } = args
  const baseCond = and(
    eq(table.gameTitleId, gameTitleId),
    eq(table.gameMode, gameMode),
    eq(table.roleGroup, roleGroup),
  )
  const cond =
    playerId !== null
      ? and(baseCond, eq(table.playerId, playerId))
      : and(
          baseCond,
          isNull(table.playerId),
          drizzleSql`lower(${table.gamertagSnapshot}) = ${gamertagSnapshot.toLowerCase()}`,
        )
  const found = await db.select({ id: table.id }).from(table).where(cond).limit(1)
  return found[0] ?? null
}

async function main() {
  const [, , inputPath, importBatchOverride] = process.argv
  if (!inputPath) usage()

  const [{ db, sql }, schema] = await Promise.all([
    import('../client.js'),
    import('../schema/index.js'),
  ])
  const {
    gameTitles,
    historicalClubMemberSeasonStats,
    historicalClubMemberStatSources,
    playerGamertagHistory,
    players,
  } = schema

  let imported = 0
  let updated = 0
  let unmatched = 0
  let sourceRows = 0
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
        const record = item as RawClubMemberRecord

        const titleSlug = requireString(record.titleSlug, 'titleSlug')
        const gameMode = record.gameMode
        if (gameMode !== '6s' && gameMode !== '3s') {
          throw new Error(`Unsupported gameMode: ${stringifyUnknown(gameMode)}`)
        }
        const roleGroup = record.roleGroup
        if (roleGroup !== 'skater' && roleGroup !== 'goalie') {
          throw new Error(`Unsupported roleGroup: ${stringifyUnknown(roleGroup)}`)
        }
        const gamertagSnapshot = requireString(record.gamertagSnapshot, 'gamertagSnapshot')
        const importBatch =
          importBatchOverride?.trim() ?? requireString(record.importBatch, 'importBatch')
        const playerNameSnapshot =
          typeof record.playerNameSnapshot === 'string' && record.playerNameSnapshot.trim() !== ''
            ? record.playerNameSnapshot.trim()
            : null

        if (!isPlainRecord(record.metrics)) {
          throw new Error(`Invalid metrics payload for ${gamertagSnapshot}`)
        }
        if (!Array.isArray(record.sources) || record.sources.length === 0) {
          throw new Error(`At least one source contribution required for ${gamertagSnapshot}`)
        }

        const gameTitleId = await getGameTitleId(tx, gameTitles, titleSlug)
        const playerId = await matchPlayerId(tx, players, playerGamertagHistory, gamertagSnapshot)
        if (playerId === null) unmatched += 1

        const reviewStatus: HistoricalClubMemberReviewStatus =
          record.reviewStatus ?? (playerId === null ? 'needs_identity_match' : 'pending_review')

        const metricColumnsSnake = buildMetricColumns(record.metrics)
        const metricColumns = snakeMetricsToCamel(metricColumnsSnake)
        const now = new Date()

        const existing = await findExistingRow(tx, historicalClubMemberSeasonStats, {
          gameTitleId,
          gameMode,
          roleGroup,
          playerId,
          gamertagSnapshot,
        })

        let statRowId: number
        if (existing) {
          const updatePatch: Record<string, unknown> = {
            gamertagSnapshot,
            playerNameSnapshot,
            playerId,
            reviewStatus,
            importBatch,
            updatedAt: now,
          }
          for (const [column, value] of Object.entries(metricColumns)) {
            if (value !== null) updatePatch[column] = value
          }
          await tx
            .update(historicalClubMemberSeasonStats)
            .set(updatePatch)
            .where(eq(historicalClubMemberSeasonStats.id, existing.id))
          statRowId = existing.id
          updated += 1
        } else {
          const inserted = await tx
            .insert(historicalClubMemberSeasonStats)
            .values({
              gameTitleId,
              gameMode,
              roleGroup,
              playerId,
              gamertagSnapshot,
              playerNameSnapshot,
              reviewStatus,
              importBatch,
              createdAt: now,
              updatedAt: now,
              ...metricColumns,
            })
            .returning({ id: historicalClubMemberSeasonStats.id })
          const newRow = inserted[0]
          if (!newRow) throw new Error(`Failed to insert canonical row for ${gamertagSnapshot}`)
          statRowId = newRow.id
          imported += 1
        }

        for (const src of record.sources as RawSourceContribution[]) {
          const confidence =
            src.confidenceScore === null || src.confidenceScore === undefined
              ? null
              : Number(src.confidenceScore).toFixed(2)
          const contributedMetrics = Array.isArray(src.contributedMetrics)
            ? src.contributedMetrics
            : []
          const rawExtractJson = isPlainRecord(src.rawExtract) ? src.rawExtract : {}
          await tx.insert(historicalClubMemberStatSources).values({
            statRowId,
            sourceAssetPath: requireString(src.sourceAssetPath, 'sources[].sourceAssetPath'),
            sortedByMetricLabel: requireString(
              src.sortedByMetricLabel,
              'sources[].sortedByMetricLabel',
            ),
            contributedMetrics,
            rawExtractJson,
            confidenceScore: confidence,
            reviewStatus: src.reviewStatus ?? 'pending_review',
            extractedAt: normalizeTimestamp(src.extractedAt) ?? now,
            reviewedAt: normalizeTimestamp(src.reviewedAt),
          })
          sourceRows += 1
        }
      }
    })

    console.log(
      JSON.stringify({ inputPath, imported, updated, unmatched, sourceRows, skipped }, null, 2),
    )
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
