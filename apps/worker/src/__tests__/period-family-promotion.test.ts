/**
 * Bounded per-family period promotion — mutation boundary + CLI (migration 0056).
 *
 * WHAT THIS PROVES
 * ----------------
 * 1. `promoteOcrPeriodFamily` writes ONE family, bounded to periods `1..maxPeriod`
 *    (the independently derived periods-played bound), all-or-nothing, and refuses
 *    shots / unknown families / bad bounds outright.
 * 2. The `reconcile-periods` CLI reports by default, writes only under `--promote`,
 *    promotes each family on its OWN verdict, and never promotes shots.
 *
 * FIXTURE PROVENANCE — RECONSTRUCTED, NOT PRODUCTION
 * -------------------------------------------------
 * The four regression shapes are named for the corpus matches that exhibit them
 * (475, 476, 2404, 2577) but are RECONSTRUCTED here on sentinel match ids far
 * above the live sequence, with their own EA truth rows. Nothing is read from,
 * or asserted about, production data — the clone's real 475/476/2404/2577 rows
 * are never touched. Every shape shares: full regulation TOI (3600 s ⇒ three
 * expected periods), goals that reconcile exactly over P1-P3, and a phantom P4
 * that frame segmentation invented.
 *
 *   shape  goals        faceoffs         shots        P4
 *   475    promotable   NOT promotable   absent       pending
 *   476    promotable   NOT promotable   manual only  pending
 *   2404   promotable   promotable       manual only  pending
 *   2577   promotable   promotable       absent       pending
 *
 * Migration 0056 is NOT applied to the live database by this slice, so `before()`
 * applies it to the clone.
 *
 * Build + run (focused):
 *   pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build
 *   set -a && source .env && set +a
 *   node apps/worker/scripts/with-test-db.mjs period-family-promotion
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../../..')
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  'packages/db/migrations/0056_period_family_review_status.sql',
)
const CLI_PATH = path.join(REPO_ROOT, 'apps/worker/dist/reconcile-periods-cli.js')

/** Sentinel match ids, far above the live sequence. Dropped in `after`. */
const M475 = 9401
const M476 = 9402
const M2404 = 9403
const M2577 = 9404
/** Extra sentinels for the mutation-boundary cases. */
const M_ISOLATION = 9405
const M_HALFREAD = 9406
const M_MISSING = 9407
const ALL_MATCHES = [M475, M476, M2404, M2577, M_ISOLATION, M_HALFREAD, M_MISSING]

/** Full regulation: max skater TOI 3600 s ⇒ periodsPlayed 3. */
const REGULATION_TOI = 3600

const hasDb = Boolean(process.env['DATABASE_URL'])

