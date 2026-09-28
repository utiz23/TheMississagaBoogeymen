/**
 * STRUCTURAL guard over the shipped legal pages: source-text assertions,
 * not behavior — the same honest limitation
 * `../../lib/account-system-disabled.test.ts` documents about itself. It
 * proves certain strings and link targets are absent from what ships; it
 * does not execute the app.
 *
 * Scope: `src/content/legal/**`, `src/components/legal/**`,
 * `src/app/legal/**`, and the registry file `src/lib/legal/legal-docs.ts`
 * — every file that can put text or a link in front of a visitor on a
 * legal page. Two deliberate exclusions:
 *
 *   - `*.test.ts(x)` files, including this one, which legitimately name
 *     the very strings they forbid.
 *   - `src/lib/legal/legal-fidelity.ts`, a build/test-time-only helper
 *     that legitimately contains the literal string "PLACEHOLDER" in its
 *     token map and regexes. It is never imported by any route or
 *     component, so it never reaches a browser.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB_SRC = path.resolve(HERE, '..', '..')

const SCANNED_DIRS = [
  path.join(WEB_SRC, 'content/legal'),
  path.join(WEB_SRC, 'components/legal'),
  path.join(WEB_SRC, 'app/legal'),
]

// The one file outside the three directories above that also ships
// legal-facing text (titles, descriptions).
const REGISTRY_FILE = path.join(WEB_SRC, 'lib/legal/legal-docs.ts')

function collectFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .filter((p): p is string => typeof p === 'string' && /\.tsx?$/.test(p))
    .filter((p) => !/\.test\.tsx?$/.test(p))
    .map((p) => path.join(dir, p))
}

function shippedLegalFiles(): string[] {
  return [...SCANNED_DIRS.flatMap(collectFiles), REGISTRY_FILE]
}

/**
 * Strips `/** ... *\/` and whole-line `// ...` comments before a source
 * file is scanned. Every check below is about what a VISITOR can see —
 * this file's own doc-comments legitimately describe forbidden strings
 * (e.g. "no PLACEHOLDER-*-URL cross-links", "closing each draft's
 * publication blockers", "Verbatim transcription of
 * `docs/planning/...-draft.md`"), and those comments never reach a
 * browser. Without stripping them, this scanner would flag its own
 * documentation as a violation.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

function read(file: string): string {
  return stripComments(readFileSync(file, 'utf8'))
}

function rel(file: string): string {
  return path.relative(WEB_SRC, file)
}

void test('the scan actually finds the four content modules and four routes', () => {
  const files = shippedLegalFiles()
  assert.ok(files.some((f) => f.endsWith(path.join('content', 'legal', 'privacy.tsx'))))
  assert.ok(files.some((f) => f.endsWith(path.join('content', 'legal', 'terms.tsx'))))
  assert.ok(files.some((f) => f.endsWith(path.join('content', 'legal', 'data-collection.tsx'))))
  assert.ok(files.some((f) => f.endsWith(path.join('content', 'legal', 'attribution.tsx'))))
  assert.ok(files.some((f) => f.endsWith(path.join('app', 'legal', 'privacy', 'page.tsx'))))
  assert.ok(files.some((f) => f.endsWith(path.join('app', 'legal', 'terms', 'page.tsx'))))
  assert.ok(files.some((f) => f.endsWith(path.join('app', 'legal', 'data-collection', 'page.tsx'))))
  assert.ok(files.some((f) => f.endsWith(path.join('app', 'legal', 'attribution', 'page.tsx'))))
})

void test('no shipped legal file contains a PLACEHOLDER token', () => {
  const offenders = shippedLegalFiles().filter((f) => read(f).includes('PLACEHOLDER'))
  assert.deepEqual(offenders.map(rel), [])
})

void test('no shipped legal file references a planning draft path', () => {
  const offenders = shippedLegalFiles().filter((f) => {
    const src = read(f)
    return src.includes('docs/planning') || src.includes('-draft.md')
  })
  assert.deepEqual(offenders.map(rel), [])
})

void test('no shipped legal file carries internal session/milestone language', () => {
  const forbiddenPhrases = [
    'Gate 2',
    'Gate 3',
    'HANDOFF',
    'checkpoint',
    'blocker',
    'drafting-quality',
    'internal checklist',
    'internal checks',
    'Full notice:',
  ]
  // Session/milestone codes like E2A, E2D3, E2H — an "E" immediately
  // followed by 1 or 2 and then more letters/digits.
  const sessionCodeRe = /\bE[12][A-Z0-9]{0,4}\b/

  const offenders: string[] = []
  for (const file of shippedLegalFiles()) {
    const src = read(file)
    if (forbiddenPhrases.some((phrase) => src.includes(phrase)) || sessionCodeRe.test(src)) {
      offenders.push(rel(file))
    }
  }
  assert.deepEqual(offenders, [])
})

void test("no shipped legal file uses the prototype's wrong domain or unapproved contact addresses", () => {
  const offenders = shippedLegalFiles().filter((f) => {
    const src = read(f)
    return (
      src.includes('boogeymen.gg') ||
      src.includes('privacy@boogeymen') ||
      src.includes('alerts@boogeymen')
    )
  })
  assert.deepEqual(offenders.map(rel), [])
})

void test('no shipped legal file names a prototype-only destination that does not exist', () => {
  const forbiddenDestinations = [
    'Cookie notice',
    'Code of conduct',
    'Tryouts',
    'Season archive',
    'Scoring leaders',
    'Goalie splits',
    'Depth chart',
    'Glossary',
  ]
  const offenders = shippedLegalFiles().filter((f) => {
    const src = read(f)
    return forbiddenDestinations.some((s) => src.includes(s))
  })
  assert.deepEqual(offenders.map(rel), [])
})

void test('no shipped legal file links to a disabled account/admin route', () => {
  const hrefRe = /href=(?:"([^"]*)"|\{`([^`]*)`\}|\{legalHref\([^)]*\)\})/g
  const offenders: string[] = []
  for (const file of shippedLegalFiles()) {
    const src = read(file)
    const hrefs = [...src.matchAll(hrefRe)].map((m) => m[1] ?? m[2] ?? '')
    if (hrefs.some((h) => /^\/(login|account|me|admin)\b/.test(h))) {
      offenders.push(rel(file))
    }
  }
  assert.deepEqual(offenders, [])
})

void test('every DocLink in the content modules uses a literal, real registry slug', () => {
  const validSlugs = ['privacy', 'terms', 'data-collection', 'attribution']
  const contentFiles = collectFiles(path.join(WEB_SRC, 'content/legal'))
  const offenders: string[] = []
  for (const file of contentFiles) {
    const src = read(file)

    // Every <DocLink opening tag, regardless of how its `to` prop is
    // written, versus only the ones written as a literal `to="slug"`. A
    // non-literal usage — `to={someExpression}` — would slip past the
    // second regex entirely and never surface as an "unknown slug" below,
    // so the two counts must match: every DocLink must be literal.
    const allOpenings = [...src.matchAll(/<DocLink\b/g)].length
    const literalSlugs = [...src.matchAll(/<DocLink\s+to="([^"]+)"/g)].map((m) => m[1] ?? '')

    if (literalSlugs.length !== allOpenings) {
      offenders.push(
        `${rel(file)}: ${String(allOpenings)} <DocLink> usage(s) but only ` +
          `${String(literalSlugs.length)} used a literal to="slug" — a non-literal ` +
          `DocLink target is not allowed`,
      )
      continue
    }

    for (const slug of literalSlugs) {
      if (!validSlugs.includes(slug)) {
        offenders.push(`${rel(file)}: unknown DocLink slug "${slug}"`)
      }
    }
  }
  assert.deepEqual(offenders, [])
})

void test('no legal page renders outside the shared LegalPage shell', () => {
  const pageFiles = collectFiles(path.join(WEB_SRC, 'app/legal'))
  const offenders = pageFiles.filter((f) => !read(f).includes('LegalPage'))
  assert.deepEqual(offenders.map(rel), [])
})
