/**
 * Create a `players` row for a gamertag that OCR has surfaced but the EA API
 * has never returned (e.g. a new BGM teammate first seen in
 * player_loadout_snapshots). Idempotent — re-running for an existing gamertag
 * reports the existing id and exits 0.
 *
 * Usage:
 *   pnpm --filter worker create-player --gamertag Pratt2016 --position LW
 *   pnpm --filter worker create-player --gamertag Pratt2016 --position LW --ea-id 1003821403659
 *   pnpm --filter worker create-player --gamertag Pratt2016 --position LW --dry-run
 *
 * Positions are stored verbatim (the schema is open-text) but the CLI accepts
 * the canonical short forms (C, LW, RW, LD, RD, G) plus the EA long forms
 * (center, leftWing, rightWing, leftDefense, rightDefense, goalie) and
 * normalizes the short forms to the EA long forms for consistency with what
 * the match-ingest path writes.
 */

import { db, sql as dbSql, players } from '@eanhl/db'
import { eq } from 'drizzle-orm'
import { upsertPlayer } from './ingest.js'

const POSITION_ALIASES: Record<string, string> = {
  C: 'center',
  LW: 'leftWing',
  RW: 'rightWing',
  LD: 'leftDefense',
  RD: 'rightDefense',
  G: 'goalie',
  center: 'center',
  leftWing: 'leftWing',
  rightWing: 'rightWing',
  leftDefense: 'leftDefense',
  rightDefense: 'rightDefense',
  goalie: 'goalie',
}

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function main(): Promise<void> {
  const gamertag = getFlag('gamertag')
  const positionInput = getFlag('position')
  const eaId = getFlag('ea-id') ?? null
  const dryRun = hasFlag('dry-run')

  if (!gamertag || !positionInput) {
    console.log('Usage:')
    console.log(
      '  pnpm --filter worker create-player --gamertag <text> --position <C|LW|RW|LD|RD|G> [--ea-id <text>] [--dry-run]',
    )
    process.exitCode = 1
    return
  }

  const position = POSITION_ALIASES[positionInput]
  if (!position) {
    console.error(
      `[create-player] invalid --position "${positionInput}". Accepted: ${Object.keys(POSITION_ALIASES).join(', ')}`,
    )
    process.exitCode = 1
    return
  }

  // Check for an existing row first so we can report idempotently without
  // touching last_seen_at on a dry-run.
  const existing = await db
    .select({ id: players.id, position: players.position, eaId: players.eaId })
    .from(players)
    .where(eq(players.gamertag, gamertag))
    .limit(1)

  if (existing[0]) {
    const row = existing[0]
    console.log(
      `[create-player] already present: id=${String(row.id)} gamertag="${gamertag}" position=${row.position ?? 'null'}`,
    )
    return
  }

  if (dryRun) {
    console.log(
      `[create-player] dry-run: would insert gamertag="${gamertag}" position=${position} ea_id=${eaId ?? 'null'}`,
    )
    return
  }

  const player = await upsertPlayer({ gamertag, position, eaId })
  console.log(
    `[create-player] inserted id=${String(player.id)} gamertag="${player.gamertag}" position=${player.position ?? 'null'}`,
  )
}

main()
  .catch((err: unknown) => {
    console.error('[create-player] Fatal error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void dbSql.end()
  })
