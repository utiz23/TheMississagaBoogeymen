/**
 * DURABLE per-family rejection — audit finding C5.
 *
 * THE DEFECT UNDER TEST
 * ---------------------
 * A rejection did not survive. `setExtractionStatus(..., 'rejected')` only
 * demoted `reviewed` families to `pending_review`, and `pending_review` is
 * exactly the state `reconcile-periods --promote` is built to consume. So:
 *
 *   1. promote goals                 → goals_review_status = 'reviewed'
 *   2. reject the goals extraction   → cascade demotes it to 'pending_review'
 *   3. reconcile-periods --promote   → the values still reconcile, so it
 *                                      republishes the family an operator just
 *                                      rejected.
 *
 * The mutation boundary never consulted rejected extraction state at all, so
 * step 3 could not refuse. A rejection was a pause, not a verdict.
 *
 * WHY THE STICKY POINTER CANNOT BE THE BARRIER
 * --------------------------------------------
 * `match_period_summaries.ocr_extraction_id` is written `COALESCE(existing,
 * incoming)` — it names only the FIRST contributor to the row, for any of the
 * three families. A second goals extraction that filled the side the first left
 * null is recorded nowhere. Gating on that pointer would let a rejection of
 * extraction B be invisible to a row naming extraction A, for the very same
 * match and family. The barrier must come from AUTHORITATIVE extraction metadata
 * (`ocr_extractions.match_id` ∪ the sticky pointers, scoped by `screen_type`),
 * never from the pointer alone.
 *
 * REQUIRED POLICY
 * ---------------
 *   * screen_type → family: post_game_box_score_{goals,shots,faceoffs}.
 *   * A directly rejected box-score extraction implicates its whole match/family
 *     (field-level provenance does not exist ⇒ fail closed): every OCR period row
 *     of that match gets that family durably marked 'rejected'.
 *   * Other families on the affected match are conservatively QUARANTINED to
 *     'pending_review' — never rejected as collateral.
 *   * A rejected NON-box-score extraction quarantines only; it never creates a
 *     permanent family rejection.
 *   * `promoteOcrPeriodFamily` independently refuses while ANY rejected
 *     extraction exists for the match/family.
 *   * Moving a rejected extraction away from 'rejected' clears the barrier only
 *     when no other rejection remains, and only as far as 'pending_review'.
 *     Publication still requires the semantic reconciliation boundary.
 *
 * NOTE ON THE DYNAMIC COUNTER READS. The two new counters are read by NAME
 * through {@link counter} rather than as typed fields. That is deliberate: it
 * keeps this file compiling against the pre-fix `CascadeCounts`, so the red run
 * that motivated the change is reproducible at the parent commit — and the names
 * themselves are the operator-facing contract the CLIs print.
 *
 * Build + run (focused):
 *   pnpm --filter @eanhl/db build && pnpm --filter @eanhl/worker build
 *   set -a && source .env && set +a
 *   node apps/worker/scripts/with-test-db.mjs period-family-rejection-durability
 */

import test, { after, before, beforeEach } from 'node:test'
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

/** Sentinel match ids, disjoint from every other period-family test file. */
const MATCH = 9601
const BYSTANDER = 9602
const ALL_MATCHES = [MATCH, BYSTANDER]

/** Full regulation: max skater TOI 3600 s ⇒ periodsPlayed 3. */
const REGULATION_TOI = 3600

const hasDb = Boolean(process.env['DATABASE_URL'])

/** MATCH's extractions. Only `goalsA` is ever named by a period row. */
let goalsA = 0
let goalsB = 0
let shotsExtraction = 0
let lobbyExtraction = 0
/** BYSTANDER's goals extraction — nothing here may reach it. */
let bystanderGoals = 0

/** Read an operator-facing cascade counter by name. See the file header. */
function counter(counts: object, key: string): number {
  const value = (counts as Record<string, unknown>)[key]
  return typeof value === 'number' ? value : Number.NaN
}

