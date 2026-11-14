import type { NewsFactsResponse } from '@eanhl/db/news'
import type { PressPersonRole } from '@eanhl/db/queries'
import { containsName } from '../news/fact-check.ts'
import type { BenchRole } from './bench.ts'
import type { PressDeps } from './pass.ts'

/**
 * T7: who a scrum or an interview is about, as the asker and the judge see them. A player is the
 * person on the game's sheet (`facts.people`). A bench person or the coach did not play, so they
 * are never on the sheet: they are the person themself, with the name the press uses, and a
 * `bench` marker that changes how the reporters ask (nothing about their play, nothing as if they
 * played). A known player on the bench keeps their own press level ("Leave me out" ends it).
 */
export interface Subject {
  name: string
  pressLevel: 'full' | 'easy'
  /** Set for a person who did not play: `bench` watched from the call, `coach` is the coach. */
  bench?: BenchRole
}

/**
 * The subject of a person row, or undefined when nothing may be asked or said about them now: a
 * player no longer on the sheet (guest, "Leave me out"), or a bench person who is a "Leave me
 * out" player or whose name is a forbidden name.
 */
export async function subjectOf(
  deps: Pick<PressDeps, 'store'>,
  res: NewsFactsResponse,
  person: { playerId: number | null; personRole: PressPersonRole; name: string },
): Promise<Subject | undefined> {
  if (person.personRole === 'player') {
    const onSheet = res.facts.people.find((p) => p.playerId === person.playerId)
    return onSheet === undefined
      ? undefined
      : { name: onSheet.name, pressLevel: onSheet.pressLevel }
  }
  if (res.forbiddenNames.some((n) => containsName(person.name, n))) return undefined
  let pressLevel: 'full' | 'easy' = 'full'
  if (person.playerId !== null) {
    const entry = (await deps.store.listPressRoster()).find((r) => r.playerId === person.playerId)
    if (entry?.pressLevel === 'out') return undefined
    if (entry?.pressLevel === 'easy') pressLevel = 'easy'
  }
  return { name: person.name, pressLevel, bench: person.personRole }
}
