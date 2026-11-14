import {
  REPORTERS,
  REPORTER_IDS,
  type NewsFactsResponse,
  type NewsGameFacts,
  type ReporterId,
} from '@eanhl/db/news'
import type { InterviewAnswer, InterviewDetail } from '@eanhl/db/queries'
import type { BotMessage } from '../bot-rest.ts'
import { escapeMarkdown } from '../message.ts'
import { crudeHit } from '../news/crude.ts'
import { containsName } from '../news/fact-check.ts'
import { FALLBACK_ACK, judgeAnswer, type ScrumHistoryEntry, type Usability } from './asker.ts'
import type { PressConfig } from './config.ts'
import {
  benchForGame,
  benchGameOf,
  benchPortOf,
  callLine,
  nameBench,
  personColumns,
  type BenchPerson,
} from './bench.ts'
import {
  panelFavourReporters,
  recordMessageSignals,
  recordRelationship,
  relationshipLevel,
  relationshipsFor,
} from './relationships.ts'
import { OFFLIMITS_LOG, screenMessage } from './hard-lines.ts'
import { askInterviewQuestion } from './interview-asker.ts'
import {
  INTERVIEW_ANSWER_MS,
  INTERVIEW_NIGHT_LOOKBACK_MS,
  INTERVIEW_OFFER_MS,
  INTERVIEW_PLAYER_LIMIT_MS,
  INTERVIEW_QUESTIONS,
  chooseInterviewReporter,
  fallbackInterviewQuestion,
  interviewClosing,
  interviewFollowUpAllowed,
  itemsAsked,
  moreQuestions,
  saysItIsOver,
} from './interview-rules.ts'
import { interviewStoreOf, type InterviewStore } from './interview-store.ts'
import { ANSWER_MAX_CHARS, TEXT, type Reply } from './interactions.ts'
import { SCRUM_SOURCE_WINDOW_MS, type PressDeps, type PressStore } from './pass.ts'
import { latestPlayerMessage, rememberPlayerMessage } from './player-latest.ts'
import { answerComponents, pressRecorder, safeWhy, threadLine } from './question.ts'
import { replyingTo } from './reply-ref.ts'
import { extrasBudgetLeft } from './rules.ts'
import { subjectOf, type Subject } from './subject.ts'

/**
 * Interviews (task T3): one reporter asks one player about 7 questions in a
 * thread under the offer message; the article is written by the timer pass
 * afterwards (interview-pass.ts). The handlers here are pure over
 * `PressDeps` and return a `Reply` like the scrum handlers. Every state
 * change two taps could both make is a conditional update (the claims in
 * `InterviewStore`). Trial and live act the same; trial interviews are
 * stored as test and posted in the test channel.
 */

export const INTERVIEW_TEXT = {
  gmOnly: 'Only the GM can start an interview for someone else.',
  noPlayer: 'Pick a player.',
  notLinked: 'That person has no player on boogeymen.app linked to Discord.',
  open: 'already has an interview open.',
  weekly: 'One interview a week. Try again in a few days.',
  allOff: 'Every reporter is switched off.',
  off: 'Interviews are not running right now.',
  inThread: 'Your interview is in the thread.',
  noGame: 'No game with the press in the last 6 hours.',
} as const

const say = (text: string): Reply => ({ kind: 'ephemeral', text })
const ACK: Reply = { kind: 'ack' }
const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const reporterName = (id: ReporterId): string => REPORTERS[id].name
/** Discord's SUPPRESS_EMBEDS message flag: a link in an answer gets no preview. */
const SUPPRESS_EMBEDS = 4
/** Discord's limit for a modal title and a text input label. */
const MODAL_TEXT_MAX = 45
/** The GM topic is cut to this length. */
export const INTERVIEW_TOPIC_MAX_CHARS = 300
/** Discord: a thread started from a message already exists (HTTP 400, code 160004). */
const THREAD_EXISTS = /\bHTTP 400\b/

