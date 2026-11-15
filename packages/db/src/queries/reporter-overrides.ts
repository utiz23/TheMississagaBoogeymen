import { sql } from 'drizzle-orm'
import { db } from '../client.js'
import { setReporterOverrides, type ReporterOverride } from '../news/character.js'
import type { Disposition } from '../news/relationships.js'
import { REPORTER_IDS, type ReporterId } from '../news/reporters.js'

// Reading the reporter overrides (Press Box L4, migration 0087). Kept apart from the editor
// queries (`press-box-reporters.ts`) so the relationship readers can refresh the registry without
// an import cycle.

type RawOverride = {
  reporter: string
  bio: string | null
  voice_notes: string | null
  catchphrases: string[] | null
  disposition: string | number | null
  character_version: string | number
  updated_by: string
  updated_at: Date | string | null
}

export const reporterOverridesSql = () => sql`
  select reporter, bio, voice_notes, catchphrases, disposition, character_version, updated_by, updated_at
  from news_reporter_overrides`

const isReporter = (v: string): v is ReporterId => (REPORTER_IDS as readonly string[]).includes(v)

/** Maps a stored row to an override. A row for an unknown reporter, or a disposition out of range, is dropped (never trusted). */
export function overrideFromRow(r: RawOverride): ReporterOverride | null {
  if (!isReporter(r.reporter)) return null
  const d = r.disposition === null ? null : Number(r.disposition)
  const disposition: Disposition | null =
    d === null ? null : d === -2 || d === -1 || d === 0 || d === 1 || d === 2 ? d : null
  return {
    reporter: r.reporter,
    bio: r.bio,
    voiceNotes: r.voice_notes,
    catchphrases: r.catchphrases === null ? null : [...r.catchphrases],
    disposition,
    characterVersion: Number(r.character_version),
    updatedBy: r.updated_by,
    updatedAt: r.updated_at === null ? null : new Date(r.updated_at),
  }
}

/** Every stored override (empty before migration 0087 is applied: the read fails and says so). */
export async function listReporterOverrides(): Promise<ReporterOverride[]> {
  const rows = await db.execute<RawOverride>(reporterOverridesSql())
  return rows.map(overrideFromRow).filter((o): o is ReporterOverride => o !== null)
}

let lastRefreshAt = 0

/**
 * Reads the overrides into the in-process registry that the prompts, the relationship rules and the
 * item stamps read (`@eanhl/db/news` `setReporterOverrides`). Never throws: when the read fails (the
 * table is missing before the migration, the database is down) the registry stays as it was and the
 * writers keep the character they had (the code defaults when nothing was ever read).
 *
 * `maxAgeMs`: skip the read when the last one is newer than this (the many readers inside one pass
 * share one read). A pass start passes 0 to force a fresh read. Returns true when the registry is
 * current.
 */
export async function refreshReporterOverrides(
  opts: { maxAgeMs?: number; now?: () => number } = {},
): Promise<boolean> {
  const now = (opts.now ?? Date.now)()
  const maxAge = opts.maxAgeMs ?? 15_000
  if (maxAge > 0 && now - lastRefreshAt < maxAge && lastRefreshAt > 0) return true
  try {
    setReporterOverrides(await listReporterOverrides())
    lastRefreshAt = now
    return true
  } catch {
    return false
  }
}

/** Forget when the registry was last read (tests). */
export function resetReporterOverrideClock(): void {
  lastRefreshAt = 0
}
