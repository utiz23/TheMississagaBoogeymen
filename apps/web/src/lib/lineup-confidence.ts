/**
 * Field-completeness confidence buckets for the Lineup & Loadouts footer.
 *
 * We have no trustworthy per-field OCR certainty (RapidOCR's overall_confidence
 * is a poorly-calibrated whole-frame average). So each bucket is a *recovery*
 * proxy: the share of expected fields the OCR actually produced, computed over
 * the RENDERED lineup rows (post-EA-platform-overlay) so the numbers match what
 * the user sees on the cards. The footer labels this honestly as a completeness
 * score, not a per-field OCR confidence.
 */

import type { LineupRow, MatchLineups } from '@eanhl/db/queries'

export interface LineupConfidence {
  /** Mean coverage of {number, persona, gamertag, platform} across rows. */
  identity: number | null
  /**
   * Share of rows carrying a build type (raw or canonical).
   *
   * Split out from the bio fields in the game-sheet revamp: the old combined
   * bucket averaged {build, height, weight} and so reported e.g. 63% on a
   * match where every single row HAD a build and only height/weight were
   * patchy. "Build 63%" read as "the OCR missed builds", which was never true.
   */
  build: number | null
  /** Mean coverage of {height, weight} across rows — the loadout bio fields. */
  bio: number | null
  /** Canonical-name resolution rate among detected X-Factor entries. */
  xfactor: number | null
  /** Valid-tier rate among detected X-Factor entries. */
  tier: number | null
  /** Share of rows carrying a non-null attribute set. */
  attribute: number | null
  /** Mean of the buckets that have a non-zero denominator. 0 when no rows. */
  overall: number
}

function gamertagPresent(r: LineupRow): boolean {
  if (r.player) return true
  return (r.gamertagSnapshot ?? '').trim().length > 0
}

export function computeLineupConfidence(lineups: MatchLineups): LineupConfidence {
  const rows: LineupRow[] = [...lineups.bgm, ...lineups.opponent]
  if (rows.length === 0) {
    return {
      identity: null,
      build: null,
      bio: null,
      xfactor: null,
      tier: null,
      attribute: null,
      overall: 0,
    }
  }

  let identitySum = 0
  let buildSum = 0
  let bioSum = 0
  let rowsWithAttrs = 0
  let xfTotal = 0
  let xfCanon = 0
  let xfTier = 0

  for (const r of rows) {
    const idPresent =
      (r.playerNumber !== null ? 1 : 0) +
      (r.playerNamePersona !== null ? 1 : 0) +
      (gamertagPresent(r) ? 1 : 0) +
      (r.platform !== null ? 1 : 0)
    identitySum += idPresent / 4

    // present when either raw or canonical is populated (renderer falls back to raw)
    buildSum += r.buildClass !== null || r.buildClassCanonical !== null ? 1 : 0
    bioSum += ((r.heightText !== null ? 1 : 0) + (r.weightLbs !== null ? 1 : 0)) / 2

    if (r.attributes !== null && Object.keys(r.attributes).length > 0) rowsWithAttrs++

    for (const xf of r.xFactors) {
      xfTotal++
      if (xf.canonicalName !== null) xfCanon++
      if (xf.tier !== null) xfTier++
    }
  }

  const identity = identitySum / rows.length
  const build = buildSum / rows.length
  const bio = bioSum / rows.length
  const attribute = rowsWithAttrs / rows.length
  const xfactor = xfTotal > 0 ? xfCanon / xfTotal : null
  const tier = xfTotal > 0 ? xfTier / xfTotal : null

  const denominated = [identity, build, bio, xfactor, tier, attribute].filter(
    (b): b is number => b !== null,
  )
  const overall =
    denominated.length > 0 ? denominated.reduce((a, b) => a + b, 0) / denominated.length : 0

  return { identity, build, bio, xfactor, tier, attribute, overall }
}