function cut(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`
}

/** A button on a press message (same shape as bot-rest's own). */
function button(label: string, customId: string): unknown {
  return { type: 2, style: 1, label, custom_id: customId }
}
export const interviewAcceptButton = (id: number): unknown =>
  button('Accept', `press:iaccept:${String(id)}`)
export const interviewAnswerButton = (id: number): unknown =>
  button('Answer', `press:ianswer:${String(id)}`)

/** The interview store, or null (then interviews are off: fail closed). */
export function interviewStore(deps: PressDeps): (PressStore & InterviewStore) | null {
  return interviewStoreOf(deps.store)
}

/** The extras budget is spent (80% of the month): no new interview step costs money. */
async function pressOff(deps: PressDeps, config: PressConfig): Promise<boolean> {
  return !extrasBudgetLeft(await deps.store.monthNewsSpendUsd(deps.now()), config.monthlyLimitUsd)
}

/** Earlier answers as asker history: an unusable answer goes in as no answer. */
export function interviewHistory(answers: readonly InterviewAnswer[]): ScrumHistoryEntry[] {
  return answers.map((a) =>
    a.usability === 'unusable' || crudeHit(a.answer)
      ? { question: a.question, answer: null }
      : { question: a.question, answer: a.answer, usability: a.usability },
  )
}

/**
 * The night sheet and the person on it; `person` undefined = not allowed (a player off the sheet:
 * Leave me out, a guest; T7: a bench person who is "Leave me out" or whose name is forbidden).
 * A bench person or the coach did not play: they are not on the sheet, and `person.bench` says so.
 */
async function sheetFor(
  deps: PressDeps,
  night: string,
  who: { playerId: number | null; personRole: 'player' | 'bench' | 'coach'; name: string },
): Promise<{ res: NewsFactsResponse; person: Subject | undefined }> {
  const res = await deps.fetchFacts('night', night)
  return { res, person: await subjectOf(deps, res, who) }
}

// ── Starting ────────────────────────────────────────────────────────────────

interface Prepared {
  night: string
  name: string
  discordUserId: string
  reporter: ReporterId
  /** T7: set when the person did not play (a bench person, the coach). */
  bench?: BenchPerson
}

/**
 * Checks shared by every start: the player's latest night (30 days), the
 * player on that night's sheet (never "Leave me out", a guest or an AI
 * goalie), a Discord link, and the reporter (the one asked for, if switched
 * on; else the rotation). A string is the refusal.
 */
export async function prepareInterview(
  deps: PressDeps,
  st: PressStore & InterviewStore,
  args: { playerId: number; name: string; reporter: ReporterId | null; seed: number },
): Promise<Prepared | string> {
  const now = deps.now()
  const name = escapeMarkdown(args.name)
  const night = await st.latestPlayerNight(
    args.playerId,
    new Date(now.getTime() - INTERVIEW_NIGHT_LOOKBACK_MS),
  )
  if (night === null) return `${name} has no game in the last 30 days.`
  const { res, person } = await sheetFor(deps, night, {
    playerId: args.playerId,
    personRole: 'player',
    name: args.name,
  })
  if (person === undefined) return `${name} can't be interviewed.`
  const discordUserId = await st.getPlayerDiscordUserId(args.playerId)
  if (discordUserId === null) return INTERVIEW_TEXT.notLinked
  const disabled = await st.listDisabledReporters()
  let reporter: ReporterId | null = args.reporter
  if (reporter !== null) {
    if (disabled.includes(reporter)) return `${reporterName(reporter)} is switched off.`
  } else {
    reporter = chooseInterviewReporter({
      seed: args.seed,
      disabled,
      lastReporter: await st.lastInterviewReporter(),
      takeReporters: res.takes
        .filter((t) => t.playerId === args.playerId)
        .flatMap((t) => [t.reporter, ...t.critics]),
      favourReporters: panelFavourReporters(
        await relationshipsFor(deps, args.playerId, person.pressLevel),
      ),
    })
    if (reporter === null) return INTERVIEW_TEXT.allOff
  }
  return { night, name: person.name, discordUserId, reporter }
}

/** The night's last game and the bench person the GM named for it (T7), or a refusal text. */
async function prepareBenchInterview(
  deps: PressDeps,
  config: PressConfig,
  st: PressStore & InterviewStore,
  args: { userId: string; reporter: ReporterId | null; seed: number },
): Promise<Prepared | string> {
  const night = await st.latestPressNight(new Date(deps.now().getTime() - SCRUM_SOURCE_WINDOW_MS))
  if (night === null) return INTERVIEW_TEXT.noGame
  const res = await deps.fetchFacts('night', night)
  const game: NewsGameFacts | undefined = [...res.facts.games]
    .sort((a, b) => a.playedAt.localeCompare(b.playedAt) || a.matchId - b.matchId)
    .at(-1)
  if (game === undefined) return INTERVIEW_TEXT.noGame
  const named = await nameBench(deps, config, await benchGameOf(st, game), args.userId)
  if (!named.ok) {
    return named.why === 'cannot be found on the server'
      ? INTERVIEW_TEXT.notLinked
      : `That person cannot be interviewed: ${named.why}.`
  }
  const disabled = await st.listDisabledReporters()
  let reporter: ReporterId | null = args.reporter
  if (reporter !== null) {
    if (disabled.includes(reporter)) return `${reporterName(reporter)} is switched off.`
  } else {
    reporter = chooseInterviewReporter({
      seed: args.seed,
      disabled,
      lastReporter: await st.lastInterviewReporter(),
      takeReporters: [],
    })
    if (reporter === null) return INTERVIEW_TEXT.allOff
  }
  return {
    night,
    name: named.person.name,
    discordUserId: args.userId,
    reporter,
    bench: named.person,
  }
}

