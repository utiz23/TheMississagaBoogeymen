import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  REPORTERS,
  planBuzz,
  type NewsFactsResponse,
  type NewsGameFacts,
  type ReporterId,
} from '@eanhl/db/news'
import type { NewNewsItem, NewNewsStance } from '@eanhl/db/queries'
import { assignGamePosts } from './assign.ts'
import { classifyGame } from './situation.ts'
import {
  ARTICLE_DELAY_MS,
  edmontonNoon,
  evaluateJob,
  featureCreatedAt,
  importAccepted,
  itemCreatedAt,
  main,
  planBackfill,
  planNextFeature,
  readJobs,
  runCheck,
  writePlan,
  type BackfillJob,
  type BackfillStore,
} from './backfill.ts'
import { FEATURE_SCHEMA } from './outputs.ts'
import {
  EMPTY_DESK_CONTEXT,
  buildReviewPrompt,
  buildSystemPrompt,
  REVIEW_SYSTEM_PROMPT,
} from './prompts.ts'
import { oct12Facts } from './test-fixtures.ts'

// ── Fakes ────────────────────────────────────────────────────────────────────

const base = oct12Facts('game').games[0]!
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00.000Z`

/**
 * A 2-3 overtime loss in 6s with a close margin: normal buzz (2 posts), Mercer's recap
 * (ot_loss). `REPLY_ID` is a match id whose seeded second post replies to the recap.
 */
function replyGame(matchId: number, night: string, playedAt: string): NewsGameFacts {
  return {
    ...base,
    matchId,
    night,
    playedAt,
    result: 'OTL',
    overtime: true,
    scoreFor: 2,
    scoreAgainst: 3,
    context: {
      result: 'normal',
      streakBefore: null,
      streakAfter: { kind: 'L', count: 1 },
      last10: { wins: 6, losses: 3, otl: 1 },
      margin: 'close',
      surprise: 'expected',
      night: [],
    },
  }
}

const REPLY_ID = (() => {
  for (let id = 250; id < 700; id++) {
    const facts = { ...oct12Facts('game'), key: '2026-05-08' }
    const game = replyGame(id, '2026-05-08', at('2026-05-09', '02:00'))
    facts.games = [game]
    const p = assignGamePosts({
      game,
      facts,
      situation: classifyGame(game),
      plan: planBuzz(game, facts),
      now: new Date(game.playedAt),
      night: '2026-05-08',
      activity: [],
    })
    if (p.length === 2 && p[1]!.replyTo === 0) return id
  }
  throw new Error('no reply game')
})()

/** A 0-6 loss (blowout_loss: Mercer is first choice) ending at `playedAt`. */
function loss(matchId: number, night: string, playedAt: string): NewsGameFacts {
  return { ...base, matchId, night, playedAt, result: 'LOSS', scoreFor: 0, scoreAgainst: 6 }
}

/** Nights → games; the fake web app serves night and game sheets from it. */
function fakeWeb(nights: Record<string, NewsGameFacts[]>) {
  const calls: string[] = []
  const fetchFacts = (kind: 'game' | 'night' | 'week', key: string): Promise<NewsFactsResponse> => {
    calls.push(`${kind}/${key}`)
    const forbiddenNames = ['Hidden Hank']
    if (kind === 'night') {
      const games = nights[key]
      if (!games) return Promise.reject(new Error('news night facts HTTP 404'))
      return Promise.resolve({
        facts: { ...oct12Facts('night'), key, games },
        forbiddenNames,
        takes: [],
      })
    }
    const g = Object.values(nights)
      .flat()
      .find((x) => String(x.matchId) === key)
    if (!g) return Promise.reject(new Error('news game facts HTTP 404'))
    return Promise.resolve({
      facts: { ...oct12Facts('game'), key: g.night, games: [g] },
      forbiddenNames,
      takes: [],
    })
  }
  return { calls, fetchFacts }
}

function reportersByNight(jobs: BackfillJob[]): Map<string, ReporterId[]> {
  const out = new Map<string, ReporterId[]>()
  for (const j of jobs) out.set(j.night, [...(out.get(j.night) ?? []), ...j.reporters])
  return out
}

// ── plan ─────────────────────────────────────────────────────────────────────

void test('plan: nights in date order, game jobs then the night article, sortable ids', async () => {
  const web = fakeWeb({
    '2026-05-09': [loss(301, '2026-05-09', at('2026-05-10', '03:00'))],
    '2026-05-08': [
      loss(250, '2026-05-08', at('2026-05-09', '02:00')),
      loss(251, '2026-05-08', at('2026-05-09', '02:40')),
    ],
  })
  const plan = await planBackfill({ nights: ['2026-05-09', '2026-05-08'], ...web })
  assert.deepEqual(
    plan.jobs.map((j) => j.id),
    [
      '2026-05-08-a01-g250',
      '2026-05-08-a02-g251',
      '2026-05-08-z-night',
      '2026-05-09-a01-g301',
      '2026-05-09-z-night',
    ],
  )
  assert.deepEqual(
    plan.jobs.map((j) => j.id),
    [...plan.jobs.map((j) => j.id)].sort(),
  )
  assert.deepEqual(web.calls, [
    'night/2026-05-08',
    'game/250',
    'game/251',
    'night/2026-05-09',
    'game/301',
  ])
  const g = plan.jobs[0]!
  assert.equal(g.kind, 'game')
  assert.equal(g.matchId, 250)
  assert.equal(g.night, '2026-05-08')
  assert.equal(g.sheet.facts.kind, 'game')
  // A plain 0-6 loss is a quiet game (buzz): one post, the recap.
  assert.equal(g.reporters.length, 1)
  assert.deepEqual(
    g.posts?.map((p) => p.angle),
    ['recap'],
  )
  assert.ok(g.user.includes('Fact sheet (JSON):'))
  assert.ok(g.user.includes('exactly one post'))
  const n = plan.jobs[2]!
  assert.equal(n.kind, 'night')
  assert.equal(n.matchId, undefined)
  assert.equal(n.reporters.length, 1)
  assert.equal(n.sheet.facts.kind, 'night')
  assert.ok(n.user.includes('one article about the whole night'))
  assert.equal(plan.system, buildSystemPrompt(Object.values(REPORTERS)))
  assert.equal(plan.reviewSystem, REVIEW_SYSTEM_PROMPT)
})

void test('plan: Dex Mercer at most once a night and 3 times in 7 days across the backfill', async () => {
  const nights: Record<string, NewsGameFacts[]> = {}
  let id = 400
  for (const day of ['01', '02', '03', '04', '05', '06']) {
    const night = `2026-05-${day}`
    const next = `2026-05-${String(Number(day) + 1).padStart(2, '0')}`
    nights[night] = [loss(id++, night, at(next, '02:00')), loss(id++, night, at(next, '02:40'))]
  }
  const plan = await planBackfill({ nights: Object.keys(nights), ...fakeWeb(nights) })
  const byNight = reportersByNight(plan.jobs)
  const mercerNights: string[] = []
  for (const [night, rs] of byNight) {
    const count = rs.filter((r) => r === 'mercer').length
    assert.ok(count <= 1, `${night}: Mercer ${String(count)} times`)
    if (count === 1) mercerNights.push(night)
  }
  // Three nights in a row, then the 7-day limit holds him back.
  assert.deepEqual(mercerNights, ['2026-05-01', '2026-05-02', '2026-05-03'])
})

void test('plan: Father Rink at most once in 14 days across the backfill', async () => {
  // A winless night of 4+ games puts Rink first for the article.
  const winless = (night: string, next: string, first: number) =>
    [0, 1, 2, 3].map((i) => loss(first + i, night, at(next, `0${String(i)}:00`)))
  const nights = {
    '2026-05-01': winless('2026-05-01', '2026-05-02', 500),
    '2026-05-08': winless('2026-05-08', '2026-05-09', 510),
    '2026-05-20': winless('2026-05-20', '2026-05-21', 520),
  }
  const plan = await planBackfill({ nights: Object.keys(nights), ...fakeWeb(nights) })
  const articles = plan.jobs.filter((j) => j.kind === 'night')
  assert.deepEqual(
    articles.map((a) => a.reporters[0] === 'rink'),
    [true, false, true],
  )
})

void test('plan: a night the web app does not have stops the plan', async () => {
  await assert.rejects(
    planBackfill({ nights: ['2026-05-30'], ...fakeWeb({}) }),
    /2026-05-30.*HTTP 404/,
  )
  await assert.rejects(planBackfill({ nights: ['May 8'], ...fakeWeb({}) }), /not a YYYY-MM-DD/)
})

void test('plan files: system prompts, review schema and one job file per item; no overwrite', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'backfill-plan-'))
  try {
    const nights = { '2026-05-08': [loss(250, '2026-05-08', at('2026-05-09', '02:00'))] }
    const plan = await planBackfill({ nights: ['2026-05-08'], ...fakeWeb(nights) })
    writePlan(dir, plan)
    assert.equal(readFileSync(join(dir, 'system.txt'), 'utf8'), plan.system)
    assert.equal(readFileSync(join(dir, 'review-system.txt'), 'utf8'), REVIEW_SYSTEM_PROMPT)
    assert.ok(JSON.parse(readFileSync(join(dir, 'review-schema.json'), 'utf8')).properties.ok)
    assert.deepEqual(readdirSync(join(dir, 'jobs')).sort(), [
      '2026-05-08-a01-g250.json',
      '2026-05-08-z-night.json',
    ])
    const back = readJobs(dir)
    assert.deepEqual(back, plan.jobs)
    assert.throws(() => writePlan(dir, plan), /already has jobs/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── check ────────────────────────────────────────────────────────────────────

async function oneGameJob(): Promise<BackfillJob> {
  // oct12 game 1 is a 2-6 loss to Shake N Bake.
  const g: NewsGameFacts = { ...base, night: '2026-05-08', playedAt: at('2026-05-09', '02:00') }
  const web = fakeWeb({ '2026-05-08': [g] })
  const plan = await planBackfill({ nights: ['2026-05-08'], ...web })
  return plan.jobs[0]!
}

function goodAnswer(job: BackfillJob): string {
  return JSON.stringify({
    posts: job.reporters.map((r) => ({
      reporter: r,
      text: 'Skater A scored in a 2-6 loss to Shake N Bake.',
      mentions: ['Skater A'],
      clubs: ['Shake N Bake'],
      criticized: [],
      zeroCalled: [],
      stances: [],
      takesUsed: [],
    })),
  })
}

void test('check: no answer waits; bad JSON or a bad shape is a rewrite', async () => {
  const job = await oneGameJob()
  assert.deepEqual(evaluateJob(job, null, null), { state: 'waiting' })
  const bad = evaluateJob(job, '{"posts": [', null)
  assert.equal(bad.state, 'rewrite')
  assert.ok(bad.state === 'rewrite' && /not valid JSON/.test(bad.problems[0]!))
  const shape = evaluateJob(job, JSON.stringify({ posts: [] }), null)
  assert.equal(shape.state, 'rewrite')
  assert.ok(shape.state === 'rewrite' && /posts/.test(shape.problems[0]!))
})

void test('check: a failed fact check is a rewrite with the problems and the rewrite prompt', async () => {
  const job = await oneGameJob()
  const answer = JSON.stringify({
    posts: job.reporters.map((r) => ({
      reporter: r,
      text: 'They won 7-1 at 12:34 of the third.',
      mentions: [],
      clubs: [],
      criticized: [],
      zeroCalled: [],
      stances: [],
      takesUsed: [],
    })),
  })
  const e = evaluateJob(job, answer, null)
  assert.equal(e.state, 'rewrite')
  if (e.state !== 'rewrite') return
  assert.ok(e.problems.includes('The game clock 12:34 is not on the fact sheet.'))
  assert.ok(e.problems.some((p) => /\b7\b/.test(p)))
  assert.ok(e.rewritePrompt.startsWith(job.user))
  assert.ok(e.rewritePrompt.includes('Your previous attempt was rejected'))
})

void test('check: a passed answer gets the review prompt; review ok = accepted; not ok = rewrite', async () => {
  const job = await oneGameJob()
  const answer = goodAnswer(job)
  const r = evaluateJob(job, answer, null)
  assert.equal(r.state, 'review')
  if (r.state !== 'review') return
  assert.equal(
    r.reviewPrompt,
    buildReviewPrompt({
      facts: job.sheet.facts,
      text: job.reporters
        .map((rep) => `${REPORTERS[rep].name}: Skater A scored in a 2-6 loss to Shake N Bake.`)
        .join('\n\n'),
      criticized: [],
    }),
  )
  assert.equal(evaluateJob(job, answer, '{"ok": true}').state, 'accepted')
  assert.equal(evaluateJob(job, answer, '{"ok": true, "problems": []}').state, 'accepted')
  const no = evaluateJob(job, answer, '{"ok": false, "problems": ["Invented save."]}')
  assert.deepEqual(no.state === 'rewrite' && no.problems, ['Invented save.'])
  const empty = evaluateJob(job, answer, '{"ok": false, "problems": []}')
  assert.deepEqual(empty.state === 'rewrite' && empty.problems, ['The review rejected the text.'])
  const broken = evaluateJob(job, answer, 'yes')
  assert.equal(broken.state, 'review')
})

void test('check files: status per answered job; a review older than the answer is ignored', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'backfill-check-'))
  try {
    const nights = {
      '2026-05-08': [{ ...base, night: '2026-05-08', playedAt: at('2026-05-09', '02:00') }],
    }
    const plan = await planBackfill({ nights: ['2026-05-08'], ...fakeWeb(nights) })
    writePlan(dir, plan)
    const job = plan.jobs[0]!
    const lines: string[] = []
    const status = () =>
      JSON.parse(readFileSync(join(dir, 'status', `${job.id}.json`), 'utf8')) as {
        state: string
      }

    writeFileSync(join(dir, 'answers', `${job.id}.json`), goodAnswer(job))
    let summary = runCheck(dir, (l) => lines.push(l))
    assert.equal(status().state, 'review')
    assert.equal(summary.review, 1)
    assert.equal(summary.waiting, 1) // the night article has no answer yet
    assert.ok(lines.some((l) => l.includes(job.id) && l.includes('review')))

    writeFileSync(join(dir, 'reviews', `${job.id}.json`), '{"ok": true}')
    summary = runCheck(dir, () => {})
    assert.deepEqual(status(), { state: 'accepted' })
    assert.equal(summary.accepted, 1)

    // A new answer after the review: the old review no longer counts.
    const later = new Date(Date.now() + 60_000)
    writeFileSync(join(dir, 'answers', `${job.id}.json`), goodAnswer(job))
    utimesSync(join(dir, 'answers', `${job.id}.json`), later, later)
    runCheck(dir, () => {})
    assert.equal(status().state, 'review')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── pile-on (rev 2, B4) ──────────────────────────────────────────────────────

function answerCriticizing(job: BackfillJob, criticized: string[]): string {
  return JSON.stringify({
    posts: job.reporters.map((r, i) => ({
      reporter: r,
      text: 'Skater A scored in a 2-6 loss to Shake N Bake.',
      mentions: ['Skater A'],
      clubs: ['Shake N Bake'],
      criticized: i === 0 ? criticized : [],
      zeroCalled: [],
      stances: [],
      takesUsed: [],
    })),
  })
}

void test('check: the pile-on limit against the night so far; the prompt gets the real list', async () => {
  const job = await oneGameJob()
  assert.ok(job.user.includes('Already criticised harshly tonight: nobody.'))
  const tonight = { ...EMPTY_DESK_CONTEXT, criticizedTonight: ['Skater A'] }
  const e = evaluateJob(job, answerCriticizing(job, ['Skater A']), null, tonight)
  assert.equal(e.state, 'rewrite')
  if (e.state !== 'rewrite') return
  assert.deepEqual(e.problems, [
    'Skater A was already criticised harshly tonight — take another angle.',
  ])
  assert.ok(e.rewritePrompt.includes('Already criticised harshly tonight: Skater A.'))
  assert.ok(!e.rewritePrompt.includes('Already criticised harshly tonight: nobody.'))
  // A waiting job whose night already has a harsh list gets the prompt to write from.
  const w = evaluateJob(job, null, null, tonight)
  assert.equal(w.state, 'waiting')
  assert.ok(
    w.state === 'waiting' && w.prompt?.includes('Already criticised harshly tonight: Skater A.'),
  )
  // The review sees the writer's list.
  const r = evaluateJob(job, answerCriticizing(job, ['Goalie G']), null, tonight)
  assert.ok(r.state === 'review' && r.reviewPrompt.includes('criticised harshly: Goalie G.'))
})

void test('check files: earlier ACCEPTED jobs of the same night count, in id order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'backfill-pileon-'))
  try {
    const nights = {
      '2026-05-08': [
        { ...base, matchId: 250, night: '2026-05-08', playedAt: at('2026-05-09', '02:00') },
        { ...base, matchId: 251, night: '2026-05-08', playedAt: at('2026-05-09', '02:40') },
      ],
      '2026-05-09': [
        { ...base, matchId: 260, night: '2026-05-09', playedAt: at('2026-05-10', '02:00') },
      ],
    }
    const plan = await planBackfill({ nights: Object.keys(nights), ...fakeWeb(nights) })
    writePlan(dir, plan)
    const [g250, g251, night8, g260] = plan.jobs
    const put = (job: BackfillJob, answer: string, review: boolean) => {
      writeFileSync(join(dir, 'answers', `${job.id}.json`), answer)
      if (review) writeFileSync(join(dir, 'reviews', `${job.id}.json`), '{"ok": true}')
    }
    const status = (job: BackfillJob) =>
      JSON.parse(readFileSync(join(dir, 'status', `${job.id}.json`), 'utf8')) as {
        state: string
        problems?: string[]
        prompt?: string
      }

    // Game 251 piles on Skater A while game 250 is not accepted yet: no problem yet.
    put(g250!, answerCriticizing(g250!, ['Skater A']), false)
    put(g251!, answerCriticizing(g251!, ['Skater A']), false)
    runCheck(dir, () => {})
    assert.equal(status(g251!).state, 'review')

    // Game 250 accepted: now 251 is a rewrite, the night article waits with the real list,
    // and the next night starts clean.
    put(g250!, answerCriticizing(g250!, ['Skater A']), true)
    runCheck(dir, () => {})
    assert.equal(status(g250!).state, 'accepted')
    assert.equal(status(g251!).state, 'rewrite')
    assert.deepEqual(status(g251!).problems, [
      'Skater A was already criticised harshly tonight — take another angle.',
    ])
    assert.equal(status(night8!).state, 'waiting')
    assert.ok(status(night8!).prompt?.includes('Already criticised harshly tonight: Skater A.'))
    put(g260!, answerCriticizing(g260!, ['Skater A']), true)
    runCheck(dir, () => {})
    assert.equal(status(g260!).state, 'accepted')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

// ── import ───────────────────────────────────────────────────────────────────

function fakeStore() {
  const rows: (NewNewsItem & { id: number })[] = []
  const stances: NewNewsStance[] = []
  const store: BackfillStore = {
    findPost: ({ matchId, reporter, body }) =>
      Promise.resolve(
        rows.find(
          (r) =>
            r.kind === 'post' &&
            r.matchId === matchId &&
            r.reporter === reporter &&
            r.body === body,
        )?.id ?? null,
      ),
    findArticle: (slug) => Promise.resolve(rows.find((r) => r.slug === slug)?.id ?? null),
    insert: (item) => {
      const id = rows.length + 1
      rows.push({ ...item, id })
      return Promise.resolve(id)
    },
    insertStance: (st) => {
      stances.push(st)
      return Promise.resolve(stances.length)
    },
  }
  return { rows, store, stances }
}

async function acceptedNight() {
  const nights = {
    '2026-05-08': [
      // A 2-3 overtime loss, normal buzz: Dex Mercer's recap, then a reply to him.
      replyGame(REPLY_ID, '2026-05-08', at('2026-05-09', '02:00')),
      // A 0-6 loss, quiet: one recap, no reply.
      loss(251, '2026-05-08', at('2026-05-09', '02:40')),
    ],
  }
  const plan = await planBackfill({ nights: ['2026-05-08'], ...fakeWeb(nights) })
  assert.equal(plan.jobs[0]!.reporters[0], 'mercer')
  assert.equal(plan.jobs[0]!.reporters.length, 2)
  assert.equal(plan.jobs[0]!.posts![1]!.replyTo, 0)
  assert.equal(plan.jobs[1]!.reporters.length, 1)
  const posts = (job: BackfillJob, text: string) => ({
    posts: job.reporters.map((r, i) => ({
      reporter: r,
      text,
      mentions: ['Skater A'],
      clubs: [],
      // Other spellings: the import stores the sheet's (C1.9, Q7).
      criticized: i === 0 && job.matchId === REPLY_ID ? ['goalie g'] : [],
      zeroCalled: [],
      stances: [],
      takesUsed: [],
    })),
  })
  const article = {
    headline: 'A long night in May',
    dek: 'Two games, two losses.',
    paragraphs: ['Word '.repeat(300).trim()],
    summary: 'Two losses.',
    mentions: ['Skater A', 'Nobody'],
    clubs: [],
    criticized: ['SKATER A'],
    zeroCalled: [],
    stances: [],
    takesUsed: [],
  }
  return plan.jobs.map((job) => ({
    job,
    output: job.kind === 'game' ? posts(job, `Post for ${String(job.matchId)}.`) : article,
  }))
}

void test('import: chronological, created_at from the games, replies linked, never sent, no jobs', async () => {
  const entries = await acceptedNight()
  // Given out of order: import sorts by job id.
  const { rows, store } = fakeStore()
  const r = await importAccepted([...entries].reverse(), store, () => {})
  const first = entries[0]!.job
  assert.equal(r.inserted, rows.length)
  assert.equal(r.existing, 0)
  assert.deepEqual(
    rows.map((x) => x.createdAt?.toISOString()),
    [
      ...first.reporters.map((_, i) =>
        new Date(Date.parse(at('2026-05-09', '02:00')) + i * 1000).toISOString(),
      ),
      ...entries[1]!.job.reporters.map((_, i) =>
        new Date(Date.parse(at('2026-05-09', '02:40')) + i * 1000).toISOString(),
      ),
      new Date(Date.parse(at('2026-05-09', '02:40')) + ARTICLE_DELAY_MS).toISOString(),
    ],
  )
  for (const row of rows) {
    assert.equal(row.isTest, false)
    assert.equal(row.discordStatus, 'skipped')
    assert.equal(row.jobId, null)
    assert.equal(row.night, '2026-05-08')
  }
  const post = rows[0]!
  assert.equal(post.kind, 'post')
  assert.equal(post.matchId, REPLY_ID)
  assert.equal(post.body, `Post for ${String(REPLY_ID)}.`)
  assert.deepEqual(post.mentions, [{ name: 'Skater A', playerId: 1 }])
  assert.deepEqual(post.facts, first.sheet.facts)
  assert.equal(rows[0]!.replyTo, null)
  assert.equal(rows[1]!.replyTo, rows[0]!.id) // the reply answers Mercer
  assert.equal(rows[2]!.replyTo, null) // game 251: one recap
  const article = rows[rows.length - 1]!
  assert.equal(article.kind, 'article')
  assert.equal(article.slug, '2026-05-08-a-long-night-in-may')
  assert.equal(article.headline, 'A long night in May')
  assert.equal(article.summary, 'Two losses.')
  assert.deepEqual(article.mentions, [{ name: 'Skater A', playerId: 1 }])
  assert.equal(article.matchId ?? null, null)
  // rev 2, B4: the harsh list of every item is stored.
  assert.deepEqual(rows[0]!.criticized, ['Goalie G'])
  assert.deepEqual(rows[1]!.criticized, [])
  assert.deepEqual(article.criticized, ['Skater A'])
})

void test('import: idempotent; an existing first post still links the reply', async () => {
  const entries = await acceptedNight()
  const { rows, store } = fakeStore()
  await importAccepted(entries, store, () => {})
  const n = rows.length
  const again = await importAccepted(entries, store, () => {})
  assert.equal(rows.length, n)
  assert.equal(again.inserted, 0)
  assert.equal(again.existing, n)

  // Only the first post of a reply pair exists: the reply is inserted and linked to it.
  const pair = entries[0]!
  const s2 = fakeStore()
  const firstReporter = pair.job.reporters[0]!
  await s2.store.insert({
    kind: 'post',
    reporter: firstReporter,
    matchId: pair.job.matchId!,
    body: `Post for ${String(pair.job.matchId)}.`,
  })
  await importAccepted([pair], s2.store, () => {})
  assert.equal(s2.rows.length, 2)
  assert.equal(s2.rows[1]!.replyTo, 1)
})

void test('the backfill never loads the Claude SDK, the writer or the live cycle', () => {
  const src = readFileSync(new URL('./backfill.ts', import.meta.url), 'utf8')
  assert.ok(!src.includes('@anthropic-ai/sdk'))
  assert.ok(!/from '\.\/writer\.ts'/.test(src))
  assert.ok(!/from '\.\/cycle\.ts'/.test(src))
  assert.ok(!src.includes('anthropicModelCall'))
})

// ── rev 2: plan rotation, next-feature, features ─────────────────────────────

void test('plan: no feature jobs; a plain loss gets only the recap; night recaps never repeat a writer (B6)', async () => {
  const nights: Record<string, NewsGameFacts[]> = {}
  let id = 700
  for (const day of ['01', '02', '03', '04', '05', '06', '07', '08']) {
    const night = `2026-05-${day}`
    const next = `2026-05-${String(Number(day) + 1).padStart(2, '0')}`
    nights[night] = [
      // A 2-3 loss: "loss", one post only.
      { ...base, matchId: id++, night, playedAt: at(next, '02:00'), scoreAgainst: 3 },
      loss(id++, night, at(next, '02:40')),
    ]
  }
  const plan = await planBackfill({ nights: Object.keys(nights), ...fakeWeb(nights) })
  assert.deepEqual([...new Set(plan.jobs.map((j) => j.kind))].sort(), ['game', 'night'])
  for (const j of plan.jobs.filter((x) => x.kind === 'game' && x.id.includes('-a01-'))) {
    assert.equal(j.reporters.length, 1, j.id)
    assert.ok(j.user.includes('exactly one post: the recap of the game'), j.id)
  }
  const writers = plan.jobs.filter((j) => j.kind === 'night').map((j) => j.reporters[0])
  for (let i = 1; i < writers.length; i++) assert.notEqual(writers[i], writers[i - 1])
  // The recap queue spreads the first posts over the fitting reporters.
  const recaps = new Set(plan.jobs.filter((j) => j.kind === 'game').map((j) => j.reporters[0]))
  assert.ok(recaps.size >= 3, [...recaps].join(','))
})

void test('edmontonNoon and featureCreatedAt: Monday 12:00 America/Edmonton of the FOLLOWING week', () => {
  assert.equal(edmontonNoon('2026-10-26').toISOString(), '2026-10-26T18:00:00.000Z') // MDT
  assert.equal(edmontonNoon('2026-11-02').toISOString(), '2026-11-02T19:00:00.000Z') // MST
  assert.equal(featureCreatedAt('2026-10-19').toISOString(), '2026-10-26T18:00:00.000Z')
  assert.equal(featureCreatedAt('2026-12-28').toISOString(), '2027-01-04T19:00:00.000Z')
})

/** A planned dir with nights in May 2026 (Mondays: 4, 11, 18, 25). */
async function plannedDir(extra: Record<string, NewsGameFacts[]> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'backfill-feature-'))
  const nights: Record<string, NewsGameFacts[]> = {
    '2026-05-05': [loss(801, '2026-05-05', at('2026-05-06', '02:00'))],
    '2026-05-12': [loss(802, '2026-05-12', at('2026-05-13', '02:00'))],
    ...extra,
  }
  const plan = await planBackfill({ nights: Object.keys(nights), ...fakeWeb(nights) })
  writePlan(dir, plan)
  const weekCalls: string[] = []
  const fetchFacts = (kind: 'game' | 'night' | 'week', key: string) => {
    weekCalls.push(`${kind}/${key}`)
    return Promise.resolve({
      facts: { ...oct12Facts('week'), key },
      forbiddenNames: ['Hidden Hank'],
      takes: [],
    })
  }
  return { dir, plan, fetchFacts, weekCalls }
}

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ')

function featureAnswer(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    headline: 'The Week In Numbers',
    dek: 'A week of hockey.',
    paragraphs: [words(350), words(350)],
    summary: 'The week.',
    mentions: [],
    clubs: [],
    criticized: [],
    zeroCalled: [],
    stances: [],
    takesUsed: [],
    prediction: 'Someone finally beats the goalie.',
    receipt: '',
    receiptVerdict: 'none',
    ...over,
  })
}

function accept(dir: string, job: BackfillJob, answer: string): void {
  writeFileSync(join(dir, 'answers', `${job.id}.json`), answer)
  writeFileSync(join(dir, 'reviews', `${job.id}.json`), '{"ok": true}')
}

void test('next-feature: one job per call, chained on the latest ACCEPTED feature (B6)', async () => {
  const { dir, fetchFacts, weekCalls } = await plannedDir()
  try {
    const first = await planNextFeature({ out: dir, week: '2026-05-04', fetchFacts })
    assert.deepEqual(weekCalls, ['week/2026-05-04'])
    assert.equal(first.id, '2026-05-11-0-feature')
    assert.equal(first.kind, 'feature')
    assert.equal(first.night, '2026-05-04')
    assert.equal(first.featureKind, 'trend')
    assert.deepEqual(first.reporters, ['quill'])
    assert.equal(first.previousPrediction, null)
    assert.equal(first.schema, FEATURE_SCHEMA)
    assert.ok(first.user.includes("Last week's prediction: none."))
    assert.ok(first.user.includes('as Mara Quill (id "quill")'))
    assert.deepEqual(
      readJobs(dir).find((j) => j.id === first.id),
      first,
    )
    // Sorted after the night of Sunday 2026-05-10 and before the games of Monday 2026-05-11.
    assert.ok('2026-05-10-z-night' < first.id && first.id < '2026-05-11-a01-g1')

    // Not accepted yet: the next week waits.
    await assert.rejects(
      planNextFeature({ out: dir, week: '2026-05-11', fetchFacts }),
      /2026-05-11-0-feature is not accepted yet/,
    )
    accept(dir, first, featureAnswer())
    const second = await planNextFeature({ out: dir, week: '2026-05-11', fetchFacts })
    assert.equal(second.featureKind, 'spotlight')
    assert.deepEqual(second.reporters, ['voss'])
    assert.equal(second.previousPrediction, 'Someone finally beats the goalie.')
    assert.ok(second.user.includes(`Last week's prediction: "Someone finally beats the goalie."`))

    // The same week again, an earlier week, a day that is not a Monday: refused.
    accept(dir, second, featureAnswer({ receipt: 'It did not come true.', receiptVerdict: 'miss' }))
    await assert.rejects(planNextFeature({ out: dir, week: '2026-05-11', fetchFacts }), /already/)
    await assert.rejects(planNextFeature({ out: dir, week: '2026-05-04', fetchFacts }), /forward/)
    await assert.rejects(planNextFeature({ out: dir, week: '2026-05-19', fetchFacts }), /Monday/)

    // A gap week: the kind goes on, the prediction is not judged.
    const fourth = await planNextFeature({ out: dir, week: '2026-05-25', fetchFacts })
    assert.equal(fourth.featureKind, 'notes')
    assert.equal(fourth.previousPrediction, null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

void test('next-feature: Rink only when no Rink item is within 14 days of the feature (B6)', async () => {
  const run = async (rinkNight: boolean) => {
    // Four winless games on 2026-05-14 put Rink on that night recap.
    const winless = [0, 1, 2, 3].map((i) =>
      loss(900 + i, '2026-05-14', at('2026-05-15', `0${String(i)}:00`)),
    )
    const { dir, plan, fetchFacts } = await plannedDir(rinkNight ? { '2026-05-14': winless } : {})
    try {
      assert.equal(
        plan.jobs.some((j) => j.reporters.includes('rink')),
        rinkNight,
      )
      // Four accepted features: trend, spotlight, notes, then bigpicture.
      const kinds = ['2026-04-13', '2026-04-20', '2026-04-27', '2026-05-04']
      let job: BackfillJob | null = null
      for (const week of kinds) {
        job = await planNextFeature({ out: dir, week, fetchFacts })
        accept(
          dir,
          job,
          featureAnswer({
            ...(job.previousPrediction === null
              ? {}
              : { receipt: 'It did not.', receiptVerdict: 'miss' }),
            // A notes column has 10-15 items.
            ...(job.featureKind === 'notes'
              ? { paragraphs: Array.from({ length: 10 }, () => words(70)) }
              : {}),
          }),
        )
      }
      assert.equal(job!.featureKind, 'bigpicture')
      return await planNextFeature({ out: dir, week: '2026-05-11', fetchFacts })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const free = await run(false)
  assert.deepEqual([free.featureKind, free.reporters[0]], ['rink', 'rink'])
  const blocked = await run(true) // Rink's night recap on 2026-05-14 is 4 days before 2026-05-18 noon
  assert.deepEqual([blocked.featureKind, blocked.reporters[0]], ['trend', 'quill'])
})

void test('check: feature rules (length, prediction without numbers, receipt) apply to feature jobs', async () => {
  const { dir, fetchFacts } = await plannedDir()
  try {
    const first = await planNextFeature({ out: dir, week: '2026-05-04', fetchFacts })
    const short = evaluateJob(first, featureAnswer({ paragraphs: [words(400)] }), null)
    assert.ok(short.state === 'rewrite' && short.problems.some((p) => /600 to 900/.test(p)))
    const digits = evaluateJob(first, featureAnswer({ prediction: 'They win 2.' }), null)
    assert.ok(
      digits.state === 'rewrite' && digits.problems.some((p) => /prediction must have no/.test(p)),
    )
    const receipt = evaluateJob(first, featureAnswer({ receipt: 'It came true.' }), null)
    assert.ok(
      receipt.state === 'rewrite' &&
        receipt.problems.some((p) => /receipt must be an empty/.test(p)),
    )
    const ok = evaluateJob(first, featureAnswer(), null)
    assert.equal(ok.state, 'review')
    assert.ok(
      ok.state === 'review' && ok.reviewPrompt.includes('Someone finally beats the goalie.'),
    )
    assert.equal(evaluateJob(first, featureAnswer(), '{"ok": true}').state, 'accepted')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

void test('import: a feature has its week, kind, prediction, slug and the following Monday noon (B6)', async () => {
  const { dir, fetchFacts } = await plannedDir()
  try {
    const first = await planNextFeature({ out: dir, week: '2026-05-04', fetchFacts })
    accept(dir, first, featureAnswer())
    const second = await planNextFeature({ out: dir, week: '2026-05-11', fetchFacts })
    const answer = JSON.parse(
      featureAnswer({
        receipt: 'It did not come true.',
        receiptVerdict: 'miss',
        criticized: ['skater a'],
      }),
    ) as Record<string, unknown>
    const { rows, store } = fakeStore()
    await importAccepted([{ job: second, output: answer as never }], store, () => {})
    const f = rows[0]!
    assert.equal(f.kind, 'article')
    assert.equal(f.reporter, 'voss')
    assert.equal(f.night, null)
    assert.equal(f.weekStart, '2026-05-11')
    assert.equal(f.featureKind, 'spotlight')
    assert.equal(f.prediction, 'Someone finally beats the goalie.')
    assert.deepEqual(f.criticized, ['Skater A'])
    assert.equal(f.slug, 'week-2026-05-11-the-week-in-numbers')
    assert.equal(f.createdAt?.toISOString(), '2026-05-18T18:00:00.000Z')
    assert.equal(
      f.body,
      ['It did not come true.', words(350), words(350), 'Someone finally beats the goalie.'].join(
        '\n\n',
      ),
    )
    assert.equal(f.discordStatus, 'skipped')
    // Idempotent by slug.
    await importAccepted([{ job: second, output: answer as never }], store, () => {})
    assert.equal(rows.length, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

void test('CLI: next-feature needs --week, the web app and the token', async () => {
  const lines: string[] = []
  assert.equal(await main(['next-feature', '--out', '/nowhere'], {}, (l) => lines.push(l)), 2)
  assert.ok(lines.join('\n').includes('next-feature --out <dir> --week <monday YYYY-MM-DD>'))
  assert.equal(
    await main(['next-feature', '--out', '/nowhere', '--week', '2026-05-04'], {}, () => {}),
    2,
  )
})

// ── C3a.11: buzz, big-game articles, desk context, takes, stances ───────────

/** The huge version of the reply game: overtime, blowout, big upset, blip (+ the sheet's milestone). */
function hugeGame(matchId: number, night: string, playedAt: string): NewsGameFacts {
  const g = replyGame(matchId, night, playedAt)
  return {
    ...g,
    context: { ...g.context!, margin: 'blowout', surprise: 'big upset', result: 'blip' },
  }
}

void test('C3a.11 plan: a huge game gets its buzz count of posts and article jobs; files round-trip', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'backfill-huge-'))
  try {
    const nights = { '2026-05-08': [hugeGame(701, '2026-05-08', at('2026-05-09', '02:00'))] }
    const plan = await planBackfill({ nights: ['2026-05-08'], ...fakeWeb(nights) })
    const ids = plan.jobs.map((j) => j.id)
    assert.equal(ids[0], '2026-05-08-a01-g701')
    assert.equal(ids[1], '2026-05-08-a01-h701-1-game')
    assert.ok(
      ids[2] === '2026-05-08-a01-h701-2-spotlight' || ids[2] === '2026-05-08-a01-h701-2-column',
    )
    assert.deepEqual(ids, [...ids].sort())
    assert.equal(ids[3], '2026-05-08-z-night')
    const posts = plan.jobs[0]!
    assert.ok(posts.reporters.length >= 6 && posts.reporters.length <= 8)
    assert.equal(new Set(posts.posts!.map((p) => p.angle)).size, posts.reporters.length)
    const story = plan.jobs[1]!
    assert.equal(story.kind, 'game-article')
    assert.equal(story.articleKind, 'game')
    assert.equal(story.matchId, 701)
    assert.ok(story.user.includes('200 to 350 words'))
    assert.ok(plan.jobs[2]!.user.includes('400 to 700 words'))
    // Article dates: a minute per kind after the game.
    assert.equal(
      itemCreatedAt(story, 0).toISOString(),
      new Date(Date.parse(at('2026-05-09', '02:00')) + 60_000).toISOString(),
    )
    writePlan(dir, plan)
    assert.deepEqual(readJobs(dir), plan.jobs)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

void test('C3a.11 check: zero call-outs, own pieces and the night posts come from accepted jobs in id order', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'backfill-ctx-'))
  try {
    const nights = {
      '2026-05-08': [
        loss(250, '2026-05-08', at('2026-05-09', '02:00')),
        loss(251, '2026-05-08', at('2026-05-09', '02:40')),
      ],
      '2026-05-09': [loss(260, '2026-05-09', at('2026-05-10', '02:00'))],
    }
    const plan = await planBackfill({ nights: Object.keys(nights), ...fakeWeb(nights) })
    writePlan(dir, plan)
    const [g250, g251, night8, g260] = plan.jobs
    const said: Record<number, string> = {
      250: 'Skater A had 0 points as the club took 14 shots.',
      251: 'Skater A had 0 points as the club allowed 29 shots.',
      260: 'Skater A had 0 points with Goalie G making 23 saves.',
    }
    const answer = (job: BackfillJob, zeroCalled: string[]) =>
      JSON.stringify({
        posts: job.reporters.map((r) => ({
          reporter: r,
          text: said[job.matchId!]!,
          mentions: ['Skater A'],
          clubs: [],
          criticized: [],
          zeroCalled,
          stances: [],
          takesUsed: [],
        })),
      })
    const put = (job: BackfillJob, text: string) => {
      writeFileSync(join(dir, 'answers', `${job.id}.json`), text)
      writeFileSync(join(dir, 'reviews', `${job.id}.json`), '{"ok": true}')
    }
    const status = (job: BackfillJob) =>
      JSON.parse(readFileSync(join(dir, 'status', `${job.id}.json`), 'utf8')) as {
        state: string
        problems?: string[]
        prompt?: string
      }
    put(g250!, answer(g250!, ['Skater A']))
    put(g251!, answer(g251!, ['Skater A']))
    runCheck(dir, () => {})
    assert.equal(status(g250!).state, 'accepted')
    // One zero call-out per night: the second game's is refused.
    assert.equal(status(g251!).state, 'rewrite')
    assert.ok(status(g251!).problems!.some((p) => /at most one per night/.test(p)))
    // The night article waits with the night's posts and the zero call-out in its prompt.
    const n8 = status(night8!)
    assert.equal(n8.state, 'waiting')
    assert.ok(n8.prompt!.includes(said[250]!))
    assert.ok(!n8.prompt!.includes(said[251]!), 'only accepted posts')
    assert.ok(n8.prompt!.includes('Zero call-outs tonight: Skater A.'))
    // The next night: Skater A was called out last night, never two nights in a row.
    put(g260!, answer(g260!, ['Skater A']))
    runCheck(dir, () => {})
    assert.ok(status(g260!).problems!.some((p) => /two nights in a row/.test(p)))
    // And the reporter's own last pieces reach his next prompt.
    const recapper = g260!.reporters[0]!
    const own = plan.jobs
      .filter((j) => j.id < g260!.id && j.kind === 'game' && j.reporters.includes(recapper))
      .map((j) => said[j.matchId!]!)
    if (own.length > 0) {
      const p = JSON.parse(readFileSync(join(dir, 'status', `${g260!.id}.json`), 'utf8')) as {
        rewritePrompt: string
      }
      assert.ok(p.rewritePrompt.includes(own[0]!))
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

void test('C3a.11 takes: offered from the sheet, at most once a week in the plan; imported with stances and zero call-outs', async () => {
  const take = {
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
    ] as ReporterId[],
    defender: null,
    playerId: 1,
    player: 'Skater A',
    take: 'INVENTED TAKE for a test.',
    spread: 'some' as const,
    dataAngle: null,
    intensity: 0,
    mild: false,
  }
  const games = {
    '2026-05-08': [replyGame(REPLY_ID, '2026-05-08', at('2026-05-09', '02:00'))],
    '2026-05-10': [replyGame(REPLY_ID + 1000, '2026-05-10', at('2026-05-11', '02:00'))],
  }
  const web = fakeWeb(games)
  const fetchFacts = async (kind: 'game' | 'night' | 'week', key: string) => ({
    ...(await web.fetchFacts(kind, key)),
    takes: [take],
  })
  const plan = await planBackfill({ nights: Object.keys(games), fetchFacts })
  const offered = plan.jobs.filter(
    (j) => j.posts?.some((p) => p.takeId === 7) || (j.offeredTakes ?? []).includes(7),
  )
  assert.equal(offered.length, 1, 'once in 7 days')
  assert.ok(offered[0]!.user.includes('Take 7 on Skater A: INVENTED TAKE'))
  assert.ok(!plan.jobs.find((j) => j !== offered[0])!.user.includes('Take 7'))

  // Import: stances, zero call-outs and takes used are stored.
  const job = offered[0]!
  const thread = {
    key: 'pp-drought@2026-05-01',
    kind: 'pp-drought' as const,
    subject: null,
    since: '2026-05-01',
    status: 'open' as const,
    summary: 'No PP goal.',
  }
  job.sheet = { ...job.sheet, facts: { ...job.sheet.facts, threads: [thread] } }
  const out = {
    posts: job.reporters.map((r, i) => ({
      reporter: r,
      text: 'Post.',
      mentions: [],
      clubs: [],
      criticized: [],
      zeroCalled: i === 0 ? ['skater a'] : [],
      stances: i === 0 ? [{ threadKey: thread.key, stance: 'It ends.' }] : [],
      takesUsed: job.posts![i]!.takeId === 7 ? [7] : [],
    })),
  }
  const { rows, store, stances } = fakeStore()
  await importAccepted([{ job, output: out }], store, () => {})
  assert.deepEqual(rows[0]!.zeroCalled, ['Skater A'])
  assert.ok(rows.some((r) => (r.takesUsed ?? []).includes(7)))
  assert.deepEqual(stances, [
    {
      threadKey: thread.key,
      reporter: job.reporters[0],
      stance: 'It ends.',
      night: job.night,
      itemId: 1,
    },
  ])
})

void test('C3a.11 import: a big game article keeps its match and kind; a feature its verdict', async () => {
  const nights = { '2026-05-08': [hugeGame(701, '2026-05-08', at('2026-05-09', '02:00'))] }
  const plan = await planBackfill({ nights: ['2026-05-08'], ...fakeWeb(nights) })
  const story = plan.jobs.find((j) => j.kind === 'game-article' && j.articleKind === 'game')!
  const extra = plan.jobs.find((j) => j.kind === 'game-article' && j.articleKind !== 'game')!
  const article = {
    headline: 'Big night',
    dek: 'A dek.',
    paragraphs: ['Body.'],
    summary: 'S.',
    mentions: [],
    clubs: [],
    criticized: [],
    zeroCalled: [],
    stances: [],
    takesUsed: [],
  }
  const { rows, store } = fakeStore()
  await importAccepted(
    [
      { job: story, output: article },
      { job: extra, output: { ...article, headline: 'Bigger night' } },
    ],
    store,
    () => {},
  )
  assert.equal(rows[0]!.matchId, 701)
  assert.equal(rows[0]!.slug, '2026-05-08-g701-big-night')
  assert.equal(rows[0]!.featureKind, null)
  assert.equal(rows[0]!.weekStart, null)
  assert.equal(rows[1]!.featureKind, extra.articleKind === 'spotlight' ? 'spotlight' : 'bigpicture')
})
