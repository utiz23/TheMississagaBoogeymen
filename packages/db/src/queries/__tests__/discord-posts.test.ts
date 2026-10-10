/**
 * SQL-shape pins for the discord_posts queries. No database: postgres.js
 * connects lazily and nothing here executes a query (same pattern as
 * game-title-controls.test.ts).
 *
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/discord-posts.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'

process.env.DATABASE_URL = 'postgresql://discord-posts-test:unused@127.0.0.1:1/unused'

const { discordPostCandidatesQuery, claimDiscordPostQuery, DISCORD_MAX_ATTEMPTS } =
  await import('../discord-posts.js')

void test('candidates: active title, inside the window, never a pending/posted/skipped row', () => {
  const { sql, params } = discordPostCandidatesQuery({
    since: new Date('2026-10-10T00:00:00Z'),
    limit: 5,
    unloggedBefore: new Date('2026-10-10T11:45:00Z'),
  }).toSQL()
  assert.match(sql, /"game_titles"\."is_active" = \$\d/)
  assert.match(sql, /"matches"\."played_at" > \$\d/)
  assert.match(sql, /"discord_posts"\."match_id" is null/)
  assert.match(sql, /"discord_posts"\."status" = \$\d/)
  assert.match(sql, /"discord_posts"\."attempts" < \$\d/)
  assert.match(sql, /order by "matches"\."played_at" asc/)
  assert.ok(params.includes('failed'))
  assert.ok(!params.includes('pending'))
  assert.ok(params.includes(DISCORD_MAX_ATTEMPTS))
})

void test('candidates: only once the ingesting worker cycle has finished', () => {
  const { sql, params } = discordPostCandidatesQuery({
    since: new Date('2026-10-10T00:00:00Z'),
    limit: 5,
    unloggedBefore: new Date('2026-10-10T11:45:00Z'),
  }).toSQL()
  // The raw payload that produced this match…
  assert.match(sql, /from "raw_match_payloads" r/)
  assert.match(sql, /r\.game_title_id = "matches"\."game_title_id"/)
  assert.match(sql, /r\.ea_match_id = "matches"\."ea_match_id"/)
  // …was logged by a cycle that has since been followed by another (non-overlapping loop)…
  assert.match(
    sql,
    /l2\.id > l1\.id and l2\.game_title_id = l1\.game_title_id and l2\.match_type = l1\.match_type/,
  )
  // …or, with no log row, was ingested long enough ago.
  assert.match(sql, /l1\.id is null and r\.ingested_at < \$\d::timestamptz/)
  // postgres.js rejects a raw Date param inside a sql`` fragment (ERR_INVALID_ARG_TYPE).
  assert.ok(params.every((p) => !(p instanceof Date)))
  assert.ok(params.includes('2026-10-10T11:45:00.000Z'))
})

void test('claim: insert pending, or flip only a failed row under the attempt cap', () => {
  const { sql } = claimDiscordPostQuery(42).toSQL()
  assert.match(sql, /insert into "discord_posts"/)
  assert.match(sql, /on conflict \("match_id"\) do update/)
  assert.match(sql, /"discord_posts"\."attempts" \+ 1/)
  assert.match(
    sql,
    /where "discord_posts"\."status" = 'failed' and "discord_posts"\."attempts" < 3/,
  )
  assert.match(sql, /returning "match_id"/)
})
