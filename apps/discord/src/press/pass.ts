import { REPORTERS, planBuzz, type NewsFactsResponse, type ReporterId } from '@eanhl/db/news'
import type {
  MirrorDeletion,
  NewNewsScrum,
  NewNewsScrumAnswer,
  NewNewsScrumPerson,
  NewNewsUsage,
  NewsItemRow,
  NewsPressSettingsRow,
  NewsScrumRow,
  PressNote,
  PressQuote,
  RecapItemWithoutScrum,
  ScrumPersonDetail,
  ScrumPersonUpdate,
  ScrumPersonWithScrum,
} from '@eanhl/db/queries'
import { acceptButton, answerButton, type BotMessage } from '../bot-rest.ts'
import { escapeMarkdown } from '../message.ts'
import { costUsd } from '../news/cost.ts'
import { payloadForItem, toBotMessage } from '../news/messages.ts'
import type { ModelCall } from '../news/writer.ts'
import {
  FALLBACK_CLOSING,
  FALLBACK_QUESTION,
  askQuestion,
  type ScrumHistoryEntry,
} from './asker.ts'
import type { PressConfig } from './config.ts'
import {
  PRESS_ACCEPT_MS,
  PRESS_ANSWER_MS,
  PRESS_OPEN_MS,
  PRESS_PING_LIMIT,
  chooseScrumReporter,
  effectiveHeat,
  extrasBudgetLeft,
  pickScrumPlayer,
  scrumCandidates,
  shouldPing,
  type Heat,
} from './rules.ts'

/**
 * The press timer pass (every 15 s in the `press` process) and the question
 * step the button handlers share. All state is in the database: a restart
 * rebuilds from the rows and timestamps. Every message that a second pass
 * could send again is claimed in the database first (the unique scrum per
 * recap item, `claimPing`, `claimScrumQuestion`, `expireScrumPerson`).
 */

/** The database side of the press (`pressDbStore` in store.ts). */
export interface PressStore {
  getPressSettings(): Promise<NewsPressSettingsRow>
  setMirrorFrom(itemId: number): Promise<boolean>
  newestNewsItemId(): Promise<number | null>
  listItemsToMirror(afterId: number, limit: number): Promise<NewsItemRow[]>
  insertMirror(args: { itemId: number; channelId: string; messageId: string }): Promise<void>
  listMirrorDeletions(limit: number): Promise<MirrorDeletion[]>
  markMirrorDeleted(itemId: number): Promise<void>
  getNewsItem(id: number): Promise<NewsItemRow | null>
  listRecapItemsWithoutScrum(args: {
    since: Date
    mode: 'trial' | 'live'
    limit: number
  }): Promise<RecapItemWithoutScrum[]>
  scrumByRecapItem(itemId: number): Promise<NewsScrumRow | null>
  gmAskForMatch(matchId: number, includeTest: boolean): Promise<number | null>
  consumeNextHeat(): Promise<Heat | null>
  listDisabledReporters(): Promise<ReporterId[]>
  lastScrumReporter(): Promise<ReporterId | null>
  insertScrum(values: NewNewsScrum): Promise<number | null>
  insertScrumPerson(values: NewNewsScrumPerson): Promise<number | null>
  countAutoPingsTonight(playerId: number, night: string): Promise<number>
  countCommandUsesTonight(userId: string, night: string): Promise<number>
  getPlayerDiscordUserId(playerId: number): Promise<string | null>
  listPeopleToPing(): Promise<ScrumPersonDetail[]>
  getScrumPerson(id: number): Promise<ScrumPersonDetail | null>
  claimPing(personId: number): Promise<boolean>
  /** Never with an empty patch: the query throws. */
  updateScrumPerson(id: number, patch: ScrumPersonUpdate): Promise<void>
  listExpiredPings(now: Date): Promise<ScrumPersonWithScrum[]>
  listExpiredQuestions(now: Date): Promise<ScrumPersonWithScrum[]>
  expireScrumPerson(id: number, from: 'pinged' | 'asking', cutoff: Date): Promise<boolean>
  listScrumAnswers(
    personId: number,
  ): Promise<{ question: string; answer: string; usability: 'usable' | 'joke' | 'unusable' }[]>
  insertScrumAnswer(values: NewNewsScrumAnswer): Promise<number>
  setScrumThread(scrumId: number, threadId: string): Promise<boolean>
  claimScrumQuestion(args: {
    personId: number
    questionsAsked: number
    question: string
    at: Date
  }): Promise<boolean>
  nightPressMaterial(
    night: string,
    includeTest: boolean,
  ): Promise<{ quotes: PressQuote[]; gmNotes: PressNote[] }>
  monthNewsSpendUsd(now: Date): Promise<number>
  recordNewsUsage(row: NewNewsUsage): Promise<void>
}

