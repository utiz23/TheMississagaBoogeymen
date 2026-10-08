import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMythicArgs } from './card-mythic-args.js'

void test('award with a theme (default title)', () => {
  assert.deepEqual(parseMythicArgs(['--player', 'Stick Menace', '--theme', 'inferno']), {
    player: 'Stick Menace',
    title: null,
    action: 'award',
    theme: 'inferno',
  })
})

void test('clear on a named title', () => {
  assert.deepEqual(parseMythicArgs(['--player', 'Stick Menace', '--title', 'nhl27', '--clear']), {
    player: 'Stick Menace',
    title: 'nhl27',
    action: 'clear',
  })
})

void test('rejects a missing player, an unknown theme, and both or neither actions', () => {
  assert.throws(() => parseMythicArgs(['--theme', 'inferno']), /--player/)
  assert.throws(
    () => parseMythicArgs(['--player', 'X', '--theme', 'carbon']),
    /theme must be one of/,
  )
  assert.throws(
    () => parseMythicArgs(['--player', 'X', '--theme', 'inferno', '--clear']),
    /exactly one/,
  )
  assert.throws(() => parseMythicArgs(['--player', 'X']), /exactly one/)
  assert.throws(() => parseMythicArgs(['--player', 'X', '--clear', '--title']), /--title needs/)
})