function assertCloneDb(): void {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('period-family-rejection-durability: DATABASE_URL is unset.')
  let dbName: string
  try {
    dbName = new URL(url).pathname.replace(/^\//, '')
  } catch {
    throw new Error(`period-family-rejection-durability: DATABASE_URL is not a valid URL: ${url}`)
  }
  if (!dbName.startsWith('eanhl_test')) {
    throw new Error(
      `period-family-rejection-durability: refusing to run — DATABASE_URL points at database ` +
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
  await pg`DELETE FROM ocr_extractions WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM ocr_capture_batches WHERE match_id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM matches WHERE id = ANY(${ALL_MATCHES})`
  await pg`DELETE FROM players WHERE gamertag = 'REJECTION-DURABILITY-SENTINEL'`
}

/**
 * A match whose goals AND faceoffs both reconcile against EA truth, so a refusal
 * in either family can only come from the rejection barrier and never from the
 * evidence.
 *
 *   goals    P1 2-1, P2 1-0, P3 0-0  → 3-1, and EA says 3-1 (two scoring periods,
 *                                      so the sum is not vacuous)
 *   faceoffs P1 5-3, P2 4-3, P3 3-2  → 12-8, and EA says 12-8; every period contested
 */
async function seedMatch(matchId: number): Promise<number> {
  const { sql: pg } = await import('@eanhl/db')
  await pg`
    INSERT INTO matches (
      id, game_title_id, ea_match_id, match_type, opponent_club_id, opponent_name,
      played_at, result, score_for, score_against, shots_for, shots_against,
      hits_for, hits_against
    ) VALUES (
      ${matchId}, (SELECT id FROM game_titles ORDER BY id LIMIT 1),
      ${`rejection-durability-${matchId}`}, 'gameType5', '999999', 'SENTINEL',
      now(), 'WIN', 3, 1, 20, 18, 5, 4
    )
  `
  const [player] = await pg<{ id: number }[]>`
    INSERT INTO players (gamertag, position)
    VALUES ('REJECTION-DURABILITY-SENTINEL', 'center')
    ON CONFLICT DO NOTHING
    RETURNING id
  `
  const playerId =
    player?.id ??
    (
      await pg<
        { id: number }[]
      >`SELECT id FROM players WHERE gamertag = 'REJECTION-DURABILITY-SENTINEL'`
    )[0]!.id

  await pg`
    INSERT INTO player_match_stats (player_id, match_id, position, is_goalie, goals, assists,
                                    faceoff_wins, faceoff_losses, toi_seconds)
    VALUES (${playerId}, ${matchId}, 'center', false, 0, 0, 12, 0, ${REGULATION_TOI})
  `
  await pg`
    INSERT INTO opponent_player_match_stats (match_id, ea_player_id, opponent_club_id, gamertag,
                                             position, is_goalie, faceoff_wins, faceoff_losses,
                                             toi_seconds)
    VALUES (${matchId}, ${`durability-${matchId}`}, '999999', 'SENTINEL-OPP',
            'center', false, 8, 0, ${REGULATION_TOI})
  `

  const [batch] = await pg<{ id: number }[]>`
    INSERT INTO ocr_capture_batches (game_title_id, match_id, capture_kind, source_directory)
    VALUES ((SELECT id FROM game_titles ORDER BY id LIMIT 1), ${matchId}, 'video_frames',
            ${`/rejection-durability-${matchId}`})
    RETURNING id
  `
  return batch!.id
}

async function insertExtraction(
  batchId: number,
  matchId: number,
  screenType: string,
  suffix: string,
): Promise<number> {
  const { sql: pg } = await import('@eanhl/db')
  // bigserial arrives as a string over the wire; coerce so ids compare as numbers.
  const [row] = await pg<{ id: string }[]>`
    INSERT INTO ocr_extractions (batch_id, match_id, screen_type, source_path, raw_result_json,
                                 transform_status, review_status)
    VALUES (${batchId}, ${matchId}, ${screenType},
            ${`/frames/${String(matchId)}-${suffix}.png`},
            '{}'::jsonb, 'success', 'pending_review')
    RETURNING id
  `
  return Number(row!.id)
}

const PERIODS = [
  { period: 1, gf: 2, ga: 1, ff: 5, fa: 3 },
  { period: 2, gf: 1, ga: 0, ff: 4, fa: 3 },
  { period: 3, gf: 0, ga: 0, ff: 3, fa: 2 },
] as const

async function insertPeriodRows(matchId: number, namedExtractionId: number): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  for (const p of PERIODS) {
    await pg`
      INSERT INTO match_period_summaries (
        match_id, period_number, period_label, goals_for, goals_against,
        shots_for, shots_against, faceoffs_for, faceoffs_against, source,
        ocr_extraction_id, review_status,
        goals_review_status, shots_review_status, faceoffs_review_status
      ) VALUES (
        ${matchId}, ${p.period}, ${`P${String(p.period)}`}, ${p.gf}, ${p.ga},
        11, 9, ${p.ff}, ${p.fa}, 'ocr',
        ${namedExtractionId}, 'pending_review',
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

/** Back to the fixture's ground state: nothing published, nothing rejected. */
async function resetAll(): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await pg`
    UPDATE match_period_summaries
    SET goals_review_status = 'pending_review',
        shots_review_status = 'pending_review',
        faceoffs_review_status = 'pending_review',
        review_status = 'pending_review'
    WHERE match_id = ANY(${ALL_MATCHES})
  `
  await pg`
    UPDATE ocr_extractions SET review_status = 'pending_review', reviewed_at = NULL
    WHERE match_id = ANY(${ALL_MATCHES})
  `
}

async function publishAll(matchId: number): Promise<void> {
  const { sql: pg } = await import('@eanhl/db')
  await pg`
    UPDATE match_period_summaries
    SET goals_review_status = 'reviewed', shots_review_status = 'reviewed',
        faceoffs_review_status = 'reviewed'
    WHERE match_id = ${matchId}
  `
}

async function promoteGoals(matchId = MATCH) {
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  return promoteOcrPeriodFamily({ matchId, family: 'goals', maxPeriod: 3 })
}

before(async () => {
  if (!hasDb) return
  assertCloneDb()
  await cleanup()
  await applyMigration0056()

  const batchId = await seedMatch(MATCH)
  goalsA = await insertExtraction(batchId, MATCH, 'post_game_box_score_goals', 'goals-a')
  goalsB = await insertExtraction(batchId, MATCH, 'post_game_box_score_goals', 'goals-b')
  shotsExtraction = await insertExtraction(batchId, MATCH, 'post_game_box_score_shots', 'shots')
  await insertExtraction(batchId, MATCH, 'post_game_box_score_faceoffs', 'faceoffs')
  lobbyExtraction = await insertExtraction(batchId, MATCH, 'pre_game_lobby_state_1', 'lobby')
  // Only goalsA is named — goalsB is the second contributor the COALESCE merge
  // silently forgot, and the reason the sticky pointer cannot be the barrier.
  await insertPeriodRows(MATCH, goalsA)

  const bystanderBatch = await seedMatch(BYSTANDER)
  bystanderGoals = await insertExtraction(
    bystanderBatch,
    BYSTANDER,
    'post_game_box_score_goals',
    'goals',
  )
  await insertPeriodRows(BYSTANDER, bystanderGoals)
})

beforeEach(async () => {
  if (!hasDb) return
  await resetAll()
})

after(async () => {
  if (!hasDb) return
  const { sql: pg } = await import('@eanhl/db')
  await cleanup().catch(() => undefined)
  await pg.end({ timeout: 1 }).catch(() => undefined)
})

// ── 1. C5: rejection must be durable ─────────────────────────────────────────

void test('promote → reject → promote must NOT republish the rejected family', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')

  const first = await promoteGoals()
  assert.equal(first.authorized, true, 'fixture must be promotable before the rejection')
  assert.deepEqual(first.promotedPeriods, [1, 2, 3])

  await setExtractionStatus([goalsA], 'rejected')

  for (const row of await statuses(MATCH)) {
    assert.equal(
      row.goals,
      'rejected',
      `a rejected goals extraction must durably reject the goals family (P${String(row.period)})`,
    )
  }

  const second = await promoteGoals()
  assert.equal(
    second.authorized,
    false,
    'automatic promotion must refuse while a rejected goals extraction exists',
  )
  assert.deepEqual(second.promotedPeriods, [], 'a refusal promotes nothing')
  for (const row of await statuses(MATCH)) {
    assert.equal(row.goals, 'rejected', 'and the rejection survives the re-run')
  }
})

// ── 2. the sticky pointer must not be the barrier ────────────────────────────

void test('a sticky pointer to extraction A does not hide the rejection of extraction B', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { sql: pg } = await import('@eanhl/db')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')

  // Every period row names goalsA. goalsB is a goals contributor no row records.
  const named = await pg<{ ocr_extraction_id: string }[]>`
    SELECT DISTINCT ocr_extraction_id FROM match_period_summaries WHERE match_id = ${MATCH}
  `
  assert.deepEqual(
    named.map((r) => Number(r.ocr_extraction_id)),
    [goalsA],
    'fixture must name only extraction A',
  )

  await promoteGoals()
  await setExtractionStatus([goalsB], 'rejected')

  for (const row of await statuses(MATCH)) {
    assert.equal(
      row.goals,
      'rejected',
      `rejecting the unnamed goals contributor must still reject the family (P${String(row.period)})`,
    )
  }
  assert.equal(
    (await promoteGoals()).authorized,
    false,
    'the barrier must come from extraction metadata, not from the row pointer',
  )
})

// ── 3. rejection is family-scoped, not row-wide ──────────────────────────────

void test('rejecting a goals extraction does not permanently reject shots or faceoffs', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  await publishAll(MATCH)

  const counts = await setExtractionStatus([goalsA], 'rejected')

  for (const row of await statuses(MATCH)) {
    assert.equal(row.goals, 'rejected', 'the implicated family is rejected')
    assert.equal(row.shots, 'pending_review', 'shots are collateral — quarantined, never rejected')
    assert.equal(row.faceoffs, 'pending_review', 'faceoffs likewise')
  }
  assert.equal(
    counter(counts, 'periodFamiliesRejected'),
    3,
    'three (row, family) pairs durably rejected',
  )
  assert.equal(counts.periodSummariesQuarantined, 3, 'and three rows collaterally quarantined')

  // …and the faceoffs family, which reconciles just as well, is still promotable.
  const faceoffs = await promoteOcrPeriodFamily({
    matchId: MATCH,
    family: 'faceoffs',
    maxPeriod: 3,
  })
  assert.equal(faceoffs.authorized, true, 'a goals rejection must not bar the faceoffs family')
})

void test('rejecting a NON-box-score extraction quarantines but never rejects a family', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')
  await publishAll(MATCH)

  const counts = await setExtractionStatus([lobbyExtraction], 'rejected')

  for (const row of await statuses(MATCH)) {
    assert.equal(row.goals, 'pending_review', 'a lobby screen implicates no stat family')
    assert.equal(row.shots, 'pending_review')
    assert.equal(row.faceoffs, 'pending_review')
  }
  assert.equal(counter(counts, 'periodFamiliesRejected'), 0, 'no family is permanently rejected')
  assert.equal(counts.periodSummariesQuarantined, 3, 'the conservative quarantine still applies')

  // A quarantine is a pause: the goals family may be republished by the
  // reconciliation boundary, which is exactly what a rejection must prevent.
  assert.equal(
    (await promoteGoals()).authorized,
    true,
    'collateral quarantine does not bar re-promotion',
  )
})

// ── 4. a demotion is not a rejection ─────────────────────────────────────────

void test('demoting a goals extraction to pending_review creates no permanent rejection', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')
  await promoteGoals()

  const counts = await setExtractionStatus([goalsA], 'pending_review')

  assert.equal(counter(counts, 'periodFamiliesRejected'), 0, 'a demotion never rejects')
  for (const row of await statuses(MATCH)) {
    assert.equal(row.goals, 'pending_review', 'the published family is withdrawn, not rejected')
  }
  assert.equal((await promoteGoals()).authorized, true, 'and a re-run may republish it')
})

// ── 5. the barrier holds until EVERY rejection is cleared ────────────────────

void test('two rejected goals extractions keep the block until both are cleared', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')

  await setExtractionStatus([goalsA, goalsB], 'rejected')
  assert.equal((await promoteGoals()).authorized, false, 'blocked by two rejections')

  const firstClear = await setExtractionStatus([goalsA], 'pending_review')
  assert.equal(
    counter(firstClear, 'periodRejectionBarriersCleared'),
    0,
    'goalsB is still rejected — nothing may be cleared yet',
  )
  for (const row of await statuses(MATCH)) {
    assert.equal(row.goals, 'rejected', 'the surviving rejection keeps the family rejected')
  }
  assert.equal((await promoteGoals()).authorized, false, 'still blocked by goalsB')

  const secondClear = await setExtractionStatus([goalsB], 'pending_review')
  assert.equal(
    counter(secondClear, 'periodRejectionBarriersCleared'),
    3,
    'clearing the last rejection lifts the barrier on all three rows',
  )
  for (const row of await statuses(MATCH)) {
    assert.equal(row.goals, 'pending_review', 'cleared only as far as pending_review')
  }
})

void test('clearing the last rejection never publishes — it only reaches pending_review', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')

  await promoteGoals()
  await setExtractionStatus([goalsA], 'rejected')
  for (const row of await statuses(MATCH)) assert.equal(row.goals, 'rejected')

  // APPROVING the extraction is the strongest possible clearance signal, and it
  // still may not restore publication: only the reconciliation boundary can.
  const counts = await setExtractionStatus([goalsA], 'reviewed')

  assert.equal(counter(counts, 'periodRejectionBarriersCleared'), 3)
  assert.equal(counts.periodSummaries, 0, 'the cascade still publishes nothing')
  for (const row of await statuses(MATCH)) {
    assert.equal(row.goals, 'pending_review', 'rejected → pending_review, never → reviewed')
  }
})

// ── 6. approval still does not widen publication ─────────────────────────────

void test('approving an extraction publishes no period family', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')

  const counts = await setExtractionStatus([goalsA], 'reviewed')

  assert.equal(counts.periodSummaries, 0)
  assert.equal(counts.periodSummariesSkipped, 3, 'the declined rows are still reported')
  assert.equal(counts.periodSummariesQuarantined, 0, 'approval quarantines nothing')
  assert.equal(counter(counts, 'periodFamiliesRejected'), 0)
  assert.equal(
    counter(counts, 'periodRejectionBarriersCleared'),
    0,
    'there was no barrier to clear',
  )
  for (const row of await statuses(MATCH)) {
    assert.equal(row.goals, 'pending_review')
    assert.equal(row.shots, 'pending_review')
    assert.equal(row.faceoffs, 'pending_review')
  }
})

// ── 7. a refused promotion writes nothing at all ─────────────────────────────

void test('a promotion refused by the rejection barrier writes nothing', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { sql: pg } = await import('@eanhl/db')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')

  await setExtractionStatus([goalsA], 'rejected')
  const before = await statuses(MATCH)
  const digest = async (): Promise<string | undefined> => {
    const [row] = await pg<{ digest: string | null }[]>`
      SELECT string_agg(id::text || ':' || review_status, ',' ORDER BY id) AS digest
      FROM ocr_extractions WHERE match_id = ANY(${ALL_MATCHES})
    `
    return row?.digest ?? undefined
  }
  const extractionsBefore = await digest()

  const result = await promoteGoals()

  assert.equal(result.authorized, false)
  assert.deepEqual(result.promotedPeriods, [])
  assert.match(result.reason, /reject/i, 'the operator must be told WHY it refused')
  assert.deepEqual(await statuses(MATCH), before, 'not one period status column moved')
  assert.equal(await digest(), extractionsBefore, 'and no extraction moved')
})

// ── 8. blast radius ──────────────────────────────────────────────────────────

void test('a rejection on one match does not reject the same family on another', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')

  await setExtractionStatus([goalsA], 'rejected')

  for (const row of await statuses(BYSTANDER)) {
    assert.equal(row.goals, 'pending_review', 'BYSTANDER shares no extraction with MATCH')
  }
  assert.equal(
    (await promoteGoals(BYSTANDER)).authorized,
    true,
    'and its goals family is still promotable',
  )
})

void test('the shots family still has no automatic promotion path, rejected or not', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { promoteOcrPeriodFamily } = await import('@eanhl/db/queries')
  const { setExtractionStatus } = await import('../lib/review-cascade.js')

  await setExtractionStatus([shotsExtraction], 'rejected')

  await assert.rejects(
    () => promoteOcrPeriodFamily({ matchId: MATCH, family: 'shots', maxPeriod: 3 }),
    /no automatic promotion path/,
    'the absolute shots ban outranks every other outcome',
  )
  for (const row of await statuses(MATCH)) {
    assert.equal(row.shots, 'rejected', 'and the shots rejection is still durable')
  }
})

// ── 9. counters and operator messaging ───────────────────────────────────────

void test('the new counters are additive and formatted for the CLIs', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const { emptyCascadeCounts, addCascadeCounts, formatCascadeCounts } =
    await import('../lib/review-cascade.js')
  const empty = emptyCascadeCounts()
  assert.equal(counter(empty, 'periodFamiliesRejected'), 0)
  assert.equal(counter(empty, 'periodRejectionBarriersCleared'), 0)

  const summed = addCascadeCounts(
    { ...empty, periodFamiliesRejected: 3, periodRejectionBarriersCleared: 1 } as typeof empty,
    { ...empty, periodFamiliesRejected: 6, periodRejectionBarriersCleared: 2 } as typeof empty,
  )
  assert.equal(counter(summed, 'periodFamiliesRejected'), 9, 'rejections accumulate across a sweep')
  assert.equal(counter(summed, 'periodRejectionBarriersCleared'), 3, 'so do clearances')
  assert.match(formatCascadeCounts(summed), /period_families_rejected=9/)
  assert.match(formatCascadeCounts(summed), /period_rejection_barriers_cleared=3/)
})

void test('the operator notes must not promise a re-run restores a rejected family', async (t) => {
  if (!hasDb) return t.skip('DATABASE_URL not set — requires the test-DB clone.')
  const mod: Record<string, unknown> = await import('../lib/review-cascade.js')
  // Read by name for the same reason as `counter` — see the file header.
  const note = (key: string): string => {
    const value = mod[key]
    return typeof value === 'string' ? value : ''
  }
  const quarantineNote = note('PERIOD_SUMMARY_QUARANTINE_NOTE')
  const rejectionNote = note('PERIOD_FAMILY_REJECTION_NOTE')

  assert.match(
    quarantineNote,
    /reject/i,
    'the quarantine advice must qualify itself — a rejected family will NOT come back',
  )
  assert.notEqual(rejectionNote, '', 'a distinct note must describe a durable family rejection')
  assert.match(
    rejectionNote,
    /clear|lift|un-?reject|move/i,
    'and must say how the rejection is lifted',
  )
})
