import test from 'node:test'
import assert from 'node:assert/strict'
import type { NewsFactsResponse, ReporterId } from '@eanhl/db/news'
import type {
  NewNewsScrum,
  NewNewsScrumPerson,
  NewNewsUsage,
  NewsItemRow,
  NewsPressSettingsRow,
  NewsScrumPersonRow,
  NewsScrumRow,
  RecapItemWithoutScrum,
  ScrumPersonUpdate,
} from '@eanhl/db/queries'
import type { BotMessage } from '../bot-rest.ts'
import type { ModelCall } from '../news/writer.ts'
import { oct12Response } from '../news/test-fixtures.ts'
import type { PressConfig } from './config.ts'
import { FALLBACK_CLOSING } from './asker.ts'
import { runPressPass, startScrumQuestion, type PressDeps, type PressStore } from './pass.ts'

const NOW = new Date('2026-10-13T03:00:00.000Z')
const NIGHT = '2026-10-12'
const GM = '100000000000000001'
const USER_A = '200000000000000001'
const USER_B = '200000000000000002'

const config = (mode: 'trial' | 'live'): PressConfig => ({
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

function itemRow(over: Partial<NewsItemRow> & Pick<NewsItemRow, 'id'>): NewsItemRow {
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
function bigResponse(): NewsFactsResponse {
  const res = oct12Response('game')
  res.facts.games[0] = {
    ...res.facts.games[0]!,
    newRecords: [{ stat: 'goals', name: 'Skater A', value: 30 }],
  }
  return res
}

const NAMES = new Map([
  [1, 'Skater A'],
  [2, 'Skater B'],
  [3, 'Goalie G'],
])

/** An in-memory press store with the same claim rules as the SQL. */
class FakeStore implements PressStore {
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
  gmNotes: { id: number; playerName: string | null; note: string; matchId: number | null }[] = []
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
  consumeNextHeat = () => {
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
      currentQuestion: v.currentQuestion ?? null,
      lastAskedAt: v.lastAskedAt ?? null,
      createdAt: NOW,
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
  expireScrumPerson = (id: number, from: 'pinged' | 'asking', cutoff: Date) => {
    const p = this.people.find((x) => x.id === id)
    const at = from === 'pinged' ? p?.pingedAt : p?.lastAskedAt
    if (!p || p.status !== from || !at || at >= cutoff) return Promise.resolve(false)
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
  insertScrumAnswer = () => Promise.resolve(1)
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
    p.currentQuestion = args.question
    p.lastAskedAt = args.at
    return Promise.resolve(true)
  }
  nightPressMaterial = () => Promise.resolve({ quotes: [], gmNotes: this.gmNotes })
  monthNewsSpendUsd = () => Promise.resolve(this.spend)
  recordNewsUsage = (row: NewNewsUsage) => {
    this.usage.push(row)
    return Promise.resolve()
  }
}

interface Sent {
  reporter: ReporterId
  channelId: string
  msg: BotMessage
}

function setup(opts: { response?: NewsFactsResponse; model?: ModelCall } = {}) {
  const store = new FakeStore()
  const sent: Sent[] = []
  const edits: { messageId: string; msg: Partial<BotMessage> }[] = []
  const removed: string[] = []
  const threads: { channelId: string; messageId: string; name: string }[] = []
  const dms: { userId: string; content: string }[] = []
  const logs: string[] = []
  const modelCalls: unknown[] = []
  let failSend: ((s: Sent) => boolean) | null = null
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
        return Promise.resolve(`thread-${String(threads.length)}`)
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
  }
}

/** A live recap item for the fixture game. */
function liveRecap(store: FakeStore, id = 10): void {
  store.items.push(itemRow({ id, isGameRecap: true, reporter: 'voss' }))
}

const pings = (sent: Sent[]) => sent.filter((s) => s.msg.content.includes('has a question for you'))

void test('a big game creates one scrum and one ping, replied under the recap with Accept', async () => {
  const t = setup({ response: bigResponse() })
  liveRecap(t.store)
  const summary = await runPressPass(t.deps, config('live'))
  assert.equal(t.store.scrums.length, 1)
  const scrum = t.store.scrums[0]!
  assert.equal(scrum.recapItemId, 10)
  assert.equal(scrum.buzzLevel, 'historic')
  assert.equal(scrum.isTest, false)
  assert.equal(scrum.channelId, 'chel')
  assert.equal(scrum.messageId, 'msg-10')
  assert.equal(scrum.night, NIGHT)
  assert.notEqual(scrum.reporter, 'rink')
  assert.equal(scrum.openUntil.getTime(), NOW.getTime() - 10 * 60_000 + 3_600_000)
  assert.equal(t.store.people.length, 1)
  const person = t.store.people[0]!
  assert.equal(person.requestedBy, 'auto')
  assert.equal(person.role, 'picked')
  assert.equal(person.discordUserId, USER_A)
  const ps = pings(t.sent)
  assert.equal(ps.length, 1)
  const ping = ps[0]!
  assert.equal(ping.reporter, scrum.reporter)
  assert.equal(ping.channelId, 'chel')
  assert.match(
    ping.msg.content,
    new RegExp(`^<@${USER_A}> — .+ has a question for you about tonight's game\\.$`),
  )
  assert.deepEqual(ping.msg.allowed_mentions, { parse: [], users: [USER_A] })
  assert.deepEqual(ping.msg.message_reference, { message_id: 'msg-10', fail_if_not_exists: false })
  assert.match(JSON.stringify(ping.msg.components), /press:accept:1/)
  assert.equal(person.pingMessageId, 'sent-1')
  assert.ok(person.pingedAt !== null)
  assert.equal(summary.scrums, 1)
  assert.equal(summary.pings, 1)
})

void test('running the pass twice creates one scrum and sends one ping (claims)', async () => {
  const t = setup({ response: bigResponse() })
  liveRecap(t.store)
  await runPressPass(t.deps, config('live'))
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.scrums.length, 1)
  assert.equal(pings(t.sent).length, 1)
})

void test('a ping already claimed is never sent again', async () => {
  const t = setup({ response: bigResponse() })
  liveRecap(t.store)
  const claim = t.store.claimPing
  // Another pass claims every ping first.
  t.store.claimPing = async (id) => {
    await claim(id)
    return false
  }
  await runPressPass(t.deps, config('live'))
  assert.equal(pings(t.sent).length, 0)
})

void test('a quiet game creates a scrum without a ping', async () => {
  const t = setup()
  liveRecap(t.store)
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.scrums.length, 1)
  assert.equal(t.store.scrums[0]!.buzzLevel, 'quiet')
  assert.equal(t.store.people.length, 0)
  assert.equal(t.sent.length, 0)
})

void test('a GM note that asks a player pings them on a quiet game, requested by the GM', async () => {
  const t = setup()
  liveRecap(t.store)
  t.store.gmAsks.set(90001, 2)
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.people.length, 1)
  assert.equal(t.store.people[0]!.playerId, 2)
  assert.equal(t.store.people[0]!.requestedBy, 'gm')
  assert.equal(pings(t.sent)[0]!.msg.allowed_mentions.users?.[0], USER_B)
})