/**
 * `/gm interview`: the GM offers an interview to a player (posted by the timer pass). T7: a
 * Discord user who did not play (the coach, or someone who watched from the call) can be
 * interviewed about the night, asked as someone who did not play; the reply lists who was in the
 * call.
 */
export async function onGmInterview(
  deps: PressDeps,
  config: PressConfig,
  userId: string,
  opts: { player: string | null; reporter: string | null; topic: string | null },
): Promise<Reply> {
  const st = interviewStore(deps)
  if (st === null) return say(INTERVIEW_TEXT.off)
  if (userId !== config.gmUserId) return say(INTERVIEW_TEXT.gmOnly)
  if (await pressOff(deps, config)) return say(TEXT.pressOff)
  if (opts.player === null) return say(INTERVIEW_TEXT.noPlayer)
  const target = await st.getPlayerForDiscordUser(opts.player)
  const asked = REPORTER_IDS.find((id) => id === opts.reporter) ?? null
  const now = deps.now()
  const lookback = new Date(now.getTime() - INTERVIEW_NIGHT_LOOKBACK_MS)
  // A known player with a game in the last 30 days is interviewed as a player; anyone else (the
  // coach, a bench person, a player with no recent game) as the bench, if the GM named a person
  // who may be on it.
  const asPlayer =
    target !== null && (await st.latestPlayerNight(target.playerId, lookback)) !== null
  const prepared = asPlayer
    ? await prepareInterview(deps, st, {
        playerId: target.playerId,
        name: target.name,
        reporter: asked,
        seed: now.getTime() ^ target.playerId,
      })
    : await prepareBenchInterview(deps, config, st, {
        userId: opts.player,
        reporter: asked,
        seed: now.getTime() ^ Number(BigInt(opts.player) % 1_000_000n),
      })
  if (typeof prepared === 'string') {
    // A known player with no game and no bench claim keeps the old refusal.
    return say(
      !asPlayer &&
        target !== null &&
        (prepared === INTERVIEW_TEXT.notLinked || prepared.includes('played that game'))
        ? `${escapeMarkdown(target.name)} has no game in the last 30 days.`
        : prepared,
    )
  }
  const topicText = opts.topic === null ? '' : cut(opts.topic.trim(), INTERVIEW_TOPIC_MAX_CHARS)
  const bench = prepared.bench
  const id = await st.insertInterview({
    playerId: bench === undefined ? target!.playerId : bench.playerId,
    discordUserId: prepared.discordUserId,
    ...(bench === undefined ? {} : personColumns(bench)),
    reporter: prepared.reporter,
    trigger: 'gm',
    requestedByUserId: userId,
    status: 'offered',
    night: prepared.night,
    topic: topicText === '' ? null : topicText,
    channelId: config.channelId,
    isTest: config.mode === 'trial',
  })
  const name = escapeMarkdown(prepared.name)
  if (id === null) return say(`${name} ${INTERVIEW_TEXT.open}`)
  deps.log(
    `[press] interview ${String(id)}: GM offer for ${
      bench === undefined ? `player ${String(target!.playerId)}` : `a ${bench.role} person`
    }`,
  )
  let call = ''
  if (benchPortOf(deps) !== undefined) {
    const res = await deps.fetchFacts('night', prepared.night)
    const game = [...res.facts.games]
      .sort((a, b) => a.playedAt.localeCompare(b.playedAt) || a.matchId - b.matchId)
      .at(-1)
    if (game !== undefined) {
      call = `\n${callLine(await benchForGame(deps, config, await benchGameOf(st, game)))}`
    }
  }
  return say(
    `Got it: ${reporterName(prepared.reporter)} will offer ${name} an interview (open for 30 minutes).${call}`,
  )
}

/** The opening line of a player's own interview (no Accept: they asked for it). */
function openingMessage(iv: { reporter: ReporterId; discordUserId: string; isTest: boolean }) {
  const text = `<@${iv.discordUserId}> — ${reporterName(iv.reporter)} sits down with you: about ${String(INTERVIEW_QUESTIONS)} questions in the thread, then a Q&A on the site.`
  return {
    content: iv.isTest ? `(trial) ${text}` : text,
    allowed_mentions: { parse: [] as never[], users: [iv.discordUserId] },
  } satisfies BotMessage
}

/** The offer of a GM or automatic interview, with the Accept button. */
export function offerMessage(iv: {
  id: number
  reporter: ReporterId
  discordUserId: string
  isTest: boolean
}): BotMessage {
  const text = `<@${iv.discordUserId}> — ${reporterName(iv.reporter)} would like a sit-down interview: about ${String(INTERVIEW_QUESTIONS)} questions in a thread, then a Q&A on the site. Tap Accept within 30 minutes.`
  return {
    content: iv.isTest ? `(trial) ${text}` : text,
    allowed_mentions: { parse: [], users: [iv.discordUserId] },
    components: [{ type: 1, components: [interviewAcceptButton(iv.id)] }],
  }
}

