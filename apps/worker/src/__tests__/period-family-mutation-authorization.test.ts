/**
 * Mutation-boundary AUTHORIZATION for `promoteOcrPeriodFamily` (migration 0056).
 *
 * THE DEFECT UNDER TEST
 * ---------------------
 * The exported mutation used to trust its caller. It validated that the rows
 * were STRUCTURALLY complete — every period `1..maxPeriod` present, both sides
 * non-null, none rejected — and then wrote `reviewed`. It never established the
 * SEMANTIC verdict, so a direct caller could:
 *
 *   * promote goals that are complete but disagree with the EA final,
 *   * promote faceoffs that are complete but disagree with EA faceoff truth,
 *   * hand it any plausible positive `maxPeriod` and have it treated as the
 *     period bound, when the bound is EA player TOI and nothing else,
 *   * bypass every evidence check the `reconcile-periods` CLI performs, simply
 *     by not being that CLI.
 *
 * That is the same shape as the rescue `execute_plan()` bypass: the check lived
 * in the caller, so the boundary was decoration. `promoteOcrPeriodFamily` is an
 * exported member of `@eanhl/db/queries`, reachable from any worker script.
 *
 * REQUIRED BEHAVIOUR: the boundary derives the verdict itself, from authoritative
 * database state, inside the same transaction and snapshot as the UPDATE. A
 * caller-supplied `maxPeriod` is a claim to be CHECKED against the TOI-derived
 * bound, never evidence in its own right.
 *
 * Build + run (focused):
 *   pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build
 *   set -a && source .env && set +a
 *   node apps/worker/scripts/with-test-db.mjs period-family-mutation-authorization
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../../..')
const MIGRATION_PATH = path.join(
  REPO_ROOT,
  'packages/db/migrations/0056_period_family_review_status.sql',
)

/**
 * Sentinel match ids, far above the live sequence and disjoint from every other
 * period-family test file (which use 93xx/94xx). Dropped in `after`.
 */
const M_GOALS_WRONG = 9501
const M_FACEOFFS_WRONG = 9502
const M_BOUND_LIE = 9503
const M_NO_TOI = 9504
const M_CLEAN = 9505
const M_VACUOUS = 9506
const M_UNCONTESTED = 9507
const M_NO_FO_TRUTH = 9508
const ALL_MATCHES = [
  M_GOALS_WRONG,
  M_FACEOFFS_WRONG,
  M_BOUND_LIE,
  M_NO_TOI,
  M_CLEAN,
  M_VACUOUS,
  M_UNCONTESTED,
  M_NO_FO_TRUTH,
]

/** Full regulation: max skater TOI 3600 s ⇒ periodsPlayed 3. */
const REGULATION_TOI = 3600

const hasDb = Boolean(process.env['DATABASE_URL'])

function assertCloneDb(): void {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('period-family-mutation-authorization: DATABASE_URL is unset.')
  let dbName: string
  try {
    dbName = new URL(url).pathname.replace(/^\//, '')
  } catch {
    throw new Error(`period-family-mutation-authorization: DATABASE_URL is not a valid URL: ${url}`)
  }
  if (!dbName.startsWith('eanhl_test')) {
    throw new Error(
      `period-family-mutation-authorization: refusing to run — DATABASE_URL points at database ` +
        `"${dbName}", not an "eanhl_test_*" clone. This file applies migration 0056 and mutates ` +
        `review statuses; run it via apps/worker/scripts/with-test-db.mjs.`,
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
  await pg`DELETE FROM players WHERE gamertag = 'MUTATION-AUTHZ-SENTINEL'`
}

interface PeriodRow {
  periodNumber: number
  goalsFor: number | null
  goalsAgainst: number | null
  faceoffsFor: number | null
  faceoffsAgainst: number | null
}

/** Seed one sentinel match: EA truth + fully-pending OCR per-period rows. */
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
      ${`mutation-authz-${opts.matchId}`}, 'gameType5', '999999', 'SENTINEL',
      now(), ${opts.scoreFor > opts.scoreAgainst ? 'WIN' : 'LOSS'},
      ${opts.scoreFor}, ${opts.scoreAgainst}, 20, 18, 5, 4
    )
  `
  const [player] = await pg<{ id: number }[]>`
    INSERT INTO players (gamertag, position)
    VALUES ('MUTATION-AUTHZ-SENTINEL', 'center')
    ON CONFLICT DO NOTHING
    RETURNING id
  `
  const playerId =
    player?.id ??
    (
      await pg<{ id: number }[]>`SELECT id FROM players WHERE gamertag = 'MUTATION-AUTHZ-SENTINEL'`
    )[0]!.id

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
    VALUES (${opts.matchId}, ${`authz-${opts.matchId}`}, '999999', 'SENTINEL-OPP',
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
        ${p.goalsFor}, ${p.goalsAgainst}, 11, 9,
        ${p.faceoffsFor}, ${p.faceoffsAgainst}, 'ocr', 'pending_review',
        'pending_review', 'pending_review', 'pending_review'
      )
    `
  }
}

