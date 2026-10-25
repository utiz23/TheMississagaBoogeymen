import test from 'node:test'
import assert from 'node:assert/strict'
import type { NewNewsItem, NewNewsUsage, NewsItemRow } from '@eanhl/db/queries'
import type { NewsFactsResponse, NewsGameFacts } from '@eanhl/db/news'
import { WebhookOutcomeUnknownError } from '../webhook.ts'
import {
  createNewsCycleState,
  NEWS_GAME_WINDOW_MS,
  runNewsCycle,
  type NewsCycleOptions,
  type NewsDeps,
  type NewsStore,
} from './cycle.ts'
import type { NewsWebhookPayload } from './messages.ts'
import { ARTICLE_SCHEMA, GAME_POSTS_SCHEMA, REVIEW_SCHEMA } from './outputs.ts'
import { oct12Response } from './test-fixtures.ts'
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

/** A one-goal loss: Wade Barlow writes, Dex Mercer replies (mercer → barlow relationship). */
function lossGame(matchId: number): NewsGameFacts {
  const base = oct12Response('game').facts.games[0]!
  return { ...base, matchId, scoreFor: 2, scoreAgainst: 3 }
}

function gameResponse(matchId: number): NewsFactsResponse {
  const r = oct12Response('game')
  return { ...r, facts: { ...r.facts, games: [lossGame(matchId)] } }
}

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
          text: `The Boogeymen kept skating, says ${String(id)}.`,
          mentions: [],
          clubs: [],
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
    reporterActivity: async () =>
      [...items.values()]
        .filter((i) => !i.isTest)
        .map((i) => ({ reporter: i.reporter, night: i.night, createdAt: i.createdAt })),
    recentReporterSummaries: async () => [],
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
  return { deps, opts, state, events, jobs, items, usage, sent, dry, writerCalls }
}

const logs = (events: string[]) => events.filter((e) => e.startsWith('log:'))

// ── Game jobs ───────────────────────────────────────────────────────────────

void test('game: two candidates ⇒ two jobs, posts sent in order with a pause between sends, jobs done', async () => {
  const h = harness({ candidates: [501, 502] })
  const s = await runNewsCycle(h.deps, h.opts)
  assert.ok(h.events.includes(`candidates:${String(NEWS_GAME_WINDOW_MS)}:5`))
  assert.equal(NEWS_GAME_WINDOW_MS, 86_400_000)
  assert.equal(h.jobs.get('game:501')?.status, 'done')
  assert.equal(h.jobs.get('game:502')?.status, 'done')
  assert.deepEqual(
    h.sent.map((p) => p.username),
    // Same night: Dex Mercer has had his one item, so Mara Quill takes the second slot.
    ['Wade Barlow', 'Dex Mercer', 'Wade Barlow', 'Mara Quill'],
  )
  // A pause before every send but the first, each at least 2.1 s.
  const sendIdx = h.events.flatMap((e, i) => (e.startsWith('send:') ? [i] : []))
  for (const i of sendIdx.slice(1)) assert.match(h.events[i - 1]!, /^pause:(\d+)$/)
  for (const e of h.events.filter((x) => x.startsWith('pause:'))) {
    assert.ok(Number(e.slice(6)) >= 2100)
  }
  // 501 is claimed, written and sent before 502 is touched.
  assert.ok(h.events.indexOf('claim:game:501') < h.events.indexOf('fetch:game:502'))
  assert.equal(s.posted, 4)

  const [first, second] = [h.items.get(1)!, h.items.get(2)!]
  assert.equal(first.night, '2026-10-12')
  assert.equal(second.night, '2026-10-12')
  assert.equal(first.matchId, 501)
  assert.equal(first.replyTo, null)
  assert.equal(second.replyTo, first.id)
  assert.equal(first.isTest, false)
  assert.equal(first.discordStatus, 'posted')
  assert.equal(first.discordMessageId, 'm100')
  assert.ok(h.sent[1]!.content.startsWith('↪ to Wade Barlow: '))
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
  const h = harness({ candidates: [501] })
  const s = await runNewsCycle(h.deps, { ...h.opts, dryRun: true })
  assert.equal(h.sent.length, 0)
  assert.equal(h.dry.length, 2)
  assert.ok(h.dry[1]!.payload.content.startsWith('↪ to Wade Barlow: '))
  assert.ok([...h.items.values()].every((i) => i.isTest && i.discordStatus === 'skipped'))
  assert.equal(h.jobs.get('game:501')?.status, 'done')
  assert.equal(s.dryRun, 2)
  assert.ok(!h.events.some((e) => e.startsWith('pause:')))
})

void test('game: dry run counts its own test items for the frequency limits', async () => {
  // Two one-goal losses on the same night: Dex Mercer may write only once a night.
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
