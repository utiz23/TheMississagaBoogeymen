/**
 * Core ingestion cycle.
 *
 * Responsibilities:
 *  - Fetch recent matches from EA API for each active game title + match type
 *  - Store raw payloads (raw-first: store before transform)
 *  - Attempt transform + persist structured data
 *  - Write ingestion_log rows
 *  - Recompute aggregates after each game title
 *
 * All operations are idempotent. Running the same cycle twice is safe.
 */

import { createHash } from 'node:crypto'
import {
  db,
  gameTitles,
  ingestionLog,
  rawMatchPayloads,
  matches,
  opponentPlayerMatchStats,
  players,
  playerGamertagHistory,
  playerMatchStats,
  playerProfiles,
  MATCH_TYPE,
  type GameTitle,
  type Player,
  type NewPlayer,
} from '@eanhl/db'
import { eq, isNull, and } from 'drizzle-orm'
import { fetchMatches, matchesUrl, throttle, EaApiError, type EaMatchType } from '@eanhl/ea-client'
import { transformMatch, type TransformResult, type PlayerIdentity } from './transform.js'
import { recomputeAggregates } from './aggregate.js'
import { syncAiGoalies } from './ai-goalie-sync.js'
import { syncClubFinals } from './club-finals-sync.js'
import { recomputeCardProgression } from './card-progression.js'
import { fetchAndStoreMemberStats, fetchAndStoreSeasonalStats } from './ingest-members.js'
import { fetchAndStoreOpponentClubs } from './ingest-opponents.js'
import { fetchAndStoreSeasonRank } from './ingest-season-rank.js'
import { runQuickCheck, type QuickCheckRequest, type QuickCheckResult } from './quick-check.js'

type DbConn = Pick<typeof db, 'select' | 'insert' | 'update'>

// ─── Ingestion cycle ──────────────────────────────────────────────────────────

/**
 * Titles the worker polls. Ingestion eligibility is `game_titles.is_active` and
 * nothing else: the frontend default (`is_default`) and chronology
 * (`release_order`) are display controls the poll filter never consults, so a
 * title can be the site default without being polled, and vice versa.
 */
export function selectIngestionEligibleTitles() {
  return db.select().from(gameTitles).where(eq(gameTitles.isActive, true))
}

export async function runIngestionCycle(): Promise<void> {
  try {
    await runIngestionCycleSteps()
  } finally {
    await markCycleFinished()
  }
}

/**
 * Stamp `finished_at` on this pass's ingestion_log rows, after every step
 * (AI goalies, aggregates, members, cards). The discord poster posts a game
 * once its row is stamped (operator, 2026-11-09: post after one pass, not
 * the next). The loop never overlaps, so every unstamped row is this pass's
 * (or one a crash left unstamped, which is then finished too).
 */
export async function markCycleFinished(): Promise<void> {
  try {
    await db
      .update(ingestionLog)
      .set({ finishedAt: new Date() })
      .where(isNull(ingestionLog.finishedAt))
  } catch (err) {
    console.error('[ingest] Could not stamp the finished pass:', err)
  }
}

