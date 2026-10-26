import test from 'node:test'
import assert from 'node:assert/strict'
import type { NewNewsItem, NewNewsStance, NewNewsUsage, NewsItemRow } from '@eanhl/db/queries'
import {
  REPORTER_IDS,
  REPORTERS,
  planBuzz,
  type NewsFactsResponse,
  type NewsGameFacts,
  type ReporterId,
} from '@eanhl/db/news'
import { WebhookOutcomeUnknownError } from '../webhook.ts'
import {
  createNewsCycleState,
  NEWS_GAME_WINDOW_MS,
  NEWS_POST_SPACING_MS,
  runNewsCycle,
  type NewsCycleOptions,
  type NewsDeps,
  type NewsStore,
} from './cycle.ts'
import { assignGamePosts, type ActivityKind } from './assign.ts'
import { classifyGame } from './situation.ts'
import type { NewsWebhookPayload } from './messages.ts'
import { ARTICLE_SCHEMA, FEATURE_SCHEMA, GAME_POSTS_SCHEMA, REVIEW_SCHEMA } from './outputs.ts'
import { oct12Response } from './test-fixtures.ts'
import { NEWS_RULES_VERSION } from './rules-version.ts'
import { NewsJobError, NewsRetryableError, NewsStopError, type ModelCall } from './writer.ts'

const NOW = new Date('2026-10-24T12:00:00Z') // a Saturday
const MIN = 60_000

type Job = {
  id: number
  kind: string
  key: string
  status: string
  attempts: number
  error: string | null
}

/**
 * A 2-3 overtime loss in 6s: buzz "normal" (overtime 2 + close 1 + the
 * sheet's milestone 2, x1.25 = 6.25), so 2 posts: Dex Mercer's recap and one more.
 */
function lossGame(matchId: number): NewsGameFacts {
  const base = oct12Response('game').facts.games[0]!
  return {
    ...base,
    matchId,
    result: 'OTL',
    overtime: true,
    scoreFor: 2,
    scoreAgainst: 3,
    context: {
      result: 'normal',
      streakBefore: null,
      streakAfter: { kind: 'L', count: 1 },
      last10: { wins: 8, losses: 1, otl: 1 },
      margin: 'close',
      surprise: 'expected',
      night: [],
    },
  }
}

function gameResponse(matchId: number): NewsFactsResponse {
  const r = oct12Response('game')
  return { ...r, facts: { ...r.facts, games: [lossGame(matchId)] } }
}

/** The first match id from 501 whose second post is a reply to the recap (the seeded draw). */
const REPLY_GAME = (() => {
  for (let id = 501; id < 900; id++) {
    const facts = gameResponse(id).facts
    const game = facts.games[0]!
    const p = assignGamePosts({
      game,
      facts,
      situation: classifyGame(game),
      plan: planBuzz(game, facts),
      now: NOW,
      night: '2026-10-12',
      activity: [],
    })
    if (p.length === 2 && p[1]!.replyTo === 0) return id
  }
  throw new Error('no reply game')
})()

const FILLER = Array.from({ length: 300 }, () => 'hockey').join(' ')

/** Answers by schema: posts for the assigned reporter ids, a long article, a passing review. */
const goodWriter: ModelCall = async (req) => {
  const base = {
    refused: false,
    model: 'claude-opus-5-5',
    usage: { input_tokens: 1000, output_tokens: 100 },
  }
  if (req.schema === GAME_POSTS_SCHEMA) {
    const ids = [...req.user.matchAll(/\(id "(\w+)"\)/g)].map((m) => m[1])
    return {
      ...base,
      json: {
        posts: ids.map((id) => ({
          reporter: id,
          text: `The Boogeymen took 14 shots, says ${String(id)}.`,
          mentions: [],
          clubs: [],
          criticized: [],
          zeroCalled: [],
          stances: [],
          takesUsed: [],
        })),
      },
    }
  }
  if (req.schema === ARTICLE_SCHEMA) {
    return {
      ...base,
      json: {
        headline: 'A Long Night On The Ice',
        dek: 'The club skated.',
        paragraphs: [FILLER],
        summary: 'The club skated.',
        mentions: [],
        clubs: [],
        criticized: [],
        zeroCalled: [],
        stances: [],
        takesUsed: [],
      },
    }
  }
  if (req.schema === FEATURE_SCHEMA) {
    return {
      ...base,
      json: {
        headline: 'The Week In Numbers',
        dek: 'A week of hockey.',
        paragraphs: [FILLER, FILLER],
        summary: 'The week.',
        mentions: [],
        clubs: [],
        criticized: [],
        zeroCalled: [],
        stances: [],
        takesUsed: [],
        prediction: 'Someone finally beats the goalie.',
        receipt: req.user.includes("Last week's prediction: none.") ? '' : 'It did not come true.',
        receiptVerdict: req.user.includes("Last week's prediction: none.") ? 'none' : 'miss',
      },
    }
  }
  assert.equal(req.schema, REVIEW_SCHEMA)
  return { ...base, json: { ok: true, problems: [] } }
}

