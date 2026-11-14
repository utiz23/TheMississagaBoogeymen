import { REPORTERS, mulberry32, type NewsFactsResponse, type ReporterId } from '@eanhl/db/news'
import type { NewsScrumRow, ScrumPersonDetail } from '@eanhl/db/queries'
import { answerButton } from '../bot-rest.ts'
import { escapeMarkdown } from '../message.ts'
import { containsName } from '../news/fact-check.ts'
import { FALLBACK_CLOSING, judgeAnswer, type FollowUpMode, type Usability } from './asker.ts'
import { fallbackLine } from './fallbacks.ts'
import { feudLevel, recordInsult } from './feuds.ts'
import { OFFLIMITS_LOG, screenMessage } from './hard-lines.ts'
import { rememberPlayerMessage } from './player-latest.ts'
import { replyingTo } from './reply-ref.ts'
import type { PressConfig } from './config.ts'
import { SCRUM_SOURCE_WINDOW_MS, type PressDeps } from './pass.ts'
import {
  answerComponents,
  panelOf,
  personSeed,
  personThreadId,
  pressRecorder,
  reporterAt,
  safeWhy,
  scrumAskContext,
  scrumHistory,
  startScrumQuestion,
  threadLine,
} from './question.ts'
import {
  PRESS_ACCEPT_MS,
  PRESS_ANSWER_MS,
  PRESS_COMMAND_LIMIT,
  PRESS_PING_LIMIT,
  extrasBudgetLeft,
  followUpAllowed,
  followUpPlan,
  pickScrumPlayer,
  questionLimit,
  scrumCandidates,
  type Candidate,
} from './rules.ts'

/**
 * The scrum interaction handlers: "Talk to the press", Accept, Answer (opens
 * the pop-up), the pop-up submit, a typed answer in the thread and `/scrum`. Pure over `PressDeps`: each
 * returns a `Reply` that the gateway turns into a Discord response. A refusal
 * is private (ephemeral) and changes nothing. Every state change that two
 * taps could both make is a conditional update (`insertScrumPerson`,
 * `acceptScrumPerson`, `claimScrumAnswer`, `claimScrumQuestion`).
 *
 * Trial and live act the same (operator, 2026-11-13: an open trial; anyone in
 * the bot test channel who takes part agrees by taking part): each person
 * acts for themselves. The trial differs only in the channel and in that its
 * scrums and answers are marked test (never used in public pieces).
 */

export type Reply =
  | { kind: 'ephemeral'; text: string }
  | { kind: 'modal'; customId: string; title: string; label: string; maxLength: 500 }
  /** `offLimits`: a hard-line message got no reaction at all (T5); the handlers log it. */
  | { kind: 'ack'; offLimits?: true }

/** The pop-up's answer limit; a longer submit is cut to it. */
export const ANSWER_MAX_CHARS = 500
/** Discord's limit for a modal title and a text input label. */
const MODAL_TEXT_MAX = 45
/** Discord's SUPPRESS_EMBEDS message flag: a link in an answer gets no preview. */
const SUPPRESS_EMBEDS = 4

export const TEXT = {
  link: 'Link your Discord on boogeymen.app (sign in) to talk to the press.',
  left: 'The press has left. Catch them after the next game.',
  notInGame: 'This scrum is for players of this game.',
  already: "You're already in this scrum.",
  tooLate: 'Too late — the reporter moved on.',
  noAnswer: 'No answer saved.',
  answered: 'Already answered.',
  twice: "You've used that twice tonight.",
  onItsWay: 'The question is on its way.',
  rightWithYou: 'The reporter will be right with you.',
  notYet: 'The press is not here yet. Try again in a minute.',
  noGame: 'No game with the press in the last 6 hours.',
  inThread: "The reporter's question is in the scrum thread.",
  nobody: 'Nobody else can be asked about this game.',
  pressOff: 'The press is off until next month.',
} as const

const say = (text: string): Reply => ({ kind: 'ephemeral', text })
const ACK: Reply = { kind: 'ack' }
const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const reporterName = (scrum: NewsScrumRow): string => REPORTERS[scrum.reporter].name

