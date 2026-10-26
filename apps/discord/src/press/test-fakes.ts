import type { NewsFactsResponse, ReporterId } from '@eanhl/db/news'
import type {
  GmNoteUpdate,
  NewNewsGmNote,
  NewNewsScrum,
  NewNewsScrumAnswer,
  NewNewsScrumPerson,
  NewNewsUsage,
  NewsGmNoteRow,
  NewsItemRow,
  NewsPressSettingsRow,
  NewsScrumPersonRow,
  NewsScrumRow,
  PressRosterEntry,
  RecapItemWithoutScrum,
  ScrumPersonUpdate,
} from '@eanhl/db/queries'
import type { BotMessage } from '../bot-rest.ts'
import type { ModelCall } from '../news/writer.ts'
import { oct12Response } from '../news/test-fixtures.ts'
import type { PressConfig } from './config.ts'
import { runPressPass, type PressDeps, type PressStore } from './pass.ts'

/**
 * Shared fakes for the press tests: an in-memory press store with the same
 * claim rules as the SQL, a fake Discord that records every call, and a
 * setup that wires them into `PressDeps`.
 */

export const NOW = new Date('2026-10-13T03:00:00.000Z')
export const NIGHT = '2026-10-12'
export const GM = '100000000000000001'
export const USER_A = '200000000000000001'
export const USER_B = '200000000000000002'

export const config = (mode: 'trial' | 'live'): PressConfig => ({
  mode,
  tokens: {} as Record<ReporterId, string>,
  guildId: '300000000000000001',
  channelId: mode === 'live' ? 'chel' : 'test-channel',
  gmUserId: GM,
  internalToken: 'x'.repeat(16),
  webBaseUrl: 'http://web:3000',
  siteUrl: 'https://boogeymen.app',
  model: 'claude-opus-5-5',
  monthlyLimitUsd: 20,
  pollIntervalMs: 15000,
})

export function itemRow(over: Partial<NewsItemRow> & Pick<NewsItemRow, 'id'>): NewsItemRow {
  return {
    jobId: null,
    kind: 'post',
    reporter: 'barlow',
    matchId: 90001,
    night: NIGHT,
    weekStart: null,
    replyTo: null,
    slug: null,
    headline: null,
    dek: null,
    body: `Post ${String(over.id)}`,
    summary: null,
    mentions: [],
    facts: null,
    criticized: [],
    prediction: null,
    featureKind: null,
    receiptVerdict: null,
    zeroCalled: [],
    takesUsed: [],
    rulesVersion: null,
    sendAfter: null,
    isCorrection: false,
    isGameRecap: false,
    isTest: false,
    discordStatus: 'posted',
    discordAttempts: 1,
    discordMessageId: `msg-${String(over.id)}`,
    discordVia: 'bot',
    discordChannelId: 'chel',
    lastError: null,
    deletedAt: null,
    discordDeletedAt: null,
    createdAt: new Date(NOW.getTime() - 10 * 60_000),
    ...over,
  }
}

/** The fixture game made historic (a new club record): a ping-level game. */
export function bigResponse(): NewsFactsResponse {
  const res = oct12Response('game')
  res.facts.games[0] = {
    ...res.facts.games[0]!,
    newRecords: [{ stat: 'goals', name: 'Skater A', value: 30 }],
  }
  return res
}

export const NAMES = new Map([
  [1, 'Skater A'],
  [2, 'Skater B'],
  [3, 'Goalie G'],
])

