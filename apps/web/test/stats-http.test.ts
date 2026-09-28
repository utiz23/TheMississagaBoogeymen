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
 * Override the port with STATS_HTTP_TEST_PORT if 34573 is taken, the archive
 * title slug with STATS_HTTP_TEST_ARCHIVE_SLUG (default "nhl22").
 *
 * SCOPE: confirms the archive-title view renders the redesigned Career Team
 * Stats table (never the old "Club team records" table), locked to the
 * selected title, using the screenshot-import source, respecting the
 * existing mode filter — and that the active-title view's global title
 * controls are unaffected.
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
const ARCHIVE_SLUG = process.env.STATS_HTTP_TEST_ARCHIVE_SLUG ?? 'nhl22'

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

void test(
  `/stats?title=${ARCHIVE_SLUG}: renders the redesigned Career Team Stats table, not the obsolete Club team records table`,
  { skip },
  async () => {
    const { status, html } = await getHtml(`/stats?title=${ARCHIVE_SLUG}`)
    assert.equal(status, 200)
    const text = stripReactComments(html)
    assert.ok(text.includes(CAREER_TEAM_STATS_HEADING), 'expected the "Career Team Stats" heading')
    assert.ok(
      !text.includes(OBSOLETE_HEADING),
      'the obsolete "Club team records" heading must not render anywhere on the archive-title page',
    )
    assert.ok(
      text.includes('aria-labelledby="career-team-stats-heading"'),
      "expected the redesigned table's section landmark",
    )
  },
)

void test(
  `/stats?title=${ARCHIVE_SLUG}: the table is locked to the selected title — never shows "All Titles"`,
  { skip },
  async () => {
    const { html } = await getHtml(`/stats?title=${ARCHIVE_SLUG}`)
    const text = stripReactComments(html)
    assert.ok(
      !text.includes('>All Titles<'),
      'archive-title page must never display the "All Titles" filter option',
    )
    assert.ok(
      !text.includes('aria-label="Filter by title"'),
      'the title-filter control must be hidden when the table is locked to one archive title',
    )
  },
)

void test(
  `/stats?title=${ARCHIVE_SLUG}: shows the screenshot-import source, never a live/match-derived one`,
  { skip },
  async () => {
    const { html } = await getHtml(`/stats?title=${ARCHIVE_SLUG}`)
    const text = stripReactComments(html)
    assert.ok(
      text.includes(SCREENSHOT_IMPORT_LABEL),
      `expected the "${SCREENSHOT_IMPORT_LABEL}" source label`,
    )
  },
)

/**
 * The Career Team Stats table's own static footnote explains playlist-family
 * label equivalences (e.g. "EASHL 6v6 = Clubs 6v6 ... EASHL 3v3 = Clubs
 * 3v3") and mentions every family by name regardless of which rows are
 * actually present — a mode assertion must exclude it, or it always finds
 * every family's label and proves nothing. It renders unconditionally, so
 * removing it once here is safe for both mode tests.
 */
const FOOTNOTE_LABEL_EXPLAINER =
  /Playlist filters group equivalent era labels[^<]*Threes and Quickplay 3v3 are kept separate\./

/** Just the Career Team Stats `<section>` (there is no nested `<section>` inside it, so a non-greedy match to the first `</section>` is exact), with the label-equivalence footnote sentence removed. */
function careerTeamStatsSectionRowText(html: string): string | null {
  const match =
    /<section[^>]*aria-labelledby="career-team-stats-heading"[^>]*>([\s\S]*?)<\/section>/.exec(
      stripReactComments(html),
    )
  if (match?.[1] === undefined) return null
  return match[1].replace(FOOTNOTE_LABEL_EXPLAINER, '')
}

void test(
  `/stats?title=${ARCHIVE_SLUG}&mode=6s: shows only 6s-family playlists`,
  { skip },
  async () => {
    const { html } = await getHtml(`/stats?title=${ARCHIVE_SLUG}&mode=6s`)
    const section = careerTeamStatsSectionRowText(html)
    if (section === null) return // no reviewed 6s rows for this title — nothing to assert
    for (const forbidden of ['3v3', 'Threes', 'Quickplay']) {
      assert.ok(!section.includes(forbidden), `6s mode must not render a "${forbidden}" playlist`)
    }
  },
)

void test(
  `/stats?title=${ARCHIVE_SLUG}&mode=3s: shows only 3s-family playlists`,
  { skip },
  async () => {
    const { html } = await getHtml(`/stats?title=${ARCHIVE_SLUG}&mode=3s`)
    const section = careerTeamStatsSectionRowText(html)
    if (section === null) return // no reviewed 3s rows for this title — nothing to assert
    for (const forbidden of ['6v6', 'Full Team']) {
      assert.ok(!section.includes(forbidden), `3s mode must not render a "${forbidden}" playlist`)
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
