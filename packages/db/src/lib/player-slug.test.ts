import test from 'node:test'
import assert from 'node:assert/strict'
import { playerPath, playerSlug } from './player-slug.js'

void test('gamertags become lower-case, hyphenated slugs', () => {
  assert.equal(playerSlug('silkyjoker85'), 'silkyjoker85')
  assert.equal(playerSlug('Stick Menace'), 'stick-menace')
  assert.equal(playerSlug('SCOOT BOY 42'), 'scoot-boy-42')
  assert.equal(playerSlug('Ordinary_Samich'), 'ordinary-samich')
  assert.equal(playerSlug('  -x--Y_  '), 'x-y')
  assert.equal(playerSlug('Zoë Ñandú'), 'zoe-nandu')
})

void test('no slug when nothing, or only digits, is left', () => {
  assert.equal(playerSlug('___'), null)
  assert.equal(playerSlug(''), null)
  assert.equal(playerSlug('12345'), null)
  assert.equal(playerSlug('1 2'), '1-2')
})

void test('playerPath falls back to the id', () => {
  assert.equal(playerPath({ id: 3, gamertag: 'Stick Menace' }), '/roster/stick-menace')
  assert.equal(playerPath({ id: 7, gamertag: '2024' }), '/roster/7')
})
