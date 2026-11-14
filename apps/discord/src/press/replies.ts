import { escapeMarkdown } from '../message.ts'
import type { PressConfig } from './config.ts'
import { codeInsult, recordInsult, type PressLevelNow } from './feuds.ts'
import { feudStoreOf } from './feud-store.ts'
import { OFFLIMITS_LOG } from './hard-lines.ts'
import { onInterviewAnswerSubmit } from './interview.ts'
import { interviewStoreOf } from './interview-store.ts'
import { onAnswerSubmit, type Reply } from './interactions.ts'
import type { PressDeps } from './pass.ts'

export { replyingTo } from './reply-ref.ts'

/**
 * Discord replies in the press threads (T4, items 1 and 2).
 *
 * 1. A message in a scrum or interview thread answers the writer's open
 *    question (T1, `PRESS_TYPED_ANSWERS=1`). A Discord Reply counts only when
 *    it replies to that exact question: the question message carries this
 *    person's Answer button and shows the current question. A reply to an
 *    old question, to someone else's question or to any other message is
 *    ignored. Each considered message gets one log line (thread, user, taken
 *    or why not), never its text.
 * 2. `replyingTo` makes a reporter's line a Discord reply to the player's
 *    answer message (the typed message, or the pop-up echo).
 */

/** The message a Discord Reply points at, as far as Barlow could read it. */
export interface ReferencedMessage {
  messageId: string
  /** Null when the message could not be read (deleted, or not fetched). */
  authorId: string | null
  content: string | null
  /** The custom ids of its buttons. */
  customIds: string[]
}

/** One message in a thread. `reference` null = a plain message, not a Reply. */
export interface ThreadMessage {
  threadId: string
  userId: string
  text: string
  /** The message's own id: the reporter's next line replies to it. */
  messageId?: string
  reference?: ReferencedMessage | null
}

/**
 * Why a message may not answer this question, or null when it may. A plain
 * message may. A Reply may only when it points at the question message that
 * is open now: it has `answerCustomId` (this person's Answer button) and its
 * text is the current question line (`<@user> question`).
 */
export function replyTargetProblem(
  reference: ReferencedMessage | null | undefined,
  answerCustomId: string,
  userId: string,
  currentQuestion: string | null,
): string | null {
  if (reference === null || reference === undefined) return null
  if (reference.content === null) return 'a reply to a message that could not be read'
  if (!reference.customIds.includes(answerCustomId)) return 'a reply to another message'
  if (currentQuestion === null) return 'no question is open'
  const line = `<@${userId}> ${escapeMarkdown(currentQuestion)}`
  if (reference.content.trim() !== line.trim()) return 'a reply to an earlier question'
  return null
}

function outcome(reply: Reply): string {
  if (reply.kind === 'ephemeral') return `not taken (${reply.text})`
  // T5: an off-limits message is never acknowledged; the log says so, never the text.
  return reply.kind === 'ack' && reply.offLimits === true ? OFFLIMITS_LOG : 'taken'
}

/**
 * T5, feuds: a message in a press thread that is NOT an answer (no open question, or a reply to
 * another message) may still insult a reporter ("gord ur an asshole"). Code only, no model call:
 * a reporter's name plus a rude or crude word (`codeInsult`). A slur or any other hard-line text
 * never counts and gets no reaction. Only a linked team member counts; "Leave me out" adds nothing.
 * The message is never answered, stored or logged. Never throws.
 */
async function insultFromThread(
  deps: PressDeps,
  msg: { threadId: string; userId: string; text: string },
  tag: string,
): Promise<void> {
  try {
    const hit = codeInsult(msg.text)
    if (hit === null) return
    // Only a press thread (a scrum or an interview): not any other thread of the guild.
    const feuds = feudStoreOf(deps.store)
    if (feuds === null || !(await feuds.isPressThread(msg.threadId))) return
    const me = await deps.store.getPlayerForDiscordUser(msg.userId)
    if (me === null) return
    const member = (await deps.store.listPressRoster()).find((p) => p.playerId === me.playerId)
    if (member === undefined) return
    await recordInsult(deps, {
      playerId: me.playerId,
      reporter: hit.reporter,
      insult: hit.insult,
      pressLevel: member.pressLevel as PressLevelNow,
      where: tag.replace('[press] ', ''),
    })
  } catch (err: unknown) {
    deps.log(`${tag}: feud check failed (${err instanceof Error ? err.message : String(err)})`)
  }
}

/**
 * A message in a thread: an interview answer, else a scrum answer, else
 * nothing. Replaces `onPressThreadMessage` as the message router's handler;
 * the answer paths themselves (`onInterviewAnswerSubmit`, `onAnswerSubmit`)
 * are unchanged apart from the reply reference.
 */
export async function onThreadMessage(
  deps: PressDeps,
  config: PressConfig,
  msg: ThreadMessage,
): Promise<void> {
  const tag = `[press] thread message: thread ${msg.threadId} user ${msg.userId}`
  const opts = { typed: true, ...(msg.messageId === undefined ? {} : { messageId: msg.messageId }) }

  const ist = interviewStoreOf(deps.store)
  const interviewId =
    ist === null ? null : await ist.findOpenInterviewInThread(msg.threadId, msg.userId)
  if (ist !== null && interviewId !== null) {
    const iv = await ist.getInterview(interviewId)
    if (iv === null) {
      deps.log(`${tag}: not taken (interview ${String(interviewId)} not found)`)
      return
    }
    const problem = replyTargetProblem(
      msg.reference,
      `press:ianswer:${String(interviewId)}`,
      iv.discordUserId,
      iv.currentQuestion,
    )
    if (problem !== null) {
      deps.log(`${tag}: not taken (interview ${String(interviewId)}: ${problem})`)
      await insultFromThread(deps, msg, tag)
      return
    }
    const seen = { questionsAsked: iv.questionsAsked, followupsAsked: iv.followupsAsked }
    const reply = await onInterviewAnswerSubmit(
      deps,
      config,
      interviewId,
      msg.userId,
      msg.text,
      seen,
      opts,
    )
    deps.log(`${tag}: interview ${String(interviewId)}: ${outcome(reply)}`)
    return
  }

  const personId = await deps.store.findOpenQuestionInThread(msg.threadId, msg.userId)
  if (personId === null) {
    deps.log(`${tag}: not taken (no open question for this user here)`)
    await insultFromThread(deps, msg, tag)
    return
  }
  const person = await deps.store.getScrumPerson(personId)
  if (person === null) {
    deps.log(`${tag}: not taken (person ${String(personId)} not found)`)
    return
  }
  const problem = replyTargetProblem(
    msg.reference,
    `press:answer:${String(personId)}`,
    person.discordUserId,
    person.currentQuestion,
  )
  if (problem !== null) {
    deps.log(`${tag}: not taken (person ${String(personId)}: ${problem})`)
    await insultFromThread(deps, msg, tag)
    return
  }
  const seen = { questionsAsked: person.questionsAsked, followupsAsked: person.followupsAsked }
  const reply = await onAnswerSubmit(deps, config, personId, msg.userId, msg.text, seen, opts)
  deps.log(`${tag}: person ${String(personId)}: ${outcome(reply)}`)
}