/** At most `max` characters (code points), with `…` when cut. */
function cut(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`
}

/** The extras budget is spent (80% of the month): scrums stop until next month. */
async function pressOff(deps: PressDeps, config: PressConfig): Promise<boolean> {
  return !extrasBudgetLeft(await deps.store.monthNewsSpendUsd(deps.now()), config.monthlyLimitUsd)
}

/** The refusal for a user who may not act for this person, or null. */
function actorRefusal(person: ScrumPersonDetail, userId: string): Reply | null {
  return userId === person.discordUserId
    ? null
    : say(`This one is for ${escapeMarkdown(person.name)}.`)
}

/** The refusal for an Answer button while no question is open, or null. */
function openQuestionRefusal(person: ScrumPersonDetail, now: Date): Reply | null {
  if (person.status !== 'asking') return say(TEXT.tooLate)
  // Accepted, or the last answer is being judged: the next line is not posted yet.
  if (person.currentQuestion === null) return say(TEXT.onItsWay)
  if (
    person.lastAskedAt === null ||
    now.getTime() - person.lastAskedAt.getTime() >= PRESS_ANSWER_MS
  ) {
    return say(TEXT.tooLate)
  }
  return null
}

/** The game's players who may be asked (Task 5 rules), with the sheet's top facts. */
async function gameCandidates(
  deps: PressDeps,
  scrum: NewsScrumRow,
): Promise<{ candidates: Candidate[]; topFacts: Parameters<typeof pickScrumPlayer>[1] }> {
  const none = { candidates: [], topFacts: [] }
  if (scrum.matchId === null) return none
  const matchId = scrum.matchId
  const res = await deps.fetchFacts('game', String(matchId))
  const game = res.facts.games.find((g) => g.matchId === matchId)
  if (game === undefined) return none
  const ids = new Map<number, string>()
  for (const line of game.players) {
    const id = await deps.store.getPlayerDiscordUserId(line.playerId)
    if (id !== null) ids.set(line.playerId, id)
  }
  return { candidates: scrumCandidates(game, res.facts, ids), topFacts: res.facts.topFacts }
}

/**
 * Ask the next question: `ack` once it is posted. The person is already
 * `asking`: when it was not posted, the expiry pass closes the round.
 */
async function askNow(
  deps: PressDeps,
  config: PressConfig,
  personId: number,
  /** T6: the player's latest message: the question replies to it. */
  replyTo: string | null = null,
): Promise<Reply> {
  try {
    if (await startScrumQuestion(deps, config, personId, replyTo)) return ACK
  } catch (err: unknown) {
    deps.log(`[press] question: person ${String(personId)}: ${reason(err)}`)
  }
  return say(TEXT.rightWithYou)
}

/** "Talk to the press" on a recap post: the user volunteers (2 reporters, no follow-up). */
export async function onTalk(
  deps: PressDeps,
  config: PressConfig,
  itemId: number,
  userId: string,
): Promise<Reply> {
  const { store } = deps
  if (await pressOff(deps, config)) return say(TEXT.pressOff)
  const me = await store.getPlayerForDiscordUser(userId)
  if (me === null) return say(TEXT.link)
  const scrum = await store.scrumByRecapItem(itemId)
  if (scrum === null) return say(TEXT.notYet)
  const now = deps.now()
  if (now >= scrum.openUntil) return say(TEXT.left)

  const { candidates } = await gameCandidates(deps, scrum)
  const player = candidates.find((c) => c.playerId === me.playerId) ?? null
  if (player === null || player.discordUserId === null) return say(TEXT.notInGame)

  const personId = await store.insertScrumPerson({
    scrumId: scrum.id,
    playerId: player.playerId,
    discordUserId: player.discordUserId,
    role: 'volunteer',
    requestedBy: 'self',
    requestedByUserId: userId,
    status: 'asking',
    // Starts the answer window: if the question never goes out, the expiry pass ends the round.
    lastAskedAt: now,
  })
  if (personId === null) return say(TEXT.already)
  return askNow(deps, config, personId)
}

/** Accept on a ping: only the pinged person, within the accept window (`PRESS_ACCEPT_MS`, 15 minutes). */
export async function onAccept(
  deps: PressDeps,
  config: PressConfig,
  personId: number,
  userId: string,
): Promise<Reply> {
  const { store } = deps
  if (await pressOff(deps, config)) return say(TEXT.pressOff)
  const person = await store.getScrumPerson(personId)
  if (person === null) return say(TEXT.tooLate)
  const refusal = actorRefusal(person, userId)
  if (refusal !== null) return refusal
  if (person.status === 'asking') return say(TEXT.already)
  const now = deps.now()
  const cutoff = new Date(now.getTime() - PRESS_ACCEPT_MS)
  if (person.status !== 'pinged' || person.pingedAt === null || person.pingedAt < cutoff) {
    return say(TEXT.tooLate)
  }
  if (!(await store.acceptScrumPerson(personId, cutoff, now))) {
    // A second tap, or the expiry pass, came first.
    const again = await store.getScrumPerson(personId)
    return say(again?.status === 'asking' ? TEXT.already : TEXT.tooLate)
  }
  return askNow(deps, config, personId)
}

/** Answer under a question: opens the pop-up for the person. */
export async function onAnswerButton(
  deps: PressDeps,
  config: PressConfig,
  personId: number,
  userId: string,
): Promise<Reply> {
  const person = await deps.store.getScrumPerson(personId)
  if (person === null) return say(TEXT.tooLate)
  const refusal = actorRefusal(person, userId) ?? openQuestionRefusal(person, deps.now())
  if (refusal !== null) return refusal
  return {
    kind: 'modal',
    // The pop-up names the item it answers: a stale one cannot answer the next.
    customId: `press:modal:${String(personId)}:${String(person.questionsAsked)}:${String(person.followupsAsked)}`,
    title: cut(`${reporterName(person.scrum)} asks`, MODAL_TEXT_MAX),
    label: cut(person.currentQuestion!, MODAL_TEXT_MAX),
    maxLength: ANSWER_MAX_CHARS,
  }
}

/** The refusal for a pop-up submit, or null. */
function submitRefusal(
  person: ScrumPersonDetail,
  seen: { questionsAsked: number; followupsAsked: number },
  now: Date,
): Reply | null {
  if (person.status !== 'asking') return say(TEXT.tooLate)
  // Opened for an earlier item, or this item's answer is already being judged.
  if (
    person.questionsAsked !== seen.questionsAsked ||
    person.followupsAsked !== seen.followupsAsked ||
    person.currentQuestion === null
  ) {
    return say(TEXT.answered)
  }
  return openQuestionRefusal(person, now)
}

interface Verdict {
  usability: Usability
  followUp: string | null
  closing: string
  /** End the round now (budget spent, off the sheet, no game): no next question. */
  end: boolean
  /** The code, not the model, decided (budget, forbidden name, no verdict): the fixed lines are used. */
  byCode: boolean
  /** The model's verdict stands, but its reply line failed after all tries: a neutral line is used. */
  replyFailed: boolean
  /** T5: the judge says the answer is off-limits: no reaction at all, nothing stored. */
  offLimits: boolean
}

/**
 * What may follow the answer to the current item. An old round (no target):
 * the old rule, the model's choice. A panel round: nothing after a follow-up;
 * else `must` or `chased` by how many follow-ups the target still needs
 * (`followUpPlan`), so the follow-ups go to the answers with the most to chase.
 */
function followUpRule(person: ScrumPersonDetail): { allowed: boolean; mode: FollowUpMode } {
  if (person.targetTotal === null) {
    return { allowed: !person.askingFollowup && followUpAllowed(person), mode: 'any' }
  }
  const plan = followUpPlan({
    panelSize: panelOf(person).length,
    questionsAsked: person.questionsAsked,
    followupsAsked: person.followupsAsked,
    askingFollowup: person.askingFollowup,
    targetTotal: person.targetTotal,
  })
  return { allowed: plan !== 'none', mode: plan === 'must' ? 'must' : 'chased' }
}

/** Questions the round asks in all (without follow-ups): the panel's size; the old limit for an old round. */
function questionsInRound(person: ScrumPersonDetail): number {
  return person.targetTotal === null ? questionLimit(person.role) : panelOf(person).length
}

/** The reporter who asked the item open now (the base question's reporter; a follow-up is the same one's). */
function askerOf(person: ScrumPersonDetail): ReporterId {
  return reporterAt(panelOf(person), Math.max(person.questionsAsked - 1, 0), person.scrum.reporter)
}

/**
 * The game sheet for the person's scrum, or null when there is no game or the
 * fetch failed (logged). Nothing about the person is echoed or judged without it.
 */
async function loadSheet(
  deps: PressDeps,
  person: ScrumPersonDetail,
): Promise<NewsFactsResponse | null> {
  const matchId = person.scrum.matchId
  if (matchId === null) return null
  try {
    return await deps.fetchFacts('game', String(matchId))
  } catch (err: unknown) {
    deps.log(`[press] answer: person ${String(person.id)}: ${reason(err)}`)
    return null
  }
}

/**
 * Judge the answer. Fails closed to unusable + the fixed line + end when the
 * extras budget is spent, the person is off the sheet, or anything throws. An
 * answer that names a forbidden person ("Leave me out", a guest) is unusable
 * with no model call; the round goes on (no follow-up). When the model gave a
 * verdict and only its reply line failed, the verdict stands (`replyFailed`).
 */
async function judge(
  deps: PressDeps,
  config: PressConfig,
  person: ScrumPersonDetail,
  question: string,
  answer: string,
  asker: ReporterId,
  res: NewsFactsResponse | null,
): Promise<Verdict> {
  const { store } = deps
  const closed: Verdict = {
    usability: 'unusable',
    followUp: null,
    closing: FALLBACK_CLOSING,
    end: true,
    byCode: true,
    replyFailed: false,
    offLimits: false,
  }
  const scrum = person.scrum
  // Why an answer is stored unusable without the model's verdict: a log line, never the answer.
  const why = (what: string): void =>
    deps.log(
      `[press] answer: person ${String(person.id)}: unusable by the code, not the model (${what})`,
    )
  if (scrum.matchId === null || res === null) {
    why('no game')
    return closed
  }
  try {
    if (!extrasBudgetLeft(await store.monthNewsSpendUsd(deps.now()), config.monthlyLimitUsd)) {
      why('extras budget spent')
      return closed
    }
    const onSheet = res.facts.people.find((p) => p.playerId === person.playerId)
    // A guest, or "Leave me out" since the question: nothing about them goes anywhere.
    if (onSheet === undefined) {
      why('off the sheet')
      return closed
    }
    // An answer that names a forbidden person is never used, shown or sent to the model.
    if (res.forbiddenNames.some((n) => containsName(answer, n))) {
      why('names a forbidden person')
      return { ...closed, end: false }
    }
    const earlier = await store.listScrumAnswers(person.id)
    // The last history entry is the question being answered.
    const history = [
      ...scrumHistory(earlier, scrum.reporter),
      { question, answer: null, by: asker },
    ]
    const feud = await feudLevel(deps, person.playerId, asker, onSheet.pressLevel)
    const ctx = await scrumAskContext(store, scrum, res, onSheet, history, person.questionsAsked, {
      reporter: asker,
      feud,
    })
    // One follow-up per reporter, and only as many as the round's target needs.
    const rule = followUpRule(person)
    let failed = false
    let kept = false
    const out = await judgeAnswer(
      deps.call,
      { ...ctx, answer, followUpAllowed: rule.allowed, followUpMode: rule.mode },
      pressRecorder(store),
      (reasonText, verdictKept) => {
        failed = !verdictKept
        kept = verdictKept
        const text = safeWhy(reasonText, [answer, ...earlier.map((a) => a.answer)])
        deps.log(
          verdictKept
            ? `[press] answer: person ${String(person.id)}: reply line failed after all tries, the model's verdict is kept (${text})`
            : `[press] answer: person ${String(person.id)}: judgement failed closed, stored unusable (${text})`,
        )
      },
    )
    return { ...out, end: false, byCode: failed, replyFailed: kept }
  } catch (err: unknown) {
    deps.log(`[press] answer: person ${String(person.id)}: ${reason(err)}`)
    return closed
  }
}