/**
 * `/interview`: a player asks for their own interview (at most one a week).
 * It starts at once: the opening message, the thread, the first question.
 */
export async function onInterviewCommand(
  deps: PressDeps,
  config: PressConfig,
  userId: string,
): Promise<Reply> {
  const st = interviewStore(deps)
  if (st === null) return say(INTERVIEW_TEXT.off)
  if (await pressOff(deps, config)) return say(TEXT.pressOff)
  const me = await st.getPlayerForDiscordUser(userId)
  if (me === null) return say(TEXT.link)
  const now = deps.now()
  const trial = config.mode === 'trial'
  const since = new Date(now.getTime() - INTERVIEW_PLAYER_LIMIT_MS)
  if ((await st.countPlayerInterviewsSince(me.playerId, since, trial)) > 0) {
    return say(INTERVIEW_TEXT.weekly)
  }
  const prepared = await prepareInterview(deps, st, {
    playerId: me.playerId,
    name: me.name,
    reporter: null,
    seed: now.getTime() ^ me.playerId,
  })
  if (typeof prepared === 'string') return say(prepared)
  // offered_at is set at once: the timer pass never posts an offer for it.
  const id = await st.insertInterview({
    playerId: me.playerId,
    discordUserId: prepared.discordUserId,
    reporter: prepared.reporter,
    trigger: 'player',
    requestedByUserId: userId,
    status: 'offered',
    offeredAt: now,
    night: prepared.night,
    channelId: config.channelId,
    isTest: trial,
  })
  if (id === null) return say(`${escapeMarkdown(prepared.name)} ${INTERVIEW_TEXT.open}`)
  try {
    const messageId = await deps.discord.send(
      prepared.reporter,
      config.channelId,
      openingMessage({ ...prepared, isTest: trial }),
    )
    await st.updateInterview(id, { offerMessageId: messageId })
  } catch (err: unknown) {
    // Never started: it does not count toward the weekly limit.
    deps.log(`[press] interview ${String(id)}: opening failed (${reason(err)})`)
    await st.endInterview({ id, from: 'offered', to: 'expired', cutoff: null, at: now })
    return say(TEXT.rightWithYou)
  }
  if (!(await st.acceptInterview(id, new Date(now.getTime() - INTERVIEW_OFFER_MS), now))) {
    return say(TEXT.tooLate)
  }
  deps.log(`[press] interview ${String(id)}: player ${String(me.playerId)} started one`)
  return (await askNext(deps, config, id)) ? say(INTERVIEW_TEXT.inThread) : say(TEXT.rightWithYou)
}

/** Accept on an offer: only the offered player, within 30 minutes. */
export async function onInterviewAccept(
  deps: PressDeps,
  config: PressConfig,
  id: number,
  userId: string,
): Promise<Reply> {
  const st = interviewStore(deps)
  if (st === null) return say(INTERVIEW_TEXT.off)
  if (await pressOff(deps, config)) return say(TEXT.pressOff)
  const iv = await st.getInterview(id)
  if (iv === null) return say(TEXT.tooLate)
  if (userId !== iv.discordUserId) return say(`This one is for ${escapeMarkdown(iv.name)}.`)
  if (iv.status === 'active') return say(TEXT.already)
  const now = deps.now()
  const cutoff = new Date(now.getTime() - INTERVIEW_OFFER_MS)
  if (iv.status !== 'offered' || iv.offeredAt === null || iv.offeredAt < cutoff) {
    return say(TEXT.tooLate)
  }
  if (!(await st.acceptInterview(id, cutoff, now))) {
    const again = await st.getInterview(id)
    return say(again?.status === 'active' ? TEXT.already : TEXT.tooLate)
  }
  if (iv.offerMessageId !== null) {
    try {
      await deps.discord.edit(iv.reporter, iv.channelId, iv.offerMessageId, { components: [] })
    } catch {
      // The button refuses a second accept anyway.
    }
  }
  deps.log(`[press] interview ${String(id)}: accepted`)
  return (await askNext(deps, config, id)) ? ACK : say(TEXT.rightWithYou)
}

// ── Questions ───────────────────────────────────────────────────────────────

/** The thread under the offer message; started when the interview has none. */
async function threadFor(deps: PressDeps, st: InterviewStore, iv: InterviewDetail) {
  if (iv.threadId !== null) return iv.threadId
  if (iv.offerMessageId === null) throw new Error('no offer message to start the thread on')
  let threadId: string
  try {
    threadId = await deps.discord.thread(
      iv.reporter,
      iv.channelId,
      iv.offerMessageId,
      cut(`${reporterName(iv.reporter)} — ${iv.name}: interview`, 100),
    )
  } catch (err: unknown) {
    if (!THREAD_EXISTS.test(reason(err))) throw err
    threadId = iv.offerMessageId
  }
  await st.updateInterview(iv.id, { threadId })
  return threadId
}