interface StatusRow {
  period: number
  goals: string
  shots: string
  faceoffs: string
  legacy: string
}

async function statuses(matchId: number): Promise<StatusRow[]> {
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

/** Every family of every row is still quarantined. */
function assertNothingPublished(rows: StatusRow[], why: string): void {
  for (const row of rows) {
    assert.equal(row.goals, 'pending_review', `${why} (P${String(row.period)} goals)`)
    assert.equal(row.shots, 'pending_review', `${why} (P${String(row.period)} shots)`)
    assert.equal(row.faceoffs, 'pending_review', `${why} (P${String(row.period)} faceoffs)`)
    assert.equal(row.legacy, 'pending_review', `${why} (P${String(row.period)} legacy)`)
  }
}

before(async () => {
  if (!hasDb) return
  assertCloneDb()
  await cleanup()
  await applyMigration0056()

  // Goals COMPLETE but INACCURATE: P1-P3 sum to 4-1, EA truth says 3-1.
  // Structurally flawless — the pre-fix boundary published it.
  await seedMatch({
    matchId: M_GOALS_WRONG,
    scoreFor: 3,
    scoreAgainst: 1,
    toi: REGULATION_TOI,
    ourFaceoffWins: 12,
    oppFaceoffWins: 8,
    periods: [
      { periodNumber: 1, goalsFor: 2, goalsAgainst: 1, faceoffsFor: 5, faceoffsAgainst: 3 },
      { periodNumber: 2, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: 3 },
      { periodNumber: 3, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 3, faceoffsAgainst: 2 },
    ],
  })

  // Faceoffs COMPLETE but INACCURATE: sums to 11-8, EA truth says 12-8.
  // Goals in the same match are clean, so a goals promotion must still work —
  // this proves the fix is per-family, not a blanket lockout.
  await seedMatch({
    matchId: M_FACEOFFS_WRONG,
    scoreFor: 3,
    scoreAgainst: 1,
    toi: REGULATION_TOI,
    ourFaceoffWins: 12,
    oppFaceoffWins: 8,
    periods: [
      { periodNumber: 1, goalsFor: 1, goalsAgainst: 1, faceoffsFor: 4, faceoffsAgainst: 3 },
      { periodNumber: 2, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: 3 },
      { periodNumber: 3, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 3, faceoffsAgainst: 2 },
    ],
  })

  // A clean 3-period match used to probe a LIED-ABOUT bound: everything
  // reconciles over P1-P3, so only the bound itself can be wrong.
  await seedMatch({
    matchId: M_BOUND_LIE,
    scoreFor: 3,
    scoreAgainst: 1,
    toi: REGULATION_TOI,
    ourFaceoffWins: 12,
    oppFaceoffWins: 8,
    periods: [
      { periodNumber: 1, goalsFor: 1, goalsAgainst: 1, faceoffsFor: 5, faceoffsAgainst: 3 },
      { periodNumber: 2, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: 3 },
      { periodNumber: 3, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 3, faceoffsAgainst: 2 },
    ],
  })

  // No TOI at all ⇒ no derivable bound ⇒ nothing is authorized, whatever the
  // caller claims.
  await seedMatch({
    matchId: M_NO_TOI,
    scoreFor: 3,
    scoreAgainst: 1,
    toi: null,
    ourFaceoffWins: 12,
    oppFaceoffWins: 8,
    periods: [
      { periodNumber: 1, goalsFor: 1, goalsAgainst: 1, faceoffsFor: 5, faceoffsAgainst: 3 },
      { periodNumber: 2, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: 3 },
      { periodNumber: 3, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 3, faceoffsAgainst: 2 },
    ],
  })

  // The genuinely publishable control: goals AND faceoffs both reconcile over
  // P1-P3, plus a phantom P4 that must stay pending.
  await seedMatch({
    matchId: M_CLEAN,
    scoreFor: 3,
    scoreAgainst: 1,
    toi: REGULATION_TOI,
    ourFaceoffWins: 12,
    oppFaceoffWins: 8,
    periods: [
      { periodNumber: 1, goalsFor: 1, goalsAgainst: 1, faceoffsFor: 5, faceoffsAgainst: 3 },
      { periodNumber: 2, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: 3 },
      { periodNumber: 3, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 3, faceoffsAgainst: 2 },
      { periodNumber: 4, goalsFor: 0, goalsAgainst: 0, faceoffsFor: 0, faceoffsAgainst: 0 },
    ],
  })

  // VACUOUS goals sum on a full-regulation game: the whole 3-1 final sits in P1
  // and P2/P3 are 0-0. The sum matches BY CONSTRUCTION, and TOI proves P2/P3
  // were really played, so their 0-0 is a claim, not a forced value. Complete
  // and "accurate" — and exactly the non-evidence the boundary must reject.
  await seedMatch({
    matchId: M_VACUOUS,
    scoreFor: 3,
    scoreAgainst: 1,
    toi: REGULATION_TOI,
    ourFaceoffWins: 12,
    oppFaceoffWins: 8,
    periods: [
      { periodNumber: 1, goalsFor: 3, goalsAgainst: 1, faceoffsFor: 5, faceoffsAgainst: 3 },
      { periodNumber: 2, goalsFor: 0, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: 3 },
      { periodNumber: 3, goalsFor: 0, goalsAgainst: 0, faceoffsFor: 3, faceoffsAgainst: 2 },
    ],
  })

  // Faceoff totals match EA truth exactly (12-8) but P3 records ZERO draws on
  // both sides — a played period always opens with a centre-ice faceoff, so
  // this is a misread whose sum happens to land.
  await seedMatch({
    matchId: M_UNCONTESTED,
    scoreFor: 3,
    scoreAgainst: 1,
    toi: REGULATION_TOI,
    ourFaceoffWins: 12,
    oppFaceoffWins: 8,
    periods: [
      { periodNumber: 1, goalsFor: 1, goalsAgainst: 1, faceoffsFor: 8, faceoffsAgainst: 5 },
      { periodNumber: 2, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 4, faceoffsAgainst: 3 },
      { periodNumber: 3, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 0, faceoffsAgainst: 0 },
    ],
  })

  // EA published NO faceoff data (0-0 truth). An OCR 0-0 agreeing with it is
  // evidence of nothing, so faceoffs must not promote — while goals still can.
  await seedMatch({
    matchId: M_NO_FO_TRUTH,
    scoreFor: 3,
    scoreAgainst: 1,
    toi: REGULATION_TOI,
    ourFaceoffWins: 0,
    oppFaceoffWins: 0,
    periods: [
      { periodNumber: 1, goalsFor: 1, goalsAgainst: 1, faceoffsFor: 0, faceoffsAgainst: 0 },
      { periodNumber: 2, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 0, faceoffsAgainst: 0 },
      { periodNumber: 3, goalsFor: 1, goalsAgainst: 0, faceoffsFor: 0, faceoffsAgainst: 0 },
    ],
  })
})

after(async () => {
  if (!hasDb) return
  const { sql: pg } = await import('@eanhl/db')
  await cleanup().catch(() => undefined)
  await pg.end({ timeout: 1 }).catch(() => undefined)
})

// ── 1. complete-but-inaccurate goals ─────────────────────────────────────────

void test('complete but EA-INACCURATE goals are not promoted by a direct call', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_GOALS_WRONG)

  // Structurally flawless: P1-P3 all present, both sides read, none rejected.
  // Semantically wrong: they sum to 4-1 against an EA final of 3-1.
  const result = await promoteOcrPeriodFamily({
    matchId: M_GOALS_WRONG,
    family: 'goals',
    maxPeriod: 3,
  })

  assert.equal(result.authorized, false, 'a caller must not be able to publish an inaccurate sum')
  assert.deepEqual(result.promotedPeriods, [])
  assert.match(result.reason, /periodAccuracy|do not sum/i)
  assertNothingPublished(await statuses(M_GOALS_WRONG), 'inaccurate goals must stay quarantined')
})

