/**
 * END-TO-END test for the four draft-gated legal routes and the sitewide
 * footer: starts the BUILT app and reads real HTTP responses and real
 * rendered HTML, the same pattern `disabled-routes-http.test.ts` uses and
 * for the same reason — module-level tests cannot prove what a browser
 * actually receives.
 *
 * REQUIRES A BUILD. Skips — loudly, not silently — when `.next/BUILD_ID` is
 * absent:
 *
 *   pnpm --filter web build && pnpm --filter web test:http-legal
 *
 * Override the port with LEGAL_HTTP_TEST_PORT if 34572 is taken.
 *
 * SCOPE: route behavior, metadata, the draft gate, heading/landmark
 * structure, cross-links, and content fidelity against the source drafts
 * for the four legal routes; plus the sitewide footer's presence (exactly
 * once, on every route that renders the root layout, including a 404) and
 * content (legal links, draft labels, the EA sentence, the contact
 * mailto, the copyright line, and the absence of disabled or
 * prototype-only destinations).
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  LEGAL_DOCS,
  DRAFT_BANNER_TEXT,
  getLegalDoc,
  type LegalSlug,
} from '../src/lib/legal/legal-docs.ts'
import {
  SOURCE_DRAFT_MARKERS,
  extractPublicSection,
  normalizeMarkdownToText,
  htmlToText,
  extractByDataAttribute,
} from '../src/lib/legal/legal-fidelity.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(WEB_ROOT, '..', '..')
const DRAFTS_DIR = path.join(REPO_ROOT, 'docs/planning')
const NEXT_BIN = path.join(WEB_ROOT, 'node_modules/next/dist/bin/next')
const BUILD_ID = path.join(WEB_ROOT, '.next/BUILD_ID')

const PORT = Number(process.env.LEGAL_HTTP_TEST_PORT ?? '34572')
const BASE = `http://127.0.0.1:${String(PORT)}`

const isBuilt = existsSync(BUILD_ID)
const skip = isBuilt
  ? false
  : 'no production build — run `pnpm --filter web build` first (this test cannot prove anything without one)'

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

/** The exact route/heading id, so a mismatch between page and test is loud. */
const LEGAL_ROUTES: readonly { slug: LegalSlug; href: string; title: string }[] = LEGAL_DOCS.map(
  (doc) => ({ slug: doc.slug, href: doc.href, title: `${doc.title} (Draft) — Club Stats` }),
)

const EA_FOOTER_SENTENCE = 'This website is not endorsed by or affiliated with EA or its licensors.'

/** Prototype-only destinations that must never appear in the sitewide footer. */
const FORBIDDEN_FOOTER_DESTINATIONS = [
  'Discord',
  'Twitch',
  'Cookie notice',
  'Code of conduct',
  'Season archive',
  'Scoring leaders',
  'Goalie splits',
  'Depth chart',
  'Glossary',
  'Tryouts',
  'Clips',
]

/**
 * Runs every content assertion the footer must satisfy against a page's
 * full HTML, extracting `[data-site-footer]` itself first so a false
 * match elsewhere on the page (e.g. the legal doc index) can't hide a
 * missing footer element.
 */
function assertFooterContent(html: string, urlPath: string): void {
  const footerCount = [...html.matchAll(/<footer\b[^>]*\bdata-site-footer\b[^>]*>/gi)].length
  assert.equal(
    footerCount,
    1,
    `${urlPath}: expected exactly one [data-site-footer], found ${String(footerCount)}`,
  )

  // React server-renders an empty `<!-- -->` comment between two adjacent
  // text-expression children of the same element (see legal-fidelity.ts's
  // htmlToText doc comment) — the footer's `© {year} Boogeymen` becomes
  // `© <!-- -->2026<!-- --> Boogeymen`. Stripped here so every text match
  // below sees the real characters only; hrefs and other attributes are
  // untouched since comments never appear inside them.
  const footer = extractByDataAttribute(html, 'data-site-footer').replace(/<!--[\s\S]*?-->/g, '')

  for (const doc of LEGAL_DOCS) {
    assert.ok(
      footer.includes(`href="${doc.href}"`),
      `${urlPath}: footer missing link to ${doc.href}`,
    )
  }

  const draftDocCount = LEGAL_DOCS.filter((doc) => doc.status === 'draft').length
  const draftLabelCount = [...footer.matchAll(/>Draft</g)].length
  assert.equal(
    draftLabelCount,
    draftDocCount,
    `${urlPath}: expected ${String(draftDocCount)} visible "Draft" labels in the footer, found ${String(draftLabelCount)}`,
  )

  assert.ok(footer.includes(EA_FOOTER_SENTENCE), `${urlPath}: footer missing the exact EA sentence`)
  assert.ok(
    footer.includes('href="mailto:webmaster@boogeymen.app"'),
    `${urlPath}: footer missing the webmaster mailto link`,
  )

  const year = new Date().getFullYear()
  assert.match(
    footer,
    new RegExp(`©\\s*${String(year)}\\s*Boogeymen`),
    `${urlPath}: footer missing "© ${String(year)} Boogeymen"`,
  )

  const footerHrefs = [...footer.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? '')
  for (const href of footerHrefs) {
    assert.ok(
      !/^\/(login|account|me|admin)\b/.test(href),
      `${urlPath}: footer links to a disabled route: ${href}`,
    )
  }

  for (const destination of FORBIDDEN_FOOTER_DESTINATIONS) {
    assert.ok(
      !footer.includes(destination),
      `${urlPath}: footer contains an unsupported prototype destination: "${destination}"`,
    )
  }
}

