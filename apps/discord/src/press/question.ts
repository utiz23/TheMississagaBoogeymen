import { REPORTERS, type ReporterId } from '@eanhl/db/news'
import { answerButton, type BotMessage } from '../bot-rest.ts'
import { escapeMarkdown } from '../message.ts'
import { costUsd } from '../news/cost.ts'
import { FALLBACK_QUESTION, askQuestion, type ScrumHistoryEntry } from './asker.ts'
import type { PressConfig } from './config.ts'
import type { PressDeps } from './pass.ts'
import { effectiveHeat, extrasBudgetLeft } from './rules.ts'

/**
 * The scrum question step: the timer pass and the button handlers (Task 8)
 * share it, with the thread-line helpers. All I/O goes through `PressDeps`.
 */

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const reporterName = (id: ReporterId): string => REPORTERS[id].name

/** The month each deps last logged the spent extras budget (`YYYY-MM`): once a month. */
const budgetNoticeMonth = new WeakMap<PressDeps, string>()
/** Who a scrum line mentions: the person, or the GM in the trial (or on a trial scrum). */
export function scrumMention(config: PressConfig, isTest: boolean, discordUserId: string): string {
  return config.mode === 'trial' || isTest ? config.gmUserId : discordUserId
}

/** A line in a scrum thread: it starts with the mention, and only that user is pinged. */
export function threadLine(userId: string, text: string, components?: unknown[]): BotMessage {
  const msg: BotMessage = {
    content: `<@${userId}> ${text}`,
    allowed_mentions: { parse: [], users: [userId] },
  }
  if (components !== undefined) msg.components = components
  return msg
}

/** Discord: a thread started from a message already exists (HTTP 400, code 160004). */
const THREAD_EXISTS = /\bHTTP 400\b/

/**
 * Ask the person's next question. Loads the game sheet, the person's name and
 * press level (`facts.people`), the match's active GM notes (no critical note
 * for a "Go easy" player), the takes and the person's earlier answers; writes
 * the question (the fallback when the extras budget is spent or anything
 * fails); opens the thread on the scrum message when it has none (`<Reporter>
 * — <player>`; a thread's id is its message's id); claims the question;
 * posts it with the Answer button, mentioning the person (the GM in the
 * trial). A person who is done, expired or no longer on the sheet gets
 * nothing; one no longer on the sheet is ended.
 */
export async function startScrumQuestion(
  deps: PressDeps,
  config: PressConfig,
  personId: number,
): Promise<void> {
  const { store, discord, log } = deps
  const person = await store.getScrumPerson(personId)
  if (person === null) {
    log(`[press] question: person ${String(personId)} not found`)
    return
  }
  const status = person.status
  if (status !== 'pinged' && status !== 'asking') return
  const scrum = person.scrum
  const reporter = scrum.reporter
  const now = deps.now()
  let name = person.name
  let question: string | null = null

  async function writeQuestion(matchId: number): Promise<string | null | 'off-sheet'> {
    const res = await deps.fetchFacts('game', String(matchId))
    const onSheet = res.facts.people.find((p) => p.playerId === person!.playerId)
    // A guest, or "Leave me out" since the ping: nothing about them goes anywhere.
    if (onSheet === undefined) return 'off-sheet'
    name = onSheet.name
    if (!extrasBudgetLeft(await store.monthNewsSpendUsd(now), config.monthlyLimitUsd)) {
      const month = now.toISOString().slice(0, 7)
      if (budgetNoticeMonth.get(deps) !== month) {
        budgetNoticeMonth.set(deps, month)
        log(`[press] budget: extras budget for ${month} is spent; scrum questions use the fallback`)
      }
      return null
    }
    const easy = onSheet.pressLevel === 'easy'
    const material = await store.nightPressMaterial(scrum.night, scrum.isTest)
    const history: ScrumHistoryEntry[] = (await store.listScrumAnswers(personId)).map((a) =>
      a.usability === 'unusable'
        ? { question: a.question, answer: null }
        : { question: a.question, answer: a.answer, usability: a.usability },
    )
    return askQuestion(
      deps.call,
      {
        facts: res.facts,
        forbiddenNames: res.forbiddenNames,
        reporter,
        heat: effectiveHeat(scrum.heat, onSheet.pressLevel).heat,
        player: { name: onSheet.name, pressLevel: onSheet.pressLevel },
        // "Go easy" means no criticism: a critical note is never used for them.
        gmNotes: material.gmNotes
          .filter((n) => n.matchId === matchId && !(easy && n.critical))
          .map((n) => n.note),
        takes: res.takes,
        history,
        questionNumber: person!.questionsAsked + 1,
      },
      (purpose, model, usage) =>
        store.recordNewsUsage({
          jobId: null,
          purpose,
          model,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
          costUsd: costUsd(model, usage),
        }),
    )
  }

  if (scrum.matchId !== null) {
    try {
      const out = await writeQuestion(scrum.matchId)
      if (out === 'off-sheet') {
        await store.expireScrumPerson(personId, status, null)
        log(`[press] question: person ${String(personId)} is not on the sheet, ended`)
        return
      }
      question = out
    } catch (err: unknown) {
      log(`[press] question: person ${String(personId)}: ${reason(err)}`)
    }
  }

  const text = question ?? FALLBACK_QUESTION(name)
  let threadId = scrum.threadId
  if (threadId === null) {
    try {
      threadId = await discord.thread(
        reporter,
        scrum.channelId,
        scrum.messageId,
        `${reporterName(reporter)} — ${name}`,
      )
    } catch (err: unknown) {
      // Started before (a restart, or another caller): its id is the message id.
      if (!THREAD_EXISTS.test(reason(err))) throw err
      threadId = scrum.messageId
    }
    await store.setScrumThread(scrum.id, threadId)
  }
  const claimed = await store.claimScrumQuestion({
    personId,
    questionsAsked: person.questionsAsked,
    question: text,
    at: now,
  })
  if (!claimed) return
  await discord.send(
    reporter,
    threadId,
    threadLine(scrumMention(config, scrum.isTest, person.discordUserId), escapeMarkdown(text), [
      { type: 1, components: [answerButton(personId)] },
    ]),
  )
}
