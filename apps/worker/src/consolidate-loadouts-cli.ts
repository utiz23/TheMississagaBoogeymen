/**
 * Cross-frame consensus for pre-game loadout/lobby snapshots — CLI wrapper.
 *
 * The consolidation logic itself lives in `lib/consolidate-loadouts.ts` so it
 * can also run inside the `decoder-runs activate` transaction (Tier 0 WS0.1A).
 * This file is a thin CLI: parse `--match` / `--dry-run`, run the lib against
 * the module-level `db`, print the human report (incl. the unresolved-persona /
 * unresolved-gamertag follow-ups), and close the pool.
 *
 * Usage:
 *   pnpm --filter worker consolidate-loadouts --match 250
 *   pnpm --filter worker consolidate-loadouts --match 250 --dry-run
 */

import { sql as postgresSql } from '@eanhl/db'
import {
  consolidateLoadouts,
  type UnresolvedPersona,
  type UnresolvedGamertag,
} from './lib/consolidate-loadouts.js'

interface CliArgs {
  matchId: number
  dryRun: boolean
}

function parseArgs(): CliArgs {
  const matchIdStr = getFlag('match')
  if (!matchIdStr) throw new Error('Missing required --match <id>')
  const matchId = Number.parseInt(matchIdStr, 10)
  if (!Number.isFinite(matchId)) throw new Error(`Invalid --match: ${matchIdStr}`)
  return { matchId, dryRun: process.argv.includes('--dry-run') }
}

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

async function main(): Promise<void> {
  const args = parseArgs()
  console.log(`[consolidate] match=${args.matchId} dryRun=${args.dryRun ? 'yes' : 'no'}`)

  const result = await consolidateLoadouts(args.matchId, {
    dryRun: args.dryRun,
    log: (msg) => console.log(msg),
  })

  emitUnresolvedReport(result.unresolvedPersonas, result.unresolvedGamertags)

  await postgresSql.end()
}

function emitUnresolvedReport(
  personas: UnresolvedPersona[],
  gamertags: UnresolvedGamertag[],
): void {
  if (personas.length === 0 && gamertags.length === 0) return

  const pad = (s: string, n: number): string => s.padEnd(n).slice(0, n)

  if (personas.length > 0) {
    console.log('')
    console.log('--- UNRESOLVED PERSONAS (need player_persona_aliases seed) ---')
    for (const p of personas) {
      console.log(`  ${pad(p.side, 7)} ${pad(p.position, 4)} ${pad(p.gamertag, 24)} → ${p.raw}`)
    }
    const mapPairs = personas
      .map(
        (p) => `${p.raw}=>${p.raw.toUpperCase().replace(/\./g, '. ').replace(/\s+/g, ' ').trim()}`,
      )
      .join(',')
    console.log('Suggested:')
    console.log(`  pnpm --filter worker promote-persona-alias --map "${mapPairs}"`)
  }

  if (gamertags.length > 0) {
    console.log('')
    console.log('--- UNRESOLVED GAMERTAGS (no players row) ---')
    for (const g of gamertags) {
      console.log(`  ${pad(g.side, 7)} ${pad(g.position, 4)} ${g.gamertag}`)
    }
    console.log('Suggested:')
    for (const g of gamertags) {
      console.log(
        `  pnpm --filter worker create-player --gamertag "${g.gamertag}" --position ${g.position}`,
      )
    }
  }
}

main().catch((err: unknown) => {
  console.error(err)
  void postgresSql.end()
  process.exitCode = 1
})