function assertCloneDb(): void {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('period-family-promotion: DATABASE_URL is unset.')
  let dbName: string
  try {
    dbName = new URL(url).pathname.replace(/^\//, '')
  } catch {
    throw new Error(`period-family-promotion: DATABASE_URL is not a valid URL: ${url}`)
  }
  if (!dbName.startsWith('eanhl_test')) {
    throw new Error(
      `period-family-promotion: refusing to run — DATABASE_URL points at database "${dbName}", ` +
        `not an "eanhl_test_*" clone. This file applies migration 0056 and mutates review ` +
        `statuses; run it via apps/worker/scripts/with-test-db.mjs.`,
    )
  }
}

async function applyMigration0056(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  const ddl = readFileSync(MIGRATION_PATH, 'utf8')
  const reserved = await pg.reserve()
  try {
    await reserved.unsafe(ddl).simple()
  } finally {
    reserved.release()
  }
}

async function cleanup(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await pg`DELETE FROM match_period_summaries WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM player_match_stats WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM opponent_player_match_stats WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM matches WHERE id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM players WHERE gamertag = 'PERIOD-FAMILY-SENTINEL'`
}

interface PeriodRow {
  periodNumber: number
  goalsFor: number | null
  goalsAgainst: number | null
  shotsFor?: number | null
  shotsAgainst?: number | null
  faceoffsFor: number | null
  faceoffsAgainst: number | null
}

/**
 * Seed one sentinel match with EA truth + OCR per-period rows.
 *
 * `toi` drives `periodsPlayed`; `ourFaceoffWins`/`oppFaceoffWins` are the EA
 * whole-game faceoff truth (summed per-player wins) the OCR totals are graded
 * against. Every OCR row starts fully pending on all three families.
 */
async function seedMatch(opts: {
  matchId: number
  scoreFor: number
  scoreAgainst: number
  toi: number | null
  ourFaceoffWins: number
  oppFaceoffWins: number
  periods: PeriodRow[]
}): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await pg`
    INSERT INTO matches (
      id, game_title_id, ea_match_id, match_type, opponent_club_id, opponent_name,
      played_at, result, score_for, score_against, shots_for, shots_against,
      hits_for, hits_against
    ) VALUES (
      ${opts.matchId}, (SELECT id FROM game_titles ORDER BY id LIMIT 1),
      ${`period-family-promotion-${opts.matchId}`}, 'gameType5', '999999', 'SENTINEL',
      now(), ${opts.scoreFor > opts.scoreAgainst ? 'WIN' : 'LOSS'},
      ${opts.scoreFor}, ${opts.scoreAgainst}, 20, 18, 5, 4
    )
  `
  const [player] = await pg<{ id: number }[]>`
    INSERT INTO players (gamertag, position)
    VALUES ('PERIOD-FAMILY-SENTINEL', 'center')
    ON CONFLICT DO NOTHING
    RETURNING id
  `
  const playerId =
    player?.id ??
    (
      await pg<{ id: number }[]>`SELECT id FROM players WHERE gamertag = 'PERIOD-FAMILY-SENTINEL'`
    )[0]!.id

  // EA truth: TOI gives the period bound, faceoff wins give the faceoff truth.
  await pg`
    INSERT INTO player_match_stats (player_id, match_id, position, is_goalie, goals, assists,
                                    faceoff_wins, faceoff_losses, toi_seconds)
    VALUES (${playerId}, ${opts.matchId}, 'center', false, 0, 0,
            ${opts.ourFaceoffWins}, 0, ${opts.toi})
  `
  await pg`
    INSERT INTO opponent_player_match_stats (match_id, ea_player_id, opponent_club_id, gamertag,
                                             position, is_goalie, faceoff_wins, faceoff_losses,
                                             toi_seconds)
    VALUES (${opts.matchId}, ${`sentinel-${opts.matchId}`}, '999999', 'SENTINEL-OPP',
            'center', false, ${opts.oppFaceoffWins}, 0, ${opts.toi})
  `
  for (const p of opts.periods) {
    await pg`
      INSERT INTO match_period_summaries (
        match_id, period_number, period_label, goals_for, goals_against,
        shots_for, shots_against, faceoffs_for, faceoffs_against, source, review_status,
        goals_review_status, shots_review_status, faceoffs_review_status
      ) VALUES (
        ${opts.matchId}, ${p.periodNumber}, ${`P${String(p.periodNumber)}`},
        ${p.goalsFor}, ${p.goalsAgainst}, ${p.shotsFor ?? null}, ${p.shotsAgainst ?? null},
        ${p.faceoffsFor}, ${p.faceoffsAgainst}, 'ocr', 'pending_review',
        'pending_review', 'pending_review', 'pending_review'
      )
    `
  }
}

/** Goals reconcile to 3-1 over P1-P3; faceoffs 12-8. The phantom P4 is empty. */
function cleanPeriods(withShots: boolean, faceoffs: 'exact' | 'mismatch'): PeriodRow[] {
  const fo: Array<[number, number]> =
    faceoffs === 'exact'
      ? [
          [5, 3],
          [4, 3],
          [3, 2],
        ]
      : [
          // Sums to 11-8, EA truth says 12-8 — one draw short.
          [4, 3],
          [4, 3],
          [3, 2],
        ]
  return [
    ...(
      [
        [1, 1, 1],
        [2, 1, 0],
        [3, 1, 0],
      ] as const
    ).map(([period, gf, ga], i) => ({
      periodNumber: period,
      goalsFor: gf,
      goalsAgainst: ga,
      shotsFor: withShots ? 10 + i : null,
      shotsAgainst: withShots ? 9 + i : null,
      faceoffsFor: fo[i]![0],
      faceoffsAgainst: fo[i]![1],
    })),
    // The phantom P4: present, empty, never played.
    {
      periodNumber: 4,
      goalsFor: 0,
      goalsAgainst: 0,
      shotsFor: withShots ? 0 : null,
      shotsAgainst: withShots ? 0 : null,
      faceoffsFor: 0,
      faceoffsAgainst: 0,
    },
  ]
}