/** The thread a line goes to (the offer message's id when the thread was never stored). */
const lineTarget = (iv: InterviewDetail): string => iv.threadId ?? iv.offerMessageId ?? iv.channelId

/** End an active interview and post the reporter's last line (best effort). */
async function close(
  deps: PressDeps,
  st: InterviewStore,
  iv: InterviewDetail,
  to: 'done' | 'stopped',
  line: string,
  /** T4: the player's answer message the line replies to. */
  replyTo: string | null = null,
): Promise<void> {
  if (!(await st.endInterview({ id: iv.id, from: 'active', to, cutoff: null, at: deps.now() }))) {
    return
  }
  deps.log(`[press] interview ${String(iv.id)}: ${to}`)
  try {
    await deps.discord.send(
      iv.reporter,
      lineTarget(iv),
      replyingTo(threadLine(iv.discordUserId, escapeMarkdown(line)), replyTo),
    )
  } catch (err: unknown) {
    deps.log(`[press] interview ${String(iv.id)}: closing line failed (${reason(err)})`)
  }
}

/**
 * Ask the next planned question: write it (the fixed fallback when the
 * writer fails), start the thread when there is none, claim it, post it with
 * the Answer button. The extras budget spent, or the player no longer on the
 * sheet: the interview stops. True when a question was posted.
 */
export async function askNext(
  deps: PressDeps,
  config: PressConfig,
  id: number,
  /** T6: the player's latest message: the question replies to it. */
  replyTo: string | null = null,
): Promise<boolean> {
  const st = interviewStore(deps)
  if (st === null) return false
  const iv = await st.getInterview(id)
  if (iv === null || iv.status !== 'active' || iv.currentQuestion !== null) return false
  if (!moreQuestions(iv)) {
    await close(deps, st, iv, 'done', interviewClosing(iv.name))
    return false
  }
  if (await pressOff(deps, config)) {
    await close(deps, st, iv, 'stopped', interviewClosing(iv.name))
    return false
  }
  const position = itemsAsked(iv) + 1
  let question: string | null = null
  let name = iv.name
  try {
    const { res, person } = await sheetFor(deps, iv.night, iv)
    if (person === undefined) {
      // "Leave me out" since the start: nothing more is asked, nothing is posted.
      await st.endInterview({ id, from: 'active', to: 'stopped', cutoff: null, at: deps.now() })
      deps.log(`[press] interview ${String(id)}: player is not on the sheet, stopped`)
      return false
    }
    name = person.name
    const relationship = await relationshipLevel(deps, iv.playerId, iv.reporter, person.pressLevel)
    question = await askInterviewQuestion(
      deps.call,
      {
        facts: res.facts,
        forbiddenNames: res.forbiddenNames,
        takes: res.takes,
        reporter: iv.reporter,
        player: {
          name: person.name,
          pressLevel: person.pressLevel,
          ...(person.bench === undefined ? {} : { bench: person.bench }),
        },
        topic: iv.topic,
        history: interviewHistory(await st.listInterviewAnswers(id)),
        position,
        relationship,
      },
      pressRecorder(st),
    )
  } catch (err: unknown) {
    deps.log(`[press] interview ${String(id)}: question: ${reason(err)}`)
  }
  const text =
    question ??
    fallbackInterviewQuestion(
      iv.questionsAsked + 1,
      name,
      iv.personRole === 'player' ? undefined : iv.personRole,
    )
  const threadId = await threadFor(deps, st, iv)
  const claimed = await st.claimInterviewQuestion({
    id,
    questionsAsked: iv.questionsAsked,
    followupsAsked: iv.followupsAsked,
    question: text,
    at: deps.now(),
  })
  if (!claimed) return false
  await deps.discord.send(
    iv.reporter,
    threadId,
    replyingTo(
      threadLine(
        iv.discordUserId,
        escapeMarkdown(text),
        answerComponents(config, interviewAnswerButton(id)),
      ),
      replyTo,
    ),
  )
  return true
}

// ── Answers ─────────────────────────────────────────────────────────────────

