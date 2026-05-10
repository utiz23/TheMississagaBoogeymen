/**
 * Manual + automatic identity-resolution CLI for OCR-derived snapshots.
 *
 * Usage:
 *   # Show every unresolved snapshot grouped by text and what column needs filling.
 *   pnpm --filter worker ingest-ocr-resolve list
 *
 *   # Re-run the resolver against every unresolved snapshot. Picks up new
 *   # exact / history / display-alias / substring / Levenshtein matches that
 *   # appeared since the snapshot was first ingested. Reports per-mode counts.
 *   pnpm --filter worker ingest-ocr-resolve --auto
 *
 *   # Bulk-update by snapshot → player_id mapping. Each pair becomes:
 *   #   - a row in player_display_aliases (so future ingests auto-resolve)
 *   #   - and updates to existing match_events / match_goal_events /
 *   #     match_penalty_events / player_loadout_snapshots rows.
 *   pnpm --filter worker ingest-ocr-resolve --map "Silky=>2,M. Rantanen=>5,E. Wanhg=>11"
 *
 * Conventions: argv flags via `process.argv.includes`, [resolve] log prefix,
 * void sql.end() in finally — same as reprocess.ts and ingest-ocr-cli.ts.
 */

import {
  db,
  sql as dbSql,
  matchEvents,
  matchGoalEvents,
  matchPenaltyEvents,
  playerLoadoutSnapshots,
  playerDisplayAliases,
  players,
  type NewPlayerDisplayAlias,
} from '@eanhl/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import {
  resolveGamertagToPlayer,
  normalizeSnapshot,
  lowercaseNormalized,
} from './ocr-promoters/resolve-identity.js'

type AnyDb = typeof db

const isList = process.argv.includes('list')
const isAuto = process.argv.includes('--auto')

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

interface UnresolvedRow {
  table: 'match_events.actor' | 'match_events.target' | 'match_goal_events.scorer' |
    'match_goal_events.primary_assist' | 'match_goal_events.secondary_assist' |
    'match_penalty_events.culprit' | 'player_loadout_snapshots.player'
  rowId: number
  snapshot: string
}

async function listUnresolved(dbConn: AnyDb): Promise<UnresolvedRow[]> {
  const rows: UnresolvedRow[] = []

  const meActor = await dbConn
    .select({ id: matchEvents.id, snap: matchEvents.actorGamertagSnapshot })
    .from(matchEvents)
    .where(and(isNull(matchEvents.actorPlayerId), eq(matchEvents.source, 'ocr')))
  for (const r of meActor) {
    if (r.snap) rows.push({ table: 'match_events.actor', rowId: r.id, snapshot: r.snap })
  }

  const meTarget = await dbConn
    .select({ id: matchEvents.id, snap: matchEvents.targetGamertagSnapshot })
    .from(matchEvents)
    .where(and(isNull(matchEvents.targetPlayerId), eq(matchEvents.source, 'ocr')))
  for (const r of meTarget) {
    if (r.snap) rows.push({ table: 'match_events.target', rowId: r.id, snapshot: r.snap })
  }

  const goals = await dbConn
    .select({
      id: matchGoalEvents.eventId,
      scorerPlayerId: matchGoalEvents.scorerPlayerId,
      scorerSnapshot: matchGoalEvents.scorerSnapshot,
      primaryPlayerId: matchGoalEvents.primaryAssistPlayerId,
      primarySnapshot: matchGoalEvents.primaryAssistSnapshot,
      secondaryPlayerId: matchGoalEvents.secondaryAssistPlayerId,
      secondarySnapshot: matchGoalEvents.secondaryAssistSnapshot,
    })
    .from(matchGoalEvents)
  for (const g of goals) {
    if (g.scorerPlayerId === null && g.scorerSnapshot) {
      rows.push({ table: 'match_goal_events.scorer', rowId: g.id, snapshot: g.scorerSnapshot })
    }
    if (g.primaryPlayerId === null && g.primarySnapshot) {
      rows.push({
        table: 'match_goal_events.primary_assist',
        rowId: g.id,
        snapshot: g.primarySnapshot,
      })
    }
    if (g.secondaryPlayerId === null && g.secondarySnapshot) {
      rows.push({
        table: 'match_goal_events.secondary_assist',
        rowId: g.id,
        snapshot: g.secondarySnapshot,
      })
    }
  }

  const pens = await dbConn
    .select({
      id: matchPenaltyEvents.eventId,
      culpritPlayerId: matchPenaltyEvents.culpritPlayerId,
      culpritSnapshot: matchPenaltyEvents.culpritSnapshot,
    })
    .from(matchPenaltyEvents)
  for (const p of pens) {
    if (p.culpritPlayerId === null && p.culpritSnapshot) {
      rows.push({ table: 'match_penalty_events.culprit', rowId: p.id, snapshot: p.culpritSnapshot })
    }
  }

  const loads = await dbConn
    .select({ id: playerLoadoutSnapshots.id, snap: playerLoadoutSnapshots.gamertagSnapshot })
    .from(playerLoadoutSnapshots)
    .where(isNull(playerLoadoutSnapshots.playerId))
  for (const l of loads) {
    if (l.snap) rows.push({ table: 'player_loadout_snapshots.player', rowId: l.id, snapshot: l.snap })
  }

  return rows
}