function harness(
  over: { candidates?: number[]; store?: Partial<NewsStore>; deps?: Partial<NewsDeps> } = {},
) {
  const events: string[] = []
  const jobs = new Map<string, Job>()
  const items = new Map<number, NewsItemRow>()
  const usage: NewNewsUsage[] = []
  const stances: NewNewsStance[] = []
  const sent: NewsWebhookPayload[] = []
  const dry: { key: string; payload: NewsWebhookPayload }[] = []
  const writerCalls: string[] = []
  const state = {
    enabled: true,
    spend: 0,
    candidates: over.candidates ?? [],
    nights: [] as { night: string; lastEnd: Date }[],
    nightGames: {} as Record<string, number>,
    deletions: [] as { id: number; messageId: string }[],
    disabled: [] as ReporterId[],
  }
  let nextJob = 1
  let nextItem = 1
  let msg = 100
  const open = (j: Job | undefined) => j === undefined || (j.status === 'failed' && j.attempts < 3)

  const store: NewsStore = {
    listDiscordDeletions: async () => state.deletions,
    markDiscordDeleted: async (id) => {
      events.push(`deleted:${String(id)}`)
      state.deletions = state.deletions.filter((d) => d.id !== id)
    },
    getNewsEnabled: async () => state.enabled,
    monthNewsSpendUsd: async () => state.spend,
    listUndeliveredNewsItems: async () =>
      [...items.values()].filter(
        (i) => i.discordStatus === 'failed' && i.discordAttempts < 3 && !i.isTest,
      ),
    newsItemReporter: async (id) => items.get(id)?.reporter ?? null,
    listGameJobCandidates: async ({ since, limit }) => {
      events.push(`candidates:${String(NOW.getTime() - since.getTime())}:${String(limit)}`)
      return state.candidates.filter((id) => open(jobs.get(`game:${String(id)}`))).slice(0, limit)
    },
    listEndedNights: async ({ now, endedForMs, since }) =>
      state.nights
        .filter(
          (n) =>
            n.lastEnd.getTime() < now.getTime() - endedForMs &&
            n.lastEnd.getTime() > since.getTime() &&
            open(jobs.get(`night:${n.night}`)),
        )
        .map((n) => n.night),
    countNightGames: async (nights) =>
      nights.reduce((sum, n) => sum + (state.nightGames[n] ?? 0), 0),
    claimNewsJob: async (kind, key) => {
      const k = `${kind}:${key}`
      const j = jobs.get(k)
      if (!open(j)) return null
      events.push(`claim:${k}`)
      if (j) {
        j.status = 'pending'
        j.attempts++
        return j.id
      }
      const id = nextJob++
      jobs.set(k, { id, kind, key, status: 'pending', attempts: 1, error: null })
      return id
    },
    markNewsJob: async (jobId, status, error) => {
      const j = [...jobs.values()].find((x) => x.id === jobId)!
      j.status = status
      j.error = error
      events.push(`job:${j.kind}:${j.key}:${status}`)
    },
    insertNewsItem: async (item: NewNewsItem) => {
      const id = nextItem++
      items.set(id, {
        id,
        jobId: item.jobId ?? null,
        kind: item.kind,
        reporter: item.reporter,
        matchId: item.matchId ?? null,
        night: item.night ?? null,
        weekStart: item.weekStart ?? null,
        replyTo: item.replyTo ?? null,
        slug: item.slug ?? null,
        headline: item.headline ?? null,
        dek: item.dek ?? null,
        body: item.body,
        summary: item.summary ?? null,
        mentions: item.mentions ?? [],
        facts: item.facts ?? null,
        criticized: item.criticized ?? [],
        prediction: item.prediction ?? null,
        featureKind: item.featureKind ?? null,
        receiptVerdict: item.receiptVerdict ?? null,
        zeroCalled: item.zeroCalled ?? [],
        takesUsed: item.takesUsed ?? [],
        rulesVersion: item.rulesVersion ?? null,
        sendAfter: item.sendAfter ?? null,
        isTest: item.isTest ?? false,
        discordStatus: item.discordStatus ?? 'pending',
        discordAttempts: 0,
        discordMessageId: null,
        lastError: null,
        deletedAt: null,
        discordDeletedAt: null,
        createdAt: NOW,
      })
      events.push(`insert:${String(id)}`)
      return id
    },
    markNewsItemPosted: async (id, messageId) => {
      const i = items.get(id)!
      i.discordStatus = 'posted'
      i.discordMessageId = messageId
      events.push(`posted:${String(id)}`)
    },
    markNewsItemFailed: async (id, error) => {
      const i = items.get(id)!
      i.discordStatus = 'failed'
      i.discordAttempts++
      i.lastError = error
      events.push(`item-failed:${String(id)}`)
    },
    markNewsItemSkipped: async (id, reason) => {
      items.get(id)!.discordStatus = 'skipped'
      events.push(`item-skipped:${String(id)}:${reason}`)
    },
    reporterActivity: async () => {
      const real = [...items.values()].filter((i) => !i.isTest)
      // As the query: a feature, a night recap, a game's first post (recap), or a reaction.
      const kindOf = (i: NewsItemRow): ActivityKind =>
        i.kind === 'article'
          ? i.weekStart !== null
            ? 'feature'
            : 'night'
          : i.replyTo === null &&
              !real.some((p) => p.kind === 'post' && p.matchId === i.matchId && p.id < i.id)
            ? 'recap'
            : 'reaction'
      return real.map((i) => ({
        reporter: i.reporter,
        night: i.night,
        createdAt: i.createdAt,
        kind: kindOf(i),
      }))
    },
    recentReporterPieces: async () => [],
    nightPostsForPrompt: async (night, includeTest) =>
      [...items.values()]
        .filter(
          (i) =>
            i.kind === 'post' &&
            i.night === night &&
            i.deletedAt === null &&
            (includeTest || !i.isTest),
        )
        .map((i) => ({ reporter: i.reporter, text: i.body })),
    takesUsedSince: async () => [],
    listGameArticleRetries: async () => [],
    lastFeature: async () => {
      const f = [...items.values()]
        .filter((i) => !i.isTest && i.deletedAt === null && i.featureKind !== null)
        .at(-1)
      return f ? { kind: f.featureKind!, prediction: f.prediction, weekStart: f.weekStart } : null
    },
    nightCriticized: async (night, includeTest) => [
      ...new Set(
        [...items.values()]
          .filter((i) => i.night === night && i.deletedAt === null && (includeTest || !i.isTest))
          .flatMap((i) => i.criticized),
      ),
    ],
    nightZeroCalled: async (night, includeTest) => {
      const live = [...items.values()].filter(
        (i) => i.deletedAt === null && (includeTest || !i.isTest) && i.night !== null,
      )
      const previous = live
        .map((i) => i.night!)
        .filter((n) => n < night)
        .sort()
        .at(-1)
      const names = (n: string | undefined) => [
        ...new Set(live.filter((i) => i.night === n).flatMap((i) => i.zeroCalled)),
      ]
      return { tonight: names(night), previous: previous === undefined ? [] : names(previous) }
    },
    listDisabledReporters: async () => state.disabled,
    listDueNewsItems: async (now, limit) =>
      [...items.values()]
        .filter(
          (i) =>
            i.discordStatus === 'pending' &&
            i.sendAfter !== null &&
            i.sendAfter <= now &&
            !i.isTest &&
            i.deletedAt === null,
        )
        .sort((a, b) => a.sendAfter!.getTime() - b.sendAfter!.getTime() || a.id - b.id)
        .slice(0, limit),
    claimDueNewsItem: async (id) => {
      const i = items.get(id)
      if (i === undefined || i.sendAfter === null || i.discordStatus !== 'pending') return false
      i.sendAfter = null
      return true
    },
    insertStance: async (st) => {
      stances.push(st)
      return stances.length
    },
    recordNewsUsage: async (row) => void usage.push(row),
    ...over.store,
  }

  const deps: NewsDeps = {
    store,
    fetchFacts: async (kind, key) => {
      events.push(`fetch:${kind}:${key}`)
      if (kind === 'game') return gameResponse(Number(key))
      const r = oct12Response(kind)
      return { ...r, facts: { ...r.facts, key } }
    },
    writer: async (req) => {
      writerCalls.push(req.purpose)
      return goodWriter(req)
    },
    send: async (payload) => {
      sent.push(payload)
      events.push(`send:${payload.username}`)
      return `m${String(msg++)}`
    },
    remove: async (messageId) => void events.push(`remove:${messageId}`),
    writeDryRun: async (key, payload) => {
      dry.push({ key, payload })
      events.push(`dry:${key}`)
    },
    pause: async (ms) => void events.push(`pause:${String(ms)}`),
    log: (m) => void events.push(`log:${m}`),
    now: () => NOW,
    ...over.deps,
  }
  const opts: NewsCycleOptions = {
    dryRun: false,
    siteUrl: 'https://boogeymen.app',
    monthlyLimitUsd: 10,
    state: createNewsCycleState(),
  }
  return { deps, opts, state, events, jobs, items, usage, sent, dry, writerCalls, stances }
}

const logs = (events: string[]) => events.filter((e) => e.startsWith('log:'))

// ── Game jobs ───────────────────────────────────────────────────────────────

void test('game: two candidates ⇒ two jobs, posts sent in order with a pause between sends, jobs done', async () => {
  const h = harness({ candidates: [REPLY_GAME, 9502] })
  const s = await runNewsCycle(h.deps, h.opts)
  assert.ok(h.events.includes(`candidates:${String(NEWS_GAME_WINDOW_MS)}:5`))
  assert.equal(NEWS_GAME_WINDOW_MS, 86_400_000)
  assert.equal(h.jobs.get(`game:${String(REPLY_GAME)}`)?.status, 'done')
  assert.equal(h.jobs.get('game:9502')?.status, 'done')
  const names = h.sent.map((p) => p.username)
  // Game 1: Mercer's recap and a seeded draw that replies to him. Game 2, same night:
  // Mercer has had his one item, so Barlow's recap and a draw.
  assert.equal(names.length, 4)
  assert.equal(names[0], 'Dex Mercer')
  assert.equal(names[2], 'Wade Barlow')
  assert.ok(!names.slice(1).includes('Dex Mercer'))
  assert.deepEqual([names[0], names[2]], ['Dex Mercer', 'Wade Barlow'])
  // A pause before every send but the first, each at least 2.1 s.
  const sendIdx = h.events.flatMap((e, i) => (e.startsWith('send:') ? [i] : []))
  for (const i of sendIdx.slice(1)) assert.match(h.events[i - 1]!, /^pause:(\d+)$/)
  for (const e of h.events.filter((x) => x.startsWith('pause:'))) {
    assert.ok(Number(e.slice(6)) >= 2100)
  }
  // The first game is claimed, written and sent before 9502 is touched.
  assert.ok(
    h.events.indexOf(`claim:game:${String(REPLY_GAME)}`) < h.events.indexOf('fetch:game:9502'),
  )
  assert.equal(s.posted, 4)

  const [first, second] = [h.items.get(1)!, h.items.get(2)!]
  assert.equal(first.night, '2026-10-12')
  assert.equal(second.night, '2026-10-12')
  assert.equal(first.matchId, REPLY_GAME)
  assert.equal(first.replyTo, null)
  assert.equal(second.replyTo, first.id)
  assert.equal(first.isTest, false)
  assert.equal(first.discordStatus, 'posted')
  assert.equal(first.discordMessageId, 'm100')
  assert.ok(h.sent[1]!.content.startsWith('↪ to Dex Mercer: '))
  // Every write and review call is recorded against its job, with a cost.
  assert.equal(h.usage.length, 4)
  assert.deepEqual(
    h.usage.map((u) => [u.jobId, u.purpose]),
    [
      [1, 'write'],
      [1, 'review'],
      [2, 'write'],
      [2, 'review'],
    ],
  )
  assert.ok(h.usage.every((u) => u.costUsd > 0 && u.inputTokens === 1000))
})