async function runIngestionCycleSteps(): Promise<void> {
  const activeGameTitles = await selectIngestionEligibleTitles()

  if (activeGameTitles.length === 0) {
    console.log('[ingest] No active game titles. Skipping cycle.')
    return
  }

  for (const title of activeGameTitles) {
    console.log(`[ingest] Processing game title: ${title.slug}`)
    await ingestGameTitle(title)

    // AI goalies' lines for games with no human goalie, before the aggregates
    // so local stats include them. Non-fatal: never blocks match ingestion.
    try {
      const ai = await syncAiGoalies(title.id)
      if (ai.skipped === undefined) {
        console.log(
          `[ingest] AI goalies ${title.slug}: ${ai.perGoalie.map((g) => `${g.gamertag} ${String(g.games)}`).join(', ')}`,
        )
      }
    } catch (err) {
      console.error(`[ingest] AI goalie sync failed for ${title.slug}:`, err)
    }

    try {
      await recomputeAggregates(title.id)
      console.log(`[ingest] Aggregates recomputed for ${title.slug}`)
    } catch (err) {
      console.error(`[ingest] Aggregate recomputation failed for ${title.slug}:`, err)
    }

    // Club Finals rounds (CF1) from the stored games. Non-fatal; needs migration 0083.
    await runClubFinalsStep(title.id, title.slug, '[ingest]')

    // Fetch EA member stats: archives raw payload, resolves player rows for
    // members not yet seen in match data, and writes structured EA season totals
    // to ea_member_season_stats for debug/baseline comparison.
    // No web surface reads from ea_member_season_stats; all stats pages use local aggregates.
    // Errors here are non-fatal — match ingestion already succeeded.
    try {
      await fetchAndStoreMemberStats(title)
    } catch (err) {
      console.error(`[ingest] Member stats fetch failed for ${title.slug}:`, err)
    }

    // Fetch official EA club record (clubs/seasonalStats) — stored in club_seasonal_stats.
    // Non-fatal; a failure here does not affect match data or player aggregates.
    try {
      await fetchAndStoreSeasonalStats(title)
    } catch (err) {
      console.error(`[ingest] Seasonal stats fetch failed for ${title.slug}:`, err)
    }

    // Fetch opponent club metadata (clubs/info) for any new opponents.
    // Populates opponent_clubs for crest display on match-facing surfaces.
    // Non-fatal; only affects logo display, not match data.
    try {
      await fetchAndStoreOpponentClubs(title)
    } catch (err) {
      console.error(`[ingest] Opponent club info fetch failed for ${title.slug}:`, err)
    }

    // Fetch competitive season rank and division thresholds (clubs/seasonRank + settings).
    // Populates club_season_rank for the home page division widget.
    // Non-fatal; only affects widget display.
    try {
      await fetchAndStoreSeasonRank(title)
    } catch (err) {
      console.error(`[ingest] Season rank fetch failed for ${title.slug}:`, err)
    }
  }

  // Card progression (badge levels, tier, level) reads every card title's
  // recorded club games (plus EA totals for dekes, fights and breakaways), so it
  // runs once per cycle, after them.
  // Non-fatal: never blocks match ingestion. Needs migration 0060 applied first.
  try {
    const results = await recomputeCardProgression({ dryRun: false })
    console.log(`[ingest] Card progression recomputed for ${String(results.length)} players`)
  } catch (err) {
    console.error('[ingest] Card progression recompute failed:', err)
  }
}

/**
 * Quick check (live events E1): the EA match lists only, then the database-only follow-ups for a
 * new game and the `finished_at` stamp. Never called while a normal pass runs (one loop).
 * See `quick-check.ts`.
 */
export function runQuickMatchCheck(request: QuickCheckRequest): Promise<QuickCheckResult> {
  return runQuickCheck<GameTitle>(request, {
    listActiveTitles: () => selectIngestionEligibleTitles(),
    ingestMatchList: (title, matchType) => ingestMatchType(title, matchType),
    throttle,
    // Same order and non-fatal steps as the normal pass: AI goalies, then aggregates.
    afterNewGames: async (title) => {
      try {
        await syncAiGoalies(title.id)
      } catch (err) {
        console.error(`[quick-check] AI goalie sync failed for ${title.slug}:`, err)
      }
      await recomputeAggregates(title.id)
      await runClubFinalsStep(title.id, title.slug, '[quick-check]')
    },
    afterAllNewGames: async () => {
      await recomputeCardProgression({ dryRun: false })
    },
    markFinished: markCycleFinished,
    log: (line) => console.error(line),
  })
}

/** One Club Finals derive for a title (CF1). Never throws: a failure only logs. */
async function runClubFinalsStep(titleId: number, slug: string, tag: string): Promise<void> {
  try {
    const r = await syncClubFinals(titleId)
    if (r.skipped !== undefined) return
    if (r.games > 0) {
      console.log(
        `${tag} Club Finals ${slug}: ${String(r.games)} games, ${String(r.attempts)} attempts` +
          (r.unplaced > 0 ? `, ${String(r.unplaced)} unplaced (after a won final)` : ''),
      )
    }
  } catch (err) {
    console.error(`${tag} Club Finals derive failed for ${slug}:`, err)
  }
}

