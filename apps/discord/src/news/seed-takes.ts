/**
 * Seeds the GM's reporter takes (spec §12.19) from a private JSON file.
 *
 *   set -a; . ./.env; set +a
 *   node apps/discord/src/news/seed-takes.ts ~/.config/eanhl/news-takes.local.json
 *   node apps/discord/src/news/seed-takes.ts <file> --check     (shape only: no database)
 *
 * The file is private lore: it never goes into git, and this script never prints a
 * take text, a data angle or any other content of the file. It prints one line per
 * take (reporter, player, inserted or updated) and a count. Problems name the
 * position and the field, never the text. Every player name must resolve to exactly
 * one player (gamertag or profile name, any case); one failure stops the whole run
 * before anything is written. Running it again updates the same takes.
 *
 * File shape: { "takes": [ { "reporter": "mercer", "player": "<gamertag or name>",
 *   "take": "...", "spread": "some" | "a few" | "most", "critics": ["voss"],
 *   "defender": "quill" | null, "dataAngle": "...", "active": true,
 *   "intensity": -2..2 (optional) } ] }   (a bare array also works)
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { REPORTER_IDS, type ReporterId } from '@eanhl/db/news'

export const SEED_SPREADS = ['some', 'a few', 'most'] as const
type Spread = (typeof SEED_SPREADS)[number]

export interface TakeSeedInput {
  reporter: ReporterId
  /** A gamertag or a profile name, as written in the file. */
  player: string
  take: string
  spread: Spread
  critics: ReporterId[]
  defender: ReporterId | null
  dataAngle: string | null
  active: boolean
  /** null = leave the stored intensity alone (new takes start at 0). */
  intensity: number | null
}

export interface TakeSeed extends Omit<TakeSeedInput, 'player'> {
  playerId: number
}

export interface SeedPlayer {
  id: number
  gamertag: string
  name: string | null
}

export interface SeedStore {
  listPlayers(): Promise<SeedPlayer[]>
  upsertTake(seed: TakeSeed): Promise<'inserted' | 'updated'>
}

const isReporter = (v: unknown): v is ReporterId =>
  typeof v === 'string' && (REPORTER_IDS as readonly string[]).includes(v)

/** Reads the parsed JSON. Problems say "take N: <field> ..." and never quote the file. */
export function parseSeedFile(
  json: unknown,
): { ok: true; takes: TakeSeedInput[] } | { ok: false; problems: string[] } {
  const list: unknown =
    Array.isArray(json) || json === null || typeof json !== 'object'
      ? json
      : (json as { takes?: unknown }).takes
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, problems: ['the file needs a non-empty "takes" list'] }
  }
  const takes: TakeSeedInput[] = []
  const problems: string[] = []
  list.forEach((raw: unknown, i) => {
    const at = `take ${String(i + 1)}`
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      problems.push(`${at}: not an object`)
      return
    }
    const e = raw as Record<string, unknown>
    const bad: string[] = []
    if (!isReporter(e['reporter'])) bad.push('reporter is not one of the nine')
    const player = typeof e['player'] === 'string' ? e['player'].trim() : ''
    if (player === '') bad.push('player is empty')
    const take = typeof e['take'] === 'string' ? e['take'].trim() : ''
    if (take === '') bad.push('take is empty')
    if (take.length > 1000) bad.push('take is longer than 1000 characters')
    const spread = e['spread'] ?? 'some'
    if (!(SEED_SPREADS as readonly unknown[]).includes(spread)) {
      bad.push('spread is not some, a few or most')
    }
    const criticsRaw = e['critics'] ?? []
    const critics: ReporterId[] = []
    if (!Array.isArray(criticsRaw)) bad.push('critics is not a list')
    else {
      for (const c of criticsRaw) {
        if (!isReporter(c)) bad.push('a critic is not one of the nine')
        else if (!critics.includes(c)) critics.push(c)
      }
    }
    const defenderRaw = e['defender'] ?? null
    let defender: ReporterId | null = null
    if (defenderRaw !== null) {
      if (!isReporter(defenderRaw)) bad.push('defender is not one of the nine')
      else if (critics.includes(defenderRaw)) bad.push('defender is also a critic')
      else defender = defenderRaw
    }
    const angleRaw = e['dataAngle'] ?? null
    let dataAngle: string | null = null
    if (angleRaw !== null) {
      if (typeof angleRaw !== 'string' || angleRaw.trim().length > 500) {
        bad.push('dataAngle is not text of 500 characters or fewer')
      } else dataAngle = angleRaw.trim() === '' ? null : angleRaw.trim()
    }
    const activeRaw = e['active'] ?? true
    if (typeof activeRaw !== 'boolean') bad.push('active is not true or false')
    const intensityRaw = e['intensity'] ?? null
    if (
      intensityRaw !== null &&
      (typeof intensityRaw !== 'number' ||
        !Number.isInteger(intensityRaw) ||
        intensityRaw < -2 ||
        intensityRaw > 2)
    ) {
      bad.push('intensity is not a whole number from -2 to 2')
    }
    if (bad.length > 0) {
      problems.push(`${at}: ${bad.join('; ')}`)
      return
    }
    takes.push({
      reporter: e['reporter'] as ReporterId,
      player,
      take,
      spread: spread as Spread,
      critics,
      defender,
      dataAngle,
      active: activeRaw as boolean,
      intensity: intensityRaw as number | null,
    })
  })
  return problems.length > 0 ? { ok: false, problems } : { ok: true, takes }
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

