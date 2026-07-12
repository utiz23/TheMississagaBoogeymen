/**
 * L4 — API-truth accuracy comparator (pure).
 *
 * Diffs OCR box-score team totals and per-player audit lines against the
 * EA-API truth, producing an exact-match fraction plus a mismatch list for the
 * review queue. Read-only + synchronous except for the injected persona
 * resolver; all DB access happens in the caller (`computeLayers`) via the
 * Task 3.2 input queries.
 *
 * Grading principle: **accuracy, not coverage.** A field is graded only when
 * BOTH the OCR value and the API value are present. A field OCR never captured
 * (null) is skipped, not counted as a miss — omissions are a completeness
 * concern (L2), not an accuracy one. So `score` answers "of what OCR read, how
 * much was correct?".
 */
import type { OcrTeamTotals, ApiTeamTotals, OcrPlayerLine, ApiPlayerLine } from '@eanhl/db/queries'

export interface L4FieldDiff {
  field: string
  scope: 'team' | `player:${string}`
  ocrValue: number | null
  apiValue: number | null
  exactMatch: boolean
}

export interface L4Result {
  /** false ⇒ "ungradable — OCR sole source" (no matches row / no API truth). */
  gradable: boolean
  /** Exact-match fraction over gradable fields; null when !gradable or 0 fields. */
  score: number | null
  fieldsTotal: number
  fieldsMatched: number
  /** Every gradable (both-sides-present) field comparison. */
  diffs: L4FieldDiff[]
  /** Subset of `diffs` where the OCR value disagrees — feeds the review queue. */
  mismatches: L4FieldDiff[]
  notes: string
}

export interface L4Inputs {
  ocrTeam: OcrTeamTotals | null
  apiTeam: ApiTeamTotals | null
  ocrPlayers: OcrPlayerLine[]
  apiPlayers: ApiPlayerLine[]
  resolvePersona: (raw: string) => Promise<{ playerId: number | null }>
}

/** Save-% comparison tolerance (percentage points), per the L4 spec. */
const SAVE_PCT_TOLERANCE = 0.01

/**
 * OCR-team → API-team field mapping. The box-score screen shows API team
 * numbers, so goalsFor↔scoreFor / goalsAgainst↔scoreAgainst, and shots/faceoffs
 * map by identical name. Diff `field` is named for the OCR side.
 */
const TEAM_FIELD_MAP: ReadonlyArray<{
  field: string
  ocr: keyof OcrTeamTotals
  api: keyof ApiTeamTotals
}> = [
  { field: 'goalsFor', ocr: 'goalsFor', api: 'scoreFor' },
  { field: 'goalsAgainst', ocr: 'goalsAgainst', api: 'scoreAgainst' },
  { field: 'shotsFor', ocr: 'shotsFor', api: 'shotsFor' },
  { field: 'shotsAgainst', ocr: 'shotsAgainst', api: 'shotsAgainst' },
  { field: 'faceoffsFor', ocr: 'faceoffsFor', api: 'faceoffsFor' },
  { field: 'faceoffsAgainst', ocr: 'faceoffsAgainst', api: 'faceoffsAgainst' },
]

export async function computeL4(inputs: L4Inputs): Promise<L4Result> {
  const { ocrTeam, apiTeam, ocrPlayers, apiPlayers, resolvePersona } = inputs

  // No API truth ⇒ ungradable. OCR is the sole source; there is nothing to
  // grade it against. (Milestone ④ treats this as "promote with a warning".)
  if (apiTeam === null) {
    return {
      gradable: false,
      score: null,
      fieldsTotal: 0,
      fieldsMatched: 0,
      diffs: [],
      mismatches: [],
      notes: 'ungradable — OCR sole source (no API truth)',
    }
  }

  const diffs: L4FieldDiff[] = []

  // ── Team totals ────────────────────────────────────────────────────────────
  if (ocrTeam !== null) {
    for (const { field, ocr, api } of TEAM_FIELD_MAP) {
      const ocrValue = ocrTeam[ocr]
      const apiValue = apiTeam[api]
      if (ocrValue == null || apiValue == null) continue // ungradable field
      diffs.push({ field, scope: 'team', ocrValue, apiValue, exactMatch: ocrValue === apiValue })
    }
  }

  // ── Per-player lines ─────────────────────────────────────────────────────────
  const apiByPlayerId = new Map<number, ApiPlayerLine>()
  for (const p of apiPlayers) apiByPlayerId.set(p.playerId, p)

  for (const line of ocrPlayers) {
    const { playerId } = await resolvePersona(line.personaRaw)
    if (playerId == null) continue // unresolved persona — nothing to grade against
    const api = apiByPlayerId.get(playerId)
    if (!api) continue // resolved to a player not on the API roster
    const scope: `player:${string}` = `player:${line.personaRaw}`

    for (const field of ['goals', 'assists', 'saves'] as const) {
      const ocrValue = line[field]
      const apiValue = api[field]
      if (ocrValue == null || apiValue == null) continue
      diffs.push({ field, scope, ocrValue, apiValue, exactMatch: ocrValue === apiValue })
    }

    // Save % compared within tolerance (both sides on the 0-100 scale).
    if (line.savePct != null && api.savePct != null) {
      diffs.push({
        field: 'savePct',
        scope,
        ocrValue: line.savePct,
        apiValue: api.savePct,
        exactMatch: Math.abs(line.savePct - api.savePct) <= SAVE_PCT_TOLERANCE,
      })
    }
  }

  const mismatches = diffs.filter((d) => !d.exactMatch)
  const fieldsTotal = diffs.length
  const fieldsMatched = fieldsTotal - mismatches.length
  const score = fieldsTotal > 0 ? fieldsMatched / fieldsTotal : null

  const notes =
    fieldsTotal === 0
      ? 'gradable but no overlapping OCR/API fields to compare'
      : `graded ${String(fieldsMatched)}/${String(fieldsTotal)} fields (team + per-player) vs EA-API truth`

  return { gradable: true, score, fieldsTotal, fieldsMatched, diffs, mismatches, notes }
}
