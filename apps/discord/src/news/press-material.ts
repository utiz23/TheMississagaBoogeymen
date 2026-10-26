import type { NewsFacts } from '@eanhl/db/news'
import type { PressNote, PressQuote } from '@eanhl/db/queries'

/**
 * The night's press material as a sheet may use it (news desk bots): answers
 * only from players on the sheet's people (never `out`, never a guest); GM notes
 * only about such a player or about no player (matched by player id, never by
 * display name), and a critical note never about an "easy" player. Pure: the
 * night recap (cycle.ts) and the scrum asker (press/question.ts) both use it.
 */
export function pressForSheet(
  material: { quotes: readonly PressQuote[]; gmNotes: readonly PressNote[] },
  facts: NewsFacts,
): { quotes: PressQuote[]; gmNotes: PressNote[] } {
  const people = new Map(facts.people.map((p) => [p.playerId, p]))
  return {
    quotes: material.quotes.filter((q) => people.has(q.playerId)),
    gmNotes: material.gmNotes.filter((n) => {
      if (n.playerId === null) return true
      const person = people.get(n.playerId)
      return person !== undefined && !(n.critical && person.pressLevel === 'easy')
    }),
  }
}
