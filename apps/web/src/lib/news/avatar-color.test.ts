/**
 * Avatar initials colour: dark or white by the tint's WCAG contrast.
 *
 * Run: node --test apps/web/src/lib/news/avatar-color.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTERS, REPORTER_IDS } from '@eanhl/db/news'
import {
  AVATAR_DARK_TEXT,
  AVATAR_LIGHT_TEXT,
  contrastRatio,
  initialsColor,
  relativeLuminance,
} from './avatar-color.ts'

test('relativeLuminance: WCAG formula end points', () => {
  assert.equal(relativeLuminance('#000000'), 0)
  assert.equal(relativeLuminance('#ffffff'), 1)
  assert.equal(contrastRatio('#ffffff', '#000000'), 21)
})

test('initialsColor: dark on Pettibone yellow (white is 1.5:1)', () => {
  assert.ok(contrastRatio('#facc15', '#ffffff') < 4.5)
  assert.equal(initialsColor('#facc15'), AVATAR_DARK_TEXT)
})

test('initialsColor: white on a tint where white reaches 4.5:1', () => {
  assert.ok(contrastRatio('#1d4ed8', '#ffffff') >= 4.5)
  assert.equal(initialsColor('#1d4ed8'), AVATAR_LIGHT_TEXT)
})

test('initialsColor: Barlow red follows the same rule (white is only 4.0:1, so dark)', () => {
  const white = contrastRatio('#e84131', '#ffffff')
  assert.ok(white > 4 && white < 4.5, String(white))
  assert.equal(initialsColor('#e84131'), AVATAR_DARK_TEXT)
  // Dark is also the stronger of the two on this red.
  assert.ok(contrastRatio('#e84131', AVATAR_DARK_TEXT) > white)
})

test('initialsColor: every reporter tint gets a colour; a bad tint falls back to dark', () => {
  for (const id of REPORTER_IDS) {
    const c = initialsColor(REPORTERS[id].tint)
    assert.ok(c === AVATAR_DARK_TEXT || c === AVATAR_LIGHT_TEXT, id)
  }
  assert.equal(initialsColor('red'), AVATAR_DARK_TEXT)
})