/**
 * The pop-up submit. `seen` = the counters in the pop-up's custom id (the
 * item it was opened for). Claims the answer on those counters (a second or
 * stale submit gets "Already answered."), echoes the answer in the thread as
 * the asking reporter right away (escaped, no mentions, no link previews;
 * never an answer the code refuses for naming a forbidden person), judges it,
 * stores it, then asks the follow-up, the next question, or closes the round.
 * An unusable answer is acknowledged but never quoted later. A typed answer
 * (`typed`) takes the same path; it is already in the thread, so it is not
 * echoed again.
 */
export async function onAnswerSubmit(
  deps: PressDeps,
  config: PressConfig,
  personId: number,
  userId: string,
  text: string,
  seen: { questionsAsked: number; followupsAsked: number },
  /** `messageId`: the typed answer's own message (T4: the reporter's lines reply to it). */
  opts: { typed?: boolean; messageId?: string } = {},
): Promise<Reply> {
  const { store, discord, log } = deps
  const person = await store.getScrumPerson(personId)
  if (person === null) return say(TEXT.tooLate)
  const now = deps.now()
  const refusal = actorRefusal(person, userId) ?? submitRefusal(person, seen, now)
  if (refusal !== null) return refusal
  const answer = Array.from(text.trim()).slice(0, ANSWER_MAX_CHARS).join('').trimEnd()
  if (answer === '') return say(TEXT.noAnswer)
  const question = person.currentQuestion!
  // The reporter who asked this item: the answer, the follow-up and the next line are theirs.
  const asker = askerOf(person)

  // T5, hard lines: before any reaction, any claim and any echo. An off-limits message gets
  // nothing (no reply, no echo, no store, no feud points) and the question stays open.
  const screened = await screenMessage(deps, config, answer, asker)
  if (screened.offLimits) {
    log(`[press] answer: person ${String(personId)}: ${OFFLIMITS_LOG} (${screened.why})`)
    return { kind: 'ack', offLimits: true }
  }

  const claimed = await store.claimScrumAnswer({ personId, ...seen, at: now })
  if (!claimed) return say(TEXT.answered)

  const scrum = person.scrum
  const threadId = personThreadId(person) ?? scrum.messageId
  const mention = person.discordUserId

  const sheet = await loadSheet(deps, person)
  const onSheet = sheet?.facts.people.find((p) => p.playerId === person.playerId)
  // The code refuses an answer that names a forbidden person ("Leave me out", a guest), and
  // any answer when the sheet is not known: such an answer is never shown anywhere.
  const refused =
    sheet === null ||
    onSheet === undefined ||
    sheet.forbiddenNames.some((n) => containsName(answer, n))
  // Echoed right after the submit, before the judgement, so the player sees their own answer
  // at once (operator, 2026-11-13). A typed answer is already there. The desk still never
  // quotes an unusable answer later.
  // T4: the reporter's lines reply to the answer message (the typed one, or the echo below);
  // never to a refused answer.
  let answerRef: string | null = refused ? null : (opts.messageId ?? null)
  if (!refused && opts.typed !== true) {
    try {
      answerRef = await discord.send(asker, threadId, {
        content: `**${escapeMarkdown(person.name)}:** ${escapeMarkdown(answer)}`,
        allowed_mentions: { parse: [] },
        flags: SUPPRESS_EMBEDS,
      })
    } catch (err: unknown) {
      // The answer still counts: it came through the bots' own pop-up.
      log(`[press] answer: person ${String(personId)}: echo failed (${reason(err)})`)
    }
  }
  const verdict = await judge(deps, config, person, question, answer, asker, sheet)
  if (verdict.offLimits) {
    // The judge's second line: the answer is off-limits after all. The question is open again,
    // the echo (if any) is taken down, nothing is stored and nothing is said.
    await store.updateScrumPerson(personId, {
      currentQuestion: question,
      lastAskedAt: person.lastAskedAt,
    })
    if (opts.typed !== true && answerRef !== null) {
      try {
        await discord.remove(asker, threadId, answerRef)
      } catch (err: unknown) {
        log(`[press] answer: person ${String(personId)}: echo not removed (${reason(err)})`)
      }
    }
    log(`[press] answer: person ${String(personId)}: ${OFFLIMITS_LOG} (judge)`)
    return { kind: 'ack', offLimits: true }
  }
  // T6: the player's latest message in their thread; the "no answer" closing replies to it.
  rememberPlayerMessage(deps, threadId, person.discordUserId, answerRef)
  // T5, feuds: an insult at a reporter (not off-limits) adds points; "Leave me out" adds none.
  if (!refused && screened.reporter !== null) {
    await recordInsult(deps, {
      playerId: person.playerId,
      reporter: screened.reporter,
      insult: screened.insult,
      pressLevel: onSheet.pressLevel,
      where: `person ${String(personId)}`,
    })
  }
  /** A fixed line from the asking reporter's own pool: never one this thread already had. */
  const poolLine = (kind: 'closing' | 'ack'): string =>
    fallbackLine(deps, {
      scrumId: scrum.id,
      kind,
      reporter: asker,
      name: person.name,
      seed: personSeed(scrum.id, personId) + person.questionsAsked + person.followupsAsked,
    })
  const fixed = verdict.byCode || verdict.replyFailed
  await store.insertScrumAnswer({
    personId,
    scrumId: scrum.id,
    playerId: person.playerId,
    night: scrum.night,
    question,
    answer,
    usability: verdict.usability,
    reporter: asker,
    isTest: scrum.isTest,
  })

  if (verdict.followUp !== null) {
    await store.updateScrumPerson(personId, {
      followupsAsked: person.followupsAsked + 1,
      askingFollowup: true,
      currentQuestion: verdict.followUp,
      lastAskedAt: now,
    })
    await discord.send(
      asker,
      threadId,
      replyingTo(
        threadLine(
          mention,
          escapeMarkdown(verdict.followUp),
          answerComponents(config, answerButton(personId)),
        ),
        answerRef,
      ),
    )
    return ACK
  }
  if (!verdict.end && person.questionsAsked < questionsInRound(person)) {
    // No silent answers: an answer the desk cannot use is still acknowledged (its words are
    // never repeated) before the next reporter asks, so the player knows it arrived.
    if (verdict.usability === 'unusable') {
      try {
        await discord.send(
          asker,
          threadId,
          replyingTo(
            threadLine(mention, escapeMarkdown(fixed ? poolLine('ack') : verdict.closing)),
            answerRef,
          ),
        )
      } catch (err: unknown) {
        // The answer is stored and the round goes on: the acknowledgement is not retried.
        log(`[press] answer: person ${String(personId)}: acknowledgement failed (${reason(err)})`)
      }
    }
    return askNow(deps, config, personId, answerRef)
  }
  await store.updateScrumPerson(personId, { status: 'done', currentQuestion: null })
  await discord.send(
    asker,
    threadId,
    replyingTo(
      threadLine(mention, escapeMarkdown(fixed ? poolLine('closing') : verdict.closing)),
      answerRef,
    ),
  )
  return ACK
}