/** The bots' Discord side. Errors name a status only, never a token. */
export interface PressDiscordOps {
  send(reporter: ReporterId, channelId: string, msg: BotMessage): Promise<string>
  edit(
    reporter: ReporterId,
    channelId: string,
    messageId: string,
    msg: Partial<BotMessage>,
  ): Promise<void>
  remove(reporter: ReporterId, channelId: string, messageId: string): Promise<void>
  thread(reporter: ReporterId, channelId: string, messageId: string, name: string): Promise<string>
  dm(userId: string, content: string): Promise<void>
}

export interface PressDeps {
  store: PressStore
  discord: PressDiscordOps
  fetchFacts: (kind: 'game' | 'night', key: string) => Promise<NewsFactsResponse>
  call: ModelCall
  log: (m: string) => void
  now: () => Date
}

export interface PressPassSummary {
  mirrored: number
  mirrorsDeleted: number
  scrums: number
  pings: number
  expiredPings: number
  closedQuestions: number
  /** Steps that stopped on an error (each logged once). */
  failedSteps: string[]
}

/** Recap items newer than this get a scrum. */
export const SCRUM_SOURCE_WINDOW_MS = 6 * 3_600_000
const SCRUM_ITEM_LIMIT = 5
const MIRROR_LIMIT = 10

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const reporterName = (id: ReporterId): string => REPORTERS[id].name

/** The month each deps last logged the spent extras budget (`YYYY-MM`): once a month. */
const budgetNoticeMonth = new WeakMap<PressDeps, string>()