void test('control: the server really is serving this app', { skip }, async () => {
  const { status } = await getHtml('/')
  assert.notEqual(status, 404, '/ must not 404; the assertions below mean nothing if it does')
  assert.ok(status < 500, `/ returned ${String(status)} — the app is not healthy enough to judge`)
})

for (const route of LEGAL_ROUTES) {
  void test(
    `${route.href}: 200, exact draft title, noindex/nofollow robots`,
    { skip },
    async () => {
      const { status, html } = await getHtml(route.href)
      assert.equal(status, 200)

      const titleMatch = /<title>([^<]*)<\/title>/.exec(html)
      assert.ok(titleMatch, `${route.href}: no <title> found`)
      // <title> content is HTML-entity-escaped (e.g. "&amp;"); decode it
      // before comparing against the plain-text expected title.
      const decodedTitle = (titleMatch[1] ?? '').replace(/&amp;/g, '&')
      assert.equal(decodedTitle, route.title)

      const robotsMatch = /<meta[^>]*name="robots"[^>]*content="([^"]*)"[^>]*>/.exec(html)
      assert.ok(robotsMatch, `${route.href}: no <meta name="robots"> found`)
      const robotsContent = robotsMatch[1] ?? ''
      assert.match(robotsContent, /noindex/)
      assert.match(robotsContent, /nofollow/)

      const googlebotMatch = /<meta[^>]*name="googlebot"[^>]*content="([^"]*)"[^>]*>/.exec(html)
      assert.ok(googlebotMatch, `${route.href}: no <meta name="googlebot"> found`)
      const googlebotContent = googlebotMatch[1] ?? ''
      assert.match(googlebotContent, /noindex/)
      assert.match(googlebotContent, /nofollow/)
    },
  )

  void test(
    `${route.href}: draft banner precedes the single <h1> in reading order`,
    { skip },
    async () => {
      const { html } = await getHtml(route.href)

      const h1Matches = [...html.matchAll(/<h1\b/g)]
      assert.equal(h1Matches.length, 1, `${route.href}: expected exactly one <h1>`)

      const bannerIdx = html.indexOf(DRAFT_BANNER_TEXT)
      assert.ok(bannerIdx !== -1, `${route.href}: draft banner text not found`)
      const firstH1Index = h1Matches.at(0)?.index ?? Number.POSITIVE_INFINITY
      assert.ok(
        bannerIdx < firstH1Index,
        `${route.href}: draft banner must appear before the <h1> in the HTML`,
      )

      const roleNoteRe = /<div[^>]*role="note"[^>]*>[^]*?Draft — not in effect\.[^]*?<\/div>/
      assert.match(html, roleNoteRe, `${route.href}: banner must be a role="note" element`)
    },
  )

  void test(
    `${route.href}: no rendered date row while the document is a draft`,
    { skip },
    async () => {
      const { html } = await getHtml(route.href)
      assert.ok(
        !html.includes('<time'),
        `${route.href}: a draft page must render no <time> element`,
      )
      assert.ok(!html.includes('Effective</dt>'), `${route.href}: no Effective date row expected`)
      assert.ok(!html.includes('Last updated</dt>'), `${route.href}: no Last updated row expected`)

      // Scoped to the transcribed content, not the whole document: the
      // shared TopNav legitimately embeds real game-title launch dates
      // (e.g. "launchedAt":"2025-10-01") in its RSC payload on every page,
      // which is unrelated to whether THIS document renders a date.
      const content = extractByDataAttribute(html, 'data-legal-content')
      assert.ok(
        !/\b20\d{2}-\d{2}-\d{2}\b/.test(content),
        `${route.href}: no ISO date string expected in the transcribed content`,
      )
    },
  )

  void test(
    `${route.href}: every #section-N Contents anchor has a matching heading id`,
    { skip },
    async () => {
      const { html } = await getHtml(route.href)
      const anchorTargets = [...html.matchAll(/href="#(section-\d+)"/g)]
        .map((m) => m[1])
        .filter((id): id is string => id !== undefined)
      assert.ok(anchorTargets.length > 0, `${route.href}: expected at least one #section-N anchor`)
      for (const id of anchorTargets) {
        assert.ok(html.includes(`id="${id}"`), `${route.href}: no element with id="${id}"`)
        assert.ok(
          html.includes(`id="${id}-heading"`),
          `${route.href}: section ${id} has no matching heading id`,
        )
      }
    },
  )

  void test(
    `${route.href}: the cross-document index links all four legal routes`,
    { skip },
    async () => {
      const { html } = await getHtml(route.href)
      assert.match(html, /aria-label="Legal documents"/)
      for (const doc of LEGAL_DOCS) {
        assert.ok(html.includes(`href="${doc.href}"`), `${route.href}: missing link to ${doc.href}`)
      }
    },
  )

  void test(
    `${route.href}: transcribed content matches the source draft exactly`,
    { skip },
    async () => {
      const { html } = await getHtml(route.href)
      const content = extractByDataAttribute(html, 'data-legal-content')
      const renderedText = htmlToText(content)

      const marker = SOURCE_DRAFT_MARKERS[route.slug]
      const raw = readFileSync(path.join(DRAFTS_DIR, marker.file), 'utf8')
      const publicMarkdown = extractPublicSection(raw, marker.heading, marker.end)
      const expectedText = normalizeMarkdownToText(publicMarkdown)

      assert.equal(
        renderedText,
        expectedText,
        `${route.href}: rendered [data-legal-content] text diverges from ` +
          `docs/planning/${marker.file}'s public section`,
      )
    },
  )

  void test(
    `${route.href}: [data-legal-content] link set matches this document's registry references exactly`,
    { skip },
    async () => {
      // Scoped to [data-legal-content] only — this deliberately excludes
      // the cross-document index (LegalDocIndex), which links all four
      // documents from every page regardless of what that page's own
      // prose actually references, and sits outside data-legal-content
      // for exactly that reason.
      const { html } = await getHtml(route.href)
      const content = extractByDataAttribute(html, 'data-legal-content')

      const hrefBySlug = new Map<string, LegalSlug>(LEGAL_DOCS.map((doc) => [doc.href, doc.slug]))
      const linkedSlugs = new Set<LegalSlug>()
      for (const match of content.matchAll(/href="(\/legal\/[a-z-]+)"/g)) {
        const href = match[1] ?? ''
        const slug = hrefBySlug.get(href)
        assert.ok(slug, `${route.href}: [data-legal-content] links an unknown legal href: ${href}`)
        linkedSlugs.add(slug)
      }

      const expectedSlugs = new Set(getLegalDoc(route.slug).references)
      assert.deepEqual(
        [...linkedSlugs].sort(),
        [...expectedSlugs].sort(),
        `${route.href}: [data-legal-content] links ${JSON.stringify([...linkedSlugs].sort())} ` +
          `but the registry's references are ${JSON.stringify([...expectedSlugs].sort())} — ` +
          `a rendered DocLink and the registry's references array have drifted apart`,
      )
    },
  )

  void test(
    `${route.href}: sitewide footer is present exactly once and correct`,
    { skip },
    async () => {
      const { html } = await getHtml(route.href)
      assertFooterContent(html, route.href)
    },
  )
}

