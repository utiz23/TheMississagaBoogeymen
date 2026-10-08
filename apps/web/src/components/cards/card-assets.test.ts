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
import type { MythicThemeKey } from '@eanhl/db/cards'
import { CARD_ASSET_DIR, MYTHIC_ASSETS, VIDEO_FORMATS, swatchThumb } from './card-assets.ts'
import { CARD_THEMES } from './card-themes.ts'

const dir = fileURLToPath(new URL('../../../public/images/cards/', import.meta.url))
const size = (file: string) => statSync(dir + file).size
const videoFiles = (base: string) => VIDEO_FORMATS.map((ext) => `${base}.${ext}`)

void test('every listed asset exists, and nothing unlisted ships', () => {
  const listed = new Set(
    Object.values(MYTHIC_ASSETS).flatMap((a) => [
      ...a.stills,
      a.thumb,
      ...a.videos.flatMap(videoFiles),
    ]),
  )
  for (const file of listed) assert.ok(existsSync(dir + file), file)
  assert.deepEqual(readdirSync(dir).sort(), [...listed].sort())
})

void test('each mythic stays within 800 KB and all of them within 3 MB', () => {
  let total = 0
  for (const [theme, a] of Object.entries(MYTHIC_ASSETS)) {
    const bytes =
      a.stills.reduce((s, f) => s + size(f), 0) +
      size(a.thumb) +
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

void test('regular themes stay asset-free; each mythic references only its own files', () => {
  const hardcoded: Partial<Record<string, string[]>> = { frozen: ['ice-cracks.avif'] }
  for (const [key, theme] of Object.entries(CARD_THEMES)) {
    const refs = (JSON.stringify(theme).match(/\/images\/cards\/[\w.-]+/g) ?? []).map((r) =>
      r.replace(`${CARD_ASSET_DIR}/`, ''),
    )
    const own = MYTHIC_ASSETS[key as keyof typeof MYTHIC_ASSETS] as
      | (typeof MYTHIC_ASSETS)[keyof typeof MYTHIC_ASSETS]
      | undefined
    if (own === undefined) {
      assert.deepEqual(refs, [], `${key} must not reference card assets`)
      continue
    }
    const owned = new Set([...own.stills, ...own.videos])
    for (const ref of [...refs, ...(hardcoded[key] ?? [])])
      assert.ok(owned.has(ref), `${key}: ${ref}`)
  }
})

void test('locker swatch thumbnails are small and resolve to their files', () => {
  for (const [theme, a] of Object.entries(MYTHIC_ASSETS)) {
    assert.ok(size(a.thumb) <= 8 * 1024, `${theme}: ${String(size(a.thumb))} bytes`)
    assert.equal(swatchThumb(theme as MythicThemeKey), `${CARD_ASSET_DIR}/${a.thumb}`)
  }
  assert.equal(swatchThumb('home'), null)
})
