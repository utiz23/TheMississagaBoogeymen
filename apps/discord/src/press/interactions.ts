import { REPORTERS, mulberry32 } from '@eanhl/db/news'
import type { NewsScrumRow, ScrumPersonDetail } from '@eanhl/db/queries'
import { answerButton } from '../bot-rest.ts'
import { escapeMarkdown } from '../message.ts'
import { FALLBACK_CLOSING, judgeAnswer, type Usability } from './asker.ts'
import type { PressConfig } from './config.ts'
import { SCRUM_SOURCE_WINDOW_MS, type PressDeps } from './pass.ts'
import {
  pressRecorder,
  scrumAskContext,
  scrumHistory,
  scrumMention,
  startScrumQuestion,
  threadLine,
} from './question.ts'
import {
  PRESS_ACCEPT_MS,
  PRESS_ANSWER_MS,
  PRESS_COMMAND_LIMIT,
  extrasBudgetLeft,
  followUpAllowed,
  pickScrumPlayer,
  questionLimit,
  scrumCandidates,
  type Candidate,
} from './rules.ts'

/**
 * The scrum interaction handlers: "Talk to the press", Accept, Answer (opens
 * the pop-up), the pop-up submit and `/scrum`. Pure over `PressDeps`: each
 * returns a `Reply` that the gateway turns into a Discord response. A refusal
 * is private (ephemeral) and changes nothing. Every state change that two
 * taps could both make is a conditional update (`insertScrumPerson`,
 * `acceptScrumPerson`, `claimScrumAnswer`, `claimScrumQuestion`).
 *
 * Trial (and any scrum left over from it): only the GM acts, for the scrum's
 * person; the stored `discord_user_id` stays the player's own.
 */

export type Reply =
  | { kind: 'ephemeral'; text: string }
  | { kind: 'modal'; customId: string; title: string; label: string; maxLength: 500 }
  | { kind: 'ack' }

/** The pop-up's answer limit; a longer submit is cut to it. */
export const ANSWER_MAX_CHARS = 500
/** Discord's limit for a modal title and a text input label. */
const MODAL_TEXT_MAX = 45

