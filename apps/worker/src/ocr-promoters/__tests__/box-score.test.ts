/**
 * Regression coverage for promoteBoxScore's cross-frame merge semantics.
 *
 * Every extracted frame in a match is processed in sorted filename order, and
 * multiple frames can land on the same (match_id, period_number, source='ocr')
 * row. Before this fix, the existing-row branch replaced columns outright via
 * `.set(rawValues)`, so a later frame's null or a differing re-read could
 * clobber a value an earlier frame had already established. These tests
 * exercise the real `promoteBoxScore` update/insert construction (not a
 * standalone merge helper) against a fake in-memory `PromoterDb`.
 *
 * The fake db can't run real SQL, so `interpretSet()` below walks the actual
 * Drizzle `SQL` fragments the promoter builds (COALESCE(column, incoming))
 * using the same introspection primitives (`is`, `Column`, `Param`) Drizzle
 * itself uses internally, to recover "what would Postgres have computed."
 *
 * Run via:
 *   pnpm --filter @eanhl/worker build && \
 *   node --test apps/worker/dist/ocr-promoters/__tests__/box-score.test.js
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { is, Column, Param, SQL } from 'drizzle-orm'
import { promoteBoxScore } from '../box-score.js'
import type { PromoterContext, PromoterDb } from '../index.js'
import type { OcrExtractionField, OcrResult } from '../../ocr-cli-runner.js'

// ─── fake row store ────────────────────────────────────────────────────────

interface FakeRow {
  id: number
  matchId: number
  periodNumber: number
  periodLabel: string
  goalsFor: number | null
  goalsAgainst: number | null
  shotsFor: number | null
  shotsAgainst: number | null
  faceoffsFor: number | null
  faceoffsAgainst: number | null
  source: string
  ocrExtractionId: number | null
}

const DB_COL_TO_JS_KEY: Record<string, keyof FakeRow> = {
  match_id: 'matchId',
  period_number: 'periodNumber',
  source: 'source',
}

/** Flattens a Drizzle SQL tree to its leaf chunks (columns, params, raw values, string literals). */
function flattenSql(node: unknown): unknown[] {
  const out: unknown[] = []
  const walk = (n: unknown) => {
    if (is(n, SQL)) {
      for (const c of n.queryChunks) walk(c)
      return
    }
    out.push(n)
  }
  walk(node)
  return out
}

function isStringChunk(x: unknown): boolean {
  return (
    typeof x === 'object' &&
    x !== null &&
    'value' in x &&
    Array.isArray((x as { value: unknown }).value)
  )
}

/** Recovers the incoming (non-column) operand from a `COALESCE(column, incoming)` fragment. */
function extractIncomingValue(node: SQL): unknown {
  for (const chunk of flattenSql(node)) {
    if (is(chunk, Column)) continue
    if (isStringChunk(chunk)) continue
    if (is(chunk, Param)) return chunk.value
    return chunk
  }
  return undefined
}

/** Recovers (db column name, value) equality pairs from an `and(eq(...), eq(...))` where-clause. */
function extractEqPairs(node: unknown): [string, unknown][] {
  const pairs: [string, unknown][] = []
  let pendingColumn: Column | null = null
  for (const chunk of flattenSql(node)) {
    if (is(chunk, Column)) {
      pendingColumn = chunk
      continue
    }
    if (isStringChunk(chunk)) continue
    if (pendingColumn) {
      pairs.push([pendingColumn.name, is(chunk, Param) ? chunk.value : chunk])
      pendingColumn = null
    }
  }
  return pairs
}

/** Applies a `.set(...)` payload to a row, honoring real values and COALESCE SQL fragments alike. */
function applySet(row: FakeRow, setObj: Record<string, unknown>): FakeRow {
  const next: Record<string, unknown> = { ...row }
  const existing = row as unknown as Record<string, unknown>
  for (const [key, value] of Object.entries(setObj)) {
    if (is(value, SQL)) {
      const incoming = extractIncomingValue(value)
      next[key] = existing[key] ?? incoming
    } else {
      next[key] = value
    }
  }
  return next as unknown as FakeRow
}

function makeFakeDb(initialRows: FakeRow[]): { db: PromoterDb; rows: FakeRow[] } {
  const rows = [...initialRows]
  let nextId = rows.reduce((max, r) => Math.max(max, r.id), 0) + 1

  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([{ opponentName: 'Test Opponent', bgmWasHome: false }]),
        }),
      }),
    }),
    update: () => ({
      set: (setObj: Record<string, unknown>) => ({
        where: (cond: unknown) => ({
          returning: () => {
            const pairs = extractEqPairs(cond)
            const idx = rows.findIndex((r) =>
              pairs.every(([col, val]) => {
                const jsKey = DB_COL_TO_JS_KEY[col]
                return jsKey ? r[jsKey] === val : true
              }),
            )
            const current = idx === -1 ? undefined : rows[idx]
            if (idx === -1 || !current) return Promise.resolve([])
            const merged = applySet(current, setObj)
            rows[idx] = merged
            return Promise.resolve([{ id: merged.id }])
          },
        }),
      }),
    }),
    insert: () => ({
      values: (vals: Partial<FakeRow>) => {
        rows.push({ id: nextId, ...vals } as FakeRow)
        nextId += 1
        return Promise.resolve(undefined)
      },
    }),
  }
  return { db: db as unknown as PromoterDb, rows }
}