/** An in-memory press store with the same claim rules as the SQL. */
export class FakeStore implements PressStore {
  settings: NewsPressSettingsRow = {
    id: 1,
    heat: 'normal',
    heatScope: 'night',
    heatNight: null,
    mirrorFromItemId: null,
    updatedAt: new Date(0),
  }
  items: NewsItemRow[] = []
  mirrors: { itemId: number; channelId: string; messageId: string; deletedAt: Date | null }[] = []
  scrums: NewsScrumRow[] = []
  people: NewsScrumPersonRow[] = []
  answers: {
    personId: number
    question: string
    answer: string
    usability: 'usable' | 'joke' | 'unusable'
  }[] = []
  gmAsks = new Map<number, number>()
  discordIds = new Map<number, string>([
    [1, USER_A],
    [2, USER_B],
  ])
  gmNotes: {
    id: number
    playerName: string | null
    note: string
    matchId: number | null
    critical: boolean
  }[] = []
  /** Every stored answer row (insertScrumAnswer also adds to `answers`). */
  answerRows: NewNewsScrumAnswer[] = []
  /** Players of each match (player_match_stats). */
  played = new Map<number, number[]>([
    [90001, [1, 2, 3]],
    [90002, [1, 2, 3]],
  ])
  usage: NewNewsUsage[] = []
  spend = 0
  disabled: ReporterId[] = []