void test('trial: the scrum hangs on the mirror, is test, and the ping goes to the GM with "test — would ping"', async () => {
  const t = setup({ response: bigResponse() })
  t.store.settings.mirrorFromItemId = 9
  t.store.items.push(
    itemRow({ id: 10, isGameRecap: true, discordVia: 'webhook', discordChannelId: null }),
  )
  await runPressPass(t.deps, config('trial'))
  const mirror = t.sent[0]!
  assert.equal(mirror.channelId, 'test-channel')
  assert.match(JSON.stringify(mirror.msg.components), /press:talk:10/)
  assert.equal(t.store.mirrors.length, 1)
  assert.equal(t.store.scrums.length, 1)
  const scrum = t.store.scrums[0]!
  assert.equal(scrum.isTest, true)
  assert.equal(scrum.channelId, 'test-channel')
  assert.equal(scrum.messageId, t.store.mirrors[0]!.messageId)
  const ping = pings(t.sent)[0]!
  assert.match(ping.msg.content, new RegExp(`^test — would ping Skater A: <@${GM}> — `))
  assert.deepEqual(ping.msg.allowed_mentions, { parse: [], users: [GM] })
  assert.equal(ping.channelId, 'test-channel')
})

void test('the third automatic ping of a night for the same player is not sent', async () => {
  const t = setup({ response: bigResponse() })
  for (const id of [1, 2]) {
    t.store.scrums.push({
      id,
      matchId: 80000 + id,
      night: NIGHT,
      recapItemId: id,
      channelId: 'chel',
      messageId: `old-${String(id)}`,
      threadId: null,
      reporter: 'barlow',
      heat: 'normal',
      buzzLevel: 'big',
      openUntil: NOW,
      isTest: false,
      createdAt: NOW,
    })
    await t.store.insertScrumPerson({
      scrumId: id,
      playerId: 1,
      discordUserId: USER_A,
      role: 'picked',
      requestedBy: 'auto',
      status: 'done',
      pingedAt: NOW,
    })
  }
  liveRecap(t.store)
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.scrums.length, 3)
  assert.equal(t.store.people.length, 2)
  assert.equal(pings(t.sent).length, 0)
})