/**
 * A message in a scrum thread (needs `PRESS_TYPED_ANSWERS=1`). It counts as the
 * answer only when this Discord user has a question open in this thread right
 * now; then it takes the same path as the pop-up (`onAnswerSubmit`: claim on
 * the current counters, judge, store, next step). Anything else is ignored:
 * nothing stored, nothing posted. A refusal (an answer that came first, the
 * window ended, empty text) is logged, never shown to the player.
 */
export async function onTypedAnswer(
  deps: PressDeps,
  config: PressConfig,
  msg: { threadId: string; userId: string; text: string },
): Promise<void> {
  const { store, log } = deps
  const personId = await store.findOpenQuestionInThread(msg.threadId, msg.userId)
  if (personId === null) return
  const person = await store.getScrumPerson(personId)
  if (person === null) return
  const seen = { questionsAsked: person.questionsAsked, followupsAsked: person.followupsAsked }
  const reply = await onAnswerSubmit(deps, config, personId, msg.userId, msg.text, seen, {
    typed: true,
  })
  if (reply.kind === 'ephemeral') {
    log(`[press] typed answer: person ${String(personId)}: not taken (${reply.text})`)
  }
}

/** Fisher–Yates with a seeded generator. */
function shuffled<T>(items: readonly T[], seed: number): T[] {
  const out = [...items]
  const rand = mulberry32(seed >>> 0)
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}

