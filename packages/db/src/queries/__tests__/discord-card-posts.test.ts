/**
 * SQL-shape pins for the card-batch queries. No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/discord-card-posts.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect } from 'drizzle-orm/pg-core'

process.env.DATABASE_URL = 'postgresql://discord-card-posts-test:unused@127.0.0.1:1/unused'

const { discordCardBatchCandidatesSql, claimDiscordCardPostSql, cardEventBatchQuery } =
  await import('../discord-card-posts.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ')

void test('candidates: active title, 24 h window passed as text, settled, counted events only', () => {
  const q = dialect.sqlToQuery(
    discordCardBatchCandidatesSql({ since: new Date('2026-10-24T00:00:00Z'), limit: 5 }),
  )
  const s = flat(q.sql)
  assert.match(s, /join game_titles g on g\.id = ev\.game_title_id and g\.is_active/)
  assert.match(s, /ev\.occurred_at > \$\d+::timestamptz/)
  assert.ok(q.params.includes('2026-10-24T00:00:00.000Z'))
  assert.ok(q.params.every((p) => !(p instanceof Date)))
  assert.match(s, /d\.batch_event_id is null or \(d\.status = 'failed' and d\.attempts < 3\)/)
  // Settled only when EVERY match type was fetched again after the batch, so a
  // 3s or private game's post (settled per type) always goes first.
  assert.match(
    s,
    /not exists \( select 1 from unnest\(array\['gameType5', 'gameType10', 'club_private'\]::text\[\]\) t\(mt\) where not exists \( select 1 from ingestion_log l where l\.game_title_id = b\.game_title_id and l\.match_type = t\.mt and l\.started_at > b\.occurred_at \) \)/,
  )
  assert.match(s, /p\.ai_goalie_side is null/)
  assert.match(s, /p\.pinned_to_roster/)
  assert.match(
    s,
    /ce\.kind = 'badge_level_up' and ceil\(ce\.to_value \/ 5\.0\) > ceil\(ce\.from_value \/ 5\.0\)/,
  )
  assert.match(s, /ce\.kind in \('level_up', 'tier_up', 'mythic_awarded'\)/)
  assert.doesNotMatch(s, /mythic_cleared/)
  assert.match(s, /order by b\.batch_event_id limit \$\d+/)
})

void test('claim: insert pending from the event row, or flip only a failed row under the cap', () => {
  const s = flat(dialect.sqlToQuery(claimDiscordCardPostSql(42)).sql)
  assert.match(
    s,
    /insert into discord_card_posts .* select ev\.id, ev\.game_title_id, ev\.occurred_at, 'pending', 1 from player_card_events ev where ev\.id = \$1/,
  )
  assert.match(
    s,
    /on conflict \(batch_event_id\) do update set status = 'pending', attempts = discord_card_posts\.attempts \+ 1/,
  )
  assert.match(
    s,
    /where discord_card_posts\.status = 'failed' and discord_card_posts\.attempts < 3/,
  )
  assert.match(s, /returning batch_event_id/)
})

void test('batch events: matched to the head event inside SQL, never via a JS timestamp', () => {
  const { sql, params } = cardEventBatchQuery(42).toSQL()
  const s = flat(sql)
  assert.match(
    s,
    /\("player_card_events"\."game_title_id", "player_card_events"\."occurred_at"\) = \(select h\.game_title_id, h\.occurred_at from player_card_events h where h\.id = \$1\)/,
  )
  assert.deepEqual(params, [42])
  assert.match(s, /order by "player_card_events"\."id" asc/)
})
