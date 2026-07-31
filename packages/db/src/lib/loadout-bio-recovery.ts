/**
 * Pure helpers for recovering loadout bio fields from raw OCR payloads.
 *
 * WHY THIS EXISTS. Height, weight, handedness, player level and the reference
 * build are all printed on the in-game loadout screen and the OCR reads them —
 * `ocr_extractions.raw_result_json` carries handedness on 157 of match 250's
 * 190 loadout captures, height on 151, weight on 157. But the typed evidence
 * extractor (`tools/game_ocr/game_ocr/loadout_evidence.py`) emits only
 * `gamertag` / `persona_raw` / `player_level_raw` from that screen — it defines
 * no ROI for height, weight or handedness. So the evidence → promotion path
 * that writes `player_loadout_snapshots` has no channel for them:
 *
 *   - handedness: NULL on 100% of rows. The pre-game lobby (the only other
 *     screen with an evidence extractor) doesn't display it at all.
 *   - height/weight: arrive only via `pre_game_lobby_state_2`, whose coverage
 *     is partial — 4 of match 250's 10 anchors got a height.
 *   - reference builds: the consolidator stores the normalized *bare* build,
 *     so "COLECAUFIELD-SNP" persists as plain "Sniper" and the reference
 *     player is dropped.
 *
 * Repairing the extractor is the real fix (new ROIs plus a re-run of the OCR
 * evidence pass over the stored frames). Until then `getMatchLineups` votes
 * these values out of the payloads at read time, touching no OCR data.
 *
 * Kept free of any DB import so the voting logic is unit-testable without a
 * live Postgres — it publishes numbers to the game sheet, so its noise
 * handling is pinned down by tests.
 */

export interface RecoveredBio {
  heightText: string | null
  weightLbs: number | null
  handedness: string | null
  playerLevelRaw: string | null
  /** Canonical "[Reference - ]Build" — only used to restore a dropped reference. */
  buildClassCanonical: string | null
}

/**
 * Empty/whitespace text → null. The loadout promoter serializes unpromoted
 * text fields as `String(winningValue ?? '')`, so "absent" reaches us as `''`
 * about as often as it reaches us as NULL — three of match 250's ten anchors
 * carry `player_level_raw = ''`.
 */
export function blank(s: string | null): string | null {
  if (s === null) return null
  const t = s.trim()
  return t.length > 0 ? t : null
}

/**
 * Minimum agreeing readings before a recovered value is trusted.
 *
 * Nulls don't vote, so without a floor a SINGLE noisy frame wins by default
 * whenever every other capture of that field was blank. Match 250 has exactly
 * that: MrHomiecide's level reads blank on 36 captures and `P1LVL17` on one —
 * a plain plurality would publish P1·L17 as fact off one frame. Two
 * independent frames agreeing is the bar; every genuine value in that match
 * clears it with 7-36.
 */
export const MIN_BIO_VOTE_SUPPORT = 2

/**
 * Winner of a plurality vote among non-null values, or null when nothing
 * reached `minSupport` agreeing readings. Ties resolve to the first value
 * seen, which keeps the result stable across query runs.
 */
export function pluralityWinner<T>(
  values: (T | null)[],
  minSupport = MIN_BIO_VOTE_SUPPORT,
): T | null {
  const counts = new Map<string, { value: T; n: number }>()
  for (const v of values) {
    if (v === null) continue
    const k = JSON.stringify(v)
    const hit = counts.get(k)
    if (hit) hit.n++
    else counts.set(k, { value: v, n: 1 })
  }
  let best: { value: T; n: number } | null = null
  for (const c of counts.values()) {
    if (best === null || c.n > best.n) best = c
  }
  if (best === null || best.n < minSupport) return null
  return best.value
}

/** "175 lbs" / "175LBS" → 175. Null when no plausible number is present. */
export function parseWeightLbs(raw: string | null): number | null {
  if (!raw) return null
  const m = /(\d{2,3})/.exec(raw)
  if (!m?.[1]) return null
  const n = Number(m[1])
  // EASHL create-a-player spans roughly 150-260 lb; anything outside that is
  // an OCR misread (the payloads contain a "601 lbs" from a mangled 6'0" row).
  return n >= 140 && n <= 275 ? n : null
}

/** "SHOOTS LEFT" / "Left" → "Left". Null when unrecognized — never a guess. */
export function parseHandedness(raw: string | null): string | null {
  if (!raw) return null
  const t = raw.trim().toLowerCase()
  if (t.includes('left')) return 'Left'
  if (t.includes('right')) return 'Right'
  return null
}

/** `5'8"` shapes only — rejects the mangled rows that lose the foot mark. */
export function parseHeightText(raw: string | null): string | null {
  if (!raw) return null
  const m = /(\d)\s*'\s*(\d{1,2})/.exec(raw)
  if (!m) return null
  return `${m[1] ?? ''}'${m[2] ?? ''}"`
}

/**
 * Keep the consolidator's build, but take the recovered one when it is the
 * SAME build carrying a reference player the stored value lost — the write
 * path persists "COLECAUFIELD-SNP" as a bare "Sniper". A recovered build that
 * disagrees on the build itself is ignored: the consolidator voted across far
 * more evidence than this read-time pass sees.
 */
export function preferReferenceBuild(
  stored: string | null,
  recovered: string | null,
): string | null {
  if (recovered === null) return stored
  if (stored === null) return recovered
  const buildOf = (s: string): string => {
    const i = s.indexOf(' - ')
    return i === -1 ? s : s.slice(i + 3)
  }
  const storedHasRef = stored.includes(' - ')
  const recoveredHasRef = recovered.includes(' - ')
  if (!storedHasRef && recoveredHasRef && buildOf(stored) === buildOf(recovered)) {
    return recovered
  }
  return stored
}
