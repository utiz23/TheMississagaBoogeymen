import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDiscordIdForm } from './discord-id-form.ts'

const form = (o: Record<string, string>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(o)) f.set(k, v)
  return f
}

void test('valid ID saved; spaces trimmed', () => {
  assert.deepEqual(
    parseDiscordIdForm(form({ playerId: '5', discordUserId: ' 447213088828030998 ' })),
    { playerId: 5, id: '447213088828030998' },
  )
})
void test('empty clears', () => {
  assert.deepEqual(parseDiscordIdForm(form({ playerId: '5', discordUserId: '' })), {
    playerId: 5,
    id: null,
  })
})
void test('rejects letters, short, long, bad player', () => {
  for (const v of ['abc', '1234', '123456789012345678901', '12345678901234567x']) {
    assert.ok('error' in parseDiscordIdForm(form({ playerId: '5', discordUserId: v })), v)
  }
  assert.ok('error' in parseDiscordIdForm(form({ playerId: '0', discordUserId: '' })))
})