/**
 * `/scrum`: no options = "Talk to the press" on the latest game the user
 * played (within 6 h). `random` / `player` = ask a teammate of that game (at
 * most twice a night per user; a teammate who already had `PRESS_PING_LIMIT`
 * automatic or command pings tonight is not asked); the person is inserted
 * `picked` and the timer pass pings them. Trial and live act the same.
 */
export async function onScrumCommand(
  deps: PressDeps,
  config: PressConfig,
  userId: string,
  opts: { player: string | null; random: boolean },
): Promise<Reply> {
  const { store } = deps
  const trial = config.mode === 'trial'
  if (await pressOff(deps, config)) return say(TEXT.pressOff)
  const me = await store.getPlayerForDiscordUser(userId)
  if (me === null) return say(TEXT.link)
  const now = deps.now()
  const itemId = await store.latestScrumItem({
    playerId: me.playerId,
    since: new Date(now.getTime() - SCRUM_SOURCE_WINDOW_MS),
    isTest: trial,
  })
  if (itemId === null) return say(TEXT.noGame)

  // `/scrum @self` is `/scrum`: the user volunteers, no command use.
  if ((opts.player === null && !opts.random) || opts.player === userId) {
    const reply = await onTalk(deps, config, itemId, userId)
    // A command has no message to update: confirm in private once the question is posted.
    return reply.kind === 'ack' ? say(TEXT.inThread) : reply
  }

  const scrum = await store.scrumByRecapItem(itemId)
  if (scrum === null) return say(TEXT.noGame)
  if (now >= scrum.openUntil) return say(TEXT.left)
  if ((await store.countCommandUsesTonight(userId, scrum.night)) >= PRESS_COMMAND_LIMIT) {
    return say(TEXT.twice)
  }
  const { candidates } = await gameCandidates(deps, scrum)
  // Command pings count toward the nightly ping limit (GM pings do not).
  const askedEnough = async (c: Candidate): Promise<boolean> =>
    (await store.countLimitedPingsTonight(c.playerId, scrum.night)) >= PRESS_PING_LIMIT
  let targets: Candidate[]
  let named: string | null = null
  if (opts.player !== null) {
    const target = await store.getPlayerForDiscordUser(opts.player)
    named = escapeMarkdown(target?.name ?? 'That player')
    const hit = target === null ? undefined : candidates.find((c) => c.playerId === target.playerId)
    if (hit === undefined) return say(`${named} can't be asked about this game.`)
    if (await askedEnough(hit)) return say(`${named} has been asked enough tonight.`)
    targets = [hit]
  } else {
    targets = shuffled(
      candidates.filter((c) => c.playerId !== me?.playerId),
      now.getTime() ^ scrum.id,
    )
  }
  for (const c of targets) {
    if (c.discordUserId === null) continue
    // `random` skips a player who reached the nightly ping limit.
    if (opts.player === null && (await askedEnough(c))) continue
    const id = await store.insertScrumPerson({
      scrumId: scrum.id,
      playerId: c.playerId,
      discordUserId: c.discordUserId,
      role: 'picked',
      requestedBy: 'command',
      requestedByUserId: userId,
    })
    if (id !== null) return say(`${reporterName(scrum)} will ping ${escapeMarkdown(c.name)}.`)
  }
  return say(named === null ? TEXT.nobody : `${named} is already in this scrum.`)
}
