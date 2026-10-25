/** A player a news item names: the name as printed, and the player row. */
export interface MentionRef {
  name: string
  playerId: number
}

export type MentionPart = { text: string } | { text: string; playerId: number }

const WORD_CHAR = /[\p{L}\p{N}_]/u

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && ch !== '' && WORD_CHAR.test(ch)
}

/**
 * Split `text` into plain-text parts and player-link parts.
 *
 * Longest names are tried first ("Silky Jr" before "Silky"). A match must be a
 * whole word: the characters just before and after it may not be letters,
 * digits or "_" (so "Silkyness" does not link). Matching is case-sensitive.
 * The parts, joined, always equal `text`.
 */
export function splitMentions(text: string, mentions: readonly MentionRef[]): MentionPart[] {
  if (text === '') return []
  const names = [...mentions]
    .filter((m) => m.name !== '')
    .sort((a, b) => b.name.length - a.name.length)
  if (names.length === 0) return [{ text }]

  const parts: MentionPart[] = []
  let plainFrom = 0
  let i = 0
  while (i < text.length) {
    const before = i === 0 ? undefined : text[i - 1]
    let hit: MentionRef | null = null
    if (!isWordChar(before)) {
      for (const m of names) {
        if (text.startsWith(m.name, i) && !isWordChar(text[i + m.name.length])) {
          hit = m
          break
        }
      }
    }
    if (hit === null) {
      i += 1
      continue
    }
    if (i > plainFrom) parts.push({ text: text.slice(plainFrom, i) })
    parts.push({ text: hit.name, playerId: hit.playerId })
    i += hit.name.length
    plainFrom = i
  }
  if (plainFrom < text.length) parts.push({ text: text.slice(plainFrom) })
  return parts
}