void test('heat: a "next" heat is used once; a Go easy pick lowers Hot to normal and the GM is told', async () => {
  const res = bigResponse()
  // Skater B (Go easy) becomes the pick through a GM note.
  const t = setup({ response: res })
  liveRecap(t.store)
  t.store.gmAsks.set(90001, 2)
  t.store.settings = { ...t.store.settings, heat: 'hot', heatScope: 'next' }
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.scrums[0]!.heat, 'normal')
  assert.equal(t.store.settings.heatScope, 'night')
  assert.deepEqual(t.dms, [
    { userId: GM, content: "Heat for Skater B's scrum lowered to Normal (Go easy)." },
  ])
})

void test('an accept older than 5 minutes becomes expired and loses its button', async () => {
  const t = setup()
  liveRecap(t.store)
  await runPressPass(t.deps, config('live'))
  await t.store.insertScrumPerson({
    scrumId: 1,
    playerId: 1,
    discordUserId: USER_A,
    role: 'picked',
    requestedBy: 'auto',
    pingedAt: new Date(NOW.getTime() - 301_000),
    pingMessageId: 'ping-1',
  })
  await t.store.insertScrumPerson({
    scrumId: 1,
    playerId: 2,
    discordUserId: USER_B,
    role: 'picked',
    requestedBy: 'gm',
    pingedAt: new Date(NOW.getTime() - 60_000),
    pingMessageId: 'ping-2',
  })
  const summary = await runPressPass(t.deps, config('live'))
  assert.equal(t.store.people[0]!.status, 'expired')
  assert.equal(t.store.people[1]!.status, 'pinged')
  assert.deepEqual(t.edits, [{ messageId: 'ping-1', msg: { components: [] } }])
  assert.equal(summary.expiredPings, 1)
})

void test('an unanswered question older than 15 minutes gets the closing line and ends', async () => {
  const t = setup()
  liveRecap(t.store)
  await runPressPass(t.deps, config('live'))
  t.store.scrums[0]!.threadId = 'thread-9'
  await t.store.insertScrumPerson({
    scrumId: 1,
    playerId: 1,
    discordUserId: USER_A,
    role: 'picked',
    requestedBy: 'auto',
    status: 'asking',
    pingedAt: new Date(NOW.getTime() - 30 * 60_000),
    lastAskedAt: new Date(NOW.getTime() - 901_000),
    currentQuestion: 'Why?',
    questionsAsked: 1,
  })
  await runPressPass(t.deps, config('live'))
  const p = t.store.people[0]!
  assert.equal(p.status, 'done')
  assert.equal(p.currentQuestion, null)
  assert.equal(t.sent.length, 1)
  assert.equal(t.sent[0]!.channelId, 'thread-9')
  assert.equal(t.sent[0]!.msg.content, FALLBACK_CLOSING)
  assert.equal(t.sent[0]!.msg.content, 'Fair enough — next game.')
  // A second pass does not close it again.
  await runPressPass(t.deps, config('live'))
  assert.equal(t.sent.length, 1)
})

void test('first trial pass: the mark is the newest item, so history is never mirrored', async () => {
  const t = setup()
  t.store.items.push(itemRow({ id: 5 }), itemRow({ id: 6, isGameRecap: true }))
  await runPressPass(t.deps, config('trial'))
  assert.equal(t.store.settings.mirrorFromItemId, 6)
  assert.equal(t.sent.length, 0)
  assert.equal(t.store.scrums.length, 0)
  t.store.items.push(itemRow({ id: 7, reporter: 'mercer', replyTo: 6 }))
  const summary = await runPressPass(t.deps, config('trial'))
  assert.equal(summary.mirrored, 1)
  assert.equal(t.sent.length, 1)
  assert.equal(t.sent[0]!.reporter, 'mercer')
  assert.equal(t.sent[0]!.channelId, 'test-channel')
  assert.match(t.sent[0]!.msg.content, /^↪ to Arthur Barlow: Post 7$|^↪ to .+: Post 7$/)
  assert.equal(t.sent[0]!.msg.components, undefined)
  assert.deepEqual(
    t.store.mirrors.map((m) => m.itemId),
    [7],
  )
})

void test('live: nothing is mirrored', async () => {
  const t = setup()
  t.store.items.push(itemRow({ id: 5 }))
  t.store.settings.mirrorFromItemId = 1
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.mirrors.length, 0)
})