async function ingestGameTitle(title: GameTitle): Promise<void> {
  for (const matchType of MATCH_TYPE) {
    await ingestMatchType(title, matchType)
    // Throttle between endpoint calls within a cycle.
    await throttle()
  }
}

async function ingestMatchType(
  title: GameTitle,
  matchType: EaMatchType,
): Promise<{ matchesNew: number }> {
  const startedAt = new Date()

  // Create the ingestion log row up front so we can link raw payloads to it.
  const [logRow] = await db
    .insert(ingestionLog)
    .values({
      gameTitleId: title.id,
      startedAt,
      matchType,
      status: 'success', // updated at end of cycle
    })
    .returning()

  if (!logRow) throw new Error('Failed to insert ingestion_log row')

  let matchesFound = 0
  let matchesNew = 0
  let transformsFailed = 0
  let status: 'success' | 'partial' | 'error' = 'success'
  let errorMessage: string | undefined

  try {
    const response = await fetchMatches({
      platform: title.eaPlatform as Parameters<typeof fetchMatches>[0]['platform'],
      clubId: title.eaClubId,
      matchType,
      baseUrl: title.apiBaseUrl,
    })

    matchesFound = response.length
    const sourceEndpoint = matchesUrl({
      platform: title.eaPlatform as Parameters<typeof matchesUrl>[0]['platform'],
      clubId: title.eaClubId,
      matchType,
      baseUrl: title.apiBaseUrl,
    })

    for (const rawMatch of response) {
      const eaMatchId = (rawMatch as { matchId?: string }).matchId
      if (!eaMatchId) {
        console.warn(`[ingest] Match without matchId skipped (${title.slug}/${matchType})`)
        continue
      }

      const payloadStr = JSON.stringify(rawMatch)
      const payloadHash = createHash('sha256').update(payloadStr).digest('hex')

      // Raw-first: insert before transform. ON CONFLICT DO NOTHING = idempotent.
      const inserted = await db
        .insert(rawMatchPayloads)
        .values({
          gameTitleId: title.id,
          eaMatchId,
          matchType,
          sourceEndpoint,
          payload: rawMatch as Record<string, unknown>,
          payloadHash,
          ingestionLogId: logRow.id,
        })
        .onConflictDoNothing()
        .returning()

      if (inserted.length === 0) {
        // Already in DB — skip transform.
        continue
      }

      const rawRow = inserted[0]
      if (!rawRow) throw new Error(`Failed to retrieve inserted raw payload for ${eaMatchId}`)
      matchesNew++

      try {
        const result = transformMatch(
          rawMatch,
          title.id,
          title.eaClubId,
          matchType,
          title.eaClubName,
        )
        await persistTransform(result)
        await db
          .update(rawMatchPayloads)
          .set({ transformStatus: 'success', transformError: null })
          .where(eq(rawMatchPayloads.id, rawRow.id))
      } catch (err) {
        transformsFailed++
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`[transform] Failed for match ${eaMatchId} (${title.slug}):`, msg)
        await db
          .update(rawMatchPayloads)
          .set({ transformStatus: 'error', transformError: msg })
          .where(eq(rawMatchPayloads.id, rawRow.id))
      }
    }

    if (transformsFailed > 0) {
      status = transformsFailed === matchesNew ? 'error' : 'partial'
    }
  } catch (err) {
    status = 'error'
    errorMessage = err instanceof Error ? err.message : String(err)
    if (err instanceof EaApiError) {
      console.error(
        `[ingest] EA API error (${title.slug}/${matchType}): ${String(err.status)} ${err.message}`,
      )
    } else {
      console.error(`[ingest] Unexpected error (${title.slug}/${matchType}):`, err)
    }
  }

  // finished_at is stamped at the end of the whole pass (markCycleFinished).
  await db
    .update(ingestionLog)
    .set({
      matchesFound,
      matchesNew,
      transformsFailed,
      status,
      errorMessage: errorMessage ?? null,
    })
    .where(eq(ingestionLog.id, logRow.id))

  console.log(
    `[ingest] ${title.slug}/${matchType}: found=${String(matchesFound)} new=${String(matchesNew)} failed=${String(transformsFailed)} status=${status}`,
  )
  return { matchesNew }
}

