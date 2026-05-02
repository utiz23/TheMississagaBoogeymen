import { readFile } from 'node:fs/promises'
import { and, eq, isNull } from 'drizzle-orm'
import type {
  HistoricalGameMode,
  HistoricalPositionScope,
  HistoricalReviewStatus,
} from '../schema/index.js'

type DbModule = typeof import('../client.js')
type SchemaModule = typeof import('../schema/index.js')

interface ReviewedRecord {
  titleSlug: string
  gamertag: string
  gameMode: HistoricalGameMode
  positionScope: HistoricalPositionScope
  roleGroup: 'skater' | 'goalie'
  sourceGameModeLabel: string
  sourcePositionLabel: string
  sourceAssetPath: string
  importBatch: string
  reviewStatus: HistoricalReviewStatus
  confidenceScore?: number | string | null
  extractedAt?: string | null
  reviewedAt?: string | null
  importedAt?: string | null
  stats: Record<string, unknown>
}

function usage(): never {
  throw new Error(
    'Usage: node dist/tools/import-historical-reviewed.js <reviewed-json-path> [import-batch]',
  )
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Invalid ${label}: expected non-empty string`)
  }
  return value.trim()
}

function readOptionalInt(stats: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = stats[key]
    if (value === undefined || value === null || value === '') continue
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value.replace(/,/g, '').trim(), 10)
      if (!Number.isNaN(parsed)) return parsed
    }
  }
  return null
}

function readOptionalDecimal(stats: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = stats[key]
    if (value === undefined || value === null || value === '') continue
    if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2)
    if (typeof value === 'string') {
      const normalized = value.replace(/%/g, '').replace(/,/g, '').trim()
      const parsed = Number.parseFloat(normalized)
      if (!Number.isNaN(parsed)) return parsed.toFixed(2)
    }
  }
  return null
}

function requiredInt(stats: Record<string, unknown>, label: string, ...keys: string[]): number {
  const value = readOptionalInt(stats, ...keys)
  if (value === null) throw new Error(`Missing required stat: ${label}`)
  return value
}

async function getGameTitleId(
  db: DbModule['db'],
  gameTitles: SchemaModule['gameTitles'],
  titleSlug: string,
): Promise<number> {
  const rows = await db.select().from(gameTitles).where(eq(gameTitles.slug, titleSlug)).limit(1)
  const row = rows[0]
  if (!row) throw new Error(`Unknown game title slug: ${titleSlug}`)
  return row.id
}

async function resolvePlayerId(
  db: DbModule['db'],
  players: SchemaModule['players'],
  playerGamertagHistory: SchemaModule['playerGamertagHistory'],
  gamertag: string,
): Promise<number> {
  const existing = await db.select().from(players).where(eq(players.gamertag, gamertag)).limit(1)
  const player = existing[0]
  if (player) return player.id

  const inserted = await db
    .insert(players)
    .values({
      gamertag,
      position: null,
      isActive: false,
    })
    .returning({ id: players.id })

  const newPlayer = inserted[0]
  if (!newPlayer) throw new Error(`Failed to create player for gamertag ${gamertag}`)

  await db.insert(playerGamertagHistory).values({
    playerId: newPlayer.id,
    gamertag,
  })

  return newPlayer.id
}

function normalizeImportedAt(record: ReviewedRecord): Date {
  return record.importedAt ? new Date(record.importedAt) : new Date()
}

function normalizeTimestamp(value: string | null | undefined): Date | null {
  if (!value) return null
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) {
    throw new Error(`Invalid timestamp: ${value}`)
  }
  return dt
}

function extractSkaterPromotedStats(stats: Record<string, unknown>) {
  return {
    gamesPlayed: requiredInt(stats, 'games_played', 'games_played', 'gp'),
    goals: requiredInt(stats, 'goals', 'goals', 'g'),
    assists: requiredInt(stats, 'assists', 'assists', 'a'),
    points: requiredInt(stats, 'points', 'points', 'pts'),
    plusMinus: requiredInt(stats, 'plus_minus', 'plus_minus', 'pm', '+/-'),
    pim: readOptionalInt(stats, 'pim') ?? 0,
    shots: readOptionalInt(stats, 'shots', 'sog', 's') ?? 0,
    shotAttempts: readOptionalInt(stats, 'shot_attempts', 'satt') ?? 0,
    hits: readOptionalInt(stats, 'hits') ?? 0,
    takeaways: readOptionalInt(stats, 'takeaways', 'tk') ?? 0,
    giveaways: readOptionalInt(stats, 'giveaways', 'gv') ?? 0,
    faceoffWins: readOptionalInt(stats, 'faceoff_wins', 'fow'),
    faceoffLosses: readOptionalInt(stats, 'faceoff_losses', 'fol'),
    faceoffPct: readOptionalDecimal(stats, 'faceoff_pct', 'fo%'),
    passCompletions: readOptionalInt(stats, 'pass_completions', 'pass'),
    passAttempts: readOptionalInt(stats, 'pass_attempts', 'patt'),
    passPct: readOptionalDecimal(stats, 'pass_pct', 'pass%'),
    blockedShots: readOptionalInt(stats, 'blocked_shots', 'bs') ?? 0,
    interceptions: readOptionalInt(stats, 'interceptions', 'int') ?? 0,
    shGoals: readOptionalInt(stats, 'sh_goals', 'shg') ?? 0,
    gwGoals: readOptionalInt(stats, 'gw_goals', 'gwg') ?? 0,
    toiSeconds: readOptionalInt(stats, 'toi_seconds'),
  }
}

function extractGoaliePromotedStats(stats: Record<string, unknown>) {
  return {
    gamesPlayed: requiredInt(stats, 'games_played', 'games_played', 'gp'),
    goals: 0,
    assists: 0,
    points: 0,
    plusMinus: 0,
    pim: 0,
    shots: 0,
    shotAttempts: 0,
    hits: 0,
    takeaways: 0,
    giveaways: 0,
    faceoffWins: null,
    faceoffLosses: null,
    faceoffPct: null,
    passCompletions: null,
    passAttempts: null,
    passPct: null,
    blockedShots: 0,
    interceptions: 0,
    shGoals: 0,
    gwGoals: 0,
    toiSeconds: readOptionalInt(stats, 'toi_seconds'),
    wins: readOptionalInt(stats, 'wins', 'w'),
    losses: readOptionalInt(stats, 'losses', 'l'),
    otl: readOptionalInt(stats, 'otl'),
    savePct: readOptionalDecimal(stats, 'save_pct', 'sv%', 'svpct'),
    gaa: readOptionalDecimal(stats, 'gaa'),
    shutouts: readOptionalInt(stats, 'shutouts', 'so'),
    totalSaves: readOptionalInt(stats, 'total_saves', 'sv', 'saves'),
    totalShotsAgainst: readOptionalInt(stats, 'total_shots_against', 'sa', 'shots_against'),
    totalGoalsAgainst: readOptionalInt(stats, 'total_goals_against', 'ga', 'goals_against'),
  }
}

async function assertNoDuplicateOpenHistory(
  db: DbModule['db'],
  playerGamertagHistory: SchemaModule['playerGamertagHistory'],
  playerId: number,
) {
  const open = await db
    .select()
    .from(playerGamertagHistory)
    .where(and(eq(playerGamertagHistory.playerId, playerId), isNull(playerGamertagHistory.seenUntil)))
  if (open.length > 1) {
    throw new Error(`Player ${playerId} has multiple open gamertag history rows`)
  }
}

async function main() {
  const [, , inputPath, importBatchOverride] = process.argv
  if (!inputPath) usage()

  const [{ db, sql }, schema] = await Promise.all([import('../client.js'), import('../schema/index.js')])
  const {
    gameTitles,
    historicalPlayerSeasonStats,
    playerGamertagHistory,
    players,
  } = schema

  try {
  const raw = JSON.parse(await readFile(inputPath, 'utf8')) as unknown
  const records = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { records?: unknown }).records)
      ? ((raw as { records: unknown[] }).records as unknown[])
      : null

  if (!records) {
    throw new Error('Reviewed input must be a JSON array or an object with a records array')
  }

  let imported = 0
  let skipped = 0

  for (const item of records) {
    const record = item as ReviewedRecord
    const reviewStatus = record.reviewStatus
    if (reviewStatus !== 'reviewed') {
      skipped += 1
      continue
    }

    const titleSlug = requireString(record.titleSlug, 'titleSlug')
    const gamertag = requireString(record.gamertag, 'gamertag')
    const gameMode = record.gameMode
    const positionScope = record.positionScope
    const roleGroup = record.roleGroup
    if (roleGroup !== 'skater' && roleGroup !== 'goalie') {
      throw new Error(`Unsupported role_group for archive import: ${String(roleGroup)}`)
    }

    const stats = record.stats
    if (!stats || typeof stats !== 'object' || Array.isArray(stats)) {
      throw new Error(`Invalid stats payload for ${gamertag} (${titleSlug})`)
    }

    const gameTitleId = await getGameTitleId(db, gameTitles, titleSlug)
    const playerId = await resolvePlayerId(db, players, playerGamertagHistory, gamertag)
    await assertNoDuplicateOpenHistory(db, playerGamertagHistory, playerId)

    const promoted =
      roleGroup === 'goalie'
        ? extractGoaliePromotedStats(stats)
        : extractSkaterPromotedStats(stats)
    const importedAt = normalizeImportedAt(record)
    const extractedAt = normalizeTimestamp(record.extractedAt) ?? importedAt
    const reviewedAt = normalizeTimestamp(record.reviewedAt)
    const confidenceScore =
      record.confidenceScore === null || record.confidenceScore === undefined
        ? null
        : Number(record.confidenceScore).toFixed(2)

    await db
      .insert(historicalPlayerSeasonStats)
      .values({
        gameTitleId,
        playerId,
        gamertagSnapshot: gamertag,
        roleGroup,
        gameMode,
        positionScope,
        sourceGameModeLabel: requireString(record.sourceGameModeLabel, 'sourceGameModeLabel'),
        sourcePositionLabel: requireString(record.sourcePositionLabel, 'sourcePositionLabel'),
        sourceAssetPath: requireString(record.sourceAssetPath, 'sourceAssetPath'),
        importBatch: importBatchOverride?.trim() || requireString(record.importBatch, 'importBatch'),
        reviewStatus,
        confidenceScore,
        extractedAt,
        reviewedAt,
        importedAt,
        updatedAt: importedAt,
        statsJson: stats,
        ...promoted,
      })
      .onConflictDoUpdate({
        target: [
          historicalPlayerSeasonStats.gameTitleId,
          historicalPlayerSeasonStats.playerId,
          historicalPlayerSeasonStats.gameMode,
          historicalPlayerSeasonStats.positionScope,
          historicalPlayerSeasonStats.roleGroup,
        ],
        set: {
          gamertagSnapshot: gamertag,
          sourceGameModeLabel: requireString(record.sourceGameModeLabel, 'sourceGameModeLabel'),
          sourcePositionLabel: requireString(record.sourcePositionLabel, 'sourcePositionLabel'),
          sourceAssetPath: requireString(record.sourceAssetPath, 'sourceAssetPath'),
          importBatch: importBatchOverride?.trim() || requireString(record.importBatch, 'importBatch'),
          reviewStatus,
          confidenceScore,
          extractedAt,
          reviewedAt,
          importedAt,
          updatedAt: importedAt,
          statsJson: stats,
          ...promoted,
        },
      })

    imported += 1
  }

  console.log(
    JSON.stringify(
      {
        inputPath,
        imported,
        skipped,
      },
      null,
      2,
    ),
  )
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
