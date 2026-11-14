import type { ReporterId } from '@eanhl/db/news'

/**
 * Fixed lines for the moments the model could not write one (a failed code
 * check or review, an outage, a spent budget). A small pool per reporter, in
 * the reporter's voice, with no numbers and no name but the asked player's:
 * so a failed write never costs a vanished question or one stock line posted
 * again and again. `fallbackLine` never gives the same line twice in one
 * scrum thread (while the pool lasts, per `owner`).
 */

export type FallbackKind = 'question' | 'closing' | 'ack'

/** A question fallback: the asked player's name goes in. */
type QuestionLine = (name: string) => string

const QUESTIONS: Record<ReporterId, readonly QuestionLine[]> = {
  barlow: [
    (n) => `Walk me through that one, ${n}.`,
    (n) => `${n}, what was the plan on the ice tonight, and did it hold?`,
    (n) => `What did you see out there that decided it, ${n}?`,
    (n) => `${n}, what is the one thing you would fix first?`,
  ],
  voss: [
    (n) => `How did tonight feel from the inside, ${n}?`,
    (n) => `${n}, where was your head when the game turned?`,
    (n) => `What was the mood on the ice after that stretch, ${n}?`,
    (n) => `${n}, what will you carry out of this game?`,
  ],
  mercer: [
    (n) => `Be straight with me, ${n}: was that your best?`,
    (n) => `${n}, somebody has to own tonight. Is it you?`,
    (n) => `What would you do differently, ${n}, and do not dodge it?`,
    (n) => `${n}, was that good enough? Yes or no.`,
  ],
  halberd: [
    (n) => `${n}, what changed in your positioning as the game went on?`,
    (n) => `Where did the breakout break down tonight, ${n}?`,
    (n) => `${n}, what did the other team do that you had not planned for?`,
    (n) => `Which adjustment worked best for you, ${n}?`,
  ],
  vale: [
    (n) => `${n}, give me the headline: what just happened out there?`,
    (n) => `Quick one, ${n}: best moment of the night, go!`,
    (n) => `${n}, was that drama or just hockey?`,
    (n) => `Hot mic, ${n}. What do you want the fans to know?`,
  ],
  quill: [
    (n) => `${n}, does the game feel the way it looked on paper?`,
    (n) => `What part of your game was the most efficient tonight, ${n}?`,
    (n) => `${n}, where did you leave something on the table?`,
    (n) => `If you could change one decision tonight, ${n}, which?`,
  ],
  rink: [
    (n) => `${n}, what did the ice say to you tonight?`,
    (n) => `Did the game haunt you or free you, ${n}?`,
    (n) => `${n}, what will you remember about this one?`,
    (n) => `Tell me what you felt on that last shift, ${n}.`,
  ],
  pettibone: [
    (n) => `${n}, give me something I can print. What happened?`,
    (n) => `Straight answer, ${n}: who was better tonight?`,
    (n) => `${n}, what is the excuse, and is it a good one?`,
    (n) => `Where did it get away from you, ${n}?`,
  ],
  bergstrom: [
    (n) => `${n}, did the team compete tonight?`,
    (n) => `What did the game ask of you, ${n}, and did you answer it?`,
    (n) => `${n}, what is the lesson you take from this one?`,
    (n) => `Tell me about the effort, ${n}. Was it there?`,
  ],
}

/** The line that ends a reporter's part of the round. Neutral: it says nothing about the answer. */
const CLOSINGS: Record<ReporterId, readonly string[]> = {
  barlow: [
    'Fair enough. Thanks for your time.',
    'Understood. Next game.',
    'Noted, and thank you.',
    'That will do. Thanks.',
  ],
  voss: [
    'Thank you for sharing that.',
    'I appreciate you talking to us.',
    'Thanks. That means something.',
    'Understood. Thank you.',
  ],
  mercer: [
    'Fine. We will see next game.',
    'Noted. I will be watching.',
    'That will have to do. Thanks.',
    'Okay. We move on.',
  ],
  halberd: [
    'Thanks. I will go back to the film.',
    'Understood. That is useful.',
    'Noted. Thank you.',
    'Good enough for now. Thanks.',
  ],
  vale: [
    'And that is a wrap. Thanks!',
    'Love it. Thanks for stopping by.',
    'Great stuff. We are done here.',
    'Back to the studio. Thanks!',
  ],
  quill: [
    'Thanks. Noted for the file.',
    'Understood. Thank you.',
    'Logged. Thanks.',
    'That settles it for now. Thanks.',
  ],
  rink: [
    'The ice has heard you. Thank you.',
    'So it is written. Thanks.',
    'Go in peace. Thank you.',
    'Until the next game. Thanks.',
  ],
  pettibone: [
    'Fine. Next.',
    'That will do. Thanks.',
    'Noted. Do not make me ask twice next time.',
    'Good enough. Moving on.',
  ],
  bergstrom: [
    'Fair enough. Thank you.',
    'Understood. Keep working.',
    'Noted. Thanks.',
    'That is all I need. Thanks.',
  ],
}

