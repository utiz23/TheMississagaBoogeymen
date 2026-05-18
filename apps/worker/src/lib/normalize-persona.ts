/**
 * Persona-name resolver: maps OCR-garbled in-game NHL player names to their
 * canonical form via `player_persona_aliases`.
 *
 * Distinct from `resolveGamertagToPlayer` (which maps OCR snapshots to
 * `player_id` for identity resolution). This resolver canonicalizes the
 * STRING displayed on the lineup card — e.g., `E.Wanhg` → `E. WAHNG`,
 * `#11- Evgeni Wanh` → `E. WAHNG`.
 *
 * Resolution cascade:
 *   1. Normalize: trim, strip leading `-. / .` ornaments, strip trailing
 *      punctuation. Reuses `normalizeSnapshot` from `resolve-identity.ts`.
 *   2. Exact case-insensitive match on `player_persona_aliases.normalized_alias`.
 *   3. Levenshtein distance ≤ 1 fallback against the full alias set.
 *   4. No alias hit → return the normalized-but-otherwise-raw value (clean of
 *      ornaments) so the consolidator can write a slightly-cleaner string
 *      even without a table entry.
 *
 * Called by the loadout consolidator after the dominant-vote step. Never
 * inserts new alias rows — the table is operator-curated (SQL or future CLI).
 */

import { db, playerPersonaAliases } from '@eanhl/db'
import { eq } from 'drizzle-orm'
import { normalizeSnapshot, levenshtein } from '../ocr-promoters/resolve-identity.js'

export type PersonaResolutionPath = 'exact_alias' | 'fuzzy_alias' | 'raw'

export interface ResolvedPersona {
  /** Canonical persona string OR the cleaned raw if no alias hit. */
  canonical: string
  /** Tags the resolution path so callers can log diagnostics. */
  via: PersonaResolutionPath
}

type PersonaDb = Pick<typeof db, 'select'>

/**
 * Resolve a raw OCR persona snapshot to a clean persona string.
 *
 * Returns `null` only when the input is null/empty/all-ornament — i.e.,
 * the snapshot carries no usable persona information. For any non-empty
 * input the resolver always returns at minimum the ornament-stripped value
 * (via=`'raw'`), so callers can rely on a string when input was meaningful.
 */
export async function resolvePersona(
  rawSnapshot: string | null | undefined,
  dbConn: PersonaDb = db,
): Promise<ResolvedPersona | null> {
  if (!rawSnapshot) return null
  const cleaned = normalizeSnapshot(rawSnapshot)
  if (!cleaned) return null
  const normalized = cleaned.toLowerCase()

  // 1. Exact match on normalized_alias.
  const [exact] = await dbConn
    .select({ canonical: playerPersonaAliases.canonicalPersona })
    .from(playerPersonaAliases)
    .where(eq(playerPersonaAliases.normalizedAlias, normalized))
    .limit(1)
  if (exact) return { canonical: exact.canonical, via: 'exact_alias' }

  // 2. Levenshtein-1 fallback against the full alias set. Set is small
  //    (operator-curated, expect ~10-100 rows), so a TS-side scan is fine.
  const all = await dbConn
    .select({
      normalized: playerPersonaAliases.normalizedAlias,
      canonical: playerPersonaAliases.canonicalPersona,
    })
    .from(playerPersonaAliases)
  for (const row of all) {
    if (levenshtein(row.normalized, normalized, 1) <= 1) {
      return { canonical: row.canonical, via: 'fuzzy_alias' }
    }
  }

  // 3. No alias hit — return the ornament-stripped value so the consolidator
  //    at least writes a slightly-cleaner snapshot than the raw vote.
  return { canonical: cleaned, via: 'raw' }
}
