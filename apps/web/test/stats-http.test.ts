/**
 * END-TO-END test for the Career Team Stats presentation on `/stats`: starts
 * the BUILT app and reads real HTTP responses / rendered HTML, the same
 * pattern `legal-http.test.ts` and `disabled-routes-http.test.ts` use and for
 * the same reason — module-level tests cannot prove what a browser actually
 * receives.
 *
 * REQUIRES A BUILD and a reachable, seeded verification database. Skips —
 * loudly, not silently — when `.next/BUILD_ID` is absent:
 *
 *   DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter web build
 *   DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter web test:http-stats
 *
 * Override the port with STATS_HTTP_TEST_PORT if 34573 is taken.
 *
 * Pinned to the canonical `nhl22` archive fixture, which is known to carry
 * reviewed rows in BOTH the 6s and 3s families — that pairing is what lets
 * the mode tests below assert real presence/absence instead of degrading to
 * a no-op. There is deliberately no env-var override for the title: a
 * silent override could select a title missing one of the two required mode
 * datasets and turn every mode assertion into an unproven no-op again.
 *
 * SCOPE: confirms the archive-title view renders the redesigned Career Team
 * Stats table (never the old "Club team records" table), locked to the
 * selected title, using the screenshot-import source only, respecting the
 * existing mode filter with real rows present and the other family's rows
 * genuinely absent — and that the active-title view's global title controls
 * are unaffected.
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(HERE, '..')
const NEXT_BIN = path.join(WEB_ROOT, 'node_modules/next/dist/bin/next')
const BUILD_ID = path.join(WEB_ROOT, '.next/BUILD_ID')

const PORT = Number(process.env.STATS_HTTP_TEST_PORT ?? '34573')
const BASE = `http://127.0.0.1:${String(PORT)}`

/** Canonical archive fixture: confirmed to carry reviewed rows in every playlist family. */
const ARCHIVE_SLUG = 'nhl22'
const ARCHIVE_TITLE_NAME = 'NHL 22'

const isBuilt = existsSync(BUILD_ID)
const skip = isBuilt
  ? false
  : 'no production build — run `DATABASE_URL="$TEST_DATABASE_URL" pnpm --filter web build` first (this test cannot prove anything without one)'

