import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { db } from '../client.js'
import {
  ocrExtractions,
  opponentPlayerMatchStats,
  playerLoadoutAttributes,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerMatchStats,
  players,
} from '../schema/index.js'

/**
 * Pre-game lineup card data for a single match.
 *
 * Returns two arrays — BGM ("our team") on one side, opponent on the other.
 *
 * Row selection precedence per `(team_side, position)` slot:
 *   1. The consolidator anchor (`review_status='reviewed'`) when one exists.
 *      The anchor was produced by `consolidate-loadouts-cli` which already
 *      voted across the per-slot snapshot group to pick the best scalar
 *      fields.
 *   2. Fallback: most-recent snapshot in the player-key group (player_id or
 *      lowercase gamertag), dedup'd to one row per position. Kept for matches
 *      where the consolidator hasn't been run yet.
 *
 * X-Factors are merged across every snapshot of the slot's player-key group
 * (preferring non-null tier per slot_index) — many slots have the names on
 * one snapshot and the HSV-classified tier on another.
 *
 * Team-side bucketing prefers the persisted `team_side` column. Snapshots
 * predating migration 0033 fall back to a lobby-roster scan inside the
 * source extraction's raw JSON, then to playerId-resolved → BGM.
 */
const JUNK_GAMERTAGS = new Set(['away', 'home', 'cpu', '?', '(unknown)'])

