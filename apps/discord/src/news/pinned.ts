import type { PinnedStoryline } from '@eanhl/db/queries'
import { containsName } from './fact-check.ts'

/**
 * The pinned storyline (Press Box L3) for ONE sheet: null when its title or angle names a forbidden
 * person (a "Leave me out" player, even one who chose that after the GM pinned it); a stance that
 * names one is left off. `forbiddenNames` is the fact-sheet response's own list. Pure.
 */
export function pinnedForSheet(
  pinned: PinnedStoryline | null,
  forbiddenNames: readonly string[],
): PinnedStoryline | null {
  if (pinned === null) return null
  const names = (text: string) =>
    forbiddenNames.some((n) => containsName(text.replace(/\s+/g, ' '), n))
  if (names(pinned.title) || names(pinned.angle)) return null
  return { ...pinned, stances: pinned.stances.filter((s) => !names(s.stance)) }
}