async function applyResolutionToRow(
  dbConn: AnyDb,
  row: UnresolvedRow,
  playerId: number,
): Promise<void> {
  switch (row.table) {
    case 'match_events.actor':
      await dbConn
        .update(matchEvents)
        .set({ actorPlayerId: playerId })
        .where(eq(matchEvents.id, row.rowId))
      return
    case 'match_events.target':
      await dbConn
        .update(matchEvents)
        .set({ targetPlayerId: playerId })
        .where(eq(matchEvents.id, row.rowId))
      return
    case 'match_goal_events.scorer':
      await dbConn
        .update(matchGoalEvents)
        .set({ scorerPlayerId: playerId })
        .where(eq(matchGoalEvents.eventId, row.rowId))
      return
    case 'match_goal_events.primary_assist':
      await dbConn
        .update(matchGoalEvents)
        .set({ primaryAssistPlayerId: playerId })
        .where(eq(matchGoalEvents.eventId, row.rowId))
      return
    case 'match_goal_events.secondary_assist':
      await dbConn
        .update(matchGoalEvents)
        .set({ secondaryAssistPlayerId: playerId })
        .where(eq(matchGoalEvents.eventId, row.rowId))
      return
    case 'match_penalty_events.culprit':
      await dbConn
        .update(matchPenaltyEvents)
        .set({ culpritPlayerId: playerId })
        .where(eq(matchPenaltyEvents.eventId, row.rowId))
      return
    case 'player_loadout_snapshots.player':
      await dbConn
        .update(playerLoadoutSnapshots)
        .set({ playerId })
        .where(eq(playerLoadoutSnapshots.id, row.rowId))
      return
  }
}

interface AutoStats {
  total: number
  resolved: number
  byVia: Record<string, number>
}

async function runAuto(dbConn: AnyDb): Promise<AutoStats> {
  const unresolved = await listUnresolved(dbConn)
  const stats: AutoStats = { total: unresolved.length, resolved: 0, byVia: {} }

  // Resolve snapshots once each (most snapshots repeat across many rows).
  const cache = new Map<string, number | null>()

  for (const row of unresolved) {
    let playerId: number | null
    const cached = cache.get(row.snapshot)
    if (cached !== undefined) {
      playerId = cached
    } else {
      const result = await resolveGamertagToPlayer(row.snapshot, 0, dbConn as unknown as Parameters<typeof resolveGamertagToPlayer>[2])
      playerId = result.playerId
      cache.set(row.snapshot, playerId)
      stats.byVia[result.via] = (stats.byVia[result.via] ?? 0) + (result.playerId ? 0 : 0)
      if (result.playerId !== null) {
        stats.byVia[result.via] = (stats.byVia[result.via] ?? 0) + 1
      }
    }
    if (playerId !== null) {
      await applyResolutionToRow(dbConn, row, playerId)
      stats.resolved++
    }
  }

  return stats
}