function isJunkGamertag(tag: string | null | undefined): boolean {
  if (!tag) return true
  const trimmed = tag.trim()
  if (trimmed.length <= 1) return true
  return JUNK_GAMERTAGS.has(trimmed.toLowerCase())
}

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
      buildClassCanonical: playerLoadoutSnapshots.buildClassCanonical,
      heightText: playerLoadoutSnapshots.heightText,
      weightLbs: playerLoadoutSnapshots.weightLbs,
      handedness: playerLoadoutSnapshots.handedness,
      playerLevelNumber: playerLoadoutSnapshots.playerLevelNumber,
      playerLevelRaw: playerLoadoutSnapshots.playerLevelRaw,
      platform: playerLoadoutSnapshots.platform,
      capturedAt: playerLoadoutSnapshots.capturedAt,
      sourceExtractionId: playerLoadoutSnapshots.sourceExtractionId,
      playerId: playerLoadoutSnapshots.playerId,
      reviewStatus: playerLoadoutSnapshots.reviewStatus,
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
        // Reject obvious-junk gamertags at the source. `AWAY`/`HOME` are
        // common false positives when OCR mistakes a section header for a
        // gamertag; single-char strings like `m`/`?` are letter-segmentation
        // noise. Null-position rows are NOT filtered here because the
        // loadout-view captures (which carry the X-Factor rows) emit no
        // position field — we still need them in the result so the X-Factor
        // merge can find them via the gamertag-pool join below.
        sql`length(trim(${playerLoadoutSnapshots.gamertagSnapshot})) > 1`,
        sql`lower(trim(${playerLoadoutSnapshots.gamertagSnapshot})) NOT IN ('away','home','cpu','?','(unknown)')`,
      ),
    )
    .orderBy(desc(playerLoadoutSnapshots.capturedAt))

  if (rawSnapshots.length === 0) {
    return { bgm: [], opponent: [] }
  }

  // X-Factors (with tier) + attributes for all snapshot ids in one shot.
  const snapshotIds = rawSnapshots.map((s) => s.snapshotId)
  const [xFactorRows, attributeRows] = await Promise.all([
    db
      .select()
      .from(playerLoadoutXFactors)
      .where(
        sql`${playerLoadoutXFactors.loadoutSnapshotId} IN (${sql.join(
          snapshotIds.map((id) => sql`${id}`),
          sql`,`,
        )})`,
      )
      .orderBy(asc(playerLoadoutXFactors.loadoutSnapshotId), asc(playerLoadoutXFactors.slotIndex)),
    db
      .select()
      .from(playerLoadoutAttributes)
      .where(
        sql`${playerLoadoutAttributes.loadoutSnapshotId} IN (${sql.join(
          snapshotIds.map((id) => sql`${id}`),
          sql`,`,
        )})`,
      ),
  ])

  const xBySnapshot = new Map<number, typeof xFactorRows>()
  for (const x of xFactorRows) {
    const list = xBySnapshot.get(x.loadoutSnapshotId) ?? []
    list.push(x)
    xBySnapshot.set(x.loadoutSnapshotId, list)
  }
  const attrsBySnapshot = new Map<number, typeof attributeRows>()
  for (const a of attributeRows) {
    const list = attrsBySnapshot.get(a.loadoutSnapshotId) ?? []
    list.push(a)
    attrsBySnapshot.set(a.loadoutSnapshotId, list)
  }

  type RawSnapshot = (typeof rawSnapshots)[number]

  /**
   * Build the X-Factor merge pool keyed by *normalized gamertag*. Using the
   * raw player_id is unsafe: old loadout-view captures sometimes resolved
   * to the wrong player (e.g. snap 142 has player_id=11 / MrHomicide but is
   * actually Stick Menace's LW capture), so a player_id-keyed pool would
   * leak the wrong player's X-Factors into a slot. Normalized-gamertag
   * matching (strip non-alphanumeric, lowercase) tolerates spacing/casing
   * drift like "Stick Menace" ↔ "StickMenace" while still rejecting the
   * OCR junk variants like "MrHomiecide Evoeni Wan".
   */
  const normalizeTag = (tag: string | null | undefined): string =>
    (tag ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const xfactorPoolByTag = new Map<string, RawSnapshot[]>()
  for (const s of rawSnapshots) {
    const key = normalizeTag(s.gamertagSnapshot)
    if (!key) continue
    const list = xfactorPoolByTag.get(key) ?? []
    list.push(s)
    xfactorPoolByTag.set(key, list)
  }

  // Player-key groups (player_id when resolved, else lowercase gamertag) are
  // still used for the legacy "most-recent survivor" fallback on matches
  // where the consolidator hasn't been run.
  const groupsByKey = new Map<string, RawSnapshot[]>()
  const playerKey = (s: RawSnapshot): string =>
    s.playerId !== null
      ? `p:${String(s.playerId)}`
      : `g:${(s.gamertagSnapshot ?? '').toLowerCase()}`
  for (const s of rawSnapshots) {
    const list = groupsByKey.get(playerKey(s)) ?? []
    list.push(s)
    groupsByKey.set(playerKey(s), list)
  }

  /** Merge X-Factors across a snapshot pool. Prefer non-null tier per slot. */
  const mergeXFactorsForPool = (pool: RawSnapshot[]): LineupRow['xFactors'] => {
    const xBySlot = new Map<number, (typeof xFactorRows)[number]>()
    for (const s of pool) {
      const rows = xBySnapshot.get(s.snapshotId)
      if (!rows) continue
      for (const x of rows) {
        const existing = xBySlot.get(x.slotIndex)
        if (!existing) {
          xBySlot.set(x.slotIndex, x)
          continue
        }
        if (existing.tier === null && x.tier !== null) {
          xBySlot.set(x.slotIndex, x)
        }
      }
    }
    return [...xBySlot.values()]
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((x) => ({
        slotIndex: x.slotIndex,
        name: x.xFactorName,
        canonicalName: x.xFactorNameCanonical,
        tier: x.tier,
      }))
  }

  const xFactorsFor = (anchor: RawSnapshot): LineupRow['xFactors'] => {
    const tag = normalizeTag(anchor.gamertagSnapshot)
    const pool = tag ? (xfactorPoolByTag.get(tag) ?? [anchor]) : [anchor]
    return mergeXFactorsForPool(pool)
  }

  /**
   * Merge per-attribute values across a snapshot pool. Each attribute key
   * takes the most-recent snapshot's non-null value (pool is captured_at
   * DESC). `deltaValue` follows the same precedence, independent per key.
   * Returns null when the pool has no data for any key.
   */
  const mergeAttributesForPool = (pool: RawSnapshot[]): LineupRow['attributes'] => {
    const byKey = new Map<string, { value: number; delta: number | null }>()
    for (const s of pool) {
      const rows = attrsBySnapshot.get(s.snapshotId)
      if (!rows) continue
      for (const r of rows) {
        if (r.value === null) continue
        if (byKey.has(r.attributeKey)) continue
        byKey.set(r.attributeKey, { value: r.value, delta: r.deltaValue })
      }
    }
    if (byKey.size === 0) return null
    return Object.fromEntries(byKey)
  }

  const attributesFor = (anchor: RawSnapshot): LineupRow['attributes'] => {
    const tag = normalizeTag(anchor.gamertagSnapshot)
    const pool = tag ? (xfactorPoolByTag.get(tag) ?? [anchor]) : [anchor]
    return mergeAttributesForPool(pool)
  }

  const buildRow = (anchor: RawSnapshot, xFactors: LineupRow['xFactors']): LineupRow => ({
    snapshotId: anchor.snapshotId,
    gamertagSnapshot: anchor.gamertagSnapshot,
    playerNameSnapshot: anchor.playerNameSnapshot,
    playerNamePersona: anchor.playerNamePersona,
    playerNumber: anchor.playerNumber,
    isCaptain: anchor.isCaptain,
    position: anchor.position,
    buildClass: anchor.buildClass,
    buildClassCanonical: anchor.buildClassCanonical,
    heightText: anchor.heightText,
    weightLbs: anchor.weightLbs,
    handedness: anchor.handedness,
    playerLevelNumber: anchor.playerLevelNumber,
    playerLevelRaw: anchor.playerLevelRaw,
    platform: anchor.platform,
    capturedAt: anchor.capturedAt,
    player: anchor.resolvedPlayer,
    xFactors,
    attributes: attributesFor(anchor),
  })

  // Step 1: consume consolidator anchors when they exist. Each anchor is the
  // canonical row for a `(team_side, position)` slot — index by that key.
  type SlotKey = `${'bgm' | 'opponent'}|${string}`
  const slotKey = (side: 'bgm' | 'opponent', pos: string): SlotKey => `${side}|${pos}`
  const filledSlots = new Set<SlotKey>()
  const bgm: LineupRow[] = []
  const opponent: LineupRow[] = []

  for (const s of rawSnapshots) {
    if (s.reviewStatus !== 'reviewed') continue
    const pos = s.position
    if (!pos) continue
    const side = decideTeamSide(s)
    const key = slotKey(side, pos)
    if (filledSlots.has(key)) continue
    const row = buildRow(s, xFactorsFor(s))
    if (side === 'bgm') bgm.push(row)
    else opponent.push(row)
    filledSlots.add(key)
  }

  // Step 2: fall back to per-player-key survivor for slots without an
  // anchor. This keeps the section rendering on matches where the
  // consolidator hasn't been run yet. Null-position rows are not eligible
  // as a survivor — they have no slot to fill — but they were already kept
  // in `rawSnapshots` so the X-Factor merge can still pull from them.
  for (const group of groupsByKey.values()) {
    const survivor = group.find((s) => s.position !== null)
    if (!survivor || !survivor.position) continue
    const side = decideTeamSide(survivor)
    const key = slotKey(side, survivor.position)
    if (filledSlots.has(key)) continue
    const row = buildRow(survivor, xFactorsFor(survivor))
    if (side === 'bgm') bgm.push(row)
    else opponent.push(row)
    filledSlots.add(key)
  }

  // Defensive guard: even after junk-gamertag filtering at the SQL level, a
  // row with no build, no jersey, AND no X-Factors is almost certainly OCR
  // noise that slipped through. Drop it so the section renders the CPU
  // placeholder instead.
  const isEmptyRow = (r: LineupRow): boolean =>
    r.buildClass === null && r.playerNumber === null && r.xFactors.length === 0

  // Canonical hockey roster order: C → LW → RW → LD → RD → G. Apply to both sides.
  const positionOrder: Record<string, number> = { C: 0, LW: 1, RW: 2, LD: 3, RD: 4, G: 5 }
  const orderFn = (a: LineupRow, b: LineupRow) =>
    (positionOrder[a.position ?? ''] ?? 99) - (positionOrder[b.position ?? ''] ?? 99)

  /**
   * One captain ("room leader" in EASHL terms) per side. The OCR + consolidator
   * OR-fold rule means stray frames can flag a non-captain as captain. We
   * enforce uniqueness here: of all captain-flagged rows on a side, keep the
   * earliest in canonical position order (C wins over LW, etc.) and clear the
   * flag on the rest. Same shape applied to bgm + opponent independently.
   */
  const enforceSingleCaptain = (rows: LineupRow[]): LineupRow[] => {
    const captains = rows.filter((r) => r.isCaptain === true)
    if (captains.length <= 1) return rows
    const sortedCaptains = [...captains].sort(orderFn)
    const winnerId = sortedCaptains[0]!.snapshotId
    return rows.map((r) =>
      r.isCaptain === true && r.snapshotId !== winnerId ? { ...r, isCaptain: false } : r,
    )
  }

  const bgmFinal = enforceSingleCaptain(bgm.filter((r) => !isEmptyRow(r))).sort(orderFn)
  const opponentFinal = enforceSingleCaptain(opponent.filter((r) => !isEmptyRow(r))).sort(orderFn)

  // Overlay the EA-API-authoritative `client_platform` on every row. The
  // EA payload returns one row per (match_id, player_id) on BGM side and
  // (match_id, ea_player_id, gamertag) on opp side — both carry the
  // console the player used for that match (`xbsx`, `ps5`, etc.). This
  // beats the OCR `player_platform` field (currently MISSING from the
  // parser) and gives us a reliable signal for the platform indicator.
  const [bgmPlatformRows, oppPlatformRows] = await Promise.all([
    db
      .select({ playerId: playerMatchStats.playerId, platform: playerMatchStats.clientPlatform })
      .from(playerMatchStats)
      .where(eq(playerMatchStats.matchId, matchId)),
    db
      .select({
        gamertag: opponentPlayerMatchStats.gamertag,
        platform: opponentPlayerMatchStats.clientPlatform,
      })
      .from(opponentPlayerMatchStats)
      .where(eq(opponentPlayerMatchStats.matchId, matchId)),
  ])
  const bgmPlatformByPlayerId = new Map<number, string>()
  for (const r of bgmPlatformRows) {
    if (r.playerId !== null && r.platform) bgmPlatformByPlayerId.set(r.playerId, r.platform)
  }
  const oppPlatformByTag = new Map<string, string>()
  for (const r of oppPlatformRows) {
    if (r.platform) oppPlatformByTag.set(normalizeTag(r.gamertag), r.platform)
  }
  const overlayPlatform = (row: LineupRow, side: 'bgm' | 'opponent'): LineupRow => {
    const ea =
      side === 'bgm'
        ? row.player
          ? (bgmPlatformByPlayerId.get(row.player.id) ?? null)
          : null
        : (oppPlatformByTag.get(normalizeTag(row.gamertagSnapshot)) ?? null)
    // EA value wins when present; fall back to whatever the OCR/consolidator
    // had previously (currently always null post-cleanup).
    return ea ? { ...row, platform: ea } : row
  }

  return {
    bgm: bgmFinal.map((r) => overlayPlatform(r, 'bgm')),
    opponent: opponentFinal.map((r) => overlayPlatform(r, 'opponent')),
  }
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
  /**
   * Canonical "[Reference Player - ]Build" produced by
   * `normalize-build-class.ts` and written by the consolidator. NULL when
   * the OCR string couldn't be mapped — the renderer falls back to raw.
   */
  buildClassCanonical: string | null
  heightText: string | null
  weightLbs: number | null
  handedness: string | null
  playerLevelNumber: number | null
  playerLevelRaw: string | null
  /** Voted platform string ("Xbox", "PS5", …). NULL when none captured. */
  platform: string | null
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
  /**
   * Per-attribute snapshot ({attribute_key: {value, delta}}). Merged from
   * the same gamertag-normalized pool as `xFactors`. NULL when no
   * attribute data is available for this slot.
   */
  attributes: Record<string, { value: number; delta: number | null }> | null
}