/** Answer under a question: opens the pop-up. */
export async function onInterviewAnswerButton(
  deps: PressDeps,
  _config: PressConfig,
  id: number,
  userId: string,
): Promise<Reply> {
  const st = interviewStore(deps)
  if (st === null) return say(INTERVIEW_TEXT.off)
  const iv = await st.getInterview(id)
  if (iv === null) return say(TEXT.tooLate)
  if (userId !== iv.discordUserId) return say(`This one is for ${escapeMarkdown(iv.name)}.`)
  const refusal = openRefusal(iv, deps.now())
  if (refusal !== null) return refusal
  return {
    kind: 'modal',
    customId: `press:imodal:${String(id)}:${String(iv.questionsAsked)}:${String(iv.followupsAsked)}`,
    title: cut(`${reporterName(iv.reporter)} asks`, MODAL_TEXT_MAX),
    label: cut(iv.currentQuestion!, MODAL_TEXT_MAX),
    maxLength: ANSWER_MAX_CHARS,
  }
}

/** The refusal while no question is open for an answer, or null. */
function openRefusal(iv: InterviewDetail, now: Date): Reply | null {
  if (iv.status !== 'active') return say(TEXT.tooLate)
  if (iv.currentQuestion === null) return say(TEXT.onItsWay)
  if (iv.lastAskedAt === null || now.getTime() - iv.lastAskedAt.getTime() >= INTERVIEW_ANSWER_MS) {
    return say(TEXT.tooLate)
  }
  return null
}

interface Verdict {
  usability: Usability
  followUp: string | null
  closing: string
  /** Stop now (budget spent, off the sheet, an error): no next question. */
  end: boolean
  /** The model's reply line is not used (the judge failed, or only its line did): post a fixed line. */
  fixed: boolean
  /** T5: the judge says the answer is off-limits: no reaction at all, nothing stored. */
  offLimits: boolean
  /** T9: the judge rated a usable answer strong (absent = no). */
  strong?: boolean
}

/** The night sheet for an answer, or null when it cannot be read. */
async function answerSheet(
  deps: PressDeps,
  iv: InterviewDetail,
): Promise<{ res: NewsFactsResponse; person: Subject | undefined } | null> {
  try {
    return await sheetFor(deps, iv.night, iv)
  } catch (err: unknown) {
    deps.log(`[press] interview ${String(iv.id)}: sheet: ${reason(err)}`)
    return null
  }
}

/**
 * Judge the answer with the scrum judge (unchanged; follow-up mode
 * `chased`: the one follow-up goes to an answer with a lot to chase). Fails
 * closed to unusable + end when the budget is spent, the sheet is not known,
 * the player is off it, or anything throws. An answer naming a forbidden
 * person is unusable with no model call; the interview goes on (no
 * follow-up). When only the reply line failed, the model's verdict is kept
 * and a fixed line is posted (`fixed`), like the scrums.
 */
async function judge(
  deps: PressDeps,
  config: PressConfig,
  st: PressStore & InterviewStore,
  iv: InterviewDetail,
  question: string,
  answer: string,
  sheet: { res: NewsFactsResponse; person: Subject | undefined } | null,
): Promise<Verdict> {
  const closed: Verdict = {
    usability: 'unusable',
    followUp: null,
    closing: interviewClosing(iv.name),
    end: true,
    fixed: true,
    offLimits: false,
  }
  const why = (what: string): void =>
    deps.log(
      `[press] interview ${String(iv.id)}: answer unusable by the code, not the model (${what})`,
    )
  try {
    if (await pressOff(deps, config)) {
      why('extras budget spent')
      return closed
    }
    if (sheet === null || sheet.person === undefined) {
      why(sheet === null ? 'no sheet' : 'off the sheet')
      return closed
    }
    const { res, person } = sheet
    if (res.forbiddenNames.some((n) => containsName(answer, n))) {
      why('names a forbidden person')
      return { ...closed, end: false }
    }
    const earlier = await st.listInterviewAnswers(iv.id)
    const history = [...interviewHistory(earlier), { question, answer: null }]
    const relationship = await relationshipLevel(deps, iv.playerId, iv.reporter, person.pressLevel)
    const out = await judgeAnswer(
      deps.call,
      {
        facts: res.facts,
        forbiddenNames: res.forbiddenNames,
        reporter: iv.reporter,
        heat: 'normal',
        player: {
          name: person.name,
          pressLevel: person.pressLevel,
          ...(person.bench === undefined ? {} : { bench: person.bench }),
        },
        gmNotes: [],
        takes: res.takes,
        history,
        questionNumber: itemsAsked(iv),
        answer,
        followUpAllowed: interviewFollowUpAllowed(iv),
        followUpMode: 'chased',
        relationship,
      },
      pressRecorder(st),
      (text, verdictKept) => {
        const safe = safeWhy(text, [answer, ...earlier.map((a) => a.answer)])
        deps.log(
          verdictKept
            ? `[press] interview ${String(iv.id)}: reply line failed after all tries, the model's verdict is kept (${safe})`
            : `[press] interview ${String(iv.id)}: judgement failed closed, stored unusable (${safe})`,
        )
      },
    )
    return {
      usability: out.usability,
      followUp: out.followUp,
      closing: out.closing,
      end: false,
      fixed: out.replyFailed || out.closedFail,
      offLimits: out.offLimits,
      strong: out.strong,
    }
  } catch (err: unknown) {
    deps.log(`[press] interview ${String(iv.id)}: judge: ${reason(err)}`)
    return closed
  }
}