void test('game: a candidate whose claim returns null is skipped (no write, no send)', async () => {
  const h = harness({ candidates: [501, 502], store: {} })
  const claim = h.deps.store.claimNewsJob
  h.deps.store.claimNewsJob = async (kind, key, isTest) =>
    key === '501' ? null : claim(kind, key, isTest)
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.has('game:501'), false)
  assert.equal(h.jobs.get('game:502')?.status, 'done')
  assert.equal(h.sent.length, 2)
  assert.equal(h.writerCalls.length, 2)
})

void test('game: facts unavailable ⇒ no claim, retried next pass', async () => {
  const h = harness({
    candidates: [501],
    deps: {
      fetchFacts: async () => {
        throw new Error('news facts HTTP 404')
      },
    },
  })
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.size, 0)
  assert.ok(logs(h.events).some((l) => l.includes('501') && l.includes('HTTP 404')))
})

void test('game: the writer gives up ⇒ job failed with the reason, nothing stored or sent', async () => {
  const h = harness({
    candidates: [501],
    deps: {
      writer: async (req) => ({ ...(await goodWriter(req)), refused: true }),
    },
  })
  const s = await runNewsCycle(h.deps, h.opts)
  const job = h.jobs.get('game:501')!
  assert.equal(job.status, 'failed')
  assert.equal(job.error, 'refused')
  assert.equal(h.items.size, 0)
  assert.equal(h.sent.length, 0)
  assert.equal(s.jobsFailed, 1)
})

void test('game: NewsJobError (400) ⇒ job failed, the next candidate is still written', async () => {
  let n = 0
  const h = harness({
    candidates: [501, 502],
    deps: {
      writer: async (req) => {
        if (n++ === 0) throw new NewsJobError('Anthropic API rejected the request: credit balance')
        return goodWriter(req)
      },
    },
  })
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.get('game:501')?.status, 'failed')
  assert.match(h.jobs.get('game:501')?.error ?? '', /credit balance/)
  assert.equal(h.jobs.get('game:502')?.status, 'done')
})

void test('game: NewsRetryableError ⇒ job failed, writing stops for this pass (API down)', async () => {
  const h = harness({
    candidates: [501, 502],
    deps: {
      writer: async () => {
        throw new NewsRetryableError('Anthropic API unavailable: overloaded')
      },
    },
  })
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.get('game:501')?.status, 'failed')
  assert.equal(h.jobs.has('game:502'), false)
})

void test('game: a failed job is claimed again on a later pass (attempts < 3)', async () => {
  let fail = true
  const h = harness({
    candidates: [501],
    deps: {
      writer: async (req) => {
        if (fail) throw new NewsJobError('bad request')
        return goodWriter(req)
      },
    },
  })
  await runNewsCycle(h.deps, h.opts)
  fail = false
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.get('game:501')?.status, 'done')
  assert.equal(h.jobs.get('game:501')?.attempts, 2)
})

void test('game: dry run ⇒ items is_test, files written, nothing sent', async () => {
  const h = harness({ candidates: [REPLY_GAME] })
  const s = await runNewsCycle(h.deps, { ...h.opts, dryRun: true })
  assert.equal(h.sent.length, 0)
  assert.equal(h.dry.length, 2)
  assert.ok(h.dry[1]!.payload.content.startsWith('↪ to Dex Mercer: '))
  assert.ok([...h.items.values()].every((i) => i.isTest && i.discordStatus === 'skipped'))
  assert.equal(h.jobs.get(`game:${String(REPLY_GAME)}`)?.status, 'done')
  assert.equal(s.dryRun, 2)
  assert.ok(!h.events.some((e) => e.startsWith('pause:')))
})

void test('game: dry run counts its own test items for the frequency limits', async () => {
  // Two overtime losses on the same night: Dex Mercer may write only once a night.
  const h = harness({ candidates: [501, 502] })
  await runNewsCycle(h.deps, { ...h.opts, dryRun: true })
  const mercer = [...h.items.values()].filter((i) => i.reporter === 'mercer')
  assert.equal(mercer.length, 1)
})

void test('game: WebhookOutcomeUnknownError ⇒ item not marked failed and never re-sent', async () => {
  let calls = 0
  const h = harness({
    candidates: [501],
    deps: {
      send: async () => {
        calls++
        if (calls === 1)
          throw new WebhookOutcomeUnknownError(
            'Discord webhook request outcome unknown (TimeoutError)',
          )
        return 'm9'
      },
    },
  })
  await runNewsCycle(h.deps, h.opts)
  const first = h.items.get(1)!
  assert.equal(first.discordStatus, 'pending')
  assert.equal(h.items.get(2)!.discordStatus, 'posted')
  assert.ok(!h.events.includes('item-failed:1'))
  assert.ok(logs(h.events).some((l) => l.includes('not retried')))
  await runNewsCycle(h.deps, h.opts)
  assert.equal(calls, 2)
})

void test('game: HTTP 429 ⇒ sending stops for the pass, the unsent post is kept for retry', async () => {
  let calls = 0
  const h = harness({
    candidates: [501, 502],
    deps: {
      send: async () => {
        calls++
        if (calls === 1) throw new Error('Discord webhook HTTP 429')
        return `m${String(calls)}`
      },
    },
  })
  await runNewsCycle(h.deps, h.opts)
  assert.equal(calls, 1)
  assert.equal(h.items.get(1)!.discordStatus, 'failed')
  assert.equal(h.items.get(2)!.discordStatus, 'failed')
  assert.equal(h.jobs.get('game:501')?.status, 'done')
  assert.equal(h.jobs.has('game:502'), false) // the pass ended
  // Next pass: both are re-sent (the reply keeps its prefix), then 502 is written.
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.items.get(1)!.discordStatus, 'posted')
  assert.equal(h.items.get(2)!.discordStatus, 'posted')
  assert.equal(h.jobs.get('game:502')?.status, 'done')
})

void test('undelivered: a failed send is retried; a reply keeps its "↪ to" prefix; an article keeps its link', async () => {
  const h = harness()
  const store = h.deps.store
  const a = await store.insertNewsItem({
    kind: 'post',
    reporter: 'barlow',
    body: 'First.',
    night: '2026-10-12',
  })
  await store.markNewsItemPosted(a, 'm1')
  const b = await store.insertNewsItem({
    kind: 'post',
    reporter: 'mercer',
    body: 'Second.',
    replyTo: a,
    night: '2026-10-12',
  })
  await store.markNewsItemFailed(b, 'Discord webhook HTTP 500')
  const c = await store.insertNewsItem({
    kind: 'article',
    reporter: 'quill',
    body: 'Body.',
    headline: 'Head',
    dek: 'Dek',
    slug: '2026-10-12-head',
    night: '2026-10-12',
  })
  await store.markNewsItemFailed(c, 'Discord webhook HTTP 500')
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.sent.length, 2)
  assert.equal(h.sent[0]!.content, '↪ to Wade Barlow: Second.')
  assert.ok(h.sent[1]!.content.endsWith('https://boogeymen.app/news/2026-10-12-head'))
  assert.equal(h.items.get(b)!.discordStatus, 'posted')
  assert.equal(h.items.get(c)!.discordStatus, 'posted')
})

void test('undelivered: not retried in a dry run (nothing is ever sent in test mode)', async () => {
  const h = harness()
  const b = await h.deps.store.insertNewsItem({ kind: 'post', reporter: 'barlow', body: 'X.' })
  await h.deps.store.markNewsItemFailed(b, 'Discord webhook HTTP 500')
  await runNewsCycle(h.deps, { ...h.opts, dryRun: true })
  assert.equal(h.sent.length, 0)
})

// ── Gates ───────────────────────────────────────────────────────────────────

void test('gates: disabled ⇒ only deletions run', async () => {
  const h = harness({ candidates: [501] })
  h.state.enabled = false
  h.state.deletions = [{ id: 7, messageId: 'm7' }]
  await runNewsCycle(h.deps, h.opts)
  assert.deepEqual(
    h.events.filter((e) => !e.startsWith('log:')),
    ['remove:m7', 'deleted:7'],
  )
  assert.equal(h.writerCalls.length, 0)
})