// ─── Persist transform result ─────────────────────────────────────────────────

/**
 * Persist a successful transform: upsert match + player identities + per-game stats.
 * All upserts are idempotent.
 * Exported so reprocess.ts can reuse it.
 */
export async function persistTransform(result: TransformResult): Promise<void> {
  await db.transaction(async (tx) => {
    const dbConn: DbConn = tx
    // Upsert match row. ON CONFLICT (game_title_id, ea_match_id) DO UPDATE.
    const [matchRow] = await dbConn
      .insert(matches)
      .values(result.match)
      .onConflictDoUpdate({
        target: [matches.gameTitleId, matches.eaMatchId],
        set: {
          opponentName: result.match.opponentName,
          result: result.match.result,
          scoreFor: result.match.scoreFor,
          scoreAgainst: result.match.scoreAgainst,
          shotsFor: result.match.shotsFor,
          shotsAgainst: result.match.shotsAgainst,
          hitsFor: result.match.hitsFor,
          hitsAgainst: result.match.hitsAgainst,
          faceoffPct: result.match.faceoffPct ?? null,
          timeOnAttack: result.match.timeOnAttack ?? null,
          penaltyMinutes: result.match.penaltyMinutes ?? null,
          eaGameTypeCode: result.match.eaGameTypeCode ?? null,
          gameMode: result.match.gameMode ?? null,
          passAttempts: result.match.passAttempts ?? null,
          passCompletions: result.match.passCompletions ?? null,
          ppGoals: result.match.ppGoals ?? null,
          ppOpportunities: result.match.ppOpportunities ?? null,
          penaltyMinutesAgainst: result.match.penaltyMinutesAgainst ?? null,
          timeOnAttackAgainst: result.match.timeOnAttackAgainst ?? null,
          passAttemptsAgainst: result.match.passAttemptsAgainst ?? null,
          passCompletionsAgainst: result.match.passCompletionsAgainst ?? null,
          ppGoalsAgainst: result.match.ppGoalsAgainst ?? null,
          ppOpportunitiesAgainst: result.match.ppOpportunitiesAgainst ?? null,
          bgmWasHome: result.match.bgmWasHome ?? null,
        },
      })
      .returning()

    if (!matchRow) throw new Error(`Failed to upsert match ${result.eaMatchId}`)

    for (const { identity, stats } of result.players) {
      const player = await upsertPlayer(identity, dbConn)
      const statsRow = { ...stats, playerId: player.id, matchId: matchRow.id }
      await dbConn
        .insert(playerMatchStats)
        .values(statsRow)
        .onConflictDoUpdate({
          // Unique index: (player_id, match_id)
          target: [playerMatchStats.playerId, playerMatchStats.matchId],
          // Update all stats on conflict so that reprocess corrects previously
          // ingested rows (e.g. after a schema change like adding toi_seconds or
          // fixing the goalie detection bug).
          set: {
            position: statsRow.position,
            isGoalie: statsRow.isGoalie,
            goals: statsRow.goals,
            assists: statsRow.assists,
            plusMinus: statsRow.plusMinus,
            shots: statsRow.shots,
            hits: statsRow.hits,
            pim: statsRow.pim,
            takeaways: statsRow.takeaways,
            giveaways: statsRow.giveaways,
            faceoffWins: statsRow.faceoffWins,
            faceoffLosses: statsRow.faceoffLosses,
            passAttempts: statsRow.passAttempts,
            passCompletions: statsRow.passCompletions,
            toiSeconds: statsRow.toiSeconds,
            shotAttempts: statsRow.shotAttempts,
            blockedShots: statsRow.blockedShots,
            ppGoals: statsRow.ppGoals,
            shGoals: statsRow.shGoals,
            interceptions: statsRow.interceptions,
            penaltiesDrawn: statsRow.penaltiesDrawn,
            possession: statsRow.possession,
            deflections: statsRow.deflections,
            saucerPasses: statsRow.saucerPasses,
            clientPlatform: statsRow.clientPlatform,
            playerDnf: statsRow.playerDnf,
            saves: statsRow.saves,
            goalsAgainst: statsRow.goalsAgainst,
            shotsAgainst: statsRow.shotsAgainst,
            breakawaySaves: statsRow.breakawaySaves,
            breakawayShots: statsRow.breakawayShots,
            despSaves: statsRow.despSaves,
            penSaves: statsRow.penSaves,
            penShots: statsRow.penShots,
            pokechecks: statsRow.pokechecks,
            ratingOffense: statsRow.ratingOffense,
            ratingDefense: statsRow.ratingDefense,
            ratingTeamplay: statsRow.ratingTeamplay,
            rankPoints: statsRow.rankPoints,
            rankTierAssetId: statsRow.rankTierAssetId,
            playerLevel: statsRow.playerLevel,
            playerClass: statsRow.playerClass,
            posSorted: statsRow.posSorted,
            removedReason: statsRow.removedReason,
            teamSide: statsRow.teamSide,
          },
        })
    }

    // Opponent player rows. No identity-table linkage — we just upsert by
    // (match_id, ea_player_id). Reprocess re-runs overwrite all stats fields.
    for (const opp of result.opponentPlayers) {
      const oppRow = { ...opp, matchId: matchRow.id }
      await dbConn
        .insert(opponentPlayerMatchStats)
        .values(oppRow)
        .onConflictDoUpdate({
          target: [opponentPlayerMatchStats.matchId, opponentPlayerMatchStats.eaPlayerId],
          set: {
            opponentClubId: oppRow.opponentClubId,
            gamertag: oppRow.gamertag,
            position: oppRow.position,
            isGoalie: oppRow.isGoalie,
            isGuest: oppRow.isGuest,
            playerDnf: oppRow.playerDnf,
            clientPlatform: oppRow.clientPlatform,
            goals: oppRow.goals,
            assists: oppRow.assists,
            plusMinus: oppRow.plusMinus,
            shots: oppRow.shots,
            hits: oppRow.hits,
            pim: oppRow.pim,
            takeaways: oppRow.takeaways,
            giveaways: oppRow.giveaways,
            faceoffWins: oppRow.faceoffWins,
            faceoffLosses: oppRow.faceoffLosses,
            passAttempts: oppRow.passAttempts,
            passCompletions: oppRow.passCompletions,
            toiSeconds: oppRow.toiSeconds,
            shotAttempts: oppRow.shotAttempts,
            blockedShots: oppRow.blockedShots,
            ppGoals: oppRow.ppGoals,
            shGoals: oppRow.shGoals,
            interceptions: oppRow.interceptions,
            penaltiesDrawn: oppRow.penaltiesDrawn,
            possession: oppRow.possession,
            deflections: oppRow.deflections,
            saucerPasses: oppRow.saucerPasses,
            saves: oppRow.saves,
            goalsAgainst: oppRow.goalsAgainst,
            shotsAgainst: oppRow.shotsAgainst,
            breakawaySaves: oppRow.breakawaySaves,
            breakawayShots: oppRow.breakawayShots,
            despSaves: oppRow.despSaves,
            penSaves: oppRow.penSaves,
            penShots: oppRow.penShots,
            pokechecks: oppRow.pokechecks,
            ratingOffense: oppRow.ratingOffense,
            ratingDefense: oppRow.ratingDefense,
            ratingTeamplay: oppRow.ratingTeamplay,
            rankPoints: oppRow.rankPoints,
            rankTierAssetId: oppRow.rankTierAssetId,
            playerLevel: oppRow.playerLevel,
            playerClass: oppRow.playerClass,
            posSorted: oppRow.posSorted,
            removedReason: oppRow.removedReason,
            teamSide: oppRow.teamSide,
          },
        })
    }
  })
}

