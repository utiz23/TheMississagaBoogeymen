import { interviewSlugKey, type ReporterId } from '@eanhl/db/news'
import type { InterviewDetail } from '@eanhl/db/queries'
import { articleSlug } from '../news/messages.ts'
import { NEWS_RULES_VERSION } from '../news/rules-version.ts'
import type { PressConfig } from './config.ts'
import { articleBody, writeInterviewArticle, type OfferedAnswer } from './interview-asker.ts'
import {
  INTERVIEW_ANSWER_MS,
  INTERVIEW_AUTO_LIMIT_MS,
  INTERVIEW_AUTO_SOURCE_MS,
  INTERVIEW_OFFER_MS,
  articleAllowed,
  chooseInterviewReporter,
  pickAutoStory,
} from './interview-rules.ts'
import type { InterviewStore } from './interview-store.ts'
import { closeExpired, interviewStore, offerMessage } from './interview.ts'
import type { PressDeps, PressStore } from './pass.ts'
import { pressRecorder } from './question.ts'
import { extrasBudgetLeft } from './rules.ts'

/**
 * The interview part of the press timer pass (called from `runPressPass`,
 * one step). In order: make the automatic offer after a night with a
 * milestone or a "Historic" game, post the offers that wait (GM and
 * automatic), end offers nobody accepted in 30 minutes, close interviews
 * with no answer in 30 minutes, and write the articles of finished interviews. All state
 * is in the database; each send is claimed first. A store without the
 * interview methods does nothing.
 */

export interface InterviewPassSummary {
  offers: number
  expiredOffers: number
  closed: number
  autoOffers: number
  articles: number
  skippedArticles: number
  failedArticles: number
}

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Nights already checked for an automatic offer, per deps (one process): each is read once. */
const autoChecked = new WeakMap<PressDeps, Set<string>>()

/** A stable seed from a night key (`YYYY-MM-DD`). */
function nightSeed(night: string): number {
  let h = 0
  for (const ch of night) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0
  return h
}

export async function runInterviewPass(
  deps: PressDeps,
  config: PressConfig,
): Promise<InterviewPassSummary> {
  const summary: InterviewPassSummary = {
    offers: 0,
    expiredOffers: 0,
    closed: 0,
    autoOffers: 0,
    articles: 0,
    skippedArticles: 0,
    failedArticles: 0,
  }
  const st = interviewStore(deps)
  if (st === null) return summary
  const { log } = deps
  const trial = config.mode === 'trial'

  async function part(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run()
    } catch (err: unknown) {
      log(`[press] interviews ${name}: ${reason(err)}`)
    }
  }

  // ── The automatic offer: a night with a milestone or a Historic game ───────
  await part('automatic offer', async () => {
    const now = deps.now()
    if (!extrasBudgetLeft(await st.monthNewsSpendUsd(now), config.monthlyLimitUsd)) return
    const night = await st.nightForAutoInterview(
      new Date(now.getTime() - INTERVIEW_AUTO_SOURCE_MS),
      trial,
    )
    if (night === null) return
    let seen = autoChecked.get(deps)
    if (seen === undefined) autoChecked.set(deps, (seen = new Set()))
    if (seen.has(night)) return
    seen.add(night)
    const since = new Date(now.getTime() - INTERVIEW_AUTO_LIMIT_MS)
    if ((await st.countAutoInterviewsSince(since, trial)) > 0) return
    const res = await deps.fetchFacts('night', night)
    const linked = new Map<number, string>()
    for (const p of res.facts.people) {
      const id = await st.getPlayerDiscordUserId(p.playerId)
      if (id !== null) linked.set(p.playerId, id)
    }
    const story = pickAutoStory(res.facts, (id) => linked.has(id))
    if (story === null) return
    const reporter: ReporterId | null = chooseInterviewReporter({
      seed: nightSeed(night),
      disabled: await st.listDisabledReporters(),
      lastReporter: await st.lastInterviewReporter(),
      takeReporters: res.takes
        .filter((t) => t.playerId === story.playerId)
        .flatMap((t) => [t.reporter, ...t.critics]),
    })
    if (reporter === null) return
    const id = await st.insertInterview({
      playerId: story.playerId,
      discordUserId: linked.get(story.playerId)!,
      reporter,
      trigger: 'auto',
      status: 'offered',
      night,
      channelId: config.channelId,
      isTest: trial,
    })
    if (id === null) return
    summary.autoOffers++
    log(
      `[press] interview ${String(id)}: automatic offer for player ${String(story.playerId)} (${story.why}, night ${night})`,
    )
  })

  // ── Offers: claim, then post with the Accept button ───────────────────────
  await part('offers', async () => {
    for (const iv of await st.listInterviewsToOffer()) {
      if (!(await st.claimInterviewOffer(iv.id, deps.now()))) continue
      try {
        const messageId = await deps.discord.send(iv.reporter, iv.channelId, offerMessage(iv))
        await st.updateInterview(iv.id, { offerMessageId: messageId })
        summary.offers++
      } catch (err: unknown) {
        // Claimed: never sent again. The offer expires after 30 minutes.
        log(`[press] interview ${String(iv.id)}: offer failed (${reason(err)})`)
      }
    }
  })

  // ── Offers nobody accepted in 30 minutes: expired, the button removed ─────
  await part('expired offers', async () => {
    const cutoff = new Date(deps.now().getTime() - INTERVIEW_OFFER_MS)
    for (const iv of await st.listExpiredInterviewOffers(cutoff)) {
      const ended = await st.endInterview({
        id: iv.id,
        from: 'offered',
        to: 'expired',
        cutoff,
        at: deps.now(),
      })
      if (!ended) continue
      summary.expiredOffers++
      if (iv.offerMessageId === null) continue
      try {
        await deps.discord.edit(iv.reporter, iv.channelId, iv.offerMessageId, { components: [] })
      } catch {
        // The button refuses a late accept anyway.
      }
    }
  })

  // ── No answer (or no next line) in 30 minutes: the reporter closes ────────
  await part('expired questions', async () => {
    const cutoff = new Date(deps.now().getTime() - INTERVIEW_ANSWER_MS)
    for (const iv of await st.listExpiredInterviewQuestions(cutoff)) {
      if (await closeExpired(deps, st, iv, cutoff)) summary.closed++
    }
  })

  // ── Articles of finished interviews ───────────────────────────────────────
  await part('articles', async () => {
    for (const iv of await st.listInterviewsForArticle()) {
      if (!(await st.claimInterviewArticle(iv.id))) continue
      try {
        const out = await writeArticle(deps, config, st, iv)
        if (out === 'written') summary.articles++
        else if (out === 'skipped') summary.skippedArticles++
        else summary.failedArticles++
      } catch (err: unknown) {
        summary.failedArticles++
        log(`[press] interview ${String(iv.id)}: article: ${reason(err)}`)
        await st.finishInterviewArticle(iv.id, 'failed', null)
      }
    }
  })

  return summary
}

