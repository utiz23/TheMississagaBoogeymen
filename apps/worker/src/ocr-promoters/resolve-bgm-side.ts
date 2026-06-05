/**
 * Resolve which side of an OCR'd post-game screen is BGM (the "for" side) and
 * which is the opponent (the "against" side).
 *
 * The schema's _for / _against columns are always BGM-perspective, but post-game
 * screens show team names neutrally as Away (top) and Home (bottom). We need a
 * mapping. Strategy (in precedence order):
 *   1. `matches.bgm_was_home` — the AUTHORITATIVE EA-payload orientation flag,
 *      set at ingest in transform.ts. When present (non-null) it is used
 *      directly: it is structured EA data, not subject to the garbled team-name
 *      OCR that defeats the soft-match path below. This is the normal path.
 *   2. LEGACY fallback only when `bgm_was_home IS NULL` (matches with no EA
 *      payload orientation): soft-match each side's team-name OCR string against
 *      known BGM aliases (BGM, BOOGEYMEN, THE BOOGEYMEN), then against the
 *      opponent name on file in matches.opponentName.
 *
 * If the flag is null AND neither side cleanly matches, throw — the operator
 * likely passed the wrong --match-id and should re-run with the right one. (This
 * "Cannot resolve BGM side" throw is treated as FATAL by the validate gate — see
 * validate-candidate-run.ts classifyExtractorError — because a wrong side would
 * silently corrupt for/against on the whole dataset.)
 */

import { matches } from '@eanhl/db'
import { eq } from 'drizzle-orm'
import type { PromoterDb } from './index.js'

// Lowercased name fragments (after stripping non-alphanumerics) that mark a
// label as the BGM side. "bm" is the short abbreviation used on Net Chart and
// Action Tracker headers; "bgm"/"boogeymen" cover the longer renderings.
const BGM_ALIASES = ['bgm', 'boogeymen', 'the boogeymen', 'bm']

export interface ResolvedSides {
  awayIs: 'for' | 'against'
  homeIs: 'for' | 'against'
}

export async function resolveBgmSide(
  matchId: number,
  awayTeamName: string | null,
  homeTeamName: string | null,
  dbConn: PromoterDb,
): Promise<ResolvedSides> {
  const [match] = await dbConn
    .select({ opponentName: matches.opponentName, bgmWasHome: matches.bgmWasHome })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1)
  if (!match) throw new Error(`match_id ${String(matchId)} not found in matches table`)

  // Authoritative path: trust the EA-payload orientation flag when present. It
  // overrides the OCR soft-match entirely — a garbled-but-coincidentally-
  // alias-matching header must never flip for/against on the whole dataset.
  if (match.bgmWasHome !== null && match.bgmWasHome !== undefined) {
    return match.bgmWasHome
      ? { awayIs: 'against', homeIs: 'for' }
      : { awayIs: 'for', homeIs: 'against' }
  }

  // Legacy fallback (bgm_was_home IS NULL): soft-match the OCR team names.
  const awayBgm = matchesBgm(awayTeamName)
  const homeBgm = matchesBgm(homeTeamName)

  if (awayBgm && !homeBgm) return { awayIs: 'for', homeIs: 'against' }
  if (!awayBgm && homeBgm) return { awayIs: 'against', homeIs: 'for' }

  // Tie-break by opponent name when BGM detection is ambiguous.
  const awayOpp = matchesString(awayTeamName, match.opponentName)
  const homeOpp = matchesString(homeTeamName, match.opponentName)
  if (awayOpp && !homeOpp) return { awayIs: 'against', homeIs: 'for' }
  if (!awayOpp && homeOpp) return { awayIs: 'for', homeIs: 'against' }

  throw new Error(
    `Cannot resolve BGM side for match ${String(matchId)}: away="${awayTeamName ?? 'null'}" home="${homeTeamName ?? 'null'}" opponent_on_file="${match.opponentName}". Verify --match-id is correct.`,
  )
}

function matchesBgm(name: string | null): boolean {
  if (!name) return false
  const tokens = normalize(name).split(' ').filter(Boolean)
  if (tokens.length === 0) return false
  // The team identifier is always the first token; subsequent tokens are
  // home/away markers ("a"/"h") or descriptive words.
  const head = tokens[0]
  if (head && BGM_ALIASES.includes(head)) return true
  // Fallback: exact-alias match against the full normalized string.
  const full = tokens.join(' ')
  return BGM_ALIASES.some((alias) => alias === full || full === alias)
}

function matchesString(name: string | null, opponent: string): boolean {
  if (!name) return false
  const aTokens = normalize(name).split(' ').filter(Boolean)
  const bTokens = normalize(opponent).split(' ').filter(Boolean)
  if (aTokens.length === 0 || bTokens.length === 0) return false
  // First token of the OCR label should match either first token of the
  // opponent name on file, or one of its tokens. Handles "4TH(H)" → "4th h"
  // matching "4th Line" → "4th line".
  const aHead = aTokens[0]
  if (!aHead) return false
  return bTokens.some((t) => t === aHead) || aTokens.some((t) => bTokens.includes(t))
}

function normalize(s: string): string {
  // Replace any non-alphanumeric run with a single space, then collapse spaces.
  // This keeps tokens like "BM(A)" → "bm a" so substring checks against
  // multi-word names (e.g. "the boogeymen") behave sensibly.
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