void test('mirror: an item not due yet waits, and so do the items after it', async () => {
  const t = setup()
  t.store.settings.mirrorFromItemId = 1
  t.store.items.push(
    itemRow({ id: 2, sendAfter: new Date(NOW.getTime() + 60_000) }),
    itemRow({ id: 3 }),
  )
  await runPressPass(t.deps, config('trial'))
  assert.equal(t.sent.length, 0)
})

void test('a deleted mirrored item: its mirror message is deleted and marked', async () => {
  const t = setup()
  t.store.settings.mirrorFromItemId = 1
  t.store.items.push(itemRow({ id: 2, deletedAt: NOW }))
  t.store.mirrors.push({
    itemId: 2,
    channelId: 'test-channel',
    messageId: 'mir-2',
    deletedAt: null,
  })
  const summary = await runPressPass(t.deps, config('trial'))
  assert.deepEqual(t.removed, ['mir-2'])
  assert.ok(t.store.mirrors[0]!.deletedAt !== null)
  assert.equal(summary.mirrorsDeleted, 1)
})

void test('a failing mirror send does not stop the scrum step', async () => {
  const t = setup()
  t.store.settings.mirrorFromItemId = 1
  // Item 2 is already mirrored (a recap without a scrum); item 3 fails to mirror.
  t.store.items.push(itemRow({ id: 2, isGameRecap: true }), itemRow({ id: 3 }))
  t.store.mirrors.push({
    itemId: 2,
    channelId: 'test-channel',
    messageId: 'mir-2',
    deletedAt: null,
  })
  t.failSendWhen((s) => s.msg.content === 'Post 3')
  const summary = await runPressPass(t.deps, config('trial'))
  assert.equal(t.store.scrums.length, 1)
  assert.equal(t.store.scrums[0]!.messageId, 'mir-2')
  assert.ok(t.logs.some((l) => /^\[press\] mirror: Discord bot HTTP 500$/.test(l)))
  assert.deepEqual(summary.failedSteps, ['mirror'])
})

void test('facts that fail to load skip the item this pass and log it', async () => {
  const t = setup()
  liveRecap(t.store)
  t.deps.fetchFacts = () => Promise.reject(new Error('news game facts HTTP 503'))
  await runPressPass(t.deps, config('live'))
  assert.equal(t.store.scrums.length, 0)
  assert.ok(t.logs.some((l) => l.startsWith('[press] scrums: item 10: news game facts HTTP 503')))
})

// ── startScrumQuestion ──────────────────────────────────────────────────────

async function scrumWithPerson(t: ReturnType<typeof setup>, playerId = 1) {
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

void test('startScrumQuestion: thread "<Reporter> — <player>", question with the Answer button, asking', async () => {
  const reqs: Parameters<ModelCall>[0][] = []
  const model: ModelCall = (req) => {
    reqs.push(req)
    const json =
      req.purpose === 'write'
        ? { question: 'Skater A, what changed after the first period?' }
        : { ok: true, problems: [] }
    return Promise.resolve({
      json,
      refused: false,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 10, output_tokens: 5 },
    })
  }
  const t = setup({ model })
  const personId = await scrumWithPerson(t)
  t.store.gmNotes = [
    { id: 1, playerName: 'Skater A', note: 'Skater A broke a stick on the post.', matchId: 90001 },
    { id: 2, playerName: null, note: 'Other game note.', matchId: 90002 },
  ]
  t.store.answers.push({ personId: 99, question: 'Not theirs', answer: 'x', usability: 'usable' })
  await startScrumQuestion(t.deps, config('live'), personId)
  const scrum = t.store.scrums[0]!
  const reporterName = t.threads[0]!.name.split(' — ')[0]!
  assert.deepEqual(t.threads, [
    { channelId: 'chel', messageId: 'msg-10', name: `${reporterName} — Skater A` },
  ])
  assert.equal(scrum.threadId, 'thread-1')
  const q = t.sent.at(-1)!
  assert.equal(q.channelId, 'thread-1')
  assert.equal(q.reporter, scrum.reporter)
  assert.equal(q.msg.content, 'Skater A, what changed after the first period?')
  assert.deepEqual(q.msg.allowed_mentions, { parse: [] })
  assert.match(JSON.stringify(q.msg.components), new RegExp(`press:answer:${String(personId)}`))
  const p = t.store.people.find((x) => x.id === personId)!
  assert.equal(p.status, 'asking')
  assert.equal(p.questionsAsked, 1)
  assert.equal(p.lastAskedAt?.getTime(), NOW.getTime())
  assert.ok(p.currentQuestion !== null && p.currentQuestion.length > 0)
  // The model saw this match's GM note only, and usage is recorded without a job.
  const write = reqs.find((r) => r.purpose === 'write')!
  assert.match(write.user, /broke a stick on the post/)
  assert.doesNotMatch(write.user, /Other game note/)
  assert.doesNotMatch(write.user, /Not theirs/)
  assert.ok(t.store.usage.length > 0)
  assert.ok(t.store.usage.every((u) => u.jobId === null))
})

