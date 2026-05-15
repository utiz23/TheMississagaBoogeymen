/**
 * X-Factor name normalization: OCR string → canonical asset name.
 *
 * EA's branding assets (apps/web/public/assets/x-factors/) use canonical
 * underscored names like `Tape_to_Tape`, `PressurePlus`, `Big_Rig`. OCR
 * output is noisy: spaces collapse ("TAPETOTAPE"), case varies, ALT-glyphs
 * appear ("PRESSURE+"), and stylized fonts produce single-char errors.
 *
 * Strategy:
 *   1. Strip all non-alphanumeric and uppercase both sides.
 *   2. Exact match on stripped form (catches every clean OCR).
 *   3. Levenshtein-1 fuzzy on stripped form (catches single-char OCR errors).
 *   4. Return null when nothing clears tier-2.
 *
 * Returning null is preferable to a wrong guess: the consumer can fall back
 * to displaying the raw OCR string and the backfill script logs unmatched
 * values for review.
 */

import { levenshtein } from '../ocr-promoters/resolve-identity.js'

/**
 * The 28 canonical X-Factor names from NHL 26. Folder layout mirrors this:
 * apps/web/public/assets/x-factors/<Name>/NHL_26_<Name>_X-Factor_Image__<Red|Gold|Blue>__File.png
 *
 * Naming oddities (preserved verbatim):
 *   - PressurePlus (EA omits the '+' / underscore here)
 *   - One_T, Big_Rig, Big_Tipper, etc. (multi-word with underscores)
 *   - Tape_to_Tape, Post_to_Post (lowercase 'to' preserved)
 *   - Stick_Em_Up (no apostrophe)
 *   - Quickpick (single word, no separator)
 */
export const XFACTOR_CANONICAL_NAMES: readonly string[] = [
  'Ankle_Breaker',
  'Backhand_Beauty',
  'Big_Rig',
  'Big_Tipper',
  'Born_Leader',
  'Dialed_In',
  'Elite_Edges',
  'Hipster',
  'No_Contest',
  'One_T',
  'Post_to_Post',
  'PressurePlus',
  'Quick_Draw',
  'Quick_Release',
  'Quickpick',
  'Recharge',
  'Rocket',
  'Second_Wind',
  'Send_It',
  'Show_Stopper',
  'Spark_Plug',
  'Sponge',
  'Stick_Em_Up',
  'Tape_to_Tape',
  'Truculence',
  'Unstoppable',
  'Warrior',
  'Wheels',
]

/** Uppercase + strip every non-alphanumeric character. */
function strip(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/** Pre-computed lookup of stripped → canonical, built once. */
const STRIPPED_INDEX: ReadonlyMap<string, string> = new Map(
  XFACTOR_CANONICAL_NAMES.map((c) => [strip(c), c]),
)

/**
 * Known OCR variants where the difference from canonical exceeds
 * Levenshtein-1 — typically because the in-game UI renders a stylized
 * glyph that OCR reads as a single character (e.g. `PRESSURE+` for
 * `PressurePlus`, which loses 4 characters). Extend this when the
 * backfill surfaces new outliers.
 */
const STRIPPED_ALIASES: ReadonlyMap<string, string> = new Map([
  ['PRESSURE', 'PressurePlus'],
  ['PRESSUREPLUS', 'PressurePlus'],
])

/**
 * Map an OCR X-Factor string to a canonical name, or null if no confident match.
 *
 * @param raw The verbatim OCR string from `x_factor_name`.
 * @returns The canonical name (e.g. `Tape_to_Tape`) or null.
 */
export function normalizeXFactor(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = strip(raw)
  if (s.length === 0) return null
  const exact = STRIPPED_INDEX.get(s)
  if (exact) return exact
  const aliased = STRIPPED_ALIASES.get(s)
  if (aliased) return aliased
  // Fuzzy: walk all canonical stripped forms, pick the unique distance-1
  // match. If multiple canonicals fit within distance 1, prefer the one
  // with the smallest distance, then alphabetical (stable).
  let best: { canonical: string; distance: number } | null = null
  let ambiguous = false
  for (const [stripped, canonical] of STRIPPED_INDEX) {
    const d = levenshtein(s, stripped, 1)
    if (d > 1) continue
    if (best === null || d < best.distance) {
      best = { canonical, distance: d }
      ambiguous = false
    } else if (d === best.distance) {
      ambiguous = true
    }
  }
  if (best && !ambiguous) return best.canonical
  return null
}