void test('gates: spend 9.6 of 10 ⇒ no writer call, one log line across two passes', async () => {
  const h = harness({ candidates: [501] })
  h.state.spend = 9.6
  h.state.nights = [{ night: '2026-10-12', lastEnd: new Date(NOW.getTime() - 120 * MIN) }]
  h.state.nightGames['2026-10-12'] = 2
  await runNewsCycle(h.deps, h.opts)
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.writerCalls.length, 0)
  assert.equal(h.jobs.size, 0)
  assert.equal(logs(h.events).filter((l) => l.includes('limit')).length, 1)
})

void test('gates: 9.4 of 10 ⇒ writes', async () => {
  const h = harness({ candidates: [501] })
  h.state.spend = 9.4
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.get('game:501')?.status, 'done')
})

void test('gates: NewsStopError ⇒ pass ends, later jobs untouched', async () => {
  let calls = 0
  const h = harness({
    candidates: [501, 502],
    deps: {
      writer: async () => {
        calls++
        throw new NewsStopError('Anthropic API refused the key (401): invalid x-api-key')
      },
    },
  })
  h.state.nights = [{ night: '2026-10-12', lastEnd: new Date(NOW.getTime() - 120 * MIN) }]
  h.state.nightGames['2026-10-12'] = 2
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.get('game:501')?.status, 'failed')
  assert.equal(h.jobs.has('game:502'), false)
  assert.equal(h.jobs.has('night:2026-10-12'), false)
  assert.equal(calls, 1)
})

void test('gates: after NewsStopError the desk waits an hour before writing again (no attempts burned)', async () => {
  let now = NOW
  let stop = true
  const h = harness({
    candidates: [501],
    deps: {
      now: () => now,
      writer: async (req) => {
        if (stop) throw new NewsStopError('Anthropic API refused the key (401)')
        return goodWriter(req)
      },
    },
  })
  await runNewsCycle(h.deps, h.opts)
  stop = false
  now = new Date(NOW.getTime() + 30 * MIN)
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.get('game:501')?.attempts, 1)
  now = new Date(NOW.getTime() + 61 * MIN)
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.get('game:501')?.status, 'done')
})

// ── Night jobs ──────────────────────────────────────────────────────────────

void test('night: ended 89 min ago ⇒ no article', async () => {
  const h = harness()
  h.state.nights = [{ night: '2026-10-12', lastEnd: new Date(NOW.getTime() - 89 * MIN) }]
  h.state.nightGames['2026-10-12'] = 2
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.items.size, 0)
  assert.equal(h.writerCalls.length, 0)
})

void test('night: ended 91 min ago ⇒ one article; Discord content ends with the article link', async () => {
  const h = harness()
  h.state.nights = [{ night: '2026-10-12', lastEnd: new Date(NOW.getTime() - 91 * MIN) }]
  h.state.nightGames['2026-10-12'] = 2
  const s = await runNewsCycle(h.deps, h.opts)
  assert.equal(h.items.size, 1)
  const a = h.items.get(1)!
  assert.equal(a.kind, 'article')
  assert.equal(a.night, '2026-10-12')
  assert.equal(a.weekStart, null)
  assert.equal(a.slug, '2026-10-12-a-long-night-on-the-ice')
  assert.equal(a.headline, 'A Long Night On The Ice')
  assert.equal(a.body, FILLER)
  assert.equal(h.sent.length, 1)
  assert.ok(h.sent[0]!.content.endsWith(`https://boogeymen.app/news/${a.slug!}`))
  assert.equal(h.jobs.get('night:2026-10-12')?.status, 'done')
  assert.equal(a.discordStatus, 'posted')
  assert.equal(s.posted, 1)
})

void test('night: a night with no counted game (all DNF) is claimed and skipped, never written', async () => {
  const h = harness()
  h.state.nights = [{ night: '2026-10-13', lastEnd: new Date(NOW.getTime() - 120 * MIN) }]
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.get('night:2026-10-13')?.status, 'skipped')
  assert.equal(h.writerCalls.length, 0)
  assert.ok(!h.events.some((e) => e.startsWith('fetch:night')))
})

// ── Week job ────────────────────────────────────────────────────────────────

// Monday 2026-10-26 in Edmonton is MDT (UTC-6): 12:00 local = 18:00Z.
const MONDAY_1159 = new Date('2026-10-26T17:59:00Z')
const MONDAY_1201 = new Date('2026-10-26T18:01:00Z')
const LAST_WEEK = [
  '2026-10-19',
  '2026-10-20',
  '2026-10-21',
  '2026-10-22',
  '2026-10-23',
  '2026-10-24',
  '2026-10-25',
]

void test('week: Monday 11:59 local ⇒ nothing', async () => {
  const h = harness({ deps: { now: () => MONDAY_1159 } })
  h.state.nightGames['2026-10-22'] = 3
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.size, 0)
  assert.equal(h.writerCalls.length, 0)
})

void test('week: Monday 12:01 with a game last week ⇒ one article for the week from Monday 2026-10-19', async () => {
  let counted: string[] = []
  const h = harness({ deps: { now: () => MONDAY_1201 } })
  const count = h.deps.store.countNightGames
  h.deps.store.countNightGames = async (n) => ((counted = n), count(n))
  h.state.nightGames['2026-10-22'] = 3
  await runNewsCycle(h.deps, h.opts)
  assert.deepEqual(counted, LAST_WEEK)
  assert.ok(h.events.includes('fetch:week:2026-10-19'))
  assert.equal(h.jobs.get('week:2026-10-19')?.status, 'done')
  assert.equal(h.items.size, 1)
  const a = h.items.get(1)!
  assert.equal(a.kind, 'article')
  assert.equal(a.weekStart, '2026-10-19')
  assert.equal(a.night, null)
  assert.ok(h.sent[0]!.content.endsWith(`https://boogeymen.app/news/${a.slug!}`))
  // Written once: the next pass sees the job.
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.items.size, 1)
})

void test('week: no feature yet ⇒ a trend column by Mara Quill; kind and prediction stored; Discord gets headline, dek, link (B3, B5, B7)', async () => {
  const prompts: string[] = []
  const h = harness({
    deps: {
      now: () => MONDAY_1201,
      writer: async (req) => {
        prompts.push(req.user)
        return goodWriter(req)
      },
    },
  })
  h.state.nightGames['2026-10-22'] = 3
  await runNewsCycle(h.deps, h.opts)
  const a = h.items.get(1)!
  assert.equal(a.reporter, 'quill')
  assert.equal(a.featureKind, 'trend')
  assert.equal(a.prediction, 'Someone finally beats the goalie.')
  assert.equal(a.weekStart, '2026-10-19')
  assert.deepEqual(a.criticized, [])
  // No receipt; the prediction closes the piece.
  assert.equal(a.body, [FILLER, FILLER, 'Someone finally beats the goalie.'].join('\n\n'))
  assert.ok(prompts[0]!.includes("Last week's prediction: none."))
  assert.ok(prompts[0]!.includes('"history"'))
  assert.equal(
    h.sent[0]!.content,
    `**The Week In Numbers**\nA week of hockey.\nhttps://boogeymen.app/news/${a.slug!}`,
  )
  assert.equal(h.sent[0]!.username, 'Mara Quill')
})

void test("week: the next kind after the last feature; last week's prediction goes in, the receipt opens the piece (B3, B5)", async () => {
  const prompts: string[] = []
  const h = harness({
    deps: {
      now: () => MONDAY_1201,
      writer: async (req) => {
        prompts.push(req.user)
        return goodWriter(req)
      },
    },
  })
  await h.deps.store.insertNewsItem({
    kind: 'article',
    reporter: 'pettibone',
    weekStart: '2026-10-12',
    slug: 'week-2026-10-12-notes',
    headline: 'Notes',
    body: 'x',
    featureKind: 'notes',
    prediction: 'The goalie steals one.',
  })
  h.state.nightGames['2026-10-22'] = 3
  await runNewsCycle(h.deps, h.opts)
  const a = h.items.get(2)!
  assert.equal(a.featureKind, 'bigpicture')
  assert.equal(a.reporter, 'bergstrom')
  assert.ok(prompts[0]!.includes(`Last week's prediction: "The goalie steals one."`))
  assert.ok(prompts[0]!.includes('the big picture, then the evidence'))
  assert.equal(
    a.body,
    ['It did not come true.', FILLER, FILLER, 'Someone finally beats the goalie.'].join('\n\n'),
  )
})