async function statuses(
  matchId: number,
): Promise<{ period: number; goals: string; shots: string; faceoffs: string; legacy: string }[]> {
  const { sql: pg } = await import('@eanhl/db')
  const rows = await pg<
    {
      period_number: number
      goals_review_status: string
      shots_review_status: string
      faceoffs_review_status: string
      review_status: string
    }[]
  >`
    SELECT period_number, goals_review_status, shots_review_status,
           faceoffs_review_status, review_status
    FROM match_period_summaries WHERE match_id = ${matchId} ORDER BY period_number
  `
  return rows.map((r) => ({
    period: r.period_number,
    goals: r.goals_review_status,
    shots: r.shots_review_status,
    faceoffs: r.faceoffs_review_status,
    legacy: r.review_status,
  }))
}

async function resetStatuses(matchId: number): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await pg`
    UPDATE match_period_summaries
    SET goals_review_status = 'pending_review',
        shots_review_status = 'pending_review',
        faceoffs_review_status = 'pending_review',
        review_status = 'pending_review'
    WHERE match_id = ${matchId}
  `
}

interface CliOutcome {
  matchId: number
  periodsPlayed: number | null
  families: Record<
    'goals' | 'shots' | 'faceoffs',
    {
      promotable: boolean
      pending: number
      promotedPeriods: number[]
      authorizedPeriods: number[]
      excludedPeriods: number[]
      reason: string
      error?: string
    }
  >
  error?: string
}

function runCli(matchId: number, promote: boolean): CliOutcome {
  const args = [CLI_PATH, '--match', String(matchId), '--json']
  if (promote) args.push('--promote')
  const result = spawnSync('node', args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(`reconcile-periods CLI failed for ${String(matchId)}: ${result.stderr}`)
  }
  const start = result.stdout.indexOf('{')
  const parsed = JSON.parse(result.stdout.slice(start)) as { outcomes: CliOutcome[] }
  const outcome = parsed.outcomes[0]
  assert.ok(outcome, `no CLI outcome for match ${String(matchId)}`)
  return outcome
}

before(async () => {
  if (!hasDb) return
  assertCloneDb()
  await cleanup()
  await applyMigration0056()

  // 475 — clean goals, faceoff totals one short of EA truth, shots never captured.
  await seedMatch({
    matchId: M475,
    scoreFor: 3,
    scoreAgainst: 1,
    toi: REGULATION_TOI,
    ourFaceoffWins: 12,
    oppFaceoffWins: 8,
    periods: cleanPeriods(false, 'mismatch'),
  })
  // 476 — same, but shots WERE captured (and still must never auto-promote).
  await seedMatch({
    matchId: M476,
    scoreFor: 3,
    scoreAgainst: 1,
    toi: REGULATION_TOI,
    ourFaceoffWins: 12,
    oppFaceoffWins: 8,
    periods: cleanPeriods(true, 'mismatch'),
  })
  // 2404 — goals AND faceoffs both reconcile; shots captured, manual only.
  await seedMatch({
    matchId: M2404,
    scoreFor: 3,
    scoreAgainst: 1,
    toi: REGULATION_TOI,
    ourFaceoffWins: 12,
    oppFaceoffWins: 8,
    periods: cleanPeriods(true, 'exact'),
  })
  // 2577 — goals AND faceoffs both reconcile; shots absent.
  await seedMatch({
    matchId: M2577,
    scoreFor: 3,
    scoreAgainst: 1,
    toi: REGULATION_TOI,
    ourFaceoffWins: 12,
    oppFaceoffWins: 8,
    periods: cleanPeriods(false, 'exact'),
  })
  // Mutation-boundary fixtures, exercised through the API directly.
  await seedMatch({
    matchId: M_ISOLATION,
    scoreFor: 3,
    scoreAgainst: 1,
    toi: REGULATION_TOI,
    ourFaceoffWins: 12,
    oppFaceoffWins: 8,
    periods: cleanPeriods(true, 'exact'),
  })
  // A half-read expected period: P2's goals-against was never captured.
  await seedMatch({
    matchId: M_HALFREAD,
    scoreFor: 3,
    scoreAgainst: 1,
    toi: REGULATION_TOI,
    ourFaceoffWins: 12,
    oppFaceoffWins: 8,
    periods: cleanPeriods(true, 'exact').map((p) =>
      p.periodNumber === 2 ? { ...p, goalsAgainst: null } : p,
    ),
  })
  // A missing expected period: P2 has no row at all.
  await seedMatch({
    matchId: M_MISSING,
    scoreFor: 3,
    scoreAgainst: 1,
    toi: REGULATION_TOI,
    ourFaceoffWins: 12,
    oppFaceoffWins: 8,
    periods: cleanPeriods(true, 'exact').filter((p) => p.periodNumber !== 2),
  })
})

