import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '../client.js'
import {
  ocrExtractions,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  players,
} from '../schema/index.js'

/**
 * Pre-game lineup card data for a single match.
 *
 * Returns two arrays — BGM ("our team") on one side, opponent on the other —
 * built from reviewed `player_loadout_snapshots` rows that are tied to this
 * match. Per-snapshot detail includes the resolved player (if any), position,
 * build class, level, and up to 3 X-Factors.
 *
 * Determining team side: `player_loadout_snapshots` doesn't carry a
 * `team_side` column today, so we look back at the source extraction's
 * `raw_result_json` (`our_team.roster[].fields.gamertag` vs
 * `opponent_team.roster[].fields.gamertag`) and bucket each snapshot by
 * gamertag-snapshot match. Snapshots whose gamertag doesn't appear in either
 * roster (e.g. because the source extraction is a `player_loadout_view`, not
 * a lobby capture) fall back to: resolved `playerId` → BGM (since EA only
 * ever creates rows in `players` for BGM members), unresolved → opponent.
 *
 * Per `(matchId, playerId or gamertagSnapshot)` the most-recent snapshot wins,
 * so a pre-game-lobby + player-loadout-view double-capture for the same
 * player collapses to one card.
 */
export async function getMatchLineups(matchId: number) {
  const rawSnapshots = await db
    .select({
      // snapshot
      snapshotId: playerLoadoutSnapshots.id,
      gamertagSnapshot: playerLoadoutSnapshots.gamertagSnapshot,
      playerNameSnapshot: playerLoadoutSnapshots.playerNameSnapshot,
      playerNamePersona: playerLoadoutSnapshots.playerNamePersona,
      playerNumber: playerLoadoutSnapshots.playerNumber,
      isCaptain: playerLoadoutSnapshots.isCaptain,
      teamSide: playerLoadoutSnapshots.teamSide,
      position: playerLoadoutSnapshots.position,
      buildClass: playerLoadoutSnapshots.buildClass,
      heightText: playerLoadoutSnapshots.heightText,
      weightLbs: playerLoadoutSnapshots.weightLbs,
      handedness: playerLoadoutSnapshots.handedness,
      playerLevelNumber: playerLoadoutSnapshots.playerLevelNumber,
      playerLevelRaw: playerLoadoutSnapshots.playerLevelRaw,
      capturedAt: playerLoadoutSnapshots.capturedAt,
      sourceExtractionId: playerLoadoutSnapshots.sourceExtractionId,
      playerId: playerLoadoutSnapshots.playerId,
      // joined player
      resolvedPlayer: sql<{ id: number; gamertag: string } | null>`
        CASE WHEN ${playerLoadoutSnapshots.playerId} IS NULL THEN NULL ELSE
          jsonb_build_object('id', ${players.id}, 'gamertag', ${players.gamertag})
        END
      `.as('resolved_player'),
      // source extraction screen + raw json (fallback for team side when
      // team_side column is null on legacy rows).
      screenType: ocrExtractions.screenType,
      rawJson: ocrExtractions.rawResultJson,
    })
    .from(playerLoadoutSnapshots)
    .leftJoin(players, eq(players.id, playerLoadoutSnapshots.playerId))
    .innerJoin(ocrExtractions, eq(ocrExtractions.id, playerLoadoutSnapshots.sourceExtractionId))
    .where(
      and(
        eq(playerLoadoutSnapshots.matchId, matchId),
        eq(playerLoadoutSnapshots.reviewStatus, 'reviewed'),
      ),
    )
    .orderBy(desc(playerLoadoutSnapshots.capturedAt))

  if (rawSnapshots.length === 0) {
    return { bgm: [], opponent: [] }
  }

  // X-Factors (with tier) for all snapshot ids in one shot.
  const snapshotIds = rawSnapshots.map((s) => s.snapshotId)
  const xFactorRows = await db
    .select()
    .from(playerLoadoutXFactors)
    .where(
      sql`${playerLoadoutXFactors.loadoutSnapshotId} IN (${sql.join(
        snapshotIds.map((id) => sql`${id}`),
        sql`,`,
      )})`,
    )
    .orderBy(asc(playerLoadoutXFactors.loadoutSnapshotId), asc(playerLoadoutXFactors.slotIndex))

  const xBySnapshot = new Map<number, typeof xFactorRows>()
  for (const x of xFactorRows) {
    const list = xBySnapshot.get(x.loadoutSnapshotId) ?? []
    list.push(x)
    xBySnapshot.set(x.loadoutSnapshotId, list)
  }

  // Bucket each snapshot into BGM vs opponent.
  const bgm: LineupRow[] = []
  const opponent: LineupRow[] = []
  const seenKey = new Set<string>() // dedup most-recent-wins per (matchId, key)

  for (const s of rawSnapshots) {
    // Key dedup by playerId when resolved, else by gamertag-snapshot.
    const key = s.playerId !== null ? `p:${String(s.playerId)}` : `g:${(s.gamertagSnapshot ?? '').toLowerCase()}`
    if (seenKey.has(key)) continue
    seenKey.add(key)

    const side = decideTeamSide(s)
    const row: LineupRow = {
      snapshotId: s.snapshotId,
      gamertagSnapshot: s.gamertagSnapshot,
      playerNameSnapshot: s.playerNameSnapshot,
      playerNamePersona: s.playerNamePersona,
      playerNumber: s.playerNumber,
      isCaptain: s.isCaptain,
      position: s.position,
      buildClass: s.buildClass,
      heightText: s.heightText,
      weightLbs: s.weightLbs,
      handedness: s.handedness,
      playerLevelNumber: s.playerLevelNumber,
      playerLevelRaw: s.playerLevelRaw,
      capturedAt: s.capturedAt,
      player: s.resolvedPlayer,
      xFactors: (xBySnapshot.get(s.snapshotId) ?? []).map((x) => ({
        slotIndex: x.slotIndex,
        name: x.xFactorName,
        tier: x.tier,
      })),
    }
    if (side === 'bgm') bgm.push(row)
    else opponent.push(row)
  }

  // Canonical hockey roster order: C → LW → RW → LD → RD → G. Apply to both sides.
  const positionOrder: Record<string, number> = { C: 0, LW: 1, RW: 2, LD: 3, RD: 4, G: 5 }
  const orderFn = (a: LineupRow, b: LineupRow) =>
    (positionOrder[a.position ?? ''] ?? 99) - (positionOrder[b.position ?? ''] ?? 99)
  bgm.sort(orderFn)
  opponent.sort(orderFn)

  return { bgm, opponent }
}