async function applyManualMap(dbConn: AnyDb, mapStr: string): Promise<{ aliases: number; rowsUpdated: number }> {
  const pairs = mapStr.split(',').map((p) => p.trim()).filter(Boolean)
  let aliases = 0
  let rowsUpdated = 0

  for (const pair of pairs) {
    const arrowIdx = pair.indexOf('=>')
    if (arrowIdx === -1) {
      console.warn(`[resolve] skipping malformed pair: ${pair}`)
      continue
    }
    const aliasRaw = pair.slice(0, arrowIdx).trim()
    const playerIdStr = pair.slice(arrowIdx + 2).trim()
    const playerId = Number.parseInt(playerIdStr, 10)
    if (!aliasRaw || !Number.isFinite(playerId)) {
      console.warn(`[resolve] skipping invalid pair: ${pair}`)
      continue
    }

    // Confirm the player exists.
    const [player] = await dbConn
      .select({ id: players.id, gamertag: players.gamertag })
      .from(players)
      .where(eq(players.id, playerId))
      .limit(1)
    if (!player) {
      console.warn(`[resolve] player_id ${String(playerId)} not found — skipping`)
      continue
    }

    const aliasNormalized = lowercaseNormalized(aliasRaw)
    if (!aliasNormalized) {
      console.warn(`[resolve] alias '${aliasRaw}' normalizes to empty — skipping`)
      continue
    }

    // 1. Insert / update the alias row.
    const aliasValues: NewPlayerDisplayAlias = {
      playerId,
      alias: normalizeSnapshot(aliasRaw),
      normalizedAlias: aliasNormalized,
      source: 'manual',
    }
    await dbConn
      .insert(playerDisplayAliases)
      .values(aliasValues)
      .onConflictDoUpdate({
        target: [playerDisplayAliases.playerId, playerDisplayAliases.normalizedAlias],
        set: { alias: aliasValues.alias, source: 'manual' },
      })
    aliases++
    console.log(
      `[resolve] alias '${aliasRaw}' (norm '${aliasNormalized}') → ${player.gamertag} (id=${String(playerId)})`,
    )

    // 2. Update every existing unresolved row whose snapshot normalizes to the same key.
    const allUnresolved = await listUnresolved(dbConn)
    const matching = allUnresolved.filter((r) => lowercaseNormalized(r.snapshot) === aliasNormalized)
    for (const row of matching) {
      await applyResolutionToRow(dbConn, row, playerId)
      rowsUpdated++
    }
    console.log(`[resolve]   updated ${String(matching.length)} existing row(s)`)
  }

  return { aliases, rowsUpdated }
}

async function main(): Promise<void> {
  const mapStr = getFlag('map')

  if (isList) {
    const rows = await listUnresolved(db)
    if (rows.length === 0) {
      console.log('[resolve] no unresolved snapshots — clean.')
      return
    }
    // Group by snapshot text.
    const grouped = new Map<string, { table: string; rowId: number }[]>()
    for (const r of rows) {
      const key = r.snapshot
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key)!.push({ table: r.table, rowId: r.rowId })
    }
    const sorted = Array.from(grouped.entries()).sort((a, b) => b[1].length - a[1].length)
    console.log(`[resolve] ${String(rows.length)} unresolved row(s) across ${String(sorted.length)} distinct snapshot(s):`)
    for (const [snap, hits] of sorted) {
      const tableCounts = new Map<string, number>()
      for (const h of hits) tableCounts.set(h.table, (tableCounts.get(h.table) ?? 0) + 1)
      const summary = Array.from(tableCounts.entries())
        .map(([t, c]) => `${t}=${String(c)}`)
        .join(', ')
      console.log(`  '${snap}'  ×${String(hits.length)}  (${summary})`)
    }
    return
  }

  if (isAuto) {
    console.log('[resolve] running auto-resolver against all unresolved snapshots…')
    const stats = await runAuto(db)
    console.log(
      `[resolve] auto: ${String(stats.resolved)}/${String(stats.total)} rows resolved`,
    )
    for (const [via, count] of Object.entries(stats.byVia)) {
      console.log(`  via ${via}: ${String(count)}`)
    }
    return
  }

  if (mapStr) {
    console.log(`[resolve] applying manual map: ${mapStr}`)
    const { aliases, rowsUpdated } = await applyManualMap(db, mapStr)
    console.log(`[resolve] applied ${String(aliases)} alias(es); ${String(rowsUpdated)} row(s) updated`)
    return
  }

  console.log('Usage:')
  console.log('  pnpm --filter worker ingest-ocr-resolve list')
  console.log('  pnpm --filter worker ingest-ocr-resolve --auto')
  console.log('  pnpm --filter worker ingest-ocr-resolve --map "Silky=>2,M. Rantanen=>5"')
}

main()
  .catch((err: unknown) => {
    console.error('[resolve] Fatal error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void dbSql.end()
  })
