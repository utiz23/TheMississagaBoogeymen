import {
  REPORTERS,
  REPORTER_IDS,
  defaultCatchphrases,
  defaultVoiceNotes,
  mergeCharacter,
} from '@eanhl/db/news'
import {
  EMPTY_RECORD,
  getLatestReporterPreview,
  getReporterRecord,
  listReporterBoard,
  listReporterOverrides,
} from '@eanhl/db/queries'
import type { ReportersList, ReporterPage } from './reporters-data'

/**
 * What the Reporters pages read from the database (task press-box-l4). Counts and the stored
 * override only: no item text, no answer text. Before migration 0087 the override table does not
 * exist: the pages still render (the code characters, no editing) and say so.
 */

async function tableReady(): Promise<boolean> {
  try {
    await listReporterOverrides()
    return true
  } catch {
    return false
  }
}

export async function loadReportersList(now: Date): Promise<ReportersList> {
  const [ready, rows] = await Promise.all([tableReady(), listReporterBoard(now)])
  return { ready, rows }
}

/** The page of one reporter, or null when `id` is none of the nine. */
export async function loadReporterPage(id: string, now: Date): Promise<ReporterPage | null> {
  const rid = REPORTER_IDS.find((r) => r === id)
  if (rid === undefined) return null
  const [ready, rail, record, preview] = await Promise.all([
    tableReady(),
    listReporterBoard(now),
    getReporterRecord(rid, now).catch(() => EMPTY_RECORD),
    // Before migration 0087 the preview kind does not exist: no preview to show.
    getLatestReporterPreview(rid).catch(() => null),
  ])
  const row = rail.find((r) => r.id === rid)
  const override = row?.override ?? null
  const base = REPORTERS[rid]
  return {
    ready,
    id: rid,
    base,
    merged: mergeCharacter(base, override ?? undefined),
    override,
    enabled: row?.enabled ?? true,
    record,
    preview,
    defaults: {
      bio: base.bio,
      voiceNotes: defaultVoiceNotes(rid),
      catchphrases: defaultCatchphrases(rid),
    },
    rail,
  }
}
