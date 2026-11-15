import type { Reporter, ReporterId, ReporterOverride } from '@eanhl/db/news'
import type { ReporterBoardRow, ReporterPreview, ReporterRecord } from '@eanhl/db/queries'

/**
 * The shapes and the pure helpers of the Reporters pages (task press-box-l4). No database import
 * here, so a test can load it; the reads are in `reporters-reads.ts`.
 */

export interface ReportersList {
  /** False before migration 0087: nothing can be edited yet. */
  ready: boolean
  rows: ReporterBoardRow[]
}

export interface ReporterPage {
  ready: boolean
  id: ReporterId
  /** The code definition (the defaults). */
  base: Reporter
  /** The character the writers read now (the code with the saved overrides). */
  merged: Reporter
  override: ReporterOverride | null
  enabled: boolean
  record: ReporterRecord
  preview: ReporterPreview | null
  /** The texts the editor starts from and "Reset to default" returns to. */
  defaults: { bio: string; voiceNotes: string; catchphrases: string[] }
  /** The reporters of the rail, for the side list. */
  rail: ReporterBoardRow[]
}

/** The text the editor shows in each field: the saved override, else the code default. */
export function editorValues(p: Pick<ReporterPage, 'merged' | 'override' | 'defaults'>): {
  bio: string
  voiceNotes: string
  catchphrases: string
  disposition: string
} {
  const o = p.override
  return {
    bio: o?.bio ?? p.defaults.bio,
    voiceNotes: o?.voiceNotes ?? p.defaults.voiceNotes,
    catchphrases: (o?.catchphrases ?? p.defaults.catchphrases).join('\n'),
    disposition:
      o?.disposition === null || o?.disposition === undefined ? 'default' : String(o.disposition),
  }
}

/** The plain-words name of a disposition step (T9: homer +2 to critic -2). */
export const DISPOSITION_LABEL: Readonly<Record<string, string>> = {
  '2': 'Homer (+2): glazes easily',
  '1': 'Leans fan (+1)',
  '0': 'Even (0)',
  '-1': 'Leans critic (-1)',
  '-2': 'Critic (-2): almost never warm',
}

/** "version 3 · edited by Silky 2026-11-14" for the header; the code defaults when never edited. */
export function characterLine(o: ReporterOverride | null, dayOf: (d: Date) => string): string {
  if (o === null) return 'character version 0 · the code defaults'
  const by = `edited by ${o.updatedBy}${o.updatedAt === null ? '' : ` ${dayOf(o.updatedAt)}`}`
  return `character version ${String(o.characterVersion)} · ${by}`
}