// ── 2. complete-but-inaccurate faceoffs ──────────────────────────────────────

void test('complete but EA-INACCURATE faceoffs are not promoted by a direct call', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_FACEOFFS_WRONG)

  const result = await promoteOcrPeriodFamily({
    matchId: M_FACEOFFS_WRONG,
    family: 'faceoffs',
    maxPeriod: 3,
  })

  assert.equal(result.authorized, false)
  assert.deepEqual(result.promotedPeriods, [])
  assert.match(result.reason, /faceoffAccuracy|do not\s+match EA truth|not reconciliation/i)
  assertNothingPublished(
    await statuses(M_FACEOFFS_WRONG),
    'inaccurate faceoffs must stay quarantined',
  )
})

void test('the goals of that same match still promote — the gate is per family', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_FACEOFFS_WRONG)

  const result = await promoteOcrPeriodFamily({
    matchId: M_FACEOFFS_WRONG,
    family: 'goals',
    maxPeriod: 3,
  })
  assert.equal(result.authorized, true, 'the goals genuinely reconcile against the EA final')
  assert.deepEqual(result.promotedPeriods, [1, 2, 3])

  for (const row of await statuses(M_FACEOFFS_WRONG)) {
    assert.equal(row.goals, 'reviewed')
    assert.equal(row.faceoffs, 'pending_review', 'the failing family is unaffected')
    assert.equal(row.shots, 'pending_review')
    assert.equal(row.legacy, 'pending_review')
  }
})