export type MatchLineups = Awaited<ReturnType<typeof getMatchLineups>>

// ─── Provenance ─────────────────────────────────────────────────────────────

/**
 * Aggregated OCR provenance metadata for the lineup section of a single
 * match — drives the "Captured / Sources / Confidence" footer.
 *
 * `sources` counts snapshots per `ocr_extractions.screen_type` so the UI
 * can call out "Pre-game lobby + Loadout view" with per-source coverage.
 * `confidence.canonical` / `tiered` are 0..1 fractions used to colour-code
 * the per-source badges (≥0.9 = ok, otherwise warn).
 */
export interface MatchLineupProvenance {
  capturedAt: { earliest: Date; latest: Date } | null
  sources: Array<{ screenType: string; snapshotCount: number }>
  confidence: {
    /** Fraction of reviewed anchors with non-null build_class_canonical. */
    canonical: number
    /** Fraction of X-Factor rows attached to reviewed anchors with non-null tier. */
    tiered: number
    /** Fraction of attribute rows (across all snapshots for the match) with non-null value. */
    attribute: number
  }
}

export async function getMatchLineupProvenance(matchId: number): Promise<MatchLineupProvenance> {
  const snapshotMeta = await db
    .select({
      id: playerLoadoutSnapshots.id,
      capturedAt: playerLoadoutSnapshots.capturedAt,
      screenType: ocrExtractions.screenType,
      reviewStatus: playerLoadoutSnapshots.reviewStatus,
      buildClassCanonical: playerLoadoutSnapshots.buildClassCanonical,
    })
    .from(playerLoadoutSnapshots)
    .innerJoin(ocrExtractions, eq(ocrExtractions.id, playerLoadoutSnapshots.sourceExtractionId))
    .where(eq(playerLoadoutSnapshots.matchId, matchId))

  if (snapshotMeta.length === 0) {
    return {
      capturedAt: null,
      sources: [],
      confidence: { canonical: 0, tiered: 0, attribute: 0 },
    }
  }

  let earliest = snapshotMeta[0]!.capturedAt
  let latest = snapshotMeta[0]!.capturedAt
  const screenCounts = new Map<string, number>()
  const reviewedIds = new Set<number>()
  let reviewedWithCanonical = 0
  for (const s of snapshotMeta) {
    if (s.capturedAt < earliest) earliest = s.capturedAt
    if (s.capturedAt > latest) latest = s.capturedAt
    screenCounts.set(s.screenType, (screenCounts.get(s.screenType) ?? 0) + 1)
    if (s.reviewStatus === 'reviewed') {
      reviewedIds.add(s.id)
      if (s.buildClassCanonical !== null) reviewedWithCanonical++
    }
  }

  let tiered = 0
  let xfactorTotal = 0
  if (reviewedIds.size > 0) {
    const xfactorRows = await db
      .select({ tier: playerLoadoutXFactors.tier })
      .from(playerLoadoutXFactors)
      .where(
        sql`${playerLoadoutXFactors.loadoutSnapshotId} IN (${sql.join(
          [...reviewedIds].map((id) => sql`${id}`),
          sql`,`,
        )})`,
      )
    xfactorTotal = xfactorRows.length
    for (const x of xfactorRows) if (x.tier !== null) tiered++
  }

  const attributeRows = await db
    .select({ value: playerLoadoutAttributes.value })
    .from(playerLoadoutAttributes)
    .innerJoin(
      playerLoadoutSnapshots,
      eq(playerLoadoutSnapshots.id, playerLoadoutAttributes.loadoutSnapshotId),
    )
    .where(eq(playerLoadoutSnapshots.matchId, matchId))
  const attributeWithValue = attributeRows.filter((a) => a.value !== null).length

  return {
    capturedAt: { earliest, latest },
    sources: [...screenCounts.entries()]
      .map(([screenType, snapshotCount]) => ({ screenType, snapshotCount }))
      .sort((a, b) => b.snapshotCount - a.snapshotCount),
    confidence: {
      canonical: reviewedIds.size > 0 ? reviewedWithCanonical / reviewedIds.size : 0,
      tiered: xfactorTotal > 0 ? tiered / xfactorTotal : 0,
      attribute: attributeRows.length > 0 ? attributeWithValue / attributeRows.length : 0,
    },
  }
}
