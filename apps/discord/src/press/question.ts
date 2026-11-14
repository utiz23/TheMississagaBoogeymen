import { REPORTERS, type FeudLevel, type NewsFactsResponse, type ReporterId } from '@eanhl/db/news'
import type { NewsGmAskRow, NewsScrumRow, ScrumPersonDetail } from '@eanhl/db/queries'
import { crudeHit } from '../news/crude.ts'
import { containsName } from '../news/fact-check.ts'
import { answerButton, type BotMessage } from '../bot-rest.ts'
import { escapeMarkdown } from '../message.ts'
import { costUsd } from '../news/cost.ts'
import { pressForSheet } from '../news/press-material.ts'
import { askQuestion, type AskContext, type Recorder, type ScrumHistoryEntry } from './asker.ts'
import { redactTakes } from '../news/redact.ts'
import type { PressConfig } from './config.ts'
import { fallbackLine, stepUpLine } from './fallbacks.ts'
import { feudLevel, feudsFor, panelFeudReporters, type PressLevelNow } from './feuds.ts'
import type { PressDeps, PressStore } from './pass.ts'
import { subjectOf, type Subject } from './subject.ts'
import { replyingTo } from './reply-ref.ts'
import { isTestScrum } from './test-scrum-rules.ts'
import { choosePanel, effectiveHeat, extrasBudgetLeft, panelSize, targetTotalFor } from './rules.ts'

/**
 * The scrum question step: the timer pass and the button handlers (Task 8)
 * share it, with the thread-line helpers. All I/O goes through `PressDeps`.
 */

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const reporterName = (id: ReporterId): string => REPORTERS[id].name

/** The month each deps last logged the spent extras budget (`YYYY-MM`): once a month. */
const budgetNoticeMonth = new WeakMap<PressDeps, string>()
/** A line in a scrum thread: it starts with the mention, and only that user is pinged. */
export function threadLine(userId: string, text: string, components?: unknown[]): BotMessage {
  const msg: BotMessage = {
    content: `<@${userId}> ${text}`,
    allowed_mentions: { parse: [], users: [userId] },
  }
  if (components !== undefined) msg.components = components
  return msg
}

/**
 * T6: the components of a question post. While typed answers are on the player just types in their
 * thread: no Answer button. With typed answers off the button is posted as before (answering must
 * never be impossible).
 */
export function answerComponents(config: Pick<PressConfig, 'typedAnswers'>, button: unknown) {
  return config.typedAnswers ? undefined : [{ type: 1, components: [button] }]
}

/**
 * The thread a person's lines go to (T6): the scrum's shared thread (a scrum made before one thread
 * per player), else the person's own thread, whose id is the id of the message it starts from
 * (`pingMessageId`: the ping, or the step-up line of a volunteer). Null while there is none yet.
 */
export function personThreadId(
  person: Pick<ScrumPersonDetail, 'scrum' | 'pingMessageId'>,
): string | null {
  return person.scrum.threadId ?? person.pingMessageId
}

/**
 * The GM's active `/gm ask` for this person on the match: by player id, or (a person with no
 * player row, T7) by Discord user id. The question of a person's first item.
 */
export async function gmAskOfPerson(
  store: Pick<PressStore, 'gmAskForPlayer' | 'gmAskForUser'>,
  person: Pick<ScrumPersonDetail, 'playerId' | 'discordUserId'>,
  matchId: number,
  isTest: boolean,
): Promise<NewsGmAskRow | null> {
  return person.playerId === null
    ? store.gmAskForUser(matchId, person.discordUserId, isTest)
    : store.gmAskForPlayer(matchId, person.playerId, isTest)
}

/**
 * Earlier answers as asker history: an unusable answer goes in as no answer.
 * Each entry names the reporter who asked (`by`): the answer's own, else
 * `scrumReporter` (an answer stored before panels).
 */
export function scrumHistory(
  answers: Awaited<ReturnType<PressStore['listScrumAnswers']>>,
  scrumReporter?: ReporterId,
): ScrumHistoryEntry[] {
  return answers.map((a) => {
    const by = a.reporter ?? scrumReporter
    const who = by === undefined ? {} : { by }
    // Rule C (T5): a crude answer goes in as no answer, whatever its label says.
    return a.usability === 'unusable' || crudeHit(a.answer)
      ? { question: a.question, answer: null, ...who }
      : { question: a.question, answer: a.answer, usability: a.usability, ...who }
  })
}

/** The person's panel: the stored one, or the scrum's own reporter (a round made before panels). */
export function panelOf(person: Pick<ScrumPersonDetail, 'panel' | 'scrum'>): ReporterId[] {
  return person.panel.length > 0 ? [...person.panel] : [person.scrum.reporter]
}