/**
 * The pop-up submit (and a typed answer, `typed`). `seen` = the counters the
 * pop-up was opened for. Claims the answer and echoes it at once in the
 * thread as the reporter (like the scrums: never a typed one, never one that
 * names a forbidden person or when the sheet is not known), judges it,
 * stores it, then asks the follow-up, the next question (an unusable answer
 * is acknowledged first, without its words), or closes. A short "I'm done" /
 * "that's it" ends the interview politely.
 */
export async function onInterviewAnswerSubmit(
  deps: PressDeps,
  config: PressConfig,
  id: number,
  userId: string,
  text: string,
  seen: { questionsAsked: number; followupsAsked: number },
  /** `messageId`: the typed answer's own message (T4: the reporter's lines reply to it). */
  opts: { typed?: boolean; messageId?: string } = {},
): Promise<Reply> {
  const st = interviewStore(deps)
  if (st === null) return say(INTERVIEW_TEXT.off)
  const iv = await st.getInterview(id)
  if (iv === null) return say(TEXT.tooLate)
  if (userId !== iv.discordUserId) return say(`This one is for ${escapeMarkdown(iv.name)}.`)
  const now = deps.now()
  if (iv.status !== 'active') return say(TEXT.tooLate)
  if (
    iv.questionsAsked !== seen.questionsAsked ||
    iv.followupsAsked !== seen.followupsAsked ||
    iv.currentQuestion === null
  ) {
    return say(TEXT.answered)
  }
  const refusal = openRefusal(iv, now)
  if (refusal !== null) return refusal
  const answer = Array.from(text.trim()).slice(0, ANSWER_MAX_CHARS).join('').trimEnd()
  if (answer === '') return say(TEXT.noAnswer)
  const question = iv.currentQuestion
  // T5, hard lines: before any reaction, any claim and any echo; the question stays open. A
  // plain "I'm done" cannot be off-limits and costs no check.
  const screened = saysItIsOver(answer)
    ? ({ offLimits: false, insult: 'none', praise: 'none', reporter: null } as const)
    : await screenMessage(deps, config, answer, iv.reporter)
  if (screened.offLimits) {
    deps.log(`[press] interview ${String(id)}: ${OFFLIMITS_LOG} (${screened.why})`)
    return { kind: 'ack', offLimits: true }
  }
  if (!(await st.claimInterviewAnswer({ id, ...seen, at: now }))) return say(TEXT.answered)
  const target = lineTarget(iv)
  const mention = iv.discordUserId

  const store = async (usability: Usability): Promise<void> => {
    await st.insertInterviewAnswer({
      interviewId: id,
      playerId: iv.playerId,
      reporter: iv.reporter,
      position: itemsAsked(iv),
      isFollowup: iv.askingFollowup,
      question,
      answer,
      usability,
      isTest: iv.isTest,
    })
  }

  if (saysItIsOver(answer)) {
    await store('unusable')
    await close(deps, st, iv, 'stopped', interviewClosing(iv.name), opts.messageId ?? null)
    return ACK
  }

  const sheet = await answerSheet(deps, iv)
  const refused =
    sheet === null ||
    sheet.person === undefined ||
    sheet.res.forbiddenNames.some((n) => containsName(answer, n))
  // T4: the reporter's lines reply to the answer message (the typed one, or the echo below);
  // never to a refused answer.
  let answerRef: string | null = refused ? null : (opts.messageId ?? null)
  if (!refused && opts.typed !== true) {
    try {
      answerRef = await deps.discord.send(iv.reporter, target, {
        content: `**${escapeMarkdown(iv.name)}:** ${escapeMarkdown(answer)}`,
        allowed_mentions: { parse: [] },
        flags: SUPPRESS_EMBEDS,
      })
    } catch (err: unknown) {
      deps.log(`[press] interview ${String(id)}: echo failed (${reason(err)})`)
    }
  }
  const verdict = await judge(deps, config, st, iv, question, answer, sheet)
  if (verdict.offLimits) {
    // The judge's second line: off-limits after all. The question is open again, the echo (if
    // any) is taken down, nothing is stored and nothing is said.
    await st.updateInterview(id, { currentQuestion: question, lastAskedAt: iv.lastAskedAt })
    if (opts.typed !== true && answerRef !== null) {
      try {
        await deps.discord.remove(iv.reporter, target, answerRef)
      } catch (err: unknown) {
        deps.log(`[press] interview ${String(id)}: echo not removed (${reason(err)})`)
      }
    }
    deps.log(`[press] interview ${String(id)}: ${OFFLIMITS_LOG} (judge)`)
    return { kind: 'ack', offLimits: true }
  }
  // T6: the player's latest message in their thread; the "no answer" closing replies to it.
  rememberPlayerMessage(deps, target, iv.discordUserId, answerRef)
  // T5, T9: an insult at a reporter (down) or a compliment or thanks (up), not off-limits, moves the
  // scale; "Leave me out" adds none.
  if (!refused && screened.reporter !== null && sheet?.person !== undefined) {
    await recordMessageSignals(deps, {
      playerId: iv.playerId,
      reporter: screened.reporter,
      insult: screened.insult,
      praise: screened.praise,
      pressLevel: sheet.person.pressLevel,
      where: `interview ${String(id)}`,
    })
  }
  // T9: a usable answer the judge rates strong moves the scale up a little.
  if (!refused && verdict.strong === true && sheet?.person !== undefined) {
    await recordRelationship(deps, {
      playerId: iv.playerId,
      reporter: iv.reporter,
      event: 'strongAnswer',
      pressLevel: sheet.person.pressLevel,
      where: `interview ${String(id)}`,
    })
  }
  await store(verdict.usability)

  if (verdict.followUp !== null) {
    const claimed = await st.claimInterviewFollowup({
      id,
      questionsAsked: iv.questionsAsked,
      followupsAsked: iv.followupsAsked,
      question: verdict.followUp,
      at: deps.now(),
    })
    if (claimed) {
      await deps.discord.send(
        iv.reporter,
        target,
        replyingTo(
          threadLine(
            mention,
            escapeMarkdown(verdict.followUp),
            answerComponents(config, interviewAnswerButton(id)),
          ),
          answerRef,
        ),
      )
      return ACK
    }
  }
  const lastLine = verdict.fixed ? interviewClosing(iv.name) : verdict.closing
  if (verdict.end) {
    await close(deps, st, iv, 'stopped', lastLine, answerRef)
    return ACK
  }
  if (moreQuestions(iv)) {
    // No silent answers (as in the scrums): an answer the desk cannot use is acknowledged,
    // without its words, before the next question.
    if (verdict.usability === 'unusable') {
      try {
        await deps.discord.send(
          iv.reporter,
          target,
          replyingTo(
            threadLine(mention, escapeMarkdown(verdict.fixed ? FALLBACK_ACK : verdict.closing)),
            answerRef,
          ),
        )
      } catch (err: unknown) {
        deps.log(`[press] interview ${String(id)}: acknowledgement failed (${reason(err)})`)
      }
    }
    try {
      if (await askNext(deps, config, id, answerRef)) return ACK
    } catch (err: unknown) {
      deps.log(`[press] interview ${String(id)}: next question: ${reason(err)}`)
    }
    return say(TEXT.rightWithYou)
  }
  await close(deps, st, iv, 'done', lastLine, answerRef)
  return ACK
}