  getPressSettings = () => Promise.resolve({ ...this.settings })
  setMirrorFrom = (itemId: number) => {
    if (this.settings.mirrorFromItemId !== null) return Promise.resolve(false)
    this.settings.mirrorFromItemId = itemId
    return Promise.resolve(true)
  }
  newestNewsItemId = () =>
    Promise.resolve(this.items.length === 0 ? null : Math.max(...this.items.map((i) => i.id)))
  listItemsToMirror = (afterId: number, limit: number) =>
    Promise.resolve(
      this.items
        .filter(
          (i) =>
            i.id > afterId && i.deletedAt === null && !this.mirrors.some((m) => m.itemId === i.id),
        )
        .sort((a, b) => a.id - b.id)
        .slice(0, limit),
    )
  insertMirror = (args: { itemId: number; channelId: string; messageId: string }) => {
    this.mirrors.push({ ...args, deletedAt: null })
    return Promise.resolve()
  }
  listMirrorDeletions = (limit: number) =>
    Promise.resolve(
      this.mirrors
        .filter(
          (m) =>
            m.deletedAt === null && this.items.find((i) => i.id === m.itemId)?.deletedAt != null,
        )
        .slice(0, limit)
        .map(({ itemId, channelId, messageId }) => ({ itemId, channelId, messageId })),
    )
  markMirrorDeleted = (itemId: number) => {
    const m = this.mirrors.find((x) => x.itemId === itemId)
    if (m) m.deletedAt = NOW
    return Promise.resolve()
  }
  getNewsItem = (id: number) => Promise.resolve(this.items.find((i) => i.id === id) ?? null)
  listRecapItemsWithoutScrum = (args: { since: Date; mode: 'trial' | 'live'; limit: number }) => {
    const out: RecapItemWithoutScrum[] = []
    for (const n of [...this.items].sort((a, b) => a.id - b.id)) {
      if (!n.isGameRecap || n.deletedAt !== null || n.createdAt <= args.since) continue
      if (this.scrums.some((s) => s.recapItemId === n.id)) continue
      const mirror = this.mirrors.find((m) => m.itemId === n.id && m.deletedAt === null)
      if (args.mode === 'trial' && !mirror) continue
      if (args.mode === 'live' && (n.isTest || n.discordStatus !== 'posted')) continue
      out.push({
        itemId: n.id,
        matchId: n.matchId,
        night: n.night,
        reporter: n.reporter,
        createdAt: n.createdAt,
        isTest: n.isTest,
        channelId: args.mode === 'live' ? n.discordChannelId! : mirror!.channelId,
        messageId: args.mode === 'live' ? n.discordMessageId! : mirror!.messageId,
      })
    }
    return Promise.resolve(out.slice(0, args.limit))
  }
  scrumByRecapItem = (itemId: number) =>
    Promise.resolve(this.scrums.find((s) => s.recapItemId === itemId) ?? null)
  gmAskForMatch = (matchId: number) => Promise.resolve(this.gmAsks.get(matchId) ?? null)
  consumeCalls = 0
  consumeNextHeat = () => {
    this.consumeCalls++
    if (this.settings.heatScope !== 'next') return Promise.resolve(null)
    const heat = this.settings.heat
    this.settings = { ...this.settings, heat: 'normal', heatScope: 'night', heatNight: null }
    return Promise.resolve(heat)
  }
  listDisabledReporters = () => Promise.resolve(this.disabled)
  lastScrumReporter = () => Promise.resolve(this.scrums.at(-1)?.reporter ?? null)
  insertScrum = (v: NewNewsScrum) => {
    if (this.scrums.some((s) => s.recapItemId === v.recapItemId)) return Promise.resolve(null)
    const id = this.scrums.length + 1
    this.scrums.push({
      id,
      matchId: v.matchId ?? null,
      night: v.night,
      recapItemId: v.recapItemId,
      channelId: v.channelId,
      messageId: v.messageId,
      threadId: v.threadId ?? null,
      reporter: v.reporter,
      heat: v.heat,
      buzzLevel: v.buzzLevel,
      openUntil: v.openUntil,
      isTest: v.isTest ?? false,
      createdAt: NOW,
    })
    return Promise.resolve(id)
  }
  insertScrumPerson = (v: NewNewsScrumPerson) => {
    if (this.people.some((p) => p.scrumId === v.scrumId && p.playerId === v.playerId)) {
      return Promise.resolve(null)
    }
    const id = this.people.length + 1
    this.people.push({
      id,
      scrumId: v.scrumId,
      playerId: v.playerId,
      discordUserId: v.discordUserId,
      role: v.role,
      requestedBy: v.requestedBy,
      requestedByUserId: v.requestedByUserId ?? null,
      status: v.status ?? 'pinged',
      pingMessageId: v.pingMessageId ?? null,
      pingedAt: v.pingedAt ?? null,
      questionsAsked: v.questionsAsked ?? 0,
      followupsAsked: v.followupsAsked ?? 0,
      askingFollowup: v.askingFollowup ?? false,
      currentQuestion: v.currentQuestion ?? null,
      lastAskedAt: v.lastAskedAt ?? null,
      createdAt: v.createdAt ?? NOW,
    })
    return Promise.resolve(id)
  }
  private scrumOf = (p: NewsScrumPersonRow) => this.scrums.find((s) => s.id === p.scrumId)!
  countAutoPingsTonight = (playerId: number, night: string) =>
    Promise.resolve(
      this.people.filter(
        (p) =>
          p.requestedBy === 'auto' && p.playerId === playerId && this.scrumOf(p).night === night,
      ).length,
    )
  countCommandUsesTonight = (userId: string, night: string) =>
    Promise.resolve(
      this.people.filter(
        (p) =>
          p.requestedBy === 'command' &&
          p.requestedByUserId === userId &&
          this.scrumOf(p).night === night,
      ).length,
    )
  getPlayerDiscordUserId = (playerId: number) =>
    Promise.resolve(this.discordIds.get(playerId) ?? null)
  private detail = (p: NewsScrumPersonRow) => ({
    ...p,
    name: NAMES.get(p.playerId) ?? `Player ${String(p.playerId)}`,
    scrum: this.scrumOf(p),
  })
  listPeopleToPing = () =>
    Promise.resolve(
      this.people.filter((p) => p.status === 'pinged' && p.pingedAt === null).map(this.detail),
    )
  getScrumPerson = (id: number) => {
    const p = this.people.find((x) => x.id === id)
    return Promise.resolve(p === undefined ? null : this.detail(p))
  }
  claimPing = (personId: number) => {
    const p = this.people.find((x) => x.id === personId)
    if (!p || p.pingedAt !== null) return Promise.resolve(false)
    p.pingedAt = NOW
    return Promise.resolve(true)
  }
  updateScrumPerson = (id: number, patch: ScrumPersonUpdate) => {
    if (Object.keys(patch).length === 0) throw new Error('No values to set')
    Object.assign(this.people.find((x) => x.id === id)!, patch)
    return Promise.resolve()
  }
  private withScrum = (p: NewsScrumPersonRow) => {
    const s = this.scrumOf(p)
    return {
      id: p.id,
      scrumId: p.scrumId,
      playerId: p.playerId,
      discordUserId: p.discordUserId,
      pingMessageId: p.pingMessageId,
      currentQuestion: p.currentQuestion,
      channelId: s.channelId,
      threadId: s.threadId,
      scrumMessageId: s.messageId,
      reporter: s.reporter,
      isTest: s.isTest,
    }
  }
  listExpiredPings = (now: Date) =>
    Promise.resolve(
      this.people
        .filter(
          (p) =>
            p.status === 'pinged' &&
            p.pingedAt !== null &&
            p.pingedAt.getTime() < now.getTime() - 300_000,
        )
        .map(this.withScrum),
    )
  listExpiredQuestions = (now: Date) =>
    Promise.resolve(
      this.people
        .filter(
          (p) =>
            p.status === 'asking' &&
            p.lastAskedAt !== null &&
            p.lastAskedAt.getTime() < now.getTime() - 900_000,
        )
        .map(this.withScrum),
    )
  expireScrumPerson = (id: number, from: 'pinged' | 'asking', cutoff: Date | null) => {
    const p = this.people.find((x) => x.id === id)
    const at = from === 'pinged' ? p?.pingedAt : p?.lastAskedAt
    if (!p || p.status !== from) return Promise.resolve(false)
    if (cutoff !== null && (!at || at >= cutoff)) return Promise.resolve(false)
    if (from === 'pinged') p.status = 'expired'
    else {
      p.status = 'done'
      p.currentQuestion = null
    }
    return Promise.resolve(true)
  }
  listScrumAnswers = (personId: number) =>
    Promise.resolve(
      this.answers
        .filter((a) => a.personId === personId)
        .map(({ question, answer, usability }) => ({ question, answer, usability })),
    )
  insertScrumAnswer = (v: NewNewsScrumAnswer) => {
    this.answerRows.push(v)
    this.answers.push({
      personId: v.personId,
      question: v.question,
      answer: v.answer,
      usability: v.usability,
    })
    return Promise.resolve(this.answerRows.length)
  }
  setScrumThread = (scrumId: number, threadId: string) => {
    const s = this.scrums.find((x) => x.id === scrumId)!
    if (s.threadId !== null) return Promise.resolve(false)
    s.threadId = threadId
    return Promise.resolve(true)
  }
  claimScrumQuestion = (args: {
    personId: number
    questionsAsked: number
    question: string
    at: Date
  }) => {
    const p = this.people.find((x) => x.id === args.personId)
    if (
      !p ||
      p.questionsAsked !== args.questionsAsked ||
      (p.status !== 'pinged' && p.status !== 'asking')
    ) {
      return Promise.resolve(false)
    }
    p.status = 'asking'
    p.questionsAsked += 1
    p.askingFollowup = false
    p.currentQuestion = args.question
    p.lastAskedAt = args.at
    return Promise.resolve(true)
  }
  acceptScrumPerson = (personId: number, cutoff: Date, at: Date) => {
    const p = this.people.find((x) => x.id === personId)
    if (!p || p.status !== 'pinged' || p.pingedAt === null || p.pingedAt < cutoff) {
      return Promise.resolve(false)
    }
    p.status = 'asking'
    p.lastAskedAt = at
    return Promise.resolve(true)
  }
  claimScrumAnswer = (args: {
    personId: number
    questionsAsked: number
    followupsAsked: number
    at: Date
  }) => {
    const p = this.people.find((x) => x.id === args.personId)
    if (
      !p ||
      p.status !== 'asking' ||
      p.questionsAsked !== args.questionsAsked ||
      p.followupsAsked !== args.followupsAsked ||
      p.currentQuestion === null
    ) {
      return Promise.resolve(false)
    }
    p.currentQuestion = null
    p.lastAskedAt = args.at
    return Promise.resolve(true)
  }
  getPlayerForDiscordUser = (userId: string) => {
    const hit = [...this.discordIds].find(([, id]) => id === userId)
    return Promise.resolve(
      hit === undefined
        ? null
        : { playerId: hit[0], name: NAMES.get(hit[0]) ?? `Player ${String(hit[0])}` },
    )
  }
  latestScrumItem = (args: { playerId: number | null; since: Date; isTest: boolean }) => {
    const hits = this.scrums.filter((s) => {
      const item = this.items.find((i) => i.id === s.recapItemId)
      if (s.isTest !== args.isTest || !item || item.deletedAt !== null) return false
      if (item.createdAt <= args.since) return false
      return (
        args.playerId === null ||
        (s.matchId !== null && (this.played.get(s.matchId) ?? []).includes(args.playerId))
      )
    })
    return Promise.resolve(hits.at(-1)?.recapItemId ?? null)
  }
  nightPressMaterial = () => Promise.resolve({ quotes: [], gmNotes: this.gmNotes })
  monthNewsSpendUsd = () => Promise.resolve(this.spend)
  recordNewsUsage = (row: NewNewsUsage) => {
    this.usage.push(row)
    return Promise.resolve()
  }

