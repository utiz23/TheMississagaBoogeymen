/**
 * Build-class normalization: OCR string -> canonical "[ReferencePlayer - ]Build"
 *
 * EA emits the build-class field in two shapes:
 *   1. Bare build: "Playmaker", "Two-Way Forward", "Puck Moving Defenseman"
 *   2. Reference player + build: "Cole Caufield - Sniper", "Tage Thompson - Power Forward"
 *
 * OCR mangles these in predictable ways:
 *   - Spaces collapse to nothing -> "PUCKMOVINGDEFENSEMAN", "TwoWayForward"
 *   - Hyphen separator loses its spaces -> "Cole Caufield-SNP", "TAGETHOMPSON-PWF"
 *   - Suffix codes (SNP/PWF/PMD) replace the long-form name on some captures
 *   - Casing varies between captures of the same player
 */

/** Canonical build names EA exposes through the loadout view. */
export const BUILD_CANONICAL_NAMES: readonly string[] = [
  'Playmaker',
  'Sniper',
  'Grinder',
  'Two-Way Forward',
  'Power Forward',
  'Puck Moving Defenseman',
  'Defensive Defenseman',
  'Offensive Defenseman',
  // Added in NHL 26 (observed on opp-side LD anchors). Suffix code TWD.
  'Two-Way Defenseman',
]

/**
 * Suffix codes the loadout view emits on "reference player" cards
 * (e.g. "Cole Caufield-SNP" means Cole Caufield, build Sniper).
 */
const SUFFIX_CODE_TO_BUILD: ReadonlyMap<string, string> = new Map([
  ['SNP', 'Sniper'],
  ['PWF', 'Power Forward'],
  ['PMD', 'Puck Moving Defenseman'],
  ['DEF', 'Defensive Defenseman'],
  ['OFF', 'Offensive Defenseman'],
  ['TWF', 'Two-Way Forward'],
  ['TWD', 'Two-Way Defenseman'],
  ['GRD', 'Grinder'],
  ['PMK', 'Playmaker'],
  // PLY is the in-game shorthand the loadout view emits on reference-player
  // cards backed by the Playmaker build (e.g. "Connor McDavid-PLY"). Treated
  // as a synonym of PMK.
  ['PLY', 'Playmaker'],
])

/** Stripped (alphanumeric-only, uppercase) form to canonical build. */
const BARE_INDEX: ReadonlyMap<string, string> = new Map(
  BUILD_CANONICAL_NAMES.map((b) => [b.toUpperCase().replace(/[^A-Z0-9]/g, ''), b]),
)

function stripAlnum(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function titleCaseReferenceName(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/\s/.test(trimmed)) {
    return trimmed
      .split(/\s+/)
      .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1).toLowerCase() : ''))
      .join(' ')
  }
  const camelParts = trimmed.split(/(?<=[a-z])(?=[A-Z])/)
  if (camelParts.length > 1) {
    return camelParts.map((p) => p[0]!.toUpperCase() + p.slice(1).toLowerCase()).join(' ')
  }
  // All-caps stuck-together name (e.g. "TAGETHOMPSON"): scan left-to-right
  // for the first vowel→consonant boundary that leaves at least 4 chars on
  // each side. The 4-char minimum keeps single-name references like
  // "Crosby" from being chopped into "Cro Sby".
  const lower = trimmed.toLowerCase()
  const isVowel = (c: string): boolean => 'aeiou'.includes(c)
  for (let i = 4; i <= lower.length - 4; i++) {
    const left = lower[i - 1]!
    const right = lower[i]!
    if (isVowel(left) && !isVowel(right)) {
      const a = lower.slice(0, i)
      const b = lower.slice(i)
      return `${a[0]!.toUpperCase() + a.slice(1)} ${b[0]!.toUpperCase() + b.slice(1)}`
    }
  }
  return lower[0]!.toUpperCase() + lower.slice(1)
}

function unstickCase(s: string): string {
  let out = s.replace(/([a-z])([A-Z])/g, '$1 $2')
  out = out.replace(/\s+/g, ' ').trim()
  return out
}

/**
 * Map a raw build-class OCR string to its canonical form.
 *
 * @param raw The verbatim OCR string from build_class.
 * @returns Canonical "<Reference> - <Build>" or "<Build>", or null when the
 *   build portion can't be confidently identified.
 */
export function normalizeBuildClass(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = raw.trim()
  if (!trimmed) return null

  let refPart: string | null = null
  let tailPart = trimmed

  const spacedMatch = /^(.+?)\s+-\s+(.+)$/.exec(trimmed)
  if (spacedMatch?.[1] && spacedMatch[2]) {
    refPart = spacedMatch[1]
    tailPart = spacedMatch[2]
  } else {
    const codeMatch = /^(.+?)-([A-Z]{2,4})$/.exec(trimmed)
    if (codeMatch?.[1] && codeMatch[2] && SUFFIX_CODE_TO_BUILD.has(codeMatch[2])) {
      refPart = codeMatch[1]
      tailPart = codeMatch[2]
    }
  }

  const tailStripped = stripAlnum(tailPart)
  let canonicalBuild: string | null = null
  if (tailStripped.length <= 4) {
    canonicalBuild = SUFFIX_CODE_TO_BUILD.get(tailStripped) ?? null
  }
  if (!canonicalBuild) {
    canonicalBuild = BARE_INDEX.get(tailStripped) ?? null
  }
  if (!canonicalBuild) {
    const unstuck = unstickCase(tailPart)
    canonicalBuild = BARE_INDEX.get(stripAlnum(unstuck)) ?? null
  }
  if (!canonicalBuild) return null

  if (refPart) {
    const ref = titleCaseReferenceName(refPart)
    if (ref) return `${ref} - ${canonicalBuild}`
  }
  return canonicalBuild
}