/**
 * Write and store one interview's article (claimed, `writing`). Skipped
 * with fewer than 3 usable or joke answers, when the extras budget is spent
 * or when the player is no longer on the sheet. Stored as an article by the
 * interview's reporter (slug `interview-<id>-…`); a real one waits for the
 * news service's delivery pass (`send_after` = now) like other bot items, a
 * test one is posted only by the trial mirror.
 */
async function writeArticle(
  deps: PressDeps,
  config: PressConfig,
  st: PressStore & InterviewStore,
  iv: InterviewDetail,
): Promise<'written' | 'skipped' | 'failed'> {
  const tag = `[press] interview ${String(iv.id)}: article`
  const skip = async (why: string): Promise<'skipped'> => {
    await st.finishInterviewArticle(iv.id, 'skipped', null)
    deps.log(`${tag} skipped (${why})`)
    return 'skipped'
  }
  const answers = await st.listInterviewAnswers(iv.id)
  if (!articleAllowed(answers)) return skip('fewer than 3 usable answers')
  const now = deps.now()
  if (!extrasBudgetLeft(await st.monthNewsSpendUsd(now), config.monthlyLimitUsd)) {
    return skip('extras budget spent')
  }
  const res = await deps.fetchFacts('night', iv.night)
  const person = res.facts.people.find((p) => p.playerId === iv.playerId)
  if (person === undefined) return skip('player not on the sheet')
  const offered: OfferedAnswer[] = answers.flatMap((a) =>
    a.usability === 'unusable'
      ? []
      : [{ question: a.question, answer: a.answer, usability: a.usability }],
  )
  const r = await writeInterviewArticle(
    deps.call,
    {
      facts: res.facts,
      forbiddenNames: res.forbiddenNames,
      takes: res.takes,
      reporter: iv.reporter,
      player: { name: person.name, pressLevel: person.pressLevel },
      topic: iv.topic,
    },
    offered,
    pressRecorder(st),
  )
  if (!r.ok) {
    await st.finishInterviewArticle(iv.id, 'failed', null)
    deps.log(`${tag} failed (${r.reason.slice(0, 300)})`)
    return 'failed'
  }
  const a = r.article
  const itemId = await st.insertNewsItem({
    kind: 'article',
    reporter: iv.reporter,
    slug: articleSlug(interviewSlugKey(iv.id), a.headline),
    headline: a.headline,
    dek: a.dek,
    body: articleBody(a, offered),
    summary: a.dek,
    mentions: [{ name: person.name, playerId: person.playerId }],
    facts: res.facts,
    rulesVersion: NEWS_RULES_VERSION,
    isTest: iv.isTest,
    // A real article goes to Discord through the news service's due pass; a test one never does.
    sendAfter: iv.isTest ? null : now,
  })
  await st.finishInterviewArticle(iv.id, 'written', itemId)
  deps.log(`${tag} written (item ${String(itemId)})`)
  return 'written'
}
