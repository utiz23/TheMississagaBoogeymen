/**
 * Seed or update `player_persona_aliases` rows from a `raw=>canonical` map.
 * Mirrors the `ingest-ocr-resolve --map` pattern but writes the persona-
 * canonicalization table (display-string), not the identity-resolution table.
 *
 * Usage:
 *   pnpm --filter worker promote-persona-alias --map "C.Benson=>C. BENSON,Y.lafallo=>Y. LAFALLO"
 *
 * For each pair:
 *   1. Cleans the raw alias via the same `normalizeSnapshot()` the resolver
 *      uses at read time, so the lookup keys round-trip.
 *   2. Upserts into player_persona_aliases on the normalized key. ON CONFLICT
 *      updates the canonical (so an operator can correct a previous entry by
 *      re-running with the same raw alias and a new canonical).
 *
 * Prints inserted / updated / no-op counts at the end.
 */

import { db, sql as dbSql, playerPersonaAliases, type NewPlayerPersonaAlias } from '@eanhl/db'
import { eq } from 'drizzle-orm'
import { normalizeSnapshot } from './ocr-promoters/resolve-identity.js'

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

interface ApplyStats {
  inserted: number
  updated: number
  noop: number
  skipped: number
}

async function applyMap(mapStr: string): Promise<ApplyStats> {
  const stats: ApplyStats = { inserted: 0, updated: 0, noop: 0, skipped: 0 }
  const pairs = mapStr
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)

  for (const pair of pairs) {
    const arrowIdx = pair.indexOf('=>')
    if (arrowIdx === -1) {
      console.warn(`[promote-persona-alias] skipping malformed pair: ${pair}`)
      stats.skipped++
      continue
    }
    const rawAlias = pair.slice(0, arrowIdx).trim()
    const canonical = pair.slice(arrowIdx + 2).trim()
    if (!rawAlias || !canonical) {
      console.warn(`[promote-persona-alias] skipping empty side: ${pair}`)
      stats.skipped++
      continue
    }

    const cleaned = normalizeSnapshot(rawAlias)
    const normalized = cleaned.toLowerCase()
    if (!normalized) {
      console.warn(`[promote-persona-alias] alias '${rawAlias}' normalizes to empty — skipping`)
      stats.skipped++
      continue
    }

    const [existing] = await db
      .select({
        id: playerPersonaAliases.id,
        canonical: playerPersonaAliases.canonicalPersona,
      })
      .from(playerPersonaAliases)
      .where(eq(playerPersonaAliases.normalizedAlias, normalized))
      .limit(1)

    if (existing) {
      if (existing.canonical === canonical) {
        console.log(`[promote-persona-alias] no-op: '${rawAlias}' → '${canonical}' already present`)
        stats.noop++
        continue
      }
      const values: Partial<NewPlayerPersonaAlias> = {
        alias: cleaned,
        canonicalPersona: canonical,
        source: 'manual',
      }
      await db
        .update(playerPersonaAliases)
        .set(values)
        .where(eq(playerPersonaAliases.id, existing.id))
      console.log(
        `[promote-persona-alias] updated: '${rawAlias}' → '${canonical}' (was '${existing.canonical}')`,
      )
      stats.updated++
      continue
    }

    const values: NewPlayerPersonaAlias = {
      alias: cleaned,
      normalizedAlias: normalized,
      canonicalPersona: canonical,
      source: 'manual',
    }
    await db.insert(playerPersonaAliases).values(values)
    console.log(`[promote-persona-alias] inserted: '${rawAlias}' → '${canonical}'`)
    stats.inserted++
  }

  return stats
}

async function main(): Promise<void> {
  const mapStr = getFlag('map')

  if (!mapStr) {
    console.log('Usage:')
    console.log(
      '  pnpm --filter worker promote-persona-alias --map "raw1=>canonical1,raw2=>canonical2"',
    )
    process.exitCode = 1
    return
  }

  const stats = await applyMap(mapStr)
  console.log(
    `[promote-persona-alias] summary: inserted=${String(stats.inserted)} updated=${String(stats.updated)} noop=${String(stats.noop)} skipped=${String(stats.skipped)}`,
  )
}

main()
  .catch((err: unknown) => {
    console.error('[promote-persona-alias] Fatal error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void dbSql.end()
  })
