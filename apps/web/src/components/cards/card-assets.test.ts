/**
 * Budget and integrity of the mythic card assets (spec Part 2: ≤ 800 KB per
 * mythic, ≤ 3 MB total; a browser downloads one video format, so count the
 * larger of .webm / .mp4).
 * Run (after `pnpm --filter @eanhl/db build`):
 *   node --test apps/web/src/components/cards/card-assets.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CARD_ASSET_DIR, MYTHIC_ASSETS, VIDEO_FORMATS } from './card-assets.ts'
import { CARD_THEMES } from './card-themes.ts'

const dir = fileURLToPath(new URL('../../../public/images/cards/', import.meta.url))
const size = (file: string) => statSync(dir + file).size
const videoFiles = (base: string) => VIDEO_FORMATS.map((ext) => `${base}.${ext}`)

void test('every listed asset exists, and nothing unlisted ships', () => {
  const listed = new Set(
    Object.values(MYTHIC_ASSETS).flatMap((a) => [...a.stills, ...a.videos.flatMap(videoFiles)]),
  )
  for (const file of listed) assert.ok(existsSync(dir + file), file)
  assert.deepEqual(readdirSync(dir).sort(), [...listed].sort())
})

void test('each mythic stays within 800 KB and all of them within 3 MB', () => {
  let total = 0
  for (const [theme, a] of Object.entries(MYTHIC_ASSETS)) {
    const bytes =
      a.stills.reduce((s, f) => s + size(f), 0) +
      a.videos.reduce((s, base) => s + Math.max(...videoFiles(base).map(size)), 0)
    assert.ok(bytes <= 800 * 1024, `${theme}: ${String(bytes)} bytes`)
    total += bytes
  }
  assert.ok(total <= 3 * 1024 * 1024, `total ${String(total)} bytes`)
})

void test('themes only reference shipped assets', () => {
  const shipped = new Set(
    Object.values(MYTHIC_ASSETS)
      .flatMap((a) => [...a.stills, ...a.videos])
      .map((f) => `${CARD_ASSET_DIR}/${f}`),
  )
  const refs = JSON.stringify(CARD_THEMES).match(/\/images\/cards\/[\w.-]+/g) ?? []
  assert.ok(refs.length > 0)
  for (const ref of refs) assert.ok(shipped.has(ref), ref)
})

void test('regular themes stay asset-free; each mythic lists only its own files', () => {
  assert.deepEqual(Object.keys(MYTHIC_ASSETS).sort(), [
    'frozen',
    'futureC',
    'inferno',
    'olympus',
    'stormLive',
  ])
})