// ── 3. a caller-supplied bound is a claim, not authorization ─────────────────

void test('a plausible but WRONG maxPeriod fails closed with no writes', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_BOUND_LIE)

  // TOI proves 3 periods. 2 is positive, an integer, and entirely plausible —
  // and under the pre-fix boundary it silently published a 2-period breakdown
  // of a 3-period game. Under-claiming must fail closed just as loudly as
  // over-claiming: the bound is derived, never negotiated.
  await assert.rejects(
    () => promoteOcrPeriodFamily({ matchId: M_BOUND_LIE, family: 'goals', maxPeriod: 2 }),
    /maxPeriod/i,
    'a bound that disagrees with EA TOI must be rejected',
  )
  assertNothingPublished(await statuses(M_BOUND_LIE), 'an under-claimed bound must write nothing')

  // Over-claiming is equally unauthorized: P4 was never played.
  await assert.rejects(
    () => promoteOcrPeriodFamily({ matchId: M_BOUND_LIE, family: 'goals', maxPeriod: 4 }),
    /maxPeriod/i,
    'a bound above the TOI-derived one must be rejected',
  )
  assertNothingPublished(await statuses(M_BOUND_LIE), 'an over-claimed bound must write nothing')
})

void test('the correct TOI-derived bound on the same match is accepted', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_BOUND_LIE)

  const result = await promoteOcrPeriodFamily({
    matchId: M_BOUND_LIE,
    family: 'goals',
    maxPeriod: 3,
  })
  assert.equal(result.authorized, true)
  assert.deepEqual(result.promotedPeriods, [1, 2, 3])
})

// ── 4. missing / unusable authoritative truth ────────────────────────────────