  // ── GM controls ──
  /** The night of the newest counted game within the window; null = no game. */
  latestNight: string | null = NIGHT
  latestNightSince: Date[] = []
  roster: PressRosterEntry[] = [
    { playerId: 1, name: 'Skater A', gamertag: 'skatera99', pressLevel: 'full', aliases: [] },
    { playerId: 2, name: 'Skater B', gamertag: 'skaterb77', pressLevel: 'easy', aliases: [] },
    { playerId: 3, name: 'Goalie G', gamertag: 'goalieg1', pressLevel: 'full', aliases: [] },
    { playerId: 4, name: 'Hidden Hank', gamertag: 'hankhides', pressLevel: 'out', aliases: [] },
  ]
  /** Stored GM notes (separate from `gmNotes`, the night material). */
  noteRows: NewsGmNoteRow[] = []
  heatCalls: { heat: string; scope: string; night: string | null }[] = []
  latestPressNight = (since: Date) => {
    this.latestNightSince.push(since)
    return Promise.resolve(this.latestNight)
  }
  listPressRoster = () =>
    Promise.resolve(this.roster.map((r) => ({ ...r, aliases: [...r.aliases] })))
  insertGmNote = (v: NewNewsGmNote) => {
    const id = this.noteRows.length + 1
    this.noteRows.push({
      id,
      matchId: v.matchId ?? null,
      night: v.night,
      playerId: v.playerId ?? null,
      nickname: v.nickname ?? null,
      note: v.note,
      asksPlayer: v.asksPlayer ?? false,
      critical: v.critical ?? false,
      theme: v.theme ?? null,
      status: v.status ?? 'active',
      refusal: v.refusal ?? null,
      isTest: v.isTest ?? false,
      createdAt: NOW,
    })
    return Promise.resolve(id)
  }
  getGmNote = (id: number) => {
    // A copy, like a database read.
    const n = this.noteRows.find((x) => x.id === id)
    return Promise.resolve(n === undefined ? null : { ...n })
  }
  updateGmNote = (id: number, patch: GmNoteUpdate) => {
    if (Object.keys(patch).length === 0) throw new Error('No values to set')
    const n = this.noteRows.find((x) => x.id === id)
    if (!n || n.status === 'cancelled') return Promise.resolve(false)
    Object.assign(n, patch)
    return Promise.resolve(true)
  }
  upsertAlias = (alias: string, playerId: number) => {
    const key = alias.trim().toLowerCase()
    for (const r of this.roster) r.aliases = r.aliases.filter((a) => a !== key)
    this.roster.find((r) => r.playerId === playerId)?.aliases.push(key)
    return Promise.resolve()
  }
  scrumForMatch = (matchId: number, isTest: boolean) =>
    Promise.resolve(
      this.scrums.filter((s) => s.matchId === matchId && s.isTest === isTest).at(-1) ?? null,
    )
  countGmPingsTonight = (playerId: number, night: string, includeTest: boolean) =>
    Promise.resolve(
      this.people.filter((p) => {
        const s = this.scrumOf(p)
        return (
          p.requestedBy === 'gm' &&
          p.playerId === playerId &&
          s.night === night &&
          (!s.isTest || includeTest) &&
          !(p.status === 'expired' && p.pingedAt === null)
        )
      }).length,
    )
  expireUnpingedGmPerson = (scrumId: number, playerId: number) => {
    const p = this.people.find(
      (x) =>
        x.scrumId === scrumId &&
        x.playerId === playerId &&
        x.requestedBy === 'gm' &&
        x.status === 'pinged' &&
        x.pingedAt === null,
    )
    if (!p) return Promise.resolve(false)
    p.status = 'expired'
    return Promise.resolve(true)
  }
  setHeat = (heat: 'cool' | 'normal' | 'hot', scope: 'next' | 'night', night: string | null) => {
    this.heatCalls.push({ heat, scope, night })
    this.settings = {
      ...this.settings,
      heat,
      heatScope: scope,
      heatNight: scope === 'night' ? night : null,
    }
    return Promise.resolve()
  }
}