/** The one player whose gamertag or profile name is `name` (any case), or why not. */
export function resolvePlayer(
  name: string,
  players: readonly SeedPlayer[],
): { id: number } | { error: string } {
  const want = norm(name)
  const ids = new Set(
    players
      .filter((p) => norm(p.gamertag) === want || (p.name !== null && norm(p.name) === want))
      .map((p) => p.id),
  )
  if (ids.size === 0) return { error: 'no player matches' }
  if (ids.size > 1) return { error: 'more than one player matches' }
  return { id: [...ids][0]! }
}

export type SeedResult =
  | { ok: true; inserted: number; updated: number }
  | { ok: false; problems: string[] }

/** Resolves every name first; writes only when all resolve. Logs no take content. */
export async function runSeed(
  json: unknown,
  store: SeedStore,
  log: (line: string) => void,
): Promise<SeedResult> {
  const parsed = parseSeedFile(json)
  if (!parsed.ok) return parsed
  const players = await store.listPlayers()
  const problems: string[] = []
  const seeds: TakeSeed[] = []
  parsed.takes.forEach((t, i) => {
    const r = resolvePlayer(t.player, players)
    if ('error' in r) {
      problems.push(`take ${String(i + 1)}: player "${t.player}": ${r.error}`)
      return
    }
    const { player: _player, ...rest } = t
    seeds.push({ ...rest, playerId: r.id })
  })
  if (problems.length > 0) return { ok: false, problems }

  let inserted = 0
  let updated = 0
  for (const [i, s] of seeds.entries()) {
    const outcome = await store.upsertTake(s)
    if (outcome === 'inserted') inserted++
    else updated++
    log(
      `take ${String(i + 1)}: ${s.reporter} on player ${String(s.playerId)}: ${outcome} (${s.spread}, ${String(s.critics.length)} critic(s), ${s.defender === null ? 'no defender' : 'defender'}, ${s.active ? 'active' : 'off'})`,
    )
  }
  return { ok: true, inserted, updated }
}

const USAGE = [
  'usage:',
  '  node apps/discord/src/news/seed-takes.ts <takes file.json>            (DATABASE_URL)',
  '  node apps/discord/src/news/seed-takes.ts <takes file.json> --check    (file shape only)',
].join('\n')

export async function main(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  log: (line: string) => void = console.log,
): Promise<number> {
  const path = argv.find((a) => !a.startsWith('--'))
  const checkOnly = argv.includes('--check')
  if (path === undefined) {
    log(USAGE)
    return 2
  }
  let json: unknown
  try {
    json = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    // The parser's message can quote the file: say only what went wrong.
    log('the takes file could not be read or is not valid JSON')
    return 2
  }
  if (checkOnly) {
    const r = parseSeedFile(json)
    if (!r.ok) {
      for (const p of r.problems) log(p)
      return 1
    }
    log(`${String(r.takes.length)} take(s) have a valid shape (names not resolved)`)
    return 0
  }
  if ((env['DATABASE_URL'] ?? '') === '') {
    log('DATABASE_URL is unset')
    return 2
  }
  // Loaded here only: the query module opens a database connection on import.
  const q = await import('@eanhl/db/queries')
  const { sql } = await import('@eanhl/db')
  try {
    const r = await runSeed(
      json,
      { listPlayers: q.listSeedPlayers, upsertTake: q.upsertReporterTake },
      log,
    )
    if (!r.ok) {
      for (const p of r.problems) log(p)
      log('nothing was written')
      return 1
    }
    log(`done: ${String(r.inserted)} inserted, ${String(r.updated)} updated`)
    return 0
  } finally {
    await sql.end()
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2), process.env).then(
    (code) => {
      process.exitCode = code
    },
    (err: unknown) => {
      // Never the message: a database error can quote the row, and the row holds a take.
      const code = (err as { code?: unknown } | null)?.code
      console.error(
        `seed-takes failed (${typeof code === 'string' ? code : err instanceof Error ? err.name : 'error'})`,
      )
      process.exitCode = 1
    },
  )
}