void test('a match with no TOI authorizes nothing, whatever bound is supplied', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_NO_TOI)

  for (const bound of [1, 2, 3, 4]) {
    await assert.rejects(
      () => promoteOcrPeriodFamily({ matchId: M_NO_TOI, family: 'goals', maxPeriod: bound }),
      /bound|TOI/i,
      `maxPeriod=${String(bound)} must not stand in for a missing TOI bound`,
    )
  }
  assertNothingPublished(await statuses(M_NO_TOI), 'no bound ⇒ no publication')
})

void test('unusable TOI is refused just as hard as absent TOI', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { sql: pg } = await import('@eanhl/db')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_CLEAN)

  // A present-but-meaningless TOI (0 s) is not a bound. It must fail closed
  // exactly like a NULL one rather than being rounded into some period count.
  await pg`UPDATE player_match_stats SET toi_seconds = 0 WHERE match_id = ${M_CLEAN}`
  try {
    await assert.rejects(
      () => promoteOcrPeriodFamily({ matchId: M_CLEAN, family: 'goals', maxPeriod: 3 }),
      /bound|TOI/i,
    )
    assertNothingPublished(await statuses(M_CLEAN), 'an unusable bound ⇒ no publication')
  } finally {
    await pg`
      UPDATE player_match_stats SET toi_seconds = ${REGULATION_TOI} WHERE match_id = ${M_CLEAN}
    `
  }
})

void test('a match id with no rows at all authorizes nothing', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')

  // No `matches` row, no TOI, no OCR rows. The boundary must refuse rather than
  // treat "nothing to contradict me" as authorization.
  //
  // Note the stronger shape — EA truth absent while OCR period rows survive — is
  // unreachable by construction: `match_period_summaries.match_id` and
  // `player_match_stats.match_id` are both FK-bound to `matches`, so a row can
  // never outlive its truth. The boundary still handles `truth === null`
  // (`computePeriodEvidence` leaves every accuracy signal null, which fails every
  // family closed); the database simply also prevents it.
  await assert.rejects(
    () => promoteOcrPeriodFamily({ matchId: 99999999, family: 'goals', maxPeriod: 3 }),
    /bound|TOI/i,
  )
})

// ── 5. non-vacuous evidence ──────────────────────────────────────────────────

void test('a VACUOUS goals sum is refused even though it is complete and adds up', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_VACUOUS)

  // 3-1 in P1, 0-0 in P2 and P3, EA final 3-1: the sum matches by construction.
  // TOI says all three periods were played, so the zeros are not forced and the
  // sum test proves nothing about the breakdown.
  const result = await promoteOcrPeriodFamily({
    matchId: M_VACUOUS,
    family: 'goals',
    maxPeriod: 3,
  })
  assert.equal(result.authorized, false)
  assert.deepEqual(result.promotedPeriods, [])
  assert.match(result.reason, /vacuous/i)
  assertNothingPublished(await statuses(M_VACUOUS), 'a vacuous sum is not reconciliation')
})

void test('an uncontested expected period blocks faceoffs despite an exact total', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_UNCONTESTED)

  const result = await promoteOcrPeriodFamily({
    matchId: M_UNCONTESTED,
    family: 'faceoffs',
    maxPeriod: 3,
  })
  assert.equal(result.authorized, false, 'P3 records zero draws — no period opens without one')
  assert.deepEqual(result.promotedPeriods, [])
  assertNothingPublished(await statuses(M_UNCONTESTED), 'an all-zero played period is a misread')
})

void test('absent EA faceoff truth blocks faceoffs but not goals', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_NO_FO_TRUTH)

  const faceoffs = await promoteOcrPeriodFamily({
    matchId: M_NO_FO_TRUTH,
    family: 'faceoffs',
    maxPeriod: 3,
  })
  assert.equal(faceoffs.authorized, false, '0-0 EA truth is "no data", not agreement')
  assert.deepEqual(faceoffs.promotedPeriods, [])

  const goals = await promoteOcrPeriodFamily({
    matchId: M_NO_FO_TRUTH,
    family: 'goals',
    maxPeriod: 3,
  })
  assert.equal(goals.authorized, true, 'goals have their own truth and are unaffected')

  for (const row of await statuses(M_NO_FO_TRUTH)) {
    assert.equal(row.goals, 'reviewed')
    assert.equal(row.faceoffs, 'pending_review')
  }
})

