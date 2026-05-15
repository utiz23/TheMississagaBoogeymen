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
        // No reviewStatus filter: rejection comes from the most-recent-snapshot
        // dedup below, which gives us one row per (player or gamertag) — the
        // newest. Manual review isn't wired up for loadout snapshots yet, so
        // filtering to 'reviewed' here would hide ~98% of captured rows.
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

  // Group snapshots by player key. rawSnapshots is already
  // capturedAt-DESC sorted, so within each group the first element is
  // the most recent snapshot.
  const groupsByKey = new Map<string, typeof rawSnapshots>()
  for (const s of rawSnapshots) {
    const key =
      s.playerId !== null
        ? `p:${String(s.playerId)}`
        : `g:${(s.gamertagSnapshot ?? '').toLowerCase()}`
    const list = groupsByKey.get(key) ?? []
    list.push(s)
    groupsByKey.set(key, list)
  }

  // Bucket each player into BGM vs opponent. Survivor = most-recent
  // snapshot (the LineupCard "compact" view uses these exact fields).
  // X-Factors aggregated across ALL snapshots in the group, deduped by
  // slot_index — typically the loadout-view capture (older) has the
  // X-Factor rows, the lobby capture (most-recent) does not.
  const bgm: LineupRow[] = []
  const opponent: LineupRow[] = []

  for (const group of groupsByKey.values()) {
    const survivor = group[0]!
    const side = decideTeamSide(survivor)

    // Walk all snapshots in the group, populating xBySlot with the
    // latest-snapshot-wins rule per slot_index.
    const xBySlot = new Map<number, (typeof xFactorRows)[number]>()
    for (const s of group) {
      const rows = xBySnapshot.get(s.snapshotId)
      if (!rows) continue
      for (const x of rows) {
        if (!xBySlot.has(x.slotIndex)) xBySlot.set(x.slotIndex, x)
      }
    }
    const xFactors = [...xBySlot.values()]
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((x) => ({
        slotIndex: x.slotIndex,
        name: x.xFactorName,
        canonicalName: x.xFactorNameCanonical,
        tier: x.tier,
      }))

    const row: LineupRow = {
      snapshotId: survivor.snapshotId,
      gamertagSnapshot: survivor.gamertagSnapshot,
      playerNameSnapshot: survivor.playerNameSnapshot,
      playerNamePersona: survivor.playerNamePersona,
      playerNumber: survivor.playerNumber,
      isCaptain: survivor.isCaptain,
      position: survivor.position,
      buildClass: survivor.buildClass,
      heightText: survivor.heightText,
      weightLbs: survivor.weightLbs,
      handedness: survivor.handedness,
      playerLevelNumber: survivor.playerLevelNumber,
      playerLevelRaw: survivor.playerLevelRaw,
      capturedAt: survivor.capturedAt,
      player: survivor.resolvedPlayer,
      xFactors,
    }
    if (side === 'bgm') bgm.push(row)
    else opponent.push(row)
  }

  // Position-keyed dedup: one row per position per side. Without this,
  // an opponent side with 27 captured gamertag-variants (OCR collisions
  // for the same 6 real players) renders 27 rows. With it, we get at
  // most 6 rows per side — one for each of {C, LW, RW, LD, RD, G}.
  //
  // Input order is captured_at DESC (most recent first per group, since
  // groupsByKey iteration preserves rawSnapshots' order via the group's
  // [0] survivor). So Map.set's first-wins semantics keep the freshest
  // row per position. Rows with null position are dropped — they're
  // typically OCR misses on the position glyph and don't represent a
  // real roster slot.
  const dedupByPosition = (rows: LineupRow[]): LineupRow[] => {
    const byPosition = new Map<string, LineupRow>()
    for (const r of rows) {
      if (!r.position) continue
      if (!byPosition.has(r.position)) byPosition.set(r.position, r)
    }
    return [...byPosition.values()]
  }
  const bgmDeduped = dedupByPosition(bgm)
  const opponentDeduped = dedupByPosition(opponent)

  // Canonical hockey roster order: C → LW → RW → LD → RD → G. Apply to both sides.
  const positionOrder: Record<string, number> = { C: 0, LW: 1, RW: 2, LD: 3, RD: 4, G: 5 }
  const orderFn = (a: LineupRow, b: LineupRow) =>
    (positionOrder[a.position ?? ''] ?? 99) - (positionOrder[b.position ?? ''] ?? 99)
  bgmDeduped.sort(orderFn)
  opponentDeduped.sort(orderFn)

  return { bgm: bgmDeduped, opponent: opponentDeduped }
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
    /** Verbatim OCR string — kept for fallback rendering when canonical is null. */
    name: string
    /**
     * Normalized canonical name matching the branding asset folders
     * (e.g. 'Tape_to_Tape', 'PressurePlus'). NULL when the OCR string
     * couldn't be mapped — caller should fall back to text-rendering `name`.
     */
    canonicalName: string | null
    /** 'Elite' | 'All Star' | 'Specialist' — classified from HSV icon color. */
    tier: 'Elite' | 'All Star' | 'Specialist' | null
  }>
}

export type MatchLineups = Awaited<ReturnType<typeof getMatchLineups>>