after(async () => {
  if (!hasDb) return
  const { sql: pg } = await import('@eanhl/db')
  await cleanup().catch(() => undefined)
  await pg.end({ timeout: 1 }).catch(() => undefined)
})

// ── mutation boundary: direct API use ────────────────────────────────────────

void test('promoteOcrPeriodFamily writes ONE family and leaves the others pending', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_ISOLATION)

  const result = await promoteOcrPeriodFamily({
    matchId: M_ISOLATION,
    family: 'goals',
    maxPeriod: 3,
  })
  assert.equal(result.authorized, true)
  assert.deepEqual(result.promotedPeriods, [1, 2, 3])
  assert.deepEqual(result.excludedPeriods, [4])

  for (const row of await statuses(M_ISOLATION)) {
    if (row.period <= 3) assert.equal(row.goals, 'reviewed')
    else assert.equal(row.goals, 'pending_review', 'P4 is above the bound')
    assert.equal(row.shots, 'pending_review', 'a goals promotion must not touch shots')
    assert.equal(row.faceoffs, 'pending_review', 'a goals promotion must not touch faceoffs')
    assert.equal(row.legacy, 'pending_review', 'the legacy status is not written either')
  }
})

void test('promoting faceoffs afterwards leaves goals reviewed and shots pending', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')

  const result = await promoteOcrPeriodFamily({
    matchId: M_ISOLATION,
    family: 'faceoffs',
    maxPeriod: 3,
  })
  assert.deepEqual(result.promotedPeriods, [1, 2, 3])

  for (const row of await statuses(M_ISOLATION)) {
    const expected = row.period <= 3 ? 'reviewed' : 'pending_review'
    assert.equal(row.goals, expected)
    assert.equal(row.faceoffs, expected)
    assert.equal(row.shots, 'pending_review')
  }
})

void test('a second call is idempotent and promotes nothing new', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  const result = await promoteOcrPeriodFamily({
    matchId: M_ISOLATION,
    family: 'goals',
    maxPeriod: 3,
  })
  assert.equal(result.authorized, true)
  assert.deepEqual(result.promotedPeriods, [])
  assert.deepEqual(result.alreadyReviewedPeriods, [1, 2, 3])
})

void test('shots have no automatic path — the mutation boundary refuses them', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  const before = await statuses(M_ISOLATION)
  await assert.rejects(
    () => promoteOcrPeriodFamily({ matchId: M_ISOLATION, family: 'shots', maxPeriod: 3 }),
    /shots have no automatic promotion path/i,
  )
  assert.deepEqual(await statuses(M_ISOLATION), before, 'no row may be touched')
})

void test('an unknown family is rejected before any DB work', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  const before = await statuses(M_ISOLATION)
  await assert.rejects(
    () =>
      promoteOcrPeriodFamily({
        matchId: M_ISOLATION,
        // Deliberate misuse: the union is closed, so this must fail loudly rather
        // than default to some family.
        family: 'hits' as unknown as 'goals',
        maxPeriod: 3,
      }),
    /unknown stat family/i,
  )
  assert.deepEqual(await statuses(M_ISOLATION), before)
})