void test('week: after bigpicture comes Rink only when his 14-day limit allows (B3)', async () => {
  const run = async (rinkDaysAgo: number | null) => {
    const h = harness({ deps: { now: () => MONDAY_1201 } })
    await h.deps.store.insertNewsItem({
      kind: 'article',
      reporter: 'bergstrom',
      weekStart: '2026-10-12',
      slug: 'week-2026-10-12-big',
      headline: 'Big',
      body: 'x',
      featureKind: 'bigpicture',
      prediction: 'The goalie steals one.',
    })
    if (rinkDaysAgo !== null) {
      const id = await h.deps.store.insertNewsItem({
        kind: 'article',
        reporter: 'rink',
        night: '2026-10-15',
        slug: 'rink-night',
        headline: 'Rink',
        body: 'x',
      })
      h.items.get(id)!.createdAt = new Date(MONDAY_1201.getTime() - rinkDaysAgo * 86_400_000)
    }
    h.state.nightGames['2026-10-22'] = 3
    await runNewsCycle(h.deps, h.opts)
    return [...h.items.values()].at(-1)!
  }
  const allowed = await run(null)
  assert.deepEqual([allowed.featureKind, allowed.reporter], ['rink', 'rink'])
  const blocked = await run(10)
  assert.deepEqual([blocked.featureKind, blocked.reporter], ['trend', 'quill'])
})

void test('week: a prediction older than last week is not judged (spec §12.6)', async () => {
  const prompts: string[] = []
  const h = harness({
    deps: {
      now: () => MONDAY_1201,
      writer: async (req) => {
        prompts.push(req.user)
        return goodWriter(req)
      },
    },
  })
  await h.deps.store.insertNewsItem({
    kind: 'article',
    reporter: 'quill',
    weekStart: '2026-10-05',
    slug: 'week-2026-10-05-trend',
    headline: 'Trend',
    body: 'x',
    featureKind: 'trend',
    prediction: 'The goalie steals one.',
  })
  h.state.nightGames['2026-10-22'] = 3
  await runNewsCycle(h.deps, h.opts)
  assert.ok(prompts[0]!.includes("Last week's prediction: none."))
  assert.equal(h.items.get(2)!.featureKind, 'spotlight')
})

void test('week: a lastFeature error after the claim marks the job failed (I1.3)', async () => {
  const h = harness({
    deps: { now: () => MONDAY_1201 },
    store: {
      lastFeature: async () => {
        throw new Error('db down')
      },
    },
  })
  h.state.nightGames['2026-10-22'] = 3
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.get('week:2026-10-19')?.status, 'failed')
  assert.match(h.jobs.get('week:2026-10-19')?.error ?? '', /could not prepare: db down/)
})

void test('week: a week with no games ⇒ nothing', async () => {
  const h = harness({ deps: { now: () => MONDAY_1201 } })
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.size, 0)
  assert.equal(h.writerCalls.length, 0)
})

void test('week: not on a Tuesday', async () => {
  const h = harness({ deps: { now: () => new Date('2026-10-27T18:01:00Z') } })
  h.state.nightGames['2026-10-22'] = 3
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.size, 0)
})

// ── Deletions ───────────────────────────────────────────────────────────────

void test('deletions: a deleted posted item ⇒ remove(messageId) then markDiscordDeleted', async () => {
  const h = harness()
  h.state.deletions = [
    { id: 7, messageId: 'm7' },
    { id: 8, messageId: 'm8' },
  ]
  const s = await runNewsCycle(h.deps, h.opts)
  const ev = h.events.filter((e) => /^(remove|deleted|pause):/.test(e))
  assert.deepEqual(ev, ['remove:m7', 'deleted:7', 'pause:2100', 'remove:m8', 'deleted:8'])
  assert.equal(s.deleted, 2)
})

void test('deletions: a failed Discord delete is not marked (retried next pass) and never logs the URL', async () => {
  const h = harness({
    deps: {
      remove: async () => {
        throw new Error('Discord webhook delete HTTP 500')
      },
    },
  })
  h.state.deletions = [{ id: 7, messageId: 'm7' }]
  await runNewsCycle(h.deps, h.opts)
  assert.ok(!h.events.includes('deleted:7'))
  assert.ok(logs(h.events).some((l) => l.includes('HTTP 500')))
})

void test('deletions: run while out of money too', async () => {
  const h = harness()
  h.state.spend = 50
  h.state.deletions = [{ id: 7, messageId: 'm7' }]
  await runNewsCycle(h.deps, h.opts)
  assert.ok(h.events.includes('deleted:7'))
})

// ── Fix round 1 ─────────────────────────────────────────────────────────────

void test('undelivered: outcome unknown on a retry ⇒ marked skipped, never sent again', async () => {
  let calls = 0
  const h = harness({
    deps: {
      send: async () => {
        calls++
        throw new WebhookOutcomeUnknownError(
          'Discord webhook request outcome unknown (TimeoutError)',
        )
      },
    },
  })
  const b = await h.deps.store.insertNewsItem({ kind: 'post', reporter: 'barlow', body: 'X.' })
  await h.deps.store.markNewsItemFailed(b, 'Discord webhook HTTP 500')
  await runNewsCycle(h.deps, h.opts)
  assert.equal(calls, 1)
  assert.equal(h.items.get(b)!.discordStatus, 'skipped')
  assert.ok(h.events.some((e) => e.startsWith(`item-skipped:${String(b)}:outcome unknown`)))
  await runNewsCycle(h.deps, h.opts)
  assert.equal(calls, 1)
})

void test('week: a failed week job is claimed again on the next pass (still Monday ≥ 12:00)', async () => {
  let fail = true
  const h = harness({
    deps: {
      now: () => MONDAY_1201,
      writer: async (req) => {
        if (fail) throw new NewsJobError('Anthropic API rejected the request')
        return goodWriter(req)
      },
    },
  })
  h.state.nightGames['2026-10-22'] = 3
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.get('week:2026-10-19')?.status, 'failed')
  fail = false
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.get('week:2026-10-19')?.status, 'done')
  assert.equal(h.jobs.get('week:2026-10-19')?.attempts, 2)
  assert.equal(h.items.size, 1)
  // Settled: later passes do not fetch the week again.
  const fetches = h.events.filter((e) => e === 'fetch:week:2026-10-19').length
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.events.filter((e) => e === 'fetch:week:2026-10-19').length, fetches)
})

void test('gates: NewsRetryableError ⇒ no writing for 15 min; deletions and undelivered sends still run', async () => {
  let now = NOW
  let down = true
  const h = harness({
    candidates: [501],
    deps: {
      now: () => now,
      writer: async (req) => {
        if (down) throw new NewsRetryableError('Anthropic API unavailable: overloaded')
        return goodWriter(req)
      },
    },
  })
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.get('game:501')?.attempts, 1)
  down = false
  now = new Date(NOW.getTime() + 14 * MIN)
  h.state.deletions = [{ id: 7, messageId: 'm7' }]
  const b = await h.deps.store.insertNewsItem({ kind: 'post', reporter: 'barlow', body: 'X.' })
  await h.deps.store.markNewsItemFailed(b, 'Discord webhook HTTP 500')
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.get('game:501')?.attempts, 1)
  assert.ok(h.events.includes('deleted:7'))
  assert.equal(h.items.get(b)!.discordStatus, 'posted')
  now = new Date(NOW.getTime() + 16 * MIN)
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.get('game:501')?.status, 'done')
})

// ── Final fix wave ──────────────────────────────────────────────────────────

void test('game: a DB error after the claim (activity) marks the job failed, never leaves it pending (I1.3)', async () => {
  const h = harness({
    candidates: [501],
    store: {
      reporterActivity: async () => {
        throw new Error('connection reset')
      },
    },
  })
  const s = await runNewsCycle(h.deps, h.opts)
  const job = h.jobs.get('game:501')!
  assert.equal(job.status, 'failed')
  assert.match(job.error ?? '', /could not prepare: connection reset/)
  assert.equal(s.jobsFailed, 1)
  assert.equal(h.writerCalls.length, 0)
  assert.equal(h.items.size, 0)
})

void test('game: a failed "skipped" mark after the claim marks the job failed instead (I1.3)', async () => {
  const h = harness({
    candidates: [501],
    deps: {
      fetchFacts: async () => {
        const r = gameResponse(999) // the sheet has another game
        return r
      },
    },
  })
  const mark = h.deps.store.markNewsJob
  h.deps.store.markNewsJob = async (jobId, status, error) => {
    if (status === 'skipped') throw new Error('db down')
    return mark(jobId, status, error)
  }
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.get('game:501')?.status, 'failed')
})

