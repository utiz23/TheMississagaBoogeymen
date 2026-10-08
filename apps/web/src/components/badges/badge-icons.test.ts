/**
 * The badge icon drop-in (spec D14): every listed icon ships, nothing unlisted
 * ships, every id is a real family.
 * Run (after `pnpm --filter @eanhl/db build`):
 *   node --test apps/web/src/components/badges/badge-icons.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { BADGE_FAMILY_IDS } from '@eanhl/db/cards'
import { BADGE_ICONS } from './badge-icons.ts'

const dir = fileURLToPath(new URL('../../../public/images/badges/icons/', import.meta.url))

void test('listed icons are real families and ship; nothing unlisted ships', () => {
  const listed = Object.entries(BADGE_ICONS)
  for (const [id, icon] of listed) {
    assert.ok((BADGE_FAMILY_IDS as readonly string[]).includes(id), id)
    assert.equal(icon.src, `/images/badges/icons/${id}.svg`)
    assert.ok(existsSync(dir + `${id}.svg`), icon.src)
    assert.ok(icon.scale >= 0.6 && icon.scale <= 2, `${id} scale ${String(icon.scale)}`)
    assert.ok(Math.abs(icon.offsetX) <= 0.5, `${id} offsetX ${String(icon.offsetX)}`)
    assert.ok(Math.abs(icon.offsetY) <= 0.5, `${id} offsetY ${String(icon.offsetY)}`)
  }
  const shipped = existsSync(dir) ? readdirSync(dir).sort() : []
  assert.deepEqual(shipped, listed.map(([id]) => `${id}.svg`).sort())
})

void test('operator 2026-10-08: Dekes, Desperation Saves and Shutouts keep their placeholders', () => {
  for (const id of ['pdekes', 'gdsv', 'gso'] as const) {
    assert.equal(BADGE_ICONS[id], undefined, id)
  }
})