// ── 6. shots remain impossible to auto-promote ───────────────────────────────

void test('shots are refused on a match where everything else reconciles', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_CLEAN)
  const before = await statuses(M_CLEAN)

  await assert.rejects(
    () => promoteOcrPeriodFamily({ matchId: M_CLEAN, family: 'shots', maxPeriod: 3 }),
    /shots have no automatic promotion path/i,
  )
  assert.deepEqual(await statuses(M_CLEAN), before, 'not one row may move')
})

// ── 7. a failed authorization leaves every family status unchanged ───────────

void test('a refused promotion leaves all three families byte-identical', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { sql: pg } = await import('@eanhl/db')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_GOALS_WRONG)

  // A deliberately mixed starting state: one family already reviewed, one
  // already rejected. A refusal must preserve every one of them exactly.
  await pg`
    UPDATE match_period_summaries SET faceoffs_review_status = 'reviewed'
    WHERE match_id = ${M_GOALS_WRONG} AND period_number = 1
  `
  await pg`
    UPDATE match_period_summaries SET shots_review_status = 'rejected'
    WHERE match_id = ${M_GOALS_WRONG} AND period_number = 2
  `
  const before = await statuses(M_GOALS_WRONG)

  const result = await promoteOcrPeriodFamily({
    matchId: M_GOALS_WRONG,
    family: 'goals',
    maxPeriod: 3,
  })
  assert.equal(result.authorized, false)
  assert.deepEqual(await statuses(M_GOALS_WRONG), before, 'a refusal writes nothing at all')
})

// ── 8. the control: a genuinely reconciled match still publishes ─────────────

void test('the clean control promotes goals and faceoffs over P1-P3 only', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_CLEAN)

  const goals = await promoteOcrPeriodFamily({ matchId: M_CLEAN, family: 'goals', maxPeriod: 3 })
  assert.equal(goals.authorized, true)
  assert.deepEqual(goals.promotedPeriods, [1, 2, 3])
  assert.deepEqual(goals.excludedPeriods, [4], 'the phantom P4 is excluded, never promoted')

  const faceoffs = await promoteOcrPeriodFamily({
    matchId: M_CLEAN,
    family: 'faceoffs',
    maxPeriod: 3,
  })
  assert.equal(faceoffs.authorized, true)
  assert.deepEqual(faceoffs.promotedPeriods, [1, 2, 3])

  for (const row of await statuses(M_CLEAN)) {
    const expected = row.period <= 3 ? 'reviewed' : 'pending_review'
    assert.equal(row.goals, expected)
    assert.equal(row.faceoffs, expected)
    assert.equal(row.shots, 'pending_review')
    assert.equal(row.legacy, 'pending_review')
  }
})

void test('the authorization reads share the transaction that writes', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { sql: pg } = await import('@eanhl/db')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await resetStatuses(M_CLEAN)

  // Hold the EA truth row the authorization depends on. If the boundary read it
  // outside the transaction, or did not lock it, the promotion would sail past
  // a row another transaction is mid-way through rewriting.
  const holder = await pg.reserve()
  let settled = false
  try {
    await holder`BEGIN`
    await holder`SELECT id FROM matches WHERE id = ${M_CLEAN} FOR UPDATE`
    const promotion = promoteOcrPeriodFamily({
      matchId: M_CLEAN,
      family: 'goals',
      maxPeriod: 3,
    }).then((r) => {
      settled = true
      return r
    })
    await new Promise((resolve) => setTimeout(resolve, 750))
    assert.equal(settled, false, 'authorization must block on the held EA-truth lock')

    await holder`ROLLBACK`
    const result = await promotion
    assert.equal(result.authorized, true)
    assert.deepEqual(result.promotedPeriods, [1, 2, 3])
  } finally {
    await holder`ROLLBACK`.catch(() => undefined)
    holder.release()
  }
})