void test('night: a DB error after the claim (own recent pieces) marks the job failed (I1.3)', async () => {
  const h = harness({
    store: {
      recentReporterPieces: async () => {
        throw new Error('connection reset')
      },
    },
  })
  h.state.nights = [{ night: '2026-10-12', lastEnd: new Date(NOW.getTime() - 91 * MIN) }]
  h.state.nightGames['2026-10-12'] = 2
  await runNewsCycle(h.deps, h.opts)
  const job = h.jobs.get('night:2026-10-12')!
  assert.equal(job.status, 'failed')
  assert.match(job.error ?? '', /could not prepare: connection reset/)
  assert.equal(h.writerCalls.length, 0)
  // Failed under the cap: the next pass claims it again and writes it.
  h.deps.store.recentReporterPieces = async () => []
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.jobs.get('night:2026-10-12')?.status, 'done')
  assert.equal(h.jobs.get('night:2026-10-12')?.attempts, 2)
})

void test('week: after a failed facts fetch the week is not fetched again for 15 minutes (M8)', async () => {
  let now = MONDAY_1201
  let down = true
  const h = harness({
    deps: {
      now: () => now,
      fetchFacts: async (kind, key) => {
        h.events.push(`fetch:${kind}:${key}`)
        if (down) throw new Error('news facts HTTP 500')
        const r = oct12Response(kind)
        return { ...r, facts: { ...r.facts, key } }
      },
    },
  })
  h.state.nightGames['2026-10-22'] = 3
  const fetches = () => h.events.filter((e) => e === 'fetch:week:2026-10-19').length
  await runNewsCycle(h.deps, h.opts)
  assert.equal(fetches(), 1)
  assert.equal(h.jobs.size, 0)
  now = new Date(MONDAY_1201.getTime() + 5 * MIN)
  await runNewsCycle(h.deps, h.opts)
  assert.equal(fetches(), 1, 'paused: not fetched again within 15 minutes')
  down = false
  now = new Date(MONDAY_1201.getTime() + 16 * MIN)
  await runNewsCycle(h.deps, h.opts)
  assert.equal(fetches(), 2)
  assert.equal(h.jobs.get('week:2026-10-19')?.status, 'done')
})

// ── Pile-on limit (rev 2, B4) ───────────────────────────────────────────────

void test("game: the night's harsh list goes into the prompt; a repeat is rewritten; criticized is stored", async () => {
  const userPrompts: string[] = []
  let writes = 0
  const h = harness({
    candidates: [501],
    store: { nightCriticized: async () => ['Skater A'] },
    deps: {
      writer: async (req) => {
        if (req.purpose === 'review') {
          userPrompts.push(req.user)
          return goodWriter(req)
        }
        userPrompts.push(req.user)
        writes++
        const ids = [...req.user.matchAll(/\(id "(\w+)"\)/g)].map((m) => m[1])
        return {
          refused: false,
          model: 'claude-opus-5-5',
          usage: { input_tokens: 1000, output_tokens: 100 },
          json: {
            posts: ids.map((id, i) => ({
              reporter: id,
              text: `The Boogeymen took 14 shots, says ${String(id)}.`,
              mentions: [],
              clubs: [],
              // First write: post 1 piles on Skater A. Rewrite: Goalie G, once.
              criticized: writes === 1 ? ['Skater A'] : i === 0 ? ['Goalie G'] : [],
              zeroCalled: [],
              stances: [],
              takesUsed: [],
            })),
          },
        }
      },
    },
  })
  await runNewsCycle(h.deps, h.opts)
  assert.ok(userPrompts[0]!.includes('Already criticised harshly tonight: Skater A.'))
  assert.ok(
    userPrompts[1]!.includes(
      'Skater A was already criticised harshly tonight — take another angle.',
    ),
  )
  assert.ok(
    userPrompts[2]!.includes('The writer listed these people as criticised harshly: Goalie G.'),
  )
  const stored = [...h.items.values()]
  assert.deepEqual(
    stored.map((i) => i.criticized),
    [['Goalie G'], []],
  )
  assert.equal(h.jobs.get('game:501')?.status, 'done')
})

void test('game: the second post may not pile on the first post of the same game', async () => {
  const h = harness({
    candidates: [501],
    deps: {
      writer: async (req) => {
        if (req.purpose === 'review') return goodWriter(req)
        const ids = [...req.user.matchAll(/\(id "(\w+)"\)/g)].map((m) => m[1])
        return {
          refused: false,
          model: 'claude-opus-5-5',
          usage: { input_tokens: 1000, output_tokens: 100 },
          json: {
            posts: ids.map((id) => ({
              reporter: id,
              text: 'Fine.',
              mentions: [],
              clubs: [],
              criticized: ['Goalie G'],
              zeroCalled: [],
              stances: [],
              takesUsed: [],
            })),
          },
        }
      },
    },
  })
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.items.size, 0)
  const job = h.jobs.get('game:501')!
  assert.equal(job.status, 'failed')
  assert.match(job.error ?? '', /Goalie G was already criticised harshly tonight/)
})

void test("night: the article's prompt carries the night's harsh list; criticized is stored", async () => {
  const prompts: string[] = []
  const h = harness({
    store: { nightCriticized: async (night) => (night === '2026-10-12' ? ['Goalie G'] : []) },
    deps: {
      writer: async (req) => {
        prompts.push(req.user)
        const r = await goodWriter(req)
        if (req.schema === ARTICLE_SCHEMA) {
          // Written in another spelling: stored as the sheet spells it (C1.9, Q7).
          return { ...r, json: { ...(r.json as object), criticized: ['skater  A'] } }
        }
        return r
      },
    },
  })
  h.state.nights = [{ night: '2026-10-12', lastEnd: new Date(NOW.getTime() - 91 * MIN) }]
  h.state.nightGames['2026-10-12'] = 2
  await runNewsCycle(h.deps, h.opts)
  assert.ok(prompts[0]!.includes('Already criticised harshly tonight: Goalie G.'))
  assert.deepEqual(h.items.get(1)!.criticized, ['Skater A'])
})

void test('C3a.4: zeroCalled, takesUsed and stances are stored with the item', async () => {
  const thread = {
    key: 'pp-drought@2026-10-08',
    kind: 'pp-drought' as const,
    subject: null,
    since: '2026-10-08',
    status: 'open' as const,
    summary: 'No power-play goal in 3 games with a chance.',
  }
  const h = harness({
    candidates: [501],
    deps: {
      fetchFacts: async (kind, key) => {
        const r = gameResponse(Number(key))
        return { ...r, facts: { ...r.facts, threads: [thread] } }
      },
      writer: async (req) => {
        const r = await goodWriter(req)
        if (req.schema !== GAME_POSTS_SCHEMA) return r
        const posts = (r.json as { posts: Record<string, unknown>[] }).posts.map((p, i) =>
          i === 0
            ? {
                ...p,
                zeroCalled: ['skater  a'],
                stances: [{ threadKey: thread.key, stance: 'It ends this week.' }],
              }
            : p,
        )
        return { ...r, json: { posts } }
      },
    },
  })
  await runNewsCycle(h.deps, h.opts)
  assert.deepEqual(logs(h.events), [])
  const first = h.items.get(1)!
  assert.deepEqual(first.zeroCalled, ['Skater A'])
  assert.deepEqual(first.takesUsed, [])
  assert.deepEqual(h.stances, [
    {
      threadKey: thread.key,
      reporter: first.reporter,
      stance: 'It ends this week.',
      night: '2026-10-12',
      itemId: 1,
    },
  ])
})

void test("C3a.5: the night's and the previous night's zero call-outs reach the check", async () => {
  const zeroWriter: ModelCall = async (req) => {
    const r = await goodWriter(req)
    if (req.schema !== GAME_POSTS_SCHEMA) return r
    const posts = (r.json as { posts: Record<string, unknown>[] }).posts.map((p, i) =>
      i === 0 ? { ...p, zeroCalled: ['Skater A'] } : p,
    )
    return { ...r, json: { posts } }
  }
  const tonight = harness({
    candidates: [501],
    store: { nightZeroCalled: async () => ({ tonight: ['Goalie G'], previous: [] }) },
    deps: { writer: zeroWriter },
  })
  await runNewsCycle(tonight.deps, tonight.opts)
  assert.equal(tonight.jobs.get('game:501')?.status, 'failed')
  assert.match(tonight.jobs.get('game:501')!.error!, /at most one per night/)
  const lastNight = harness({
    candidates: [501],
    store: { nightZeroCalled: async () => ({ tonight: [], previous: ['Skater A'] }) },
    deps: { writer: zeroWriter },
  })
  await runNewsCycle(lastNight.deps, lastNight.opts)
  assert.match(lastNight.jobs.get('game:501')!.error!, /two nights in a row/)
})