export interface Sent {
  reporter: ReporterId
  channelId: string
  msg: BotMessage
}

export function setup(opts: { response?: NewsFactsResponse; model?: ModelCall } = {}) {
  const store = new FakeStore()
  const sent: Sent[] = []
  const edits: { messageId: string; msg: Partial<BotMessage> }[] = []
  const removed: string[] = []
  const threads: { channelId: string; messageId: string; name: string }[] = []
  const dms: { userId: string; content: string }[] = []
  const logs: string[] = []
  const modelCalls: unknown[] = []
  let failSend: ((s: Sent) => boolean) | null = null
  let threadError: Error | null = null
  let n = 0
  const deps: PressDeps = {
    store,
    discord: {
      send: (reporter, channelId, msg) => {
        const s = { reporter, channelId, msg }
        if (failSend?.(s)) return Promise.reject(new Error('Discord bot HTTP 500'))
        sent.push(s)
        return Promise.resolve(`sent-${String(++n)}`)
      },
      edit: (_r, _c, messageId, msg) => {
        edits.push({ messageId, msg })
        return Promise.resolve()
      },
      remove: (_r, _c, messageId) => {
        removed.push(messageId)
        return Promise.resolve()
      },
      thread: (_r, channelId, messageId, name) => {
        threads.push({ channelId, messageId, name })
        if (threadError !== null) return Promise.reject(threadError)
        return Promise.resolve(messageId)
      },
      dm: (userId, content) => {
        dms.push({ userId, content })
        return Promise.resolve()
      },
    },
    fetchFacts: () => Promise.resolve(opts.response ?? oct12Response('game')),
    call:
      opts.model ??
      ((req) => {
        modelCalls.push(req)
        return Promise.reject(new Error('no model in this test'))
      }),
    log: (m) => logs.push(m),
    now: () => NOW,
  }
  return {
    store,
    deps,
    sent,
    edits,
    removed,
    threads,
    dms,
    logs,
    modelCalls,
    failSendWhen: (f: (s: Sent) => boolean) => {
      failSend = f
    },
    threadFails: (err: Error) => {
      threadError = err
    },
  }
}

/** A live recap item for the fixture game. */
export function liveRecap(store: FakeStore, id = 10): void {
  store.items.push(itemRow({ id, isGameRecap: true, reporter: 'voss' }))
}

export async function scrumWithPerson(t: ReturnType<typeof setup>, playerId = 1) {
  liveRecap(t.store)
  await runPressPass(t.deps, config('live'))
  t.store.scrums[0]!.heat = 'normal'
  const id = await t.store.insertScrumPerson({
    scrumId: 1,
    playerId,
    discordUserId: playerId === 1 ? USER_A : USER_B,
    role: 'picked',
    requestedBy: 'auto',
    pingedAt: NOW,
  })
  return id!
}