// ─── Player upsert ────────────────────────────────────────────────────────────

/**
 * Upsert a player by ea_id (primary) or gamertag (fallback if ea_id absent).
 * Tracks gamertag changes via player_gamertag_history.
 * Exported so reprocess.ts can reuse it.
 */
export async function upsertPlayer(identity: PlayerIdentity, dbConn: DbConn = db): Promise<Player> {
  const now = new Date()

  let player: Player
  if (identity.eaId) {
    player = await upsertPlayerByEaId(identity, identity.eaId, now, dbConn)
  } else {
    // ea_id absent — degraded path. Duplicates are possible if gamertag changes.
    console.warn(`[player] blazeId absent for "${identity.gamertag}" — using gamertag fallback`)
    player = await upsertPlayerByGamertag(identity, now, dbConn)
  }

  // Ensure a profile row exists. ON CONFLICT DO NOTHING means:
  //   - new player: creates an empty row (all profile fields NULL)
  //   - existing player: no-op, preserving any manually populated fields
  await dbConn.insert(playerProfiles).values({ playerId: player.id }).onConflictDoNothing()

  return player
}

async function upsertPlayerByEaId(
  identity: PlayerIdentity,
  eaId: string,
  now: Date,
  dbConn: DbConn,
): Promise<Player> {
  const existing = await dbConn.select().from(players).where(eq(players.eaId, eaId)).limit(1)

  if (existing.length > 0) {
    const row = existing[0]
    if (!row) throw new Error(`Unexpected missing row for eaId ${eaId}`)
    if (row.gamertag !== identity.gamertag) {
      await handleGamertagChange(row, identity.gamertag, now, dbConn)
    }
    await dbConn
      .update(players)
      .set({ lastSeenAt: now, position: identity.position ?? row.position })
      .where(eq(players.id, row.id))
    return { ...row, lastSeenAt: now, position: identity.position ?? row.position }
  }

  return insertNewPlayer(identity, now, dbConn)
}