// ── C3a.7/C3a.8: buzz post counts and big-game articles ─────────────────────

function hugeGame(matchId: number): NewsGameFacts {
  const g = lossGame(matchId)
  // overtime 2 + blowout 3 + big upset 3 + blip 2 + the milestone 2 = 12, x1.25 = 15: huge.
  return {
    ...g,
    context: { ...g.context!, margin: 'blowout', surprise: 'big upset', result: 'blip' },
  }
}

const longWriter: ModelCall = async (req) => {
  const r = await goodWriter(req)
  if (req.schema !== ARTICLE_SCHEMA) return r
  const words = req.user.includes('400 to 700 words') ? 500 : 300
  return {
    ...r,
    json: {
      ...(r.json as object),
      paragraphs: [Array.from({ length: words }, () => 'hockey').join(' ')],
    },
  }
}

void test('C3a.7: a huge game gets 6-8 posts and a game story plus a spotlight or column', async () => {
  const h = harness({
    candidates: [701],
    deps: {
      fetchFacts: async (kind, key) => {
        const r = gameResponse(Number(key))
        return { ...r, facts: { ...r.facts, games: [hugeGame(Number(key))] } }
      },
      writer: longWriter,
    },
  })
  await runNewsCycle(h.deps, h.opts)
  assert.deepEqual(logs(h.events), [])
  const posts = [...h.items.values()].filter((i) => i.kind === 'post')
  const plan = planBuzz(hugeGame(701), gameResponse(701).facts)
  assert.equal(plan.level, 'huge')
  assert.equal(posts.length, plan.posts)
  assert.ok(posts.length >= 6 && posts.length <= 8)
  assert.equal(new Set(posts.map((p) => p.reporter)).size, posts.length)
  const articles = [...h.items.values()].filter((i) => i.kind === 'article')
  assert.equal(articles.length, 2)
  for (const a of articles) {
    assert.equal(a.matchId, 701)
    assert.equal(a.night, '2026-10-12')
    assert.equal(a.weekStart, null)
    assert.ok(a.slug!.startsWith('2026-10-12-g701-'))
  }
  assert.equal(articles[0]!.featureKind, null) // the game story
  assert.ok(['spotlight', 'bigpicture'].includes(articles[1]!.featureKind ?? ''))
  assert.equal(h.jobs.get('game_article:701:game')?.status, 'done')
  assert.equal([...h.jobs.keys()].filter((k) => k.startsWith('game_article:701:')).length, 2)
  // Discord gets each article as headline, dek, link.
  assert.ok(h.sent.some((p) => p.content.includes('/news/2026-10-12-g701-')))
})

void test('C3a.8: a failed game article is written again on a later pass, posts are not', async () => {
  let fail = true
  const h = harness({
    candidates: [701],
    deps: {
      fetchFacts: async (kind, key) => {
        const r = gameResponse(Number(key))
        return { ...r, facts: { ...r.facts, games: [hugeGame(Number(key))] } }
      },
      writer: async (req) =>
        fail && req.schema === ARTICLE_SCHEMA ? goodWriter(req) : longWriter(req),
    },
  })
  await runNewsCycle(h.deps, h.opts)
  const failed = [...h.jobs.values()].filter(
    (j) => j.kind === 'game_article' && j.status === 'failed',
  )
  assert.ok(failed.length >= 1)
  const postsBefore = [...h.items.values()].filter((i) => i.kind === 'post').length
  fail = false
  h.state.candidates = []
  h.deps.store.listGameArticleRetries = async () =>
    [...h.jobs.values()]
      .filter((j) => j.kind === 'game_article' && j.status === 'failed' && j.attempts < 3)
      .map((j) => j.key)
  await runNewsCycle(h.deps, h.opts)
  assert.ok(
    [...h.jobs.values()].filter((j) => j.kind === 'game_article').every((j) => j.status === 'done'),
  )
  assert.equal([...h.items.values()].filter((i) => i.kind === 'post').length, postsBefore)
})

// ── C3a.6: reporter takes ───────────────────────────────────────────────────

const TAKE = {
  id: 7,
  reporter: 'mercer' as const,
  critics: [
    'voss',
    'barlow',
    'halberd',
    'vale',
    'quill',
    'rink',
    'pettibone',
    'bergstrom',
  ] as const,
  defender: null,
  playerId: 1,
  player: 'Skater A',
  take: 'INVENTED TAKE TEXT for a test.',
  spread: 'some' as const,
  dataAngle: 'shots per game',
  intensity: 0,
  mild: false,
}

void test('C3a.6: a due take reaches the prompt, takesUsed is stored; never in facts or Discord; not due after use', async () => {
  const prompts: string[] = []
  let used: { takeId: number; lastUsed: Date }[] = []
  const h = harness({
    candidates: [REPLY_GAME],
    store: { takesUsedSince: async () => used },
    deps: {
      fetchFacts: async (kind, key) => ({
        ...gameResponse(Number(key)),
        takes: [{ ...TAKE, critics: [...TAKE.critics] }],
      }),
      writer: async (req) => {
        if (req.purpose === 'write') prompts.push(req.user)
        const r = await goodWriter(req)
        if (req.schema !== GAME_POSTS_SCHEMA) return r
        const posts = (r.json as { posts: Record<string, unknown>[] }).posts.map((p, i) =>
          i === 1 && req.user.includes('Take 7 on') ? { ...p, takesUsed: [7] } : p,
        )
        return { ...r, json: { posts } }
      },
    },
  })
  await runNewsCycle(h.deps, h.opts)
  assert.deepEqual(logs(h.events), [])
  assert.ok(prompts[0]!.includes('Take 7 on Skater A: INVENTED TAKE TEXT'))
  const second = h.items.get(2)!
  assert.deepEqual(second.takesUsed, [7])
  for (const i of h.items.values()) assert.ok(!JSON.stringify(i.facts).includes('INVENTED TAKE'))
  for (const p of h.sent) assert.ok(!JSON.stringify(p).includes('INVENTED TAKE'))
  // Used two days ago: not due, so a later game's prompt has no take.
  used = [{ takeId: 7, lastUsed: new Date(NOW.getTime() - 2 * 86_400_000) }]
  h.state.candidates = [9701]
  const before = prompts.length
  await runNewsCycle(h.deps, h.opts)
  assert.deepEqual(logs(h.events), [])
  assert.equal(prompts.length, before + 1)
  assert.ok(!prompts.at(-1)!.includes('Take 7'), prompts.at(-1))
})

void test("C3a.3: the night article sees the night posts and each prompt the reporter's own pieces", async () => {
  const prompts: string[] = []
  const h = harness({
    candidates: [REPLY_GAME],
    store: {
      recentReporterPieces: async (r) => [
        { kind: 'post', text: `OLD PIECE BY ${r}`, night: '2026-10-05' },
      ],
    },
    deps: {
      writer: async (req) => {
        if (req.purpose === 'write') prompts.push(req.user)
        return goodWriter(req)
      },
    },
  })
  h.state.nights = [{ night: '2026-10-12', lastEnd: new Date(NOW.getTime() - 91 * MIN) }]
  h.state.nightGames['2026-10-12'] = 2
  await runNewsCycle(h.deps, h.opts)
  assert.ok(prompts[0]!.includes('OLD PIECE BY mercer'))
  const night = prompts.find((p) => p.includes('one article about the whole night'))!
  assert.ok(
    night.includes(
      "Tonight's posts, oldest first. Reuse their numbers only to draw a new conclusion:",
    ),
  )
  assert.ok(night.includes('- Dex Mercer: The Boogeymen took 14 shots, says mercer.'))
})

void test('C3b.2: every item carries the rules version: posts, night article and weekly feature', async () => {
  const h = harness({ candidates: [REPLY_GAME] })
  h.state.nights = [{ night: '2026-10-12', lastEnd: new Date(NOW.getTime() - 91 * MIN) }]
  h.state.nightGames['2026-10-12'] = 2
  await runNewsCycle(h.deps, h.opts)
  assert.ok(h.items.size >= 3)
  for (const item of h.items.values()) assert.equal(item.rulesVersion, NEWS_RULES_VERSION)
  const w = harness({ deps: { now: () => MONDAY_1201 } })
  w.state.nightGames['2026-10-22'] = 3
  await runNewsCycle(w.deps, w.opts)
  assert.equal(w.items.get(1)!.rulesVersion, NEWS_RULES_VERSION)
})

