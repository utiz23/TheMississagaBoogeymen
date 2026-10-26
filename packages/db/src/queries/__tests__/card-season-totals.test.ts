/**
 * SQL-shape pins for the club-only badge totals. No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/card-season-totals.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'

process.env.DATABASE_URL = 'postgresql://card-season-totals-test:unused@127.0.0.1:1/unused'

const { clubSeasonTotalsSql } = await import('../card-mythics.js')
const flat = (s: string) => s.replace(/\s+/g, ' ')
const text = flat(new PgDialect().sqlToQuery(clubSeasonTotalsSql(sql`7`)).sql)

void test('a goalie DNF or a team DNF is not a completed goalie game', () => {
  // AI-goalie lines never set player_dnf; a team DNF lives in matches.result.
  assert.match(
    text,
    /WHERE p\.is_goalie AND NOT COALESCE\(p\.player_dnf, false\) AND m\.result <> 'DNF'\)\)::int AS "goalieGamesCompleted"/,
  )
})

void test('a shutout is a completed goalie game with goals_against exactly 0', () => {
  assert.match(
    text,
    /WHERE p\.is_goalie AND NOT COALESCE\(p\.player_dnf, false\) AND m\.result <> 'DNF' AND p\.goals_against = 0\)\)::int AS "goalieShutouts"/,
  )
})

void test('NULL stat columns count as 0; goalie sums use goalie rows only', () => {
  assert.match(
    text,
    /COALESCE\(SUM\(COALESCE\(p\.saves, 0\)\) FILTER \(WHERE p\.is_goalie\), 0\)::int AS "goalieSaves"/,
  )
  assert.match(text, /COALESCE\(SUM\(COALESCE\(p\.goals, 0\)\), 0\)::int AS "goals"/)
  assert.match(
    text,
    /\(COUNT\(DISTINCT m\.id\) FILTER \(WHERE m\.result = 'WIN'\)\)::int AS "wins"/,
  )
  assert.match(text, /WHERE m\.game_title_id IN \(7\) GROUP BY p\.player_id, m\.game_title_id/)
})