/**
 * A message in an interview thread (needs `PRESS_TYPED_ANSWERS=1`): the
 * answer when this user has a question open in this thread right now. True
 * when the message belonged to an interview (handled or refused); false when
 * it is not an interview thread of this user (the scrum path gets it).
 */
export async function onInterviewTypedAnswer(
  deps: PressDeps,
  config: PressConfig,
  msg: { threadId: string; userId: string; text: string },
): Promise<boolean> {
  const st = interviewStore(deps)
  if (st === null) return false
  const id = await st.findOpenInterviewInThread(msg.threadId, msg.userId)
  if (id === null) return false
  const iv = await st.getInterview(id)
  if (iv === null) return false
  const seen = { questionsAsked: iv.questionsAsked, followupsAsked: iv.followupsAsked }
  const reply = await onInterviewAnswerSubmit(deps, config, id, msg.userId, msg.text, seen, {
    typed: true,
  })
  if (reply.kind === 'ephemeral') {
    deps.log(`[press] interview ${String(id)}: typed answer not taken (${reply.text})`)
  }
  return true
}

/** The last line when an interview runs out of time (the expiry pass). */
export async function closeExpired(
  deps: PressDeps,
  st: InterviewStore,
  iv: InterviewDetail,
  cutoff: Date,
): Promise<boolean> {
  if (
    !(await st.endInterview({ id: iv.id, from: 'active', to: 'stopped', cutoff, at: deps.now() }))
  ) {
    return false
  }
  try {
    await deps.discord.send(
      iv.reporter,
      lineTarget(iv),
      replyingTo(
        threadLine(iv.discordUserId, escapeMarkdown(interviewClosing(iv.name))),
        latestPlayerMessage(deps, lineTarget(iv), iv.discordUserId),
      ),
    )
  } catch (err: unknown) {
    deps.log(`[press] interview ${String(iv.id)}: closing line failed (${reason(err)})`)
  }
  return true
}