void test('C3b.3: a benched reporter writes nothing: game posts, the night article, the weekly feature', async () => {
  // Without a bench Mercer writes this game's recap and Quill the trend column.
  const base = harness({ candidates: [REPLY_GAME] })
  await runNewsCycle(base.deps, base.opts)
  assert.equal(base.items.get(1)!.reporter, 'mercer')

  const h = harness({ candidates: [REPLY_GAME] })
  h.state.disabled = ['mercer', 'quill', 'vale']
  h.state.nights = [{ night: '2026-10-12', lastEnd: new Date(NOW.getTime() - 91 * MIN) }]
  h.state.nightGames['2026-10-12'] = 2
  await runNewsCycle(h.deps, h.opts)
  assert.ok(h.items.size >= 3)
  for (const item of h.items.values()) {
    assert.ok(!['mercer', 'quill', 'vale'].includes(item.reporter), item.reporter)
  }

  const w = harness({ deps: { now: () => MONDAY_1201 } })
  w.state.disabled = ['quill']
  w.state.nightGames['2026-10-22'] = 3
  await runNewsCycle(w.deps, w.opts)
  assert.equal(w.items.get(1)!.reporter, 'voss')
  assert.equal(w.items.get(1)!.featureKind, 'spotlight')
})

void test('C3b.3: every reporter off ⇒ nothing is written, one log line across passes; one back on ⇒ writes', async () => {
  const h = harness({ candidates: [REPLY_GAME] })
  h.state.disabled = [...REPORTER_IDS]
  await runNewsCycle(h.deps, h.opts)
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.items.size, 0)
  assert.equal(h.writerCalls.length, 0)
  assert.equal(h.jobs.size, 0)
  assert.equal(logs(h.events).filter((l) => l.includes('every reporter is switched off')).length, 1)
  h.state.disabled = REPORTER_IDS.filter((r) => r !== 'barlow')
  await runNewsCycle(h.deps, h.opts)
  assert.ok(h.items.size > 0)
  assert.ok([...h.items.values()].every((i) => i.reporter === 'barlow'))
})

void test('C3b.3: the switch cannot be read ⇒ nothing is written this pass', async () => {
  const h = harness({
    candidates: [REPLY_GAME],
    store: {
      listDisabledReporters: async () => {
        throw new Error('db down')
      },
    },
  })
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.items.size, 0)
  assert.equal(h.writerCalls.length, 0)
  assert.ok(logs(h.events).some((l) => l.includes('switches could not be read')))
})

// ── C3b.4: big-game posts are sent a few minutes apart ──────────────────────

const hugeHarness = (clock: { t: Date }, extra: Partial<NewsDeps> = {}) =>
  harness({
    candidates: [701],
    deps: {
      now: () => clock.t,
      fetchFacts: async (kind, key) => {
        const r = gameResponse(Number(key))
        return { ...r, facts: { ...r.facts, games: [hugeGame(Number(key))] } }
      },
      writer: longWriter,
      ...extra,
    },
  })

void test('C3b.4: a huge game sends the recap now; the other posts wait 3 minutes apart', async () => {
  assert.equal(NEWS_POST_SPACING_MS, 3 * 60_000)
  const clock = { t: NOW }
  const h = hugeHarness(clock)
  await runNewsCycle(h.deps, h.opts)
  const posts = [...h.items.values()].filter((i) => i.kind === 'post')
  assert.ok(posts.length >= 6)
  assert.equal(posts[0]!.sendAfter, null)
  assert.equal(posts[0]!.discordStatus, 'posted')
  posts.slice(1).forEach((p, i) => {
    assert.equal(p.sendAfter?.getTime(), NOW.getTime() + (i + 1) * NEWS_POST_SPACING_MS)
    assert.equal(p.discordStatus, 'pending')
  })
  // Only the recap and the two articles went out; the job is done (the writing is finished).
  const postNames = h.sent.filter((p) => !p.content.includes('/news/')).map((p) => p.username)
  assert.deepEqual(postNames, [REPORTERS[posts[0]!.reporter].name])
  assert.equal(h.jobs.get('game:701')?.status, 'done')
})

void test('C3b.4: later passes send the posts whose time has come, in order, never twice', async () => {
  const clock = { t: NOW }
  const h = hugeHarness(clock)
  await runNewsCycle(h.deps, h.opts)
  const posts = [...h.items.values()].filter((i) => i.kind === 'post')
  const before = h.sent.length
  // 1 minute later: nothing is due.
  clock.t = new Date(NOW.getTime() + 60_000)
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.sent.length, before)
  // 7 minutes later: posts 2 and 3 (due at +3 and +6 minutes) go out, oldest first.
  clock.t = new Date(NOW.getTime() + 7 * 60_000)
  await runNewsCycle(h.deps, h.opts)
  assert.deepEqual(
    h.sent.slice(before).map((p) => p.username),
    [posts[1]!, posts[2]!].map((p) => REPORTERS[p.reporter].name),
  )
  assert.equal(posts[1]!.discordStatus, 'posted')
  assert.equal(posts[2]!.discordStatus, 'posted')
  assert.equal(posts[3]!.discordStatus, 'pending')
  // The same pass again sends nothing twice.
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.sent.length, before + 2)
  // All of them, once the last is due.
  clock.t = new Date(NOW.getTime() + 60 * 60_000)
  await runNewsCycle(h.deps, h.opts)
  assert.ok(posts.every((p) => p.discordStatus === 'posted'))
  assert.equal(h.sent.length, before + posts.length - 1)
})

void test('C3b.4: due posts still go out when the money limit is reached or a pass has nothing else to do', async () => {
  const clock = { t: NOW }
  const h = hugeHarness(clock)
  await runNewsCycle(h.deps, h.opts)
  const before = h.sent.length
  h.state.spend = 9.8
  h.state.candidates = []
  clock.t = new Date(NOW.getTime() + 10 * 60_000)
  await runNewsCycle(h.deps, h.opts)
  assert.ok(h.sent.length > before)
})

void test('C3b.4: a deleted or switched-off desk sends no waiting posts; a deleted post is never sent', async () => {
  const clock = { t: NOW }
  const h = hugeHarness(clock)
  await runNewsCycle(h.deps, h.opts)
  const posts = [...h.items.values()].filter((i) => i.kind === 'post')
  const before = h.sent.length
  clock.t = new Date(NOW.getTime() + 60 * 60_000)
  h.state.enabled = false
  await runNewsCycle(h.deps, h.opts)
  assert.equal(h.sent.length, before)
  h.state.enabled = true
  posts[1]!.deletedAt = NOW
  await runNewsCycle(h.deps, h.opts)
  assert.equal(posts[1]!.discordStatus, 'pending')
  assert.equal(h.sent.length, before + posts.length - 2)
})

void test('C3b.4: an unknown send outcome is not sent again; a normal game and a dry run are not spaced', async () => {
  const clock = { t: NOW }
  let calls = 0
  const h = hugeHarness(clock, {
    send: async (payload) => {
      calls++
      // Calls 1-3: the recap and the two articles of the first pass. 4: the first waiting post.
      if (calls === 4) throw new WebhookOutcomeUnknownError('timeout after the request left')
      return `m${String(calls)}`
    },
  })
  await runNewsCycle(h.deps, h.opts)
  clock.t = new Date(NOW.getTime() + 60 * 60_000)
  await runNewsCycle(h.deps, h.opts)
  const afterFirst = calls
  await runNewsCycle(h.deps, h.opts)
  assert.equal(calls, afterFirst, 'the unknown one is claimed and never retried')

  const normal = harness({ candidates: [REPLY_GAME] })
  await runNewsCycle(normal.deps, normal.opts)
  assert.ok([...normal.items.values()].every((i) => i.sendAfter === null))
  assert.ok([...normal.items.values()].every((i) => i.discordStatus === 'posted'))

  const dry = hugeHarness({ t: NOW })
  dry.opts.dryRun = true
  await runNewsCycle(dry.deps, dry.opts)
  assert.ok([...dry.items.values()].every((i) => i.sendAfter === null))
})