let server: ChildProcess | null = null

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/`, { method: 'HEAD' })
      return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  throw new Error(`the built app did not start on ${BASE} within 60s`)
}

before(async () => {
  if (!isBuilt) return
  server = spawn(process.execPath, [NEXT_BIN, 'start', '-p', String(PORT), '-H', '127.0.0.1'], {
    cwd: WEB_ROOT,
    stdio: 'ignore',
  })
  await waitForServer()
})

after(() => {
  server?.kill('SIGTERM')
  server = null
})

async function getHtml(urlPath: string): Promise<{ status: number; html: string }> {
  const response = await fetch(`${BASE}${urlPath}`, { redirect: 'manual' })
  const html = await response.text()
  return { status: response.status, html }
}

/** React inserts an empty `<!-- -->` marker around interpolated text nodes; strip before substring checks. */
function stripReactComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '')
}

const CAREER_TEAM_STATS_HEADING = 'Career Team Stats'
const OBSOLETE_HEADING = 'Club team records'
const SCREENSHOT_IMPORT_LABEL = 'Screenshot import · reviewed'
const LIVE_MATCH_SOURCE_LABEL = 'Local · derived from matches'

/**
 * The Career Team Stats table's own static footnote explains playlist-family
 * label equivalences (e.g. "EASHL 6v6 = Clubs 6v6 ... EASHL 3v3 = Clubs
 * 3v3") and names every family regardless of which rows are actually
 * present — a mode assertion must exclude exactly this one sentence, or it
 * always finds every family's label and proves nothing. It renders
 * unconditionally and is plain literal JSX text (no interpolation inside
 * it), so a single anchored match removes only itself, never a rendered
 * row, control, or heading around it.
 */
const FOOTNOTE_LABEL_EXPLAINER =
  /Playlist filters group equivalent era labels[^<]*Threes and Quickplay 3v3 are kept separate\./

/**
 * The Career Team Stats `<section>` (there is no nested `<section>` inside
 * it, so a non-greedy match to the first `</section>` is exact), with the
 * label-equivalence footnote sentence removed. Fails the test immediately —
 * never returns a value silently standing in for "absent" — so a response
 * missing the redesigned section cannot let a caller's later assertions
 * degrade into an unproven no-op.
 */
function extractCareerTeamStatsSection(html: string, context: string): string {
  const match =
    /<section[^>]*aria-labelledby="career-team-stats-heading"[^>]*>([\s\S]*?)<\/section>/.exec(
      stripReactComments(html),
    )
  assert.ok(
    match?.[1] !== undefined,
    `${context}: expected the redesigned Career Team Stats section, found none`,
  )
  return match[1].replace(FOOTNOTE_LABEL_EXPLAINER, '')
}

void test(
  `/stats?title=${ARCHIVE_SLUG} (no mode): redesigned section, locked to ${ARCHIVE_TITLE_NAME}, screenshot-import only, both playlist families present`,
  { skip },
  async () => {
    const urlPath = `/stats?title=${ARCHIVE_SLUG}`
    const { status, html } = await getHtml(urlPath)
    assert.equal(status, 200, `${urlPath}: expected HTTP 200`)

    const fullText = stripReactComments(html)
    assert.ok(
      fullText.includes(CAREER_TEAM_STATS_HEADING),
      `${urlPath}: expected the "Career Team Stats" heading`,
    )
    assert.ok(
      !fullText.includes(OBSOLETE_HEADING),
      `${urlPath}: the obsolete "Club team records" heading must not render anywhere on the page`,
    )

    const section = extractCareerTeamStatsSection(html, urlPath)

    // Locked-title scope: the exact title, never "All Titles", and no
    // title-filter control to switch away from it.
    assert.ok(
      section.includes(ARCHIVE_TITLE_NAME),
      `${urlPath}: scope must show "${ARCHIVE_TITLE_NAME}"`,
    )
    assert.ok(section.includes('all playlists'), `${urlPath}: scope must show "all playlists"`)
    assert.ok(!section.includes('>All Titles<'), `${urlPath}: must never display "All Titles"`)
    assert.ok(
      !section.includes('aria-label="Filter by title"'),
      `${urlPath}: the title-filter control must be hidden when locked to one archive title`,
    )

    // Source integrity: screenshot-import only, never a live/match-derived row.
    assert.ok(
      section.includes(SCREENSHOT_IMPORT_LABEL),
      `${urlPath}: expected the "${SCREENSHOT_IMPORT_LABEL}" source label`,
    )
    assert.ok(
      !section.includes(LIVE_MATCH_SOURCE_LABEL),
      `${urlPath}: the archive table must never show the "${LIVE_MATCH_SOURCE_LABEL}" (live) source`,
    )

    // With no mode filter, both playlist families must have real rows —
    // this is the fixture precondition the mode tests below depend on.
    assert.ok(section.includes('6v6'), `${urlPath}: expected at least one 6s-family row/label`)
    assert.ok(section.includes('3v3'), `${urlPath}: expected at least one 3s-family row/label`)
  },
)

void test(
  `/stats?title=${ARCHIVE_SLUG}&mode=6s: redesigned section with real 6s rows, no 3s-family rows`,
  { skip },
  async () => {
    const urlPath = `/stats?title=${ARCHIVE_SLUG}&mode=6s`
    const { status, html } = await getHtml(urlPath)
    assert.equal(status, 200, `${urlPath}: expected HTTP 200`)

    const fullText = stripReactComments(html)
    assert.ok(
      !fullText.includes(OBSOLETE_HEADING),
      `${urlPath}: the obsolete "Club team records" heading must not render anywhere on the page`,
    )

    const section = extractCareerTeamStatsSection(html, urlPath)
    assert.ok(section.includes('6v6'), `${urlPath}: expected at least one 6s-family row/label`)
    for (const forbidden of ['3v3', 'Threes', 'Quickplay']) {
      assert.ok(!section.includes(forbidden), `${urlPath}: must not render a "${forbidden}" row`)
    }
  },
)

void test(
  `/stats?title=${ARCHIVE_SLUG}&mode=3s: redesigned section with real 3s rows, no 6s-family rows`,
  { skip },
  async () => {
    const urlPath = `/stats?title=${ARCHIVE_SLUG}&mode=3s`
    const { status, html } = await getHtml(urlPath)
    assert.equal(status, 200, `${urlPath}: expected HTTP 200`)

    const fullText = stripReactComments(html)
    assert.ok(
      !fullText.includes(OBSOLETE_HEADING),
      `${urlPath}: the obsolete "Club team records" heading must not render anywhere on the page`,
    )

    const section = extractCareerTeamStatsSection(html, urlPath)
    assert.ok(section.includes('3v3'), `${urlPath}: expected at least one 3s-family row/label`)
    for (const forbidden of ['6v6', 'Full Team']) {
      assert.ok(!section.includes(forbidden), `${urlPath}: must not render a "${forbidden}" row`)
    }
  },
)

void test(
  'the active-title /stats page keeps its global title-filter controls',
  { skip },
  async () => {
    const { status, html } = await getHtml('/stats')
    assert.equal(status, 200)
    const text = stripReactComments(html)
    assert.ok(text.includes(CAREER_TEAM_STATS_HEADING), 'expected the "Career Team Stats" heading')
    assert.ok(
      text.includes('aria-label="Filter by title"'),
      'the active-title page must keep its global "Filter by title" control — this task must not touch it',
    )
    assert.ok(
      text.includes('>All Titles<'),
      'the active-title page must keep its "All Titles" option',
    )
  },
)