export const TEXT = {
  trial: 'The press bots are on trial.',
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

/** Only the GM acts in the trial, and on a scrum left over from it. */
function gmOnly(config: PressConfig, isTest: boolean): boolean {
  return config.mode === 'trial' || isTest
}

/** The refusal for a user who may not act for this person, or null. */
function actorRefusal(
  config: PressConfig,
  person: ScrumPersonDetail,
  userId: string,
): Reply | null {
  if (gmOnly(config, person.scrum.isTest)) {
    return userId === config.gmUserId ? null : say(TEXT.trial)
  }
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
async function askNow(deps: PressDeps, config: PressConfig, personId: number): Promise<Reply> {
  try {
    if (await startScrumQuestion(deps, config, personId)) return ACK
  } catch (err: unknown) {
    deps.log(`[press] question: person ${String(personId)}: ${reason(err)}`)
  }
  return say(TEXT.rightWithYou)
}

/** "Talk to the press" on a recap post: the user volunteers (1 question). */
export async function onTalk(
  deps: PressDeps,
  config: PressConfig,
  itemId: number,
  userId: string,
): Promise<Reply> {
  const { store } = deps
  const isGm = userId === config.gmUserId
  if (config.mode === 'trial' && !isGm) return say(TEXT.trial)
  const me = config.mode === 'trial' ? null : await store.getPlayerForDiscordUser(userId)
  if (config.mode === 'live' && me === null && !isGm) return say(TEXT.link)
  const scrum = await store.scrumByRecapItem(itemId)
  if (scrum === null) return say(TEXT.notYet)
  const gm = gmOnly(config, scrum.isTest)
  if (gm && !isGm) return say(TEXT.trial)
  if (!gm && me === null) return say(TEXT.link)
  const now = deps.now()
  if (now >= scrum.openUntil) return say(TEXT.left)

  const { candidates, topFacts } = await gameCandidates(deps, scrum)
  let player: Candidate | null
  if (gm) {
    // The GM acts as the player the scrum picks.
    const gmAsk = scrum.matchId === null ? null : await store.gmAskForMatch(scrum.matchId, true)
    player = pickScrumPlayer(candidates, topFacts, gmAsk)
  } else {
    player = candidates.find((c) => c.playerId === me!.playerId) ?? null
  }
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

/** Accept on a ping: only the pinged person (the GM in the trial), within 5 minutes. */
export async function onAccept(
  deps: PressDeps,
  config: PressConfig,
  personId: number,
  userId: string,
): Promise<Reply> {
  const { store } = deps
  if (config.mode === 'trial' && userId !== config.gmUserId) return say(TEXT.trial)
  const person = await store.getScrumPerson(personId)
  if (person === null) return say(TEXT.tooLate)
  const refusal = actorRefusal(config, person, userId)
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

/** Answer under a question: opens the pop-up for the person (the GM in the trial). */
export async function onAnswerButton(
  deps: PressDeps,
  config: PressConfig,
  personId: number,
  userId: string,
): Promise<Reply> {
  if (config.mode === 'trial' && userId !== config.gmUserId) return say(TEXT.trial)
  const person = await deps.store.getScrumPerson(personId)
  if (person === null) return say(TEXT.tooLate)
  const refusal = actorRefusal(config, person, userId) ?? openQuestionRefusal(person, deps.now())
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
}

/**
 * Judge the answer. Fails closed to unusable + `FALLBACK_CLOSING` + end when
 * the extras budget is spent, the person is off the sheet, or anything throws.
 */
async function judge(
  deps: PressDeps,
  config: PressConfig,
  person: ScrumPersonDetail,
  question: string,
  answer: string,
): Promise<Verdict> {
  const { store } = deps
  const closed: Verdict = {
    usability: 'unusable',
    followUp: null,
    closing: FALLBACK_CLOSING,
    end: true,
  }
  const scrum = person.scrum
  if (scrum.matchId === null) return closed
  try {
    if (!extrasBudgetLeft(await store.monthNewsSpendUsd(deps.now()), config.monthlyLimitUsd)) {
      return closed
    }
    const res = await deps.fetchFacts('game', String(scrum.matchId))
    const onSheet = res.facts.people.find((p) => p.playerId === person.playerId)
    // A guest, or "Leave me out" since the question: nothing about them goes anywhere.
    if (onSheet === undefined) return closed
    // The last history entry is the question being answered.
    const history = [
      ...scrumHistory(await store.listScrumAnswers(person.id)),
      { question, answer: null },
    ]
    const ctx = await scrumAskContext(store, scrum, res, onSheet, history, person.questionsAsked)
    // One follow-up per question: never after a follow-up.
    const allowed = !person.askingFollowup && followUpAllowed(person)
    const out = await judgeAnswer(
      deps.call,
      { ...ctx, answer, followUpAllowed: allowed },
      pressRecorder(store),
    )
    return { ...out, end: false }
  } catch (err: unknown) {
    deps.log(`[press] answer: person ${String(person.id)}: ${reason(err)}`)
    return closed
  }
}

/**
 * The pop-up submit. `seen` = the counters in the pop-up's custom id (the
 * item it was opened for). Claims the answer on those counters (a second or
 * stale submit gets "Already answered."), echoes it in the thread as the reporter (escaped, no
 * mentions), judges it, stores it, then asks the follow-up, the next
 * question, or closes the round.
 */
export async function onAnswerSubmit(
  deps: PressDeps,
  config: PressConfig,
  personId: number,
  userId: string,
  text: string,
  seen: { questionsAsked: number; followupsAsked: number },
): Promise<Reply> {
  const { store, discord, log } = deps
  if (config.mode === 'trial' && userId !== config.gmUserId) return say(TEXT.trial)
  const person = await store.getScrumPerson(personId)
  if (person === null) return say(TEXT.tooLate)
  const now = deps.now()
  const refusal = actorRefusal(config, person, userId) ?? submitRefusal(person, seen, now)
  if (refusal !== null) return refusal
  const answer = Array.from(text.trim()).slice(0, ANSWER_MAX_CHARS).join('').trimEnd()
  if (answer === '') return say(TEXT.noAnswer)
  const question = person.currentQuestion!
  const claimed = await store.claimScrumAnswer({ personId, ...seen, at: now })
  if (!claimed) return say(TEXT.answered)

  const scrum = person.scrum
  const threadId = scrum.threadId ?? scrum.messageId
  const mention = scrumMention(config, scrum.isTest, person.discordUserId)
  try {
    await discord.send(scrum.reporter, threadId, {
      content: `**${escapeMarkdown(person.name)}:** ${escapeMarkdown(answer)}`,
      allowed_mentions: { parse: [] },
    })
  } catch (err: unknown) {
    // The answer still counts: it came through the bots' own pop-up.
    log(`[press] answer: person ${String(personId)}: echo failed (${reason(err)})`)
  }

  const verdict = await judge(deps, config, person, question, answer)
  await store.insertScrumAnswer({
    personId,
    scrumId: scrum.id,
    playerId: person.playerId,
    night: scrum.night,
    question,
    answer,
    usability: verdict.usability,
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
      scrum.reporter,
      threadId,
      threadLine(mention, escapeMarkdown(verdict.followUp), [
        { type: 1, components: [answerButton(personId)] },
      ]),
    )
    return ACK
  }
  if (!verdict.end && person.questionsAsked < questionLimit(person.role)) {
    return askNow(deps, config, personId)
  }
  await store.updateScrumPerson(personId, { status: 'done', currentQuestion: null })
  await discord.send(scrum.reporter, threadId, threadLine(mention, escapeMarkdown(verdict.closing)))
  return ACK
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
 * most twice a night per user); the person is inserted `picked` and the timer
 * pass pings them. In the trial the GM acts for any latest game.
 */
export async function onScrumCommand(
  deps: PressDeps,
  config: PressConfig,
  userId: string,
  opts: { player: string | null; random: boolean },
): Promise<Reply> {
  const { store } = deps
  const trial = config.mode === 'trial'
  if (trial && userId !== config.gmUserId) return say(TEXT.trial)
  const me = trial ? null : await store.getPlayerForDiscordUser(userId)
  if (!trial && me === null) return say(TEXT.link)
  const now = deps.now()
  const itemId = await store.latestScrumItem({
    playerId: me?.playerId ?? null,
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
  let targets: Candidate[]
  let named: string | null = null
  if (opts.player !== null) {
    const target = await store.getPlayerForDiscordUser(opts.player)
    named = escapeMarkdown(target?.name ?? 'That player')
    const hit = target === null ? undefined : candidates.find((c) => c.playerId === target.playerId)
    if (hit === undefined) return say(`${named} can't be asked about this game.`)
    targets = [hit]
  } else {
    targets = shuffled(
      candidates.filter((c) => c.playerId !== me?.playerId),
      now.getTime() ^ scrum.id,
    )
  }
  for (const c of targets) {
    if (c.discordUserId === null) continue
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