async function upsertPlayerByGamertag(
  identity: PlayerIdentity,
  now: Date,
  dbConn: DbConn,
): Promise<Player> {
  const existing = await dbConn
    .select()
    .from(players)
    .where(eq(players.gamertag, identity.gamertag))
    .limit(1)

  if (existing.length > 0) {
    const row = existing[0]
    if (!row) throw new Error(`Unexpected missing row for gamertag ${identity.gamertag}`)
    await dbConn
      .update(players)
      .set({ lastSeenAt: now, position: identity.position ?? row.position })
      .where(eq(players.id, row.id))
    return { ...row, lastSeenAt: now }
  }

  return insertNewPlayer(identity, now, dbConn)
}

async function insertNewPlayer(
  identity: PlayerIdentity,
  now: Date,
  dbConn: DbConn,
): Promise<Player> {
  const values: NewPlayer = {
    eaId: identity.eaId ?? null,
    gamertag: identity.gamertag,
    position: identity.position ?? null,
    firstSeenAt: now,
    lastSeenAt: now,
  }

  const [newPlayer] = await dbConn.insert(players).values(values).returning()
  if (!newPlayer) throw new Error(`Failed to insert player "${identity.gamertag}"`)

  // Open initial gamertag history row.
  await dbConn.insert(playerGamertagHistory).values({
    playerId: newPlayer.id,
    gamertag: identity.gamertag,
    seenFrom: now,
  })

  return newPlayer
}

/**
 * Close the current open-ended history row and open a new one for the new gamertag.
 * Must run inside the same transaction as the players.gamertag update to avoid
 * a race with the partial unique index on (player_id) WHERE seen_until IS NULL.
 *
 * NOTE: Currently not wrapped in a transaction. At this data volume with a single
 * worker process, the race window is acceptable. Wrap in db.transaction() if the
 * worker ever runs concurrently.
 */
async function handleGamertagChange(
  player: Player,
  newGamertag: string,
  now: Date,
  dbConn: DbConn,
): Promise<void> {
  console.log(
    `[player] Gamertag change: "${player.gamertag}" → "${newGamertag}" (id=${String(player.id)})`,
  )

  // Close current open-ended history row.
  await dbConn
    .update(playerGamertagHistory)
    .set({ seenUntil: now })
    .where(
      and(eq(playerGamertagHistory.playerId, player.id), isNull(playerGamertagHistory.seenUntil)),
    )

  // Update current gamertag.
  await dbConn.update(players).set({ gamertag: newGamertag }).where(eq(players.id, player.id))

  // Open new history row.
  await dbConn.insert(playerGamertagHistory).values({
    playerId: player.id,
    gamertag: newGamertag,
    seenFrom: now,
  })
}