// ─── fixture builders ──────────────────────────────────────────────────────

function ocrField(value: number | null): OcrExtractionField {
  return {
    raw_text: value === null ? null : String(value),
    value,
    confidence: value === null ? null : 0.95,
    status: value === null ? 'missing' : 'ok',
  }
}

function makeResult(
  statKind: 'goals' | 'shots' | 'faceoffs',
  periods: { period_number: number; away: number | null; home: number | null }[],
): OcrResult {
  return {
    meta: {
      screen_type: `post_game_box_score_${statKind}`,
      source_path: '/tmp/stub.png',
      processed_at: '2026-01-01T00:00:00Z',
      ocr_backend: 'easyocr',
      overall_confidence: 0.9,
      duplicate_of: null,
    },
    success: true,
    errors: [],
    warnings: [],
    stat_kind: statKind,
    away_team: ocrField(null),
    home_team: ocrField(null),
    periods: periods.map((p) => ({
      period_label: `PERIOD ${String(p.period_number)}`,
      period_number: p.period_number,
      away_value: ocrField(p.away),
      home_value: ocrField(p.home),
    })),
  } as unknown as OcrResult
}

function makeCtx(result: OcrResult, extractionId: number, db: PromoterDb): PromoterContext {
  return {
    result,
    extractionId,
    matchId: 555,
    sourcePath: '/tmp/stub.png',
    db,
  }
}

function existingRow(overrides: Partial<FakeRow>): FakeRow {
  return {
    id: 1,
    matchId: 555,
    periodNumber: 2,
    periodLabel: 'PERIOD 2',
    goalsFor: null,
    goalsAgainst: null,
    shotsFor: null,
    shotsAgainst: null,
    faceoffsFor: null,
    faceoffsAgainst: null,
    source: 'ocr',
    ocrExtractionId: 100,
    ...overrides,
  }
}

function firstRow(rows: FakeRow[]): FakeRow {
  const row = rows[0]
  assert.ok(row, 'expected at least one row')
  return row
}

// Fake db resolves bgmWasHome=false → awayIs='for', homeIs='against'.
// So `away` fixtures land in the *_for column, `home` in *_against.

// ─── tests ─────────────────────────────────────────────────────────────────

void test('existing non-null values survive an incoming null', async () => {
  const { db, rows } = makeFakeDb([existingRow({ shotsFor: 4, shotsAgainst: 9 })])
  const result = makeResult('shots', [{ period_number: 2, away: null, home: null }])
  await promoteBoxScore(makeCtx(result, 200, db))

  const row = firstRow(rows)
  assert.equal(row.shotsFor, 4)
  assert.equal(row.shotsAgainst, 9)
})

void test('existing non-null values survive a conflicting incoming non-null value', async () => {
  const { db, rows } = makeFakeDb([existingRow({ shotsFor: 4, shotsAgainst: 9 })])
  const result = makeResult('shots', [{ period_number: 2, away: 7, home: 2 }])
  await promoteBoxScore(makeCtx(result, 200, db))

  const row = firstRow(rows)
  assert.equal(row.shotsFor, 4)
  assert.equal(row.shotsAgainst, 9)
})

void test('existing null values are populated by an incoming non-null value', async () => {
  const { db, rows } = makeFakeDb([existingRow({ shotsFor: null, shotsAgainst: null })])
  const result = makeResult('shots', [{ period_number: 2, away: 4, home: 9 }])
  await promoteBoxScore(makeCtx(result, 200, db))

  const row = firstRow(rows)
  assert.equal(row.shotsFor, 4)
  assert.equal(row.shotsAgainst, 9)
})

void test('an incoming legitimate numeric zero fills an existing null (not treated as missing)', async () => {
  const { db, rows } = makeFakeDb([existingRow({ goalsFor: null, goalsAgainst: null })])
  const result = makeResult('goals', [{ period_number: 2, away: 0, home: 3 }])
  await promoteBoxScore(makeCtx(result, 200, db))

  const row = firstRow(rows)
  assert.equal(row.goalsFor, 0)
  assert.equal(row.goalsAgainst, 3)
})