void test('a non-positive-integer bound is rejected — an unknown bound never promotes all', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  const before = await statuses(M_ISOLATION)
  for (const bad of [0, -1, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    await assert.rejects(
      () => promoteOcrPeriodFamily({ matchId: M_ISOLATION, family: 'goals', maxPeriod: bad }),
      /maxPeriod must be a positive integer/i,
      `maxPeriod=${String(bad)} must be rejected`,
    )
  }
  assert.deepEqual(await statuses(M_ISOLATION), before)
})

void test('a half-read expected period promotes NOTHING, not just the readable rows', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_HALFREAD)

  const result = await promoteOcrPeriodFamily({
    matchId: M_HALFREAD,
    family: 'goals',
    maxPeriod: 3,
  })
  assert.equal(result.authorized, false)
  assert.deepEqual(result.promotedPeriods, [])
  assert.deepEqual(result.incompletePeriods, [2])
  for (const row of await statuses(M_HALFREAD)) {
    assert.equal(row.goals, 'pending_review', 'a partial breakdown must not be published')
  }
})

void test('a missing expected period promotes NOTHING and names the gap', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_MISSING)

  const result = await promoteOcrPeriodFamily({
    matchId: M_MISSING,
    family: 'goals',
    maxPeriod: 3,
  })
  assert.equal(result.authorized, false)
  assert.deepEqual(result.missingPeriods, [2])
  assert.deepEqual(result.promotedPeriods, [])
  for (const row of await statuses(M_MISSING)) assert.equal(row.goals, 'pending_review')
})

void test('an explicitly rejected family blocks the whole bounded window', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { sql: pg } = await import('@eanhl/db')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_HALFREAD)
  await pg`
    UPDATE match_period_summaries SET goals_against = 0, goals_review_status = 'rejected'
    WHERE match_id = ${M_HALFREAD} AND period_number = 2
  `
  const result = await promoteOcrPeriodFamily({
    matchId: M_HALFREAD,
    family: 'goals',
    maxPeriod: 3,
  })
  assert.equal(result.authorized, false)
  assert.deepEqual(result.rejectedPeriods, [2])
  assert.deepEqual(result.promotedPeriods, [])
  const rows = await statuses(M_HALFREAD)
  assert.equal(rows.find((r) => r.period === 1)?.goals, 'pending_review')
  assert.equal(
    rows.find((r) => r.period === 2)?.goals,
    'rejected',
    'a rejection is never overwritten',
  )
})

void test('a caller-chosen SMALLER bound is refused — the bound is derived, not passed', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_ISOLATION)

  // This case USED to promote periods 1-2 and leave 3-4 pending, on the theory
  // that a narrower window is the safer direction. It is not. The fixture's TOI
  // proves three periods were played, so publishing P1-P2 alone renders a
  // two-period breakdown of a three-period game that reads as complete on the
  // recap — P3's goals silently vanish from the published total. `maxPeriod` is
  // a claim the boundary checks against the TOI-derived bound, never a window
  // the caller may choose. See period-family-mutation-authorization.test.ts.
  await assert.rejects(
    () => promoteOcrPeriodFamily({ matchId: M_ISOLATION, family: 'goals', maxPeriod: 2 }),
    /maxPeriod=2 disagrees with the 3-period bound/,
  )
  for (const row of await statuses(M_ISOLATION)) {
    assert.equal(row.goals, 'pending_review', 'a rejected bound writes nothing')
  }
})

void test('countPendingOcrPeriodFamilies reports per family, never a row count', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { countPendingOcrPeriodFamilies } = await import('@eanhl/db/queries')
  await resetStatuses(M_ISOLATION)

  const all = await countPendingOcrPeriodFamilies(M_ISOLATION)
  assert.deepEqual(all, { goals: 4, shots: 4, faceoffs: 4, rows: 4 })

  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await promoteOcrPeriodFamily({ matchId: M_ISOLATION, family: 'goals', maxPeriod: 3 })
  const after = await countPendingOcrPeriodFamilies(M_ISOLATION)
  assert.equal(after.goals, 1, 'only the out-of-bound P4 goals reading is still pending')
  assert.equal(after.shots, 4, 'shots are untouched — and are not folded into a row count')
  assert.equal(after.faceoffs, 4)
  assert.equal(after.rows, 4)
})

