import test from 'node:test'
import assert from 'node:assert/strict'
import { PgDialect } from 'drizzle-orm/pg-core'

process.env.DATABASE_URL = 'postgresql://discord-ids-test:unused@127.0.0.1:1/unused'
const { playerDiscordUserIdSql, DISCORD_USER_ID_RE } = await import('../discord-ids.js')
const flat = (s: string) => s.replace(/\s+/g, ' ')

void test('lookup: the Discord sign-in ID first, then the manual ID', () => {
  const q = new PgDialect().sqlToQuery(playerDiscordUserIdSql(28))
  const s = flat(q.sql)
  assert.match(
    s,
    /coalesce\( ?\( ?select a\.account_id from user_player_claims c join accounts a on a\.user_id = c\.user_id and a\.provider_id = 'discord' where c\.player_id = p\.id limit 1 ?\), p\.discord_user_id ?\)/,
  )
  assert.match(s, /from players p where p\.id = \$1/)
  assert.deepEqual(q.params, [28])
})

void test('Discord user ID shape', () => {
  assert.ok(DISCORD_USER_ID_RE.test('447213088828030998'))
  assert.ok(!DISCORD_USER_ID_RE.test('1234'))
  assert.ok(!DISCORD_USER_ID_RE.test('12345678901234567x'))
})
