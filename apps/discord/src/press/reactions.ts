import { reactionItemText } from '../news/prompts.ts'
import type { PressConfig } from './config.ts'
import type { PressDeps } from './pass.ts'
import { extrasBudgetLeft } from './rules.ts'

/**
 * Fan reactions (spec §7): when a reporter post or article in the channel gets
 * reactions from at least 3 different people, another reporter posts one
 * follow-up reply. The press process only counts: one vote per person per
 * item (any emoji; removing a reaction does not undo it), and at the third
 * person a trigger row. The news cycle writes the follow-up (`reactionPass`).
 * Trial: votes count on the mirror messages; an item of the live news desk
 * gets no trigger, the GM gets a DM instead.
 */

/** This many different people earn an item a follow-up. */
export const REACTION_PEOPLE = 3
/** At most this many follow-ups a night (test and live together). */
export const REACTION_NIGHT_LIMIT = 2
/** An item older than this gets no follow-up. */
export const REACTION_MAX_AGE_MS = 24 * 3_600_000
const PREVIEW_CHARS = 60

/** Items whose trial DM went out, per deps (one process). */
const previewed = new WeakMap<PressDeps, Set<number>>()

/** One reaction added on a message. Never a correction, a follow-up or an old item. */
export async function onReaction(
  deps: PressDeps,
  config: PressConfig,
  args: { channelId: string; messageId: string; userId: string; userIsBot: boolean },
): Promise<void> {
  const { store } = deps
  if (args.userIsBot || args.channelId !== config.channelId) return
  const item = await store.findReactionItem(args.messageId, config.mode)
  if (item === null) return
  // The same person again (another emoji, or after a removal) changes nothing.
  if (!(await store.insertReactionVote(item.id, args.userId))) return

  // A weekly piece has no night and no game sheet to follow up from.
  if (item.isCorrection || item.jobKind === 'reaction' || item.night === null) return
  const now = deps.now()
  if (now.getTime() - item.createdAt.getTime() > REACTION_MAX_AGE_MS) return
  if ((await store.countReactionPeople(item.id)) < REACTION_PEOPLE) return
  if ((await store.countReactionTriggersTonight(item.night)) >= REACTION_NIGHT_LIMIT) return
  if (!extrasBudgetLeft(await store.monthNewsSpendUsd(now), config.monthlyLimitUsd)) return

  if (config.mode === 'trial' && !item.isTest) {
    // The news desk is live (webhook): a test must not write a real follow-up.
    let seen = previewed.get(deps)
    if (seen === undefined) previewed.set(deps, (seen = new Set()))
    if (seen.has(item.id)) return
    seen.add(item.id)
    const preview = reactionItemText(item).slice(0, PREVIEW_CHARS)
    await deps.discord.dm(config.gmUserId, `Test: "${preview}" would get a fan follow-up.`)
    return
  }
  const id = await store.insertReactionTrigger({
    itemId: item.id,
    night: item.night,
    isTest: item.isTest,
  })
  if (id !== null) deps.log(`[press] reactions: item ${String(id)}: fans reacted, follow-up due`)
}