// ── CLI: report-only, then per-family promotion ──────────────────────────────

void test('report-only is the default and writes nothing', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  await resetStatuses(M2404)
  const before = await statuses(M2404)

  const outcome = runCli(M2404, false)
  assert.equal(outcome.families.goals.promotable, true)
  assert.equal(outcome.families.faceoffs.promotable, true)
  assert.deepEqual(outcome.families.goals.promotedPeriods, [])
  assert.deepEqual(outcome.families.faceoffs.promotedPeriods, [])

  assert.deepEqual(await statuses(M2404), before, 'a report run must not mutate a single row')
})

void test('shape 475: goals promote P1-P3, faceoffs do not, shots stay absent + pending', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  await resetStatuses(M475)
  const outcome = runCli(M475, true)

  assert.equal(outcome.periodsPlayed, 3)
  assert.deepEqual(outcome.families.goals.promotedPeriods, [1, 2, 3])
  assert.deepEqual(outcome.families.goals.excludedPeriods, [4])
  assert.equal(outcome.families.faceoffs.promotable, false)
  assert.deepEqual(outcome.families.faceoffs.promotedPeriods, [])
  assert.equal(outcome.families.shots.promotable, false)

  for (const row of await statuses(M475)) {
    assert.equal(row.goals, row.period <= 3 ? 'reviewed' : 'pending_review')
    assert.equal(row.faceoffs, 'pending_review', 'faceoff totals miss EA truth by one draw')
    assert.equal(row.shots, 'pending_review')
  }
})

void test('shape 476: same verdicts, and captured shots are still never promoted', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  await resetStatuses(M476)
  const outcome = runCli(M476, true)

  assert.deepEqual(outcome.families.goals.promotedPeriods, [1, 2, 3])
  assert.equal(outcome.families.faceoffs.promotable, false)
  assert.equal(outcome.families.shots.promotable, false)
  assert.deepEqual(outcome.families.shots.promotedPeriods, [])
  assert.equal(outcome.families.shots.pending, 4, 'all four shot readings stay quarantined')

  for (const row of await statuses(M476)) {
    assert.equal(row.shots, 'pending_review', 'shots are manual review only')
    assert.equal(row.faceoffs, 'pending_review')
  }
})

void test('shape 2404: goals AND faceoffs promote P1-P3; shots and P4 stay pending', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  await resetStatuses(M2404)
  const outcome = runCli(M2404, true)

  assert.deepEqual(outcome.families.goals.promotedPeriods, [1, 2, 3])
  assert.deepEqual(outcome.families.faceoffs.promotedPeriods, [1, 2, 3])
  assert.equal(outcome.families.shots.promotable, false)

  for (const row of await statuses(M2404)) {
    const expected = row.period <= 3 ? 'reviewed' : 'pending_review'
    assert.equal(row.goals, expected)
    assert.equal(row.faceoffs, expected)
    assert.equal(row.shots, 'pending_review')
    assert.equal(row.legacy, 'pending_review', 'the legacy row status is never written')
  }
})

void test('shape 2577: goals AND faceoffs promote P1-P3 with shots absent', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  await resetStatuses(M2577)
  const outcome = runCli(M2577, true)

  assert.deepEqual(outcome.families.goals.promotedPeriods, [1, 2, 3])
  assert.deepEqual(outcome.families.faceoffs.promotedPeriods, [1, 2, 3])

  for (const row of await statuses(M2577)) {
    const expected = row.period <= 3 ? 'reviewed' : 'pending_review'
    assert.equal(row.goals, expected)
    assert.equal(row.faceoffs, expected)
    assert.equal(row.shots, 'pending_review')
  }
})