void test('startScrumQuestion: earlier answers go in as history (unusable ones as no answer)', async () => {
  const reqs: Parameters<ModelCall>[0][] = []
  const model: ModelCall = (req) => {
    reqs.push(req)
    return Promise.reject(new Error('stop after the prompt'))
  }
  const t = setup({ model })
  const personId = await scrumWithPerson(t)
  t.store.people.find((x) => x.id === personId)!.questionsAsked = 2
  t.store.people.find((x) => x.id === personId)!.status = 'asking'
  t.store.answers.push(
    { personId, question: 'First question?', answer: 'We pushed hard.', usability: 'usable' },
    { personId, question: 'Second question?', answer: 'my job is awful', usability: 'unusable' },
  )
  await startScrumQuestion(t.deps, config('live'), personId)
  const write = reqs.find((r) => r.purpose === 'write')!
  assert.match(write.user, /First question\?/)
  assert.match(write.user, /We pushed hard\./)
  assert.match(write.user, /Second question\?/)
  assert.doesNotMatch(write.user, /my job is awful/)
  assert.match(write.user, /question 3 of the scrum/)
  // The model failed: the fallback question is posted, and the person moves on.
  assert.equal(t.sent.at(-1)!.msg.content, 'Walk me through that one, Skater A.')
  assert.equal(t.store.people.find((x) => x.id === personId)!.questionsAsked, 3)
})

void test('startScrumQuestion: budget spent → fallback question, no model call, logged once a month', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  t.store.spend = 16
  await startScrumQuestion(t.deps, config('live'), personId)
  assert.equal(t.modelCalls.length, 0)
  assert.equal(t.sent.at(-1)!.msg.content, 'Walk me through that one, Skater A.')
  t.store.people.find((x) => x.id === personId)!.status = 'asking'
  await startScrumQuestion(t.deps, config('live'), personId)
  assert.equal(t.modelCalls.length, 0)
  assert.equal(t.logs.filter((l) => l.startsWith('[press] budget:')).length, 1)
})

void test('startScrumQuestion: an existing thread is reused; a finished person is not asked', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  t.store.spend = 100
  t.store.scrums[0]!.threadId = 'thread-old'
  await startScrumQuestion(t.deps, config('live'), personId)
  assert.equal(t.threads.length, 0)
  assert.equal(t.sent.at(-1)!.channelId, 'thread-old')
  const before = t.sent.length
  t.store.people.find((x) => x.id === personId)!.status = 'done'
  await startScrumQuestion(t.deps, config('live'), personId)
  assert.equal(t.sent.length, before)
})

void test('startScrumQuestion: two calls for the same question post it once (claim)', async () => {
  const t = setup()
  const personId = await scrumWithPerson(t)
  t.store.spend = 100
  t.store.scrums[0]!.threadId = 'thread-old'
  await Promise.all([
    startScrumQuestion(t.deps, config('live'), personId),
    startScrumQuestion(t.deps, config('live'), personId),
  ])
  assert.equal(t.sent.filter((s) => s.channelId === 'thread-old').length, 1)
})

void test('a failing closing line does not stop the other closings', async () => {
  const t = setup()
  liveRecap(t.store)
  await runPressPass(t.deps, config('live'))
  t.store.scrums[0]!.threadId = 'thread-9'
  for (const playerId of [1, 2]) {
    await t.store.insertScrumPerson({
      scrumId: 1,
      playerId,
      discordUserId: playerId === 1 ? USER_A : USER_B,
      role: 'volunteer',
      requestedBy: 'self',
      status: 'asking',
      lastAskedAt: new Date(NOW.getTime() - 901_000),
      questionsAsked: 1,
    })
  }
  let first = true
  t.failSendWhen(() => {
    const fail = first
    first = false
    return fail
  })
  await runPressPass(t.deps, config('live'))
  assert.deepEqual(
    t.store.people.map((p) => p.status),
    ['done', 'done'],
  )
  assert.equal(t.sent.length, 1)
  assert.ok(t.logs.some((l) => l === '[press] expired answers: person 1: Discord bot HTTP 500'))
})