/**
 * The reporter of the item with this index (0 = the first question). Past the
 * end of the panel (an old one-reporter round) it is the last reporter.
 */
export function reporterAt(
  panel: readonly ReporterId[],
  index: number,
  fallback: ReporterId,
): ReporterId {
  return panel[index] ?? panel.at(-1) ?? fallback
}

/** One number per person that never repeats within a scrum: the seed of its panel and target. */
export const personSeed = (scrumId: number, personId: number): number =>
  scrumId * 100_003 + personId

/**
 * The person's panel and target total. Made once, at the first question: the
 * GM's chosen reporter first (else the scrum's own reporter), then reporters
 * drawn by heat and takes; 3 reporters for a picked player, 2 for a volunteer.
 * A person with a question already asked and no panel is in an old round
 * (made before panels): the scrum's reporter alone, no target (old limits).
 */
export async function ensurePanel(
  deps: PressDeps,
  person: ScrumPersonDetail,
): Promise<{ panel: ReporterId[]; targetTotal: number | null }> {
  if (person.panel.length > 0) return { panel: [...person.panel], targetTotal: person.targetTotal }
  const { store } = deps
  const scrum = person.scrum
  let panel: ReporterId[]
  let targetTotal: number | null
  if (person.questionsAsked > 0) {
    panel = [scrum.reporter]
    targetTotal = null
  } else {
    let takeReporters: ReporterId[] = []
    let pressLevel: 'full' | 'easy' = 'full'
    // T5: a feud (level "feud" or above) makes that reporter likelier on the panel. Unknown press
    // level (the sheet could not be read) = no feud content, like "Go easy".
    let feudLevelNow: PressLevelNow = 'out'
    if (scrum.matchId !== null) {
      try {
        const res = await deps.fetchFacts('game', String(scrum.matchId))
        pressLevel = (await subjectOf(deps, res, person))?.pressLevel ?? 'full'
        feudLevelNow = pressLevel
        takeReporters =
          person.playerId === null
            ? []
            : res.takes
                .filter((t) => t.playerId === person.playerId)
                .flatMap((t) => [t.reporter, ...t.critics])
      } catch (err: unknown) {
        deps.log(`[press] panel: person ${String(person.id)}: no takes (${reason(err)})`)
      }
    }
    const ask =
      scrum.matchId === null
        ? null
        : await gmAskOfPerson(store, person, scrum.matchId, scrum.isTest)
    const seed = personSeed(scrum.id, person.id)
    const feudReporters = panelFeudReporters(await feudsFor(deps, person.playerId, feudLevelNow))
    panel = choosePanel({
      size: panelSize(person.role),
      heat: effectiveHeat(scrum.heat, pressLevel).heat,
      seed,
      disabled: await store.listDisabledReporters(),
      first: ask?.reporter ?? scrum.reporter,
      takeReporters,
      feudReporters,
    })
    if (panel.length === 0) panel = [scrum.reporter]
    // A short panel (reporters switched off) cannot take more than 2 items each.
    const drawn = targetTotalFor(person.role, seed)
    targetTotal = Math.min(drawn, panel.length * 2)
  }
  if (await store.setScrumPersonPanel(person.id, panel, targetTotal)) return { panel, targetTotal }
  // Another caller set it first: theirs counts.
  const again = await store.getScrumPerson(person.id)
  return again !== null && again.panel.length > 0
    ? { panel: [...again.panel], targetTotal: again.targetTotal }
    : { panel, targetTotal }
}

/**
 * Why a scrum write failed, as a log line part: cut, and with the player's
 * answers (any run of 4 or more of their words) taken out: the review's
 * problems may quote them. Never the player's answer in a log.
 */
export function safeWhy(why: string, answers: readonly string[], max = 300): string {
  const redacted = redactTakes(
    why,
    answers.map((a, i) => ({ id: i, take: a })),
  )
  return Array.from(redacted).slice(0, max).join('')
}

/** Records a scrum model call (no news job). */
export function pressRecorder(store: PressStore): Recorder {
  return (purpose, model, usage) =>
    store.recordNewsUsage({
      jobId: null,
      purpose,
      model,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
      costUsd: costUsd(model, usage),
    })
}

/**
 * The asker context for a person on the game sheet: the scrum's heat (never
 * Hot for "Go easy"), this match's active GM notes (filtered like the night
 * recap's by each note's own player, and no critical note at all for a "Go
 * easy" person asked), the takes and the history.
 */