void test('a match with no derivable period bound promotes nothing', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { sql: pg } = await import('@eanhl/db')
  await resetStatuses(M2577)
  await pg`UPDATE player_match_stats SET toi_seconds = NULL WHERE match_id = ${M2577}`
  try {
    const outcome = runCli(M2577, true)
    assert.equal(outcome.periodsPlayed, null)
    assert.equal(outcome.families.goals.promotable, false)
    assert.equal(outcome.families.faceoffs.promotable, false)
    for (const row of await statuses(M2577)) {
      assert.equal(row.goals, 'pending_review')
      assert.equal(row.faceoffs, 'pending_review')
    }
  } finally {
    await pg`UPDATE player_match_stats SET toi_seconds = ${REGULATION_TOI} WHERE match_id = ${M2577}`
  }
})

void test('the CLI does not claim promotion when nothing became publishable', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  // 475's families are already settled from the run above: goals reviewed,
  // faceoffs unreconciled. A second --promote has nothing left to publish.
  const result = spawnSync('node', [CLI_PATH, '--match', String(M475), '--promote'], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /Nothing became publishable/)
  assert.doesNotMatch(result.stdout, /^Promoted [1-9]/m)
})

void test('a report run mentions the out-of-range periods it excluded', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const result = spawnSync('node', [CLI_PATH, '--match', String(M2404)], {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /out-of-range OCR periods/)
  assert.match(result.stdout, /periods \[4\]/)
  assert.match(result.stdout, /Report only — nothing written/)
})

// ── TOCTOU ───────────────────────────────────────────────────────────────────

void test('the decision and the write share one lock — a concurrent writer waits', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { sql: pg } = await import('@eanhl/db')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_ISOLATION)

  // Hold the rows on a separate connection. If `promoteOcrPeriodFamily` did NOT
  // take `FOR UPDATE`, it would sail past this and classify rows another
  // transaction is mid-way through changing.
  const holder = await pg.reserve()
  let settled = false
  try {
    await holder`BEGIN`
    await holder`
      SELECT id FROM match_period_summaries WHERE match_id = ${M_ISOLATION} FOR UPDATE
    `
    const promotion = promoteOcrPeriodFamily({
      matchId: M_ISOLATION,
      family: 'goals',
      maxPeriod: 3,
    }).then((r) => {
      settled = true
      return r
    })
    await new Promise((resolve) => setTimeout(resolve, 750))
    assert.equal(settled, false, 'promotion must block on the held row lock, not race it')

    await holder`ROLLBACK`
    const result = await promotion
    assert.deepEqual(result.promotedPeriods, [1, 2, 3])
  } finally {
    await holder`ROLLBACK`.catch(() => undefined)
    holder.release()
  }
})

void test('a DB refusal the verdict did not anticipate is reported, never counted as promotion', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { sql: pg } = await import('@eanhl/db')
  await resetStatuses(M2577)

  // Reconciliation grades VALUES and knows nothing about review state, so it
  // still authorizes [1,2,3]. An operator rejecting P2's goals between the
  // report and the promote makes the DB refuse the window. The CLI must surface
  // that divergence rather than silently report a partial success.
  await pg`
    UPDATE match_period_summaries SET goals_review_status = 'rejected'
    WHERE match_id = ${M2577} AND period_number = 2
  `
  try {
    const outcome = runCli(M2577, true)
    assert.equal(outcome.families.goals.promotable, true, 'the values still reconcile')
    assert.deepEqual(outcome.families.goals.promotedPeriods, [], 'but nothing was promoted')
    assert.match(outcome.families.goals.error ?? '', /reconciliation authorized \[1,2,3\]/)

    const rows = await statuses(M2577)
    assert.equal(rows.find((r) => r.period === 1)?.goals, 'pending_review')
    assert.equal(rows.find((r) => r.period === 2)?.goals, 'rejected')
    assert.equal(rows.find((r) => r.period === 3)?.goals, 'pending_review')
    // Faceoffs are authorized independently and are unaffected by the goals refusal.
    assert.equal(rows.find((r) => r.period === 1)?.faceoffs, 'reviewed')
  } finally {
    await resetStatuses(M2577)
  }
})

void test('a match that does not exist is isolated, not fatal', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const outcome = runCli(99999999, true)
  assert.match(outcome.error ?? '', /not found/)
  assert.equal(outcome.families.goals.promotable, false)
})