void test('a goals extraction cannot change shots or faceoffs columns', async () => {
  const { db, rows } = makeFakeDb([
    existingRow({
      shotsFor: 10,
      shotsAgainst: 11,
      faceoffsFor: 12,
      faceoffsAgainst: 13,
      goalsFor: null,
      goalsAgainst: null,
    }),
  ])
  const result = makeResult('goals', [{ period_number: 2, away: 2, home: 1 }])
  await promoteBoxScore(makeCtx(result, 200, db))

  const row = firstRow(rows)
  assert.equal(row.goalsFor, 2)
  assert.equal(row.goalsAgainst, 1)
  assert.equal(row.shotsFor, 10)
  assert.equal(row.shotsAgainst, 11)
  assert.equal(row.faceoffsFor, 12)
  assert.equal(row.faceoffsAgainst, 13)
})

void test('a shots extraction cannot change goals or faceoffs columns', async () => {
  const { db, rows } = makeFakeDb([
    existingRow({
      goalsFor: 3,
      goalsAgainst: 2,
      faceoffsFor: 12,
      faceoffsAgainst: 13,
      shotsFor: null,
      shotsAgainst: null,
    }),
  ])
  const result = makeResult('shots', [{ period_number: 2, away: 8, home: 6 }])
  await promoteBoxScore(makeCtx(result, 200, db))

  const row = firstRow(rows)
  assert.equal(row.shotsFor, 8)
  assert.equal(row.shotsAgainst, 6)
  assert.equal(row.goalsFor, 3)
  assert.equal(row.goalsAgainst, 2)
  assert.equal(row.faceoffsFor, 12)
  assert.equal(row.faceoffsAgainst, 13)
})

void test('a faceoffs extraction cannot change goals or shots columns', async () => {
  const { db, rows } = makeFakeDb([
    existingRow({
      goalsFor: 3,
      goalsAgainst: 2,
      shotsFor: 10,
      shotsAgainst: 11,
      faceoffsFor: null,
      faceoffsAgainst: null,
    }),
  ])
  const result = makeResult('faceoffs', [{ period_number: 2, away: 5, home: 4 }])
  await promoteBoxScore(makeCtx(result, 200, db))

  const row = firstRow(rows)
  assert.equal(row.faceoffsFor, 5)
  assert.equal(row.faceoffsAgainst, 4)
  assert.equal(row.goalsFor, 3)
  assert.equal(row.goalsAgainst, 2)
  assert.equal(row.shotsFor, 10)
  assert.equal(row.shotsAgainst, 11)
})

void test('the first contributing ocrExtractionId is preserved on update', async () => {
  const { db, rows } = makeFakeDb([existingRow({ ocrExtractionId: 100, shotsFor: null })])
  const result = makeResult('shots', [{ period_number: 2, away: 4, home: 5 }])
  await promoteBoxScore(makeCtx(result, 200, db))

  assert.equal(firstRow(rows).ocrExtractionId, 100)
})

void test('a new row still inserts the incoming stat-kind values normally', async () => {
  const { db, rows } = makeFakeDb([])
  const result = makeResult('shots', [{ period_number: 2, away: 5, home: 6 }])
  await promoteBoxScore(makeCtx(result, 300, db))

  assert.equal(rows.length, 1)
  const row = firstRow(rows)
  assert.equal(row.shotsFor, 5)
  assert.equal(row.shotsAgainst, 6)
  assert.equal(row.goalsFor, null)
  assert.equal(row.goalsAgainst, null)
  assert.equal(row.faceoffsFor, null)
  assert.equal(row.faceoffsAgainst, null)
  assert.equal(row.ocrExtractionId, 300)
})

void test('SO/TOT sentinel rows (period_number < 1) are ignored', async () => {
  const { db, rows } = makeFakeDb([])
  const result = makeResult('shots', [
    { period_number: -1, away: 29, home: 16 },
    { period_number: 0, away: 1, home: 1 },
    { period_number: 1, away: 5, home: 6 },
  ])
  await promoteBoxScore(makeCtx(result, 300, db))

  assert.equal(rows.length, 1, 'only the real period-1 row should be written')
  const row = firstRow(rows)
  assert.equal(row.periodNumber, 1)
  assert.equal(row.shotsFor, 5)
  assert.equal(row.shotsAgainst, 6)
})

void test('reprocessing identical input is idempotent', async () => {
  const { db, rows } = makeFakeDb([])
  const result = makeResult('shots', [{ period_number: 2, away: 5, home: 6 }])

  await promoteBoxScore(makeCtx(result, 300, db))
  await promoteBoxScore(makeCtx(result, 300, db))

  assert.equal(rows.length, 1, 'no duplicate row from reprocessing')
  const row = firstRow(rows)
  assert.equal(row.shotsFor, 5)
  assert.equal(row.shotsAgainst, 6)
  assert.equal(row.ocrExtractionId, 300)
})