export async function scrumAskContext(
  store: PressStore,
  scrum: NewsScrumRow,
  res: NewsFactsResponse,
  onSheet: Subject,
  history: ScrumHistoryEntry[],
  questionNumber: number,
  /** The asking reporter (default: the scrum's own), the scrum's other questions and the GM's topic. */
  opts: {
    reporter?: ReporterId
    usedQuestions?: string[]
    gmTopic?: string
    /** T5: the feud between the asking reporter and the player (never for "Go easy"). */
    feud?: FeudLevel
  } = {},
): Promise<AskContext> {
  const easy = onSheet.pressLevel === 'easy'
  const material = await store.nightPressMaterial(scrum.night, scrum.isTest)
  return {
    facts: res.facts,
    forbiddenNames: res.forbiddenNames,
    reporter: opts.reporter ?? scrum.reporter,
    heat: effectiveHeat(scrum.heat, onSheet.pressLevel).heat,
    player: {
      name: onSheet.name,
      pressLevel: onSheet.pressLevel,
      ...(onSheet.bench === undefined ? {} : { bench: onSheet.bench }),
    },
    // "Go easy" means no criticism: a critical note is never used for them.
    gmNotes: pressForSheet(material, res.facts)
      .gmNotes.filter((n) => n.matchId === scrum.matchId && !(easy && n.critical))
      .map((n) => n.note),
    takes: res.takes,
    history,
    questionNumber,
    ...(opts.usedQuestions === undefined ? {} : { usedQuestions: opts.usedQuestions }),
    ...(opts.gmTopic === undefined ? {} : { gmTopic: opts.gmTopic }),
    ...(opts.feud === undefined || easy ? {} : { feud: opts.feud }),
  }
}

/** Discord: a thread started from a message already exists (HTTP 400, code 160004). */
const THREAD_EXISTS = /\bHTTP 400\b/

/**
 * Ask the person's next question, from the next reporter of their panel (made
 * at the first question). Loads the game sheet, the person's name and press
 * level (`facts.people`), the match's active GM notes (no critical note for a
 * "Go easy" player), the takes, the person's earlier answers and the questions
 * the scrum already put to others (no repeated angle); writes the question
 * (the fallback when the extras budget is spent or anything fails). The
 * first question of a GM-asked player is the GM's: word for word, or as a
 * topic in the reporter's voice. T6, one thread per player: the person's thread
 * starts from the ping message (a volunteer, or a ping that was never stored:
 * from a step-up line the reporter posts under the recap) at the first question
 * (`<Player> — press scrum`; a thread's id is its message's id); a scrum that
 * already has a shared thread (made before T6) keeps using it. Claims the
 * question; posts it, mentioning the person, with the Answer button only while
 * typed answers are off; `replyTo` (the player's latest message) makes it a
 * Discord reply. A
 * person who is done, expired or no longer on the sheet gets nothing; one no
 * longer on the sheet is ended. True when the question was posted.
 */
