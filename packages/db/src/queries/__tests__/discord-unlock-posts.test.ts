/**
 * SQL-shape pins for the unlock queries. No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/discord-unlock-posts.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect } from 'drizzle-orm/pg-core'

process.env.DATABASE_URL = 'postgresql://discord-unlock-posts-test:unused@127.0.0.1:1/unused'

const { discordUnlockCandidatesSql, claimDiscordUnlockSql } =
  await import('../discord-unlock-posts.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ')

void test('candidates: counted kinds (every badge level), members only, settled, ordered, limited', () => {
  const q = dialect.sqlToQuery(
    discordUnlockCandidatesSql({ since: new Date('2026-10-24T00:00:00Z'), limit: 20 }),
  )
  const s = flat(q.sql)
  assert.match(s, /join game_titles g on g\.id = ev\.game_title_id and g\.is_active/)
  assert.match(s, /ev\.occurred_at > \$\d+::timestamptz/)
  assert.ok(q.params.includes('2026-10-24T00:00:00.000Z'))
  assert.ok(q.params.every((p) => !(p instanceof Date)))
  assert.match(s, /d\.event_id is null or \( ?d\.status = 'failed' and d\.attempts < 3 ?\)/)
  assert.match(s, /p\.ai_goalie_side is null/)
  assert.match(s, /p\.pinned_to_roster/)
  assert.match(s, /ev\.kind = 'badge_level_up' and ev\.to_value > ev\.from_value/)
  // Card level-ups are not posted, only new cards (operator, 2026-10-26).
  assert.match(s, /ev\.kind in \('tier_up', 'mythic_awarded'\)/)
  assert.doesNotMatch(s, /'level_up', 'tier_up'/)
  assert.doesNotMatch(s, /mythic_cleared/)
  assert.match(s, /unnest\(array\['gameType5', 'gameType10', 'club_private'\]::text\[\]\)/)
  assert.match(
    s,
    /order by ev\.occurred_at, \( ?select min\(x\.id\) from player_card_events x where x\.game_title_id = ev\.game_title_id and x\.occurred_at = ev\.occurred_at and x\.player_id = ev\.player_id ?\), case ev\.kind when 'badge_level_up' then 0 when 'level_up' then 1 when 'tier_up' then 2 else 3 end, ev\.id limit \$\d+/,
  )
})

void test('claim: insert pending, or flip only a failed row under the cap', () => {
  const s = flat(dialect.sqlToQuery(claimDiscordUnlockSql(42)).sql)
  // Only for an event that still exists: a deleted event claims nothing (no FK error).
  assert.match(
    s,
    /insert into discord_unlock_posts \(event_id, status, attempts\) select ev\.id, 'pending', 1 from player_card_events ev where ev\.id = \$1/,
  )
  assert.match(
    s,
    /on conflict \(event_id\) do update set status = 'pending', attempts = discord_unlock_posts\.attempts \+ 1/,
  )
  assert.match(
    s,
    /where discord_unlock_posts\.status = 'failed' and discord_unlock_posts\.attempts < 3/,
  )
  assert.match(s, /returning event_id/)
})