export async function runPressPass(
  deps: PressDeps,
  config: PressConfig,
): Promise<PressPassSummary> {
  const { store, discord, log } = deps
  const trial = config.mode === 'trial'
  const summary: PressPassSummary = {
    mirrored: 0,
    mirrorsDeleted: 0,
    scrums: 0,
    pings: 0,
    expiredPings: 0,
    closedQuestions: 0,
    failedSteps: [],
  }

  async function step(name: string, run: () => Promise<void>): Promise<void> {
    try {
      await run()
    } catch (err: unknown) {
      summary.failedSteps.push(name)
      log(`[press] ${name}: ${reason(err)}`)
    }
  }

  // ── 1. Mirror (trial only): copy new items into the test channel ──────────
  await step('mirror', async () => {
    if (!trial) return
    let from = (await store.getPressSettings()).mirrorFromItemId
    if (from === null) {
      // First pass: start after the newest item, so history is never mirrored.
      const newest = (await store.newestNewsItemId()) ?? 0
      await store.setMirrorFrom(newest)
      from = (await store.getPressSettings()).mirrorFromItemId ?? newest
    }
    const now = deps.now()
    for (const item of await store.listItemsToMirror(from, MIRROR_LIMIT)) {
      // An item not due yet waits, and the items after it wait too (order).
      if (item.sendAfter !== null && item.sendAfter > now) break
      let replyToName: string | null = null
      if (item.kind !== 'article' && item.replyTo !== null) {
        const to = await store.getNewsItem(item.replyTo)
        if (to !== null) replyToName = reporterName(to.reporter)
      }
      const msg = toBotMessage(
        payloadForItem(item, config.siteUrl, replyToName),
        item.isGameRecap ? item.id : null,
      )
      const messageId = await discord.send(item.reporter, config.channelId, msg)
      await store.insertMirror({ itemId: item.id, channelId: config.channelId, messageId })
      summary.mirrored++
    }
  })

  // ── 2. Mirror deletions: a deleted item's copy goes too ───────────────────
  await step('mirror deletions', async () => {
    for (const d of await store.listMirrorDeletions(MIRROR_LIMIT)) {
      const item = await store.getNewsItem(d.itemId)
      if (item === null) continue
      await discord.remove(item.reporter, d.channelId, d.messageId)
      await store.markMirrorDeleted(d.itemId)
      summary.mirrorsDeleted++
    }
  })

  // ── 3. New scrums: one per game recap ─────────────────────────────────────
  async function heatFor(night: string): Promise<Heat> {
    const settings = await store.getPressSettings()
    if (settings.heatScope === 'next') return (await store.consumeNextHeat()) ?? 'normal'
    return settings.heatNight === night ? settings.heat : 'normal'
  }

  async function createScrum(item: RecapItemWithoutScrum): Promise<void> {
    const tag = `item ${String(item.itemId)}`
    if (item.matchId === null) {
      log(`[press] scrums: ${tag}: no match, no scrum`)
      return
    }
    const matchId = item.matchId
    const res = await deps.fetchFacts('game', String(matchId))
    const game = res.facts.games.find((g) => g.matchId === matchId)
    if (game === undefined) throw new Error('the game is not on its fact sheet')
    const plan = planBuzz(game, res.facts)
    const gmAsk = await store.gmAskForMatch(matchId, trial)

    const discordIds = new Map<number, string>()
    for (const line of game.players) {
      const id = await store.getPlayerDiscordUserId(line.playerId)
      if (id !== null) discordIds.set(line.playerId, id)
    }
    const pick = pickScrumPlayer(
      scrumCandidates(game, res.facts, discordIds),
      res.facts.topFacts,
      gmAsk,
    )
    const night = item.night ?? game.night
    const { heat, lowered } = effectiveHeat(await heatFor(night), pick?.pressLevel ?? 'full')
    const reporter = chooseScrumReporter({
      heat,
      seed: item.itemId,
      disabled: await store.listDisabledReporters(),
      lastScrumReporter: await store.lastScrumReporter(),
      takeReporters:
        pick === null
          ? []
          : res.takes
              .filter((t) => t.playerId === pick.playerId)
              .flatMap((t) => [t.reporter, ...t.critics]),
    })
    // The unique recap item is the claim: a second pass inserts nothing.
    const scrumId = await store.insertScrum({
      matchId,
      night,
      recapItemId: item.itemId,
      channelId: item.channelId,
      messageId: item.messageId,
      reporter,
      heat,
      buzzLevel: plan.level,
      openUntil: new Date(item.createdAt.getTime() + PRESS_OPEN_MS),
      isTest: trial,
    })
    if (scrumId === null) return
    summary.scrums++

    if (pick === null || pick.discordUserId === null) return
    const gmAsked = gmAsk !== null && pick.playerId === gmAsk
    if (!shouldPing(plan.level, gmAsked)) return
    if (!gmAsked && (await store.countAutoPingsTonight(pick.playerId, night)) >= PRESS_PING_LIMIT) {
      log(
        `[press] scrums: ${tag}: player ${String(pick.playerId)} had ${String(PRESS_PING_LIMIT)} pings tonight, no ping`,
      )
      return
    }
    const personId = await store.insertScrumPerson({
      scrumId,
      playerId: pick.playerId,
      discordUserId: pick.discordUserId,
      role: 'picked',
      requestedBy: gmAsked ? 'gm' : 'auto',
    })
    if (personId !== null && lowered) {
      try {
        await discord.dm(
          config.gmUserId,
          `Heat for ${pick.name}'s scrum lowered to Normal (Go easy).`,
        )
      } catch (err: unknown) {
        log(`[press] scrums: ${tag}: heat DM failed (${reason(err)})`)
      }
    }
  }

  await step('scrums', async () => {
    const since = new Date(deps.now().getTime() - SCRUM_SOURCE_WINDOW_MS)
    const items = await store.listRecapItemsWithoutScrum({
      since,
      mode: config.mode,
      limit: SCRUM_ITEM_LIMIT,
    })
    for (const item of items) {
      try {
        await createScrum(item)
      } catch (err: unknown) {
        log(`[press] scrums: item ${String(item.itemId)}: ${reason(err)}`)
      }
    }
  })

  // ── 4. Pings: claim, then reply under the scrum message ───────────────────
  await step('pings', async () => {
    for (const p of await store.listPeopleToPing()) {
      if (!(await store.claimPing(p.id))) continue
      try {
        const scrum = p.scrum
        // Trial (or a scrum left over from the trial): the ping goes to the GM.
        const toGm = trial || scrum.isTest
        const target = toGm ? config.gmUserId : p.discordUserId
        const text = `<@${target}> — ${reporterName(scrum.reporter)} has a question for you about tonight's game.`
        const messageId = await discord.send(scrum.reporter, scrum.channelId, {
          content: toGm ? `test — would ping ${escapeMarkdown(p.name)}: ${text}` : text,
          allowed_mentions: { parse: [], users: [target] },
          components: [{ type: 1, components: [acceptButton(p.id)] }],
          message_reference: { message_id: scrum.messageId, fail_if_not_exists: false },
        })
        await store.updateScrumPerson(p.id, { pingMessageId: messageId })
        summary.pings++
      } catch (err: unknown) {
        // Claimed: never sent again. The person expires after the accept window.
        log(`[press] pings: person ${String(p.id)}: ${reason(err)}`)
      }
    }
  })

  // ── 5. Expired accepts: no accept in 5 minutes ────────────────────────────
  await step('expired accepts', async () => {
    const now = deps.now()
    const cutoff = new Date(now.getTime() - PRESS_ACCEPT_MS)
    for (const p of await store.listExpiredPings(now)) {
      if (!(await store.expireScrumPerson(p.id, 'pinged', cutoff))) continue
      summary.expiredPings++
      if (p.pingMessageId === null) continue
      try {
        await discord.edit(p.reporter, p.channelId, p.pingMessageId, { components: [] })
      } catch {
        // The button refuses a late accept anyway.
      }
    }
  })

  // ── 6. Expired answers: no answer in 15 minutes ───────────────────────────
  await step('expired answers', async () => {
    const now = deps.now()
    const cutoff = new Date(now.getTime() - PRESS_ANSWER_MS)
    for (const p of await store.listExpiredQuestions(now)) {
      if (!(await store.expireScrumPerson(p.id, 'asking', cutoff))) continue
      summary.closedQuestions++
      if (p.threadId === null) continue
      try {
        await discord.send(p.reporter, p.threadId, {
          content: FALLBACK_CLOSING,
          allowed_mentions: { parse: [] },
        })
      } catch (err: unknown) {
        // Closed: the line is never sent again.
        log(`[press] expired answers: person ${String(p.id)}: ${reason(err)}`)
      }
    }
  })

  return summary
}