void test('/: sitewide footer is present exactly once and correct', { skip }, async () => {
  const { html } = await getHtml('/')
  assertFooterContent(html, '/')
})

void test(
  '/no-such-page (404): sitewide footer is present exactly once and correct',
  { skip },
  async () => {
    const { status, html } = await getHtml('/no-such-page')
    assert.equal(status, 404, 'expected an ordinary 404 for a nonexistent page')
    assertFooterContent(html, '/no-such-page (404)')
  },
)

void test(
  'every /legal/* link found across all four pages resolves with 200',
  { skip },
  async () => {
    const seen = new Set<string>()
    for (const route of LEGAL_ROUTES) {
      const { html } = await getHtml(route.href)
      for (const match of html.matchAll(/href="(\/legal\/[a-z-]+)"/g)) {
        const href = match[1]
        if (href) seen.add(href)
      }
    }
    assert.ok(seen.size > 0, 'expected at least one /legal/* link across the four pages')
    for (const href of seen) {
      const { status } = await getHtml(href)
      assert.equal(status, 200, `${href} did not resolve`)
    }
  },
)

void test('an unrelated path under /legal/ is an ordinary 404', { skip }, async () => {
  const { status } = await getHtml('/legal/does-not-exist')
  assert.equal(status, 404)
})

void test(
  '/legal (no slug) is an ordinary 404 — there is no legal index page',
  { skip },
  async () => {
    const { status } = await getHtml('/legal')
    assert.equal(status, 404)
  },
)
