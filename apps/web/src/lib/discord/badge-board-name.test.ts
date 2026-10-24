import test from 'node:test'
import assert from 'node:assert/strict'
import { badgeBoardName } from '@eanhl/db/discord'
import { themeLabel } from '../../components/badges/badge-board.ts'

void test('Discord badge names equal the badge board labels for every level', () => {
  for (let l = 1; l <= 30; l++) assert.equal(badgeBoardName(l), themeLabel(l), `level ${String(l)}`)
})