function decideTeamSide(snapshot: {
  teamSide: 'for' | 'against' | null
  gamertagSnapshot: string | null
  playerId: number | null
  screenType: string
  rawJson: unknown
}): 'bgm' | 'opponent' {
  // Preferred: team_side column populated by the post-2026-05 promoters
  // (from the gamertag-resolver heuristic).
  if (snapshot.teamSide === 'for') return 'bgm'
  if (snapshot.teamSide === 'against') return 'opponent'
  // Legacy fallback for snapshots that predate migration 0033: lobby captures
  // carry both teams' rosters in raw_result_json; match on gamertag-snapshot.
  const gamertag = (snapshot.gamertagSnapshot ?? '').toLowerCase()
  if (gamertag && snapshot.screenType.startsWith('pre_game_lobby')) {
    const raw = snapshot.rawJson as RawLobbyJson | null
    if (raw) {
      if (rosterHasGamertag(raw.our_team, gamertag)) return 'bgm'
      if (rosterHasGamertag(raw.opponent_team, gamertag)) return 'opponent'
    }
  }
  // Last-resort fallback: resolved playerId → BGM (EA ingest only creates
  // rows in `players` for BGM members).
  return snapshot.playerId !== null ? 'bgm' : 'opponent'
}

interface RawLobbyJson {
  our_team?: { roster?: RawLobbySlot[] }
  opponent_team?: { roster?: RawLobbySlot[] }
}

interface RawLobbySlot {
  fields?: { gamertag?: { value?: unknown; raw_text?: unknown } }
}

function rosterHasGamertag(team: RawLobbyJson['our_team'], gamertag: string): boolean {
  const roster = Array.isArray(team?.roster) ? team.roster : []
  for (const slot of roster) {
    const f = slot.fields?.gamertag
    const candidate = (
      (typeof f?.value === 'string' && f.value) ||
      (typeof f?.raw_text === 'string' && f.raw_text) ||
      ''
    ).toLowerCase()
    if (candidate && candidate === gamertag) return true
  }
  return false
}

export interface LineupRow {
  snapshotId: number
  gamertagSnapshot: string | null
  /** Full real name from loadout view title bar — e.g. "Evgeni Wanhg". */
  playerNameSnapshot: string | null
  /** Short in-game persona name from lobby state-2 — e.g. "E. Wanhg". */
  playerNamePersona: string | null
  /** In-game jersey number — e.g. 11. */
  playerNumber: number | null
  /** Captain ★ marker detected next to gamertag. */
  isCaptain: boolean | null
  position: string | null
  buildClass: string | null
  heightText: string | null
  weightLbs: number | null
  handedness: string | null
  playerLevelNumber: number | null
  playerLevelRaw: string | null
  capturedAt: Date
  player: { id: number; gamertag: string } | null
  xFactors: Array<{
    slotIndex: number
    name: string
    /** 'Elite' | 'All Star' | 'Specialist' — classified from HSV icon color. */
    tier: 'Elite' | 'All Star' | 'Specialist' | null
  }>
}

export type MatchLineups = Awaited<ReturnType<typeof getMatchLineups>>