/** After an answer the desk could not use, when the round goes on: it only says the answer arrived. */
const ACKS: Record<ReporterId, readonly string[]> = {
  barlow: [
    'Noted. Moving on.',
    'Got it. Next question.',
    'Understood. Let us go on.',
    'Okay. Moving along.',
  ],
  voss: [
    'I hear you. Let us go on.',
    'Thank you. One more angle.',
    'Understood. Moving on.',
    'Got it. Here comes the next.',
  ],
  mercer: [
    'Right. Moving on.',
    'Noted. Do not get comfortable.',
    'Okay. Next.',
    'Heard. Here is another.',
  ],
  halberd: [
    'Noted. Next topic.',
    'Got it. Let us look at something else.',
    'Understood. Moving on.',
    'Okay. A different angle.',
  ],
  vale: [
    'Heard you, loud and clear! Next!',
    'Ha, got it. On we go!',
    'Noted! Here comes another.',
    'Okay, okay! Moving on!',
  ],
  quill: [
    'Noted. Next question.',
    'Received. Moving on.',
    'Got it. Different angle.',
    'Understood. Next.',
  ],
  rink: [
    'I heard. Let us go on.',
    'So it is. The next one.',
    'Noted. The ice moves on.',
    'Understood. Onward.',
  ],
  pettibone: [
    'Heard. Next.',
    'Okay, okay. Moving on.',
    'Noted. Do not go quiet on me.',
    'Got it. Here is another.',
  ],
  bergstrom: [
    'Noted. Moving on.',
    'Understood. Next question.',
    'Got it. On we go.',
    'Okay. Let us carry on.',
  ],
}

/**
 * T6: the line a reporter posts under the recap when a player steps up to the mic ("Talk to the
 * press", `/scrum`): the player's own scrum thread starts from it. `who` is the player's mention.
 * No numbers, no other name.
 */
const STEP_UPS: Record<ReporterId, readonly ((who: string) => string)[]> = {
  barlow: [(w) => `${w} steps up to the mic.`, (w) => `${w} is on the record.`],
  voss: [(w) => `${w} has a moment for us.`, (w) => `${w} stops to talk.`],
  mercer: [(w) => `${w} steps up. Let us see what they say.`, (w) => `${w} takes the mic.`],
  halberd: [(w) => `${w} comes to the board.`, (w) => `${w} steps up to the mic.`],
  vale: [(w) => `${w} grabs the mic!`, (w) => `Look who steps up: ${w}!`],
  quill: [(w) => `${w} steps up to the mic.`, (w) => `${w} is ready for questions.`],
  rink: [(w) => `${w} walks up to the mic.`, (w) => `${w} comes to speak with the ice.`],
  pettibone: [(w) => `${w} steps up. Finally.`, (w) => `${w} takes the mic.`],
  bergstrom: [(w) => `${w} steps up to the mic.`, (w) => `${w} is here to talk.`],
}

/** The step-up line of a reporter (`seed` picks one). */
export function stepUpLine(reporter: ReporterId, who: string, seed: number): string {
  const pool = STEP_UPS[reporter]
  return pool[Math.abs(Math.trunc(seed)) % pool.length]!(who)
}

/** Every line of a kind for a reporter, as text (the name filled in for questions). */
export function fallbackPool(kind: FallbackKind, reporter: ReporterId, name = 'Player'): string[] {
  if (kind === 'question') return QUESTIONS[reporter].map((q) => q(name))
  return [...(kind === 'closing' ? CLOSINGS : ACKS)[reporter]]
}

/** The lines posted per scrum (a scrum thread), per owner (the process's deps). Bounded: the oldest scrum goes first. */
const usedBy = new WeakMap<object, Map<number, Set<string>>>()
const USED_SCRUMS_MAX = 50

/**
 * A fallback line: the first of the reporter's pool that this scrum's thread
 * has not had, starting at `seed`. `alsoUsed` are lines already known to be in
 * the thread (the scrum's questions). When the whole pool has been used, the
 * seeded line repeats. The choice is remembered for the scrum.
 */
export function fallbackLine(
  owner: object,
  args: {
    scrumId: number
    kind: FallbackKind
    reporter: ReporterId
    name: string
    seed: number
    alsoUsed?: readonly string[]
  },
): string {
  let used = usedBy.get(owner)
  if (used === undefined) usedBy.set(owner, (used = new Map()))
  const pool = fallbackPool(args.kind, args.reporter, args.name)
  let seen = used.get(args.scrumId)
  if (seen === undefined) {
    seen = new Set()
    used.set(args.scrumId, seen)
    if (used.size > USED_SCRUMS_MAX) used.delete(used.keys().next().value as number)
  }
  const taken = new Set([...seen, ...(args.alsoUsed ?? [])])
  const start = Math.abs(Math.trunc(args.seed)) % pool.length
  let line = pool[start]!
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[(start + i) % pool.length]!
    if (!taken.has(candidate)) {
      line = candidate
      break
    }
  }
  seen.add(line)
  return line
}