/**
 * Ask the person's next question. Loads the game sheet, the person's name and
 * press level (`facts.people`), the match's active GM notes, the takes and
 * the person's earlier answers; writes the question (or the fallback when
 * the extras budget is spent, the person is not on the sheet, or anything
 * fails); creates the thread on the scrum message when it has none
 * (`<Reporter> — <player>`); claims the question; posts it with the Answer
 * button. Does nothing for a person who is done or expired.
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
  if (person.status !== 'pinged' && person.status !== 'asking') return
  const scrum = person.scrum
  const reporter = scrum.reporter
  const now = deps.now()
  let name = person.name
  let question: string | null = null

  try {
    question = await writeQuestion()
  } catch (err: unknown) {
    log(`[press] question: person ${String(personId)}: ${reason(err)}`)
  }

  async function writeQuestion(): Promise<string | null> {
    if (scrum.matchId === null) return null
    const matchId = scrum.matchId
    const res = await deps.fetchFacts('game', String(matchId))
    const onSheet = res.facts.people.find((p) => p.playerId === person!.playerId)
    // Never on the sheet (a guest, or "Leave me out"): nothing about them goes to the model.
    if (onSheet === undefined) return null
    name = onSheet.name
    if (!extrasBudgetLeft(await store.monthNewsSpendUsd(now), config.monthlyLimitUsd)) {
      const month = now.toISOString().slice(0, 7)
      if (budgetNoticeMonth.get(deps) !== month) {
        budgetNoticeMonth.set(deps, month)
        log(`[press] budget: extras budget for ${month} is spent; scrum questions use the fallback`)
      }
      return null
    }
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
        gmNotes: material.gmNotes.filter((n) => n.matchId === matchId).map((n) => n.note),
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

  const text = question ?? FALLBACK_QUESTION(name)
  let threadId = scrum.threadId
  if (threadId === null) {
    const created = await discord.thread(
      reporter,
      scrum.channelId,
      scrum.messageId,
      `${reporterName(reporter)} — ${name}`,
    )
    threadId = (await store.setScrumThread(scrum.id, created))
      ? created
      : ((await store.getScrumPerson(personId))?.scrum.threadId ?? created)
  }
  const claimed = await store.claimScrumQuestion({
    personId,
    questionsAsked: person.questionsAsked,
    question: text,
    at: now,
  })
  if (!claimed) return
  await discord.send(reporter, threadId, {
    content: escapeMarkdown(text),
    allowed_mentions: { parse: [] },
    components: [{ type: 1, components: [answerButton(personId)] }],
  })
}
