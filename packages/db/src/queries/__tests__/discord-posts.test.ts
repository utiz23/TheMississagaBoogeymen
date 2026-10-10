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
