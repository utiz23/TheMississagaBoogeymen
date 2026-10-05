/**
 * The shared title policy (title-resolver.ts): default, explicit slugs,
 * chronology, live/archive view class, nav switcher and career-range label —
 * plus a static check that every title-aware surface uses it.
 *
 * title-resolver.ts reaches `@eanhl/db/queries`, whose client throws at import
 * time without DATABASE_URL. postgres.js connects lazily and these tests never
 * query, so a closed-port placeholder (the test/register-loader.mjs convention)
 * is set unconditionally and never dialled. Needs `pnpm --filter @eanhl/db build`.
 *
 * Run: node --test apps/web/src/lib/title-policy.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { GameTitleListing } from '@eanhl/db/queries'

process.env.DATABASE_URL = 'postgresql://title-policy-test:unused@127.0.0.1:1/unused'

const { resolveTitle, pickDefaultTitle, switcherTitles, formatCareerTitleRange } =
  await import('./title-resolver.ts')

function title(
  slug: string,
  id: number,
  releaseOrder: number | null,
  flags: { isActive?: boolean; isDefault?: boolean; isLive?: boolean } = {},
): GameTitleListing {
  return {
    id,
    slug,
    name: `NHL ${slug.replace(/^nhl/u, '')}`,
    eaPlatform: 'common-gen5',
    eaClubId: '19224',
    apiBaseUrl: 'https://proclubs.ea.com/api/nhl',
    isActive: flags.isActive ?? false,
    isDefault: flags.isDefault ?? false,
    releaseOrder,
    launchedAt: null,
    isLive: flags.isLive ?? flags.isActive ?? false,
  }
}

function ok(result: ReturnType<typeof resolveTitle>) {
  assert.equal(result.kind, 'ok')
  return result.resolved
}

// Post-cutover target state with deliberately misleading ids: NHL 27 is the
// polled default with the LOWEST id; NHL 26 has stopped polling but keeps its
// captured matches (live); NHL 24 and NHL 22 are archive-only.
const NHL27 = title('nhl27', 1, 27, { isActive: true, isDefault: true })
const NHL26 = title('nhl26', 9, 26, { isActive: false, isLive: true })
const NHL24 = title('nhl24', 4, 24)
const NHL22 = title('nhl22', 6, 22)
const TARGET = [NHL26, NHL22, NHL27, NHL24]

// ─── Default resolution ──────────────────────────────────────────────────────

void test('no ?title= resolves the explicit default', () => {
  assert.equal(ok(resolveTitle(undefined, TARGET)).gameTitle.slug, 'nhl27')
})

void test('an older, non-polled default still wins over a newer polled title', () => {
  const titles = [
    title('nhl27', 1, 27, { isActive: true }),
    title('nhl26', 9, 26, { isActive: false, isLive: true, isDefault: true }),
  ]
  assert.equal(ok(resolveTitle(undefined, titles)).gameTitle.slug, 'nhl26')
})

void test('ingestion eligibility is independent of the default', () => {
  // NHL 27 is the default but NOT polled; NHL 26 is polled but not the default.
  const titles = [
    title('nhl27', 1, 27, { isActive: false, isLive: true, isDefault: true }),
    title('nhl26', 9, 26, { isActive: true }),
  ]
  assert.equal(ok(resolveTitle(undefined, titles)).gameTitle.slug, 'nhl27')
  // ...and a polled-but-not-default title stays reachable explicitly.
  assert.equal(ok(resolveTitle('nhl26', titles)).gameTitle.slug, 'nhl26')
})

void test('fallback with no default: newest live title, then newest title, then empty', () => {
  const noDefault = [title('nhl28', 2, 28), title('nhl27', 1, 27, { isActive: true }), NHL24]
  assert.equal(ok(resolveTitle(undefined, noDefault)).gameTitle.slug, 'nhl27')
  assert.equal(ok(resolveTitle(undefined, [NHL22, NHL24])).gameTitle.slug, 'nhl24')
  assert.deepEqual(resolveTitle(undefined, []), { kind: 'empty' })
})

// ─── Explicit slugs ──────────────────────────────────────────────────────────

void test('explicit live and archive slugs resolve and beat the default', () => {
  const live = ok(resolveTitle('nhl27', TARGET))
  assert.equal(live.gameTitle.slug, 'nhl27')
  assert.equal(live.gameTitle.isLive, true)

  const archive = ok(resolveTitle('nhl24', TARGET))
  assert.equal(archive.gameTitle.slug, 'nhl24')
  assert.equal(archive.gameTitle.isLive, false)
})

void test('NHL 26 stays selectable and on the live view after polling stops', () => {
  const resolved = ok(resolveTitle('nhl26', TARGET))
  assert.equal(resolved.gameTitle.slug, 'nhl26')
  assert.equal(resolved.gameTitle.isActive, false)
  assert.equal(resolved.gameTitle.isLive, true)
  assert.ok(resolved.allTitles.some((t) => t.slug === 'nhl26'))
  assert.ok(switcherTitles(TARGET).some((t) => t.slug === 'nhl26'))
})

void test('invalid slugs stay invalid (callers redirect)', () => {
  for (const slug of ['nhl99', 'NHL27', 'nhl', '../nhl27']) {
    const result = resolveTitle(slug, TARGET)
    assert.equal(result.kind, 'invalid', slug)
    assert.equal(result.allTitles.length, TARGET.length)
  }
  assert.equal(resolveTitle('nhl27', []).kind, 'invalid')
})

// ─── Chronology ──────────────────────────────────────────────────────────────

void test('allTitles is newest first despite misleading ids, and never default-first', () => {
  const oldDefault = [
    title('nhl26', 9, 26, { isLive: true }),
    title('nhl22', 6, 22, { isDefault: true }),
    title('nhl27', 1, 27, { isActive: true }),
    title('nhl24', 4, 24),
  ]
  const resolved = ok(resolveTitle(undefined, oldDefault))
  assert.equal(resolved.gameTitle.slug, 'nhl22')
  assert.deepEqual(
    resolved.allTitles.map((t) => t.slug),
    ['nhl27', 'nhl26', 'nhl24', 'nhl22'],
  )
})

// ─── Nav switcher ────────────────────────────────────────────────────────────

void test('nav: an older, non-polled default is the no-query selection, not titles[0]', () => {
  const titles = [
    title('nhl27', 1, 27, { isActive: true }),
    title('nhl26', 9, 26, { isActive: false, isLive: true, isDefault: true }),
    NHL24,
  ]
  assert.equal(pickDefaultTitle(titles)?.slug, 'nhl26')
  const offered = switcherTitles(titles)
  assert.deepEqual(
    offered.map((t) => t.slug),
    ['nhl27', 'nhl26'],
  )
  assert.notEqual(offered[0]?.slug, pickDefaultTitle(titles)?.slug)
})

void test('nav: the default stays offered even when it is neither polled nor match-backed', () => {
  const titles = [
    title('nhl27', 1, 27, { isActive: true }),
    title('nhl26', 9, 26, { isLive: true }),
    title('nhl24', 4, 24, { isDefault: true }),
    NHL22,
  ]
  assert.equal(pickDefaultTitle(titles)?.slug, 'nhl24')
  assert.deepEqual(
    switcherTitles(titles).map((t) => t.slug),
    ['nhl27', 'nhl26', 'nhl24'],
  )
})

void test('liveOnly (/ and /games): an archive slug is invalid; live titles and NHL 26 resolve', () => {
  const liveOnly = { liveOnly: true }
  for (const slug of ['nhl24', 'nhl22']) {
    assert.equal(resolveTitle(slug, TARGET, liveOnly).kind, 'invalid', slug)
  }
  assert.equal(ok(resolveTitle('nhl27', TARGET, liveOnly)).gameTitle.slug, 'nhl27')
  // NHL 26 keeps its match-backed pages after polling stops.
  assert.equal(ok(resolveTitle('nhl26', TARGET, liveOnly)).gameTitle.slug, 'nhl26')
  assert.equal(ok(resolveTitle(undefined, TARGET, liveOnly)).gameTitle.slug, 'nhl27')
  // No ?title= never redirects, even when the default itself is not live.
  assert.equal(ok(resolveTitle(undefined, [NHL22, NHL24], liveOnly)).gameTitle.slug, 'nhl24')
})

void test('/games toolbar: an explicitly selected archive title is offered too', () => {
  assert.deepEqual(
    switcherTitles(TARGET, NHL22.id).map((t) => t.slug),
    ['nhl27', 'nhl26', 'nhl22'],
  )
})

// ─── Career range label ──────────────────────────────────────────────────────

function careerRow(slug: string, releaseOrder: number | null) {
  return {
    gameTitleName: `NHL ${slug.replace(/^nhl/u, '')}`,
    gameTitleSlug: slug,
    gameTitleReleaseOrder: releaseOrder,
  }
}

void test('career range reads oldest to newest, including NHL 27', () => {
  // Production id order (nhl26 = 1, nhl22 = 6, nhl27 = 7) — the old label
  // derived "NHL 27–NHL 26" from exactly this order.
  const byId = [careerRow('nhl26', 26), careerRow('nhl22', 22), careerRow('nhl27', 27)]
  assert.equal(formatCareerTitleRange(byId), 'NHL 22–NHL 27 · sum')
  assert.equal(formatCareerTitleRange([...byId].reverse()), 'NHL 22–NHL 27 · sum')
})

void test('career range: single title and no titles', () => {
  assert.equal(formatCareerTitleRange([careerRow('nhl27', 27)]), 'NHL 27 · sum')
  assert.equal(formatCareerTitleRange([]), 'Career · sum')
})

// ─── Every title-aware surface uses the shared policy ────────────────────────

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

const PAGES = [
  '../app/page.tsx',
  '../app/games/page.tsx',
  '../app/stats/page.tsx',
  '../app/roster/page.tsx',
]

void test('/, /games, /stats and /roster resolve titles through the shared resolver', () => {
  for (const page of PAGES) {
    const text = source(page)
    assert.match(
      text,
      /import \{[^}]*\bresolveTitleFromSlug\b[^}]*\} from '@\/lib\/title-resolver'/,
      `${page} imports resolveTitleFromSlug`,
    )
    assert.match(text, /await resolveTitleFromSlug\(titleSlug[,)]/, `${page} calls it`)
    assert.doesNotMatch(text, /function resolveGameTitle\b/, `${page} has no local resolver`)
    assert.doesNotMatch(
      text,
      /\b(getActiveGameTitleBySlug|getArchiveGameTitleBySlug|listArchiveGameTitles|listGameTitles)\b/,
      `${page} has no direct title listing/lookup`,
    )
  }
})

void test('/ and /games have no archive view, so they resolve live titles only', () => {
  for (const page of ['../app/page.tsx', '../app/games/page.tsx']) {
    assert.match(
      source(page),
      /resolveTitleFromSlug\(titleSlug, \{ liveOnly: true \}\)/,
      `${page} is live-only`,
    )
  }
  for (const page of ['../app/stats/page.tsx', '../app/roster/page.tsx']) {
    assert.doesNotMatch(source(page), /liveOnly/, `${page} keeps its archive view`)
  }
})

void test('nav takes the default from the shared policy, never from titles[0]', () => {
  const switcher = source('../components/nav/game-title-switcher.tsx')
  assert.match(switcher, /const currentSlug = searchParams\.get\('title'\) \?\? defaultSlug\b/)
  assert.doesNotMatch(switcher, /titles\[0\]\?\.slug/)

  const topNav = source('../components/nav/top-nav.tsx')
  assert.match(topNav, /pickDefaultTitle\(all\)/)
  assert.match(topNav, /switcherTitles\(all\)/)
  assert.match(topNav, /defaultSlug=\{defaultSlug\}/)

  const drawer = source('../components/nav/nav-drawer.tsx')
  assert.match(drawer, /<GameTitleSwitcher titles=\{titles\} defaultSlug=\{defaultSlug\} \/>/)
})