export async function startScrumQuestion(
  deps: PressDeps,
  config: PressConfig,
  personId: number,
  /** T6: the player's latest message in their thread; the question replies to it. */
  replyTo: string | null = null,
): Promise<boolean> {
  const { store, discord, log } = deps
  const person = await store.getScrumPerson(personId)
  if (person === null) {
    log(`[press] question: person ${String(personId)} not found`)
    return false
  }
  const status = person.status
  if (status !== 'pinged' && status !== 'asking') return false
  const scrum = person.scrum
  const { panel } = await ensurePanel(deps, person)
  const reporter = reporterAt(panel, person.questionsAsked, scrum.reporter)
  const now = deps.now()
  let name = person.name
  let question: string | null = null

  async function writeQuestion(matchId: number): Promise<string | null | 'off-sheet'> {
    const res = await deps.fetchFacts('game', String(matchId))
    const onSheet = await subjectOf(deps, res, person!)
    // A guest, or "Leave me out" since the ping: nothing about them goes anywhere.
    if (onSheet === undefined) return 'off-sheet'
    name = onSheet.name
    // The GM's question comes first (a person's first question only).
    const ask =
      person!.questionsAsked === 0
        ? await gmAskOfPerson(store, person!, matchId, scrum.isTest)
        : null
    if (ask !== null && res.forbiddenNames.some((n) => containsName(ask.question, n))) {
      log(
        `[press] question: person ${String(personId)}: the GM's question names a forbidden person, not used`,
      )
    } else if (ask !== null && ask.exact) {
      return ask.question
    }
    const topic = ask !== null && !ask.exact ? ask.question : undefined
    if (!extrasBudgetLeft(await store.monthNewsSpendUsd(now), config.monthlyLimitUsd)) {
      const month = now.toISOString().slice(0, 7)
      if (budgetNoticeMonth.get(deps) !== month) {
        budgetNoticeMonth.set(deps, month)
        log(`[press] budget: extras budget for ${month} is spent; scrum questions use the fallback`)
      }
      return null
    }
    const answers = await store.listScrumAnswers(personId)
    const history = scrumHistory(answers, scrum.reporter)
    const usedQuestions = await store.listScrumQuestions(scrum.id, personId)
    const feud = await feudLevel(deps, person!.playerId, reporter, onSheet.pressLevel)
    let failed = false
    const written = await askQuestion(
      deps.call,
      await scrumAskContext(store, scrum, res, onSheet, history, person!.questionsAsked + 1, {
        reporter,
        usedQuestions,
        feud,
        ...(topic === undefined ? {} : { gmTopic: topic }),
      }),
      pressRecorder(store),
      {
        onFail: (why) => {
          failed = true
          log(
            `[press] question: person ${String(personId)}: write failed, fixed line used (${safeWhy(
              why,
              answers.map((a) => a.answer),
            )})`,
          )
        },
      },
    )
    // A failed write: a line from the reporter's own pool, not the one stock question.
    return failed ? null : written
  }

  /** A question of the reporter's own fallback pool, never one this thread already had. */
  async function fallbackQuestion(): Promise<string> {
    let had: string[] = []
    try {
      had = [
        ...(await store.listScrumQuestions(scrum.id, personId)),
        ...(await store.listScrumAnswers(personId)).map((a) => a.question),
      ]
    } catch {
      // The pool still gives a line; the repeat check only has less to go on.
    }
    return fallbackLine(deps, {
      scrumId: scrum.id,
      kind: 'question',
      reporter,
      name,
      seed: personSeed(scrum.id, personId) + person!.questionsAsked,
      alsoUsed: had,
      ...(person!.personRole === 'player' ? {} : { bench: person!.personRole }),
    })
  }

  /**
   * The thread this person's lines go to. A shared thread of an old scrum is used as it is. A
   * person's own thread is started at the first question; a retry (nothing claimed yet) meets
   * Discord's "thread exists" answer and uses the message id.
   */
  async function ensureThread(): Promise<string> {
    if (scrum.threadId !== null) return scrum.threadId
    if (person!.questionsAsked > 0 && person!.pingMessageId !== null) return person!.pingMessageId
    let anchor = person!.pingMessageId
    if (anchor === null) {
      // A volunteer (or a ping that was never stored): the reporter says who steps up, under the
      // recap, and the person's thread starts from that line. It is stored first, so a retry
      // never posts a second one.
      anchor = await discord.send(reporter, scrum.channelId, {
        content: stepUpLine(
          reporter,
          `<@${person!.discordUserId}>`,
          personSeed(scrum.id, personId),
        ),
        allowed_mentions: { parse: [], users: [person!.discordUserId] },
        message_reference: { message_id: scrum.messageId, fail_if_not_exists: false },
      })
      await store.updateScrumPerson(personId, { pingMessageId: anchor })
    }
    try {
      return await discord.thread(
        reporter,
        scrum.channelId,
        anchor,
        Array.from(`${name} — press scrum`).slice(0, 100).join(''),
      )
    } catch (err: unknown) {
      // Started before (a restart, or another caller): its id is the message id.
      if (!THREAD_EXISTS.test(reason(err))) throw err
      return anchor
    }
  }

  // T8: a test scrum never calls the model: its questions come from the reporter's fixed pool.
  if (scrum.matchId !== null && !isTestScrum(scrum)) {
    try {
      const out = await writeQuestion(scrum.matchId)
      if (out === 'off-sheet') {
        await store.expireScrumPerson(personId, status, null)
        log(`[press] question: person ${String(personId)} is not on the sheet, ended`)
        return false
      }
      question = out
    } catch (err: unknown) {
      log(`[press] question: person ${String(personId)}: ${reason(err)}`)
    }
  }

  const text = question ?? (await fallbackQuestion())
  const threadId = await ensureThread()
  const claimed = await store.claimScrumQuestion({
    personId,
    questionsAsked: person.questionsAsked,
    question: text,
    at: now,
  })
  if (!claimed) return false
  await discord.send(
    reporter,
    threadId,
    replyingTo(
      threadLine(
        person.discordUserId,
        escapeMarkdown(text),
        answerComponents(config, answerButton(personId)),
      ),
      replyTo,
    ),
  )
  return true
}
