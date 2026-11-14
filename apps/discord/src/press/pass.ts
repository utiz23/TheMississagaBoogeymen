import { REPORTERS, planBuzz, type NewsFactsResponse, type ReporterId } from '@eanhl/db/news'
import type {
  GmNoteUpdate,
  MirrorDeletion,
  NewNewsGmAsk,
  NewNewsGmNote,
  NewNewsScrum,
  NewNewsScrumAnswer,
  NewNewsScrumPerson,
  NewNewsUsage,
  NewsGmAskRow,
  NewsGmNoteRow,
  NewsItemRow,
  NewsScrumPersonRow,
  NewsPressSettingsRow,
  NewsScrumRow,
  PressNote,
  PressRosterEntry,
  PressQuote,
  ReactionItem,
  RecapItemWithoutScrum,
  ScrumAnswerEntry,
  ScrumPersonDetail,
  ScrumPersonUpdate,
  ScrumPersonWithScrum,
} from '@eanhl/db/queries'
import { acceptButton, type BotMessage } from '../bot-rest.ts'
import { payloadForItem, toBotMessage } from '../news/messages.ts'
import type { ModelCall } from '../news/writer.ts'
import { fallbackLine } from './fallbacks.ts'
import type { MessageScreen } from './hard-lines.ts'
import type { PressConfig } from './config.ts'
import { runInterviewPass } from './interview-pass.ts'
import { threadLine } from './question.ts'
import {
  PRESS_ACCEPT_MS,
  PRESS_ANSWER_MS,
  PRESS_GM_PING_DELAY_MS,
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
 * The press timer pass (every 15 s in the `press` process); the question step
 * the button handlers share is in question.ts. All state is in the database: a restart
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
  /** The GM's active `/gm ask` rows on the match, oldest first. */
  gmAsksForMatch(matchId: number, includeTest: boolean): Promise<NewsGmAskRow[]>
  /** The newest active `/gm ask` for this player on the match, or null. */
  gmAskForPlayer(
    matchId: number,
    playerId: number,
    includeTest: boolean,
  ): Promise<NewsGmAskRow | null>
  insertGmAsk(values: NewNewsGmAsk): Promise<number>
  consumeNextHeat(): Promise<Heat | null>
  listDisabledReporters(): Promise<ReporterId[]>
  lastScrumReporter(): Promise<ReporterId | null>
  insertScrum(values: NewNewsScrum): Promise<number | null>
  insertScrumPerson(values: NewNewsScrumPerson): Promise<number | null>
  /** Automatic and command pings tonight (the ping limit); GM pings are not counted. */
  countLimitedPingsTonight(playerId: number, night: string): Promise<number>
  countCommandUsesTonight(userId: string, night: string): Promise<number>
  getPlayerDiscordUserId(playerId: number): Promise<string | null>
  listPeopleToPing(): Promise<ScrumPersonDetail[]>
  getScrumPerson(id: number): Promise<ScrumPersonDetail | null>
  /** The person with a question open for this user in this thread (a typed answer), or null. */
  findOpenQuestionInThread(threadId: string, userId: string): Promise<number | null>
  claimPing(personId: number): Promise<boolean>
  /** Never with an empty patch: the query throws. */
  updateScrumPerson(id: number, patch: ScrumPersonUpdate): Promise<void>
  listExpiredPings(now: Date): Promise<ScrumPersonWithScrum[]>
  listExpiredQuestions(now: Date): Promise<ScrumPersonWithScrum[]>
  expireScrumPerson(id: number, from: 'pinged' | 'asking', cutoff: Date | null): Promise<boolean>
  listScrumAnswers(personId: number): Promise<ScrumAnswerEntry[]>
  /** The questions the scrum put to other people (answered and open), oldest first: no repeated angle. */
  listScrumQuestions(scrumId: number, exceptPersonId: number): Promise<string[]>
  /** Sets the panel once, while it is empty. True when this call set it. */
  setScrumPersonPanel(id: number, panel: ReporterId[], targetTotal: number | null): Promise<boolean>
  findScrumPerson(scrumId: number, playerId: number): Promise<NewsScrumPersonRow | null>
  insertScrumAnswer(values: NewNewsScrumAnswer): Promise<number>
  setScrumThread(scrumId: number, threadId: string): Promise<boolean>
  claimScrumQuestion(args: {
    personId: number
    questionsAsked: number
    question: string
    at: Date
  }): Promise<boolean>
  acceptScrumPerson(personId: number, cutoff: Date, at: Date): Promise<boolean>
  claimScrumAnswer(args: {
    personId: number
    questionsAsked: number
    followupsAsked: number
    at: Date
  }): Promise<boolean>
  getPlayerForDiscordUser(userId: string): Promise<{ playerId: number; name: string } | null>
  latestScrumItem(args: {
    playerId: number | null
    since: Date
    isTest: boolean
  }): Promise<number | null>
  nightPressMaterial(
    night: string,
    includeTest: boolean,
  ): Promise<{ quotes: PressQuote[]; gmNotes: PressNote[] }>
  monthNewsSpendUsd(now: Date): Promise<number>
  recordNewsUsage(row: NewNewsUsage): Promise<void>
  // GM controls (gm.ts)
  latestPressNight(since: Date): Promise<string | null>
  listPressRoster(): Promise<PressRosterEntry[]>
  insertGmNote(values: NewNewsGmNote): Promise<number>
  getGmNote(id: number): Promise<NewsGmNoteRow | null>
  /** False when the note is gone or cancelled. Never with an empty patch. */
  updateGmNote(id: number, patch: GmNoteUpdate): Promise<boolean>
  upsertAlias(alias: string, playerId: number): Promise<void>
  scrumForMatch(matchId: number, isTest: boolean): Promise<NewsScrumRow | null>
  countGmPingsTonight(playerId: number, night: string, includeTest: boolean): Promise<number>
  /** False when there was no waiting GM person (none, or already pinged). */
  expireUnpingedGmPerson(scrumId: number, playerId: number): Promise<boolean>
  setHeat(heat: Heat, scope: 'next' | 'night', night: string | null): Promise<void>
  // Fan reactions (reactions.ts)
  findReactionItem(messageId: string, mode: 'trial' | 'live'): Promise<ReactionItem | null>
  /** True when this person had not voted for the item before. */
  insertReactionVote(itemId: number, userId: string): Promise<boolean>
  countReactionPeople(itemId: number): Promise<number>
  countReactionTriggersTonight(night: string): Promise<number>
  /** The item id; null when the item already has a trigger. */
  insertReactionTrigger(args: {
    itemId: number
    night: string
    isTest: boolean
  }): Promise<number | null>
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
  /**
   * T5, hard lines: the model check every player message passes before any reaction
   * (`screenMessage` in hard-lines.ts adds the code layer and fails closed). Absent (the
   * process): the default check on `call` and the store (`makeMessageScreen`); tests inject one.
   */
  screen?: MessageScreen
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

/** Recap items whose scrum failed, per deps (one process): each is logged once. */
const failedScrumItems = new WeakMap<PressDeps, Set<number>>()
/** The month each deps last logged that scrums stopped for the budget (`YYYY-MM`). */
const budgetStopMonth = new WeakMap<PressDeps, string>()

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
  /** The heat for a new scrum. A `next` heat is only read here; it is used up after the insert. */
  async function heatFor(night: string): Promise<{ heat: Heat; next: boolean }> {
    const settings = await store.getPressSettings()
    if (settings.heatScope === 'next') return { heat: settings.heat, next: true }
    return { heat: settings.heatNight === night ? settings.heat : 'normal', next: false }
  }

  /** A failing recap item is retried every pass but logged once per process. */
  function logItemOnce(itemId: number, text: string): void {
    let seen = failedScrumItems.get(deps)
    if (seen === undefined) failedScrumItems.set(deps, (seen = new Set()))
    if (seen.has(itemId)) return
    seen.add(itemId)
    log(`[press] scrums: item ${String(itemId)}: ${text}`)
  }

  async function createScrum(item: RecapItemWithoutScrum): Promise<void> {
    const tag = `item ${String(item.itemId)}`
    if (item.matchId === null) {
      logItemOnce(item.itemId, 'no match, no scrum')
      return
    }
    const matchId = item.matchId
    const res = await deps.fetchFacts('game', String(matchId))
    const game = res.facts.games.find((g) => g.matchId === matchId)
    if (game === undefined) throw new Error('the game is not on its fact sheet')
    const plan = planBuzz(game, res.facts)
    const asks = await store.gmAsksForMatch(matchId, trial)
    const gmAsk = (await store.gmAskForMatch(matchId, trial)) ?? asks[0]?.playerId ?? null

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
    const setHeat = await heatFor(night)
    const { heat, lowered } = effectiveHeat(setHeat.heat, pick?.pressLevel ?? 'full')
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
    if (setHeat.next) await store.consumeNextHeat()

    // The extras budget is spent (80%): the scrum stays empty, so nobody is
    // pinged and the night recap does not wait for it.
    const now = deps.now()
    if (!extrasBudgetLeft(await store.monthNewsSpendUsd(now), config.monthlyLimitUsd)) {
      const month = now.toISOString().slice(0, 7)
      if (budgetStopMonth.get(deps) !== month) {
        budgetStopMonth.set(deps, month)
        log(`[press] scrums: extras budget for ${month} is spent; scrums ask nobody`)
      }
      return
    }

    // The GM's `/gm ask` players join as GM requests (pinged after the usual 60 s).
    // The pick below may be one of them: the unique (scrum, player) joins them once.
    const candidates = scrumCandidates(game, res.facts, discordIds)
    for (const ask of asks) {
      if (pick !== null && ask.playerId === pick.playerId) continue
      const c = candidates.find((x) => x.playerId === ask.playerId)
      if (c === undefined || c.discordUserId === null) continue
      await store.insertScrumPerson({
        scrumId,
        playerId: c.playerId,
        discordUserId: c.discordUserId,
        role: 'picked',
        requestedBy: 'gm',
        requestedByUserId: ask.requestedByUserId,
      })
    }

    if (pick === null || pick.discordUserId === null) return
    const gmAsked = gmAsk !== null && pick.playerId === gmAsk
    if (!shouldPing(plan.level, gmAsked)) return
    if (
      !gmAsked &&
      (await store.countLimitedPingsTonight(pick.playerId, night)) >= PRESS_PING_LIMIT
    ) {
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
        logItemOnce(item.itemId, reason(err))
      }
    }
  })

  // ── 4. Pings: claim, then reply under the scrum message ───────────────────
  await step('pings', async () => {
    const gmReadyBefore = deps.now().getTime() - PRESS_GM_PING_DELAY_MS
    for (const p of await store.listPeopleToPing()) {
      // A GM ping waits a minute: the GM may still correct or cancel the note.
      if (p.requestedBy === 'gm' && p.createdAt.getTime() > gmReadyBefore) continue
      if (!(await store.claimPing(p.id))) continue
      try {
        const scrum = p.scrum
        // Open trial (operator, 2026-11-13): the picked person is pinged, in the
        // bot test channel; the line says it is a trial.
        const target = p.discordUserId
        const text = `<@${target}> — ${reporterName(scrum.reporter)} has a question for you about tonight's game.`
        const messageId = await discord.send(scrum.reporter, scrum.channelId, {
          content: scrum.isTest ? `(trial) ${text}` : text,
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

  // ── 5. Expired accepts: no accept in 15 minutes ────────────────────────────
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
        // A line of the reporter's own pool: never the one stock line again in the same thread.
        const line = fallbackLine(deps, {
          scrumId: p.scrumId,
          kind: 'closing',
          reporter: p.reporter,
          name: '',
          seed: p.id,
        })
        await discord.send(p.reporter, p.threadId, threadLine(p.discordUserId, line))
      } catch (err: unknown) {
        // Closed: the line is never sent again.
        log(`[press] expired answers: person ${String(p.id)}: ${reason(err)}`)
      }
    }
  })

  // ── 7. Interviews (interview-pass.ts): offers, expiry, automatic offer, articles ──
  await step('interviews', async () => {
    await runInterviewPass(deps, config)
  })

  return summary
}
