import { LEGAL_DOCS, type LegalSlug } from './legal-docs.ts'

/**
 * Where each draft's PUBLIC section lives inside its `docs/planning/
 * *-draft.md` file, expressed as two exact substrings rather than line
 * numbers, so this survives unrelated edits above or below the public
 * section. `heading` is the document-level `## ...` heading line (its text
 * becomes the page's <h1>, rendered outside `[data-legal-content]`, so
 * extraction starts AFTER that line, not at it). `end` is the heading that
 * starts the first excluded material after the public section.
 *
 * For `attribution`, `end` intentionally stops at "Drafting component:
 * short-form / footer notice" — that component is excluded from the
 * transcribed page entirely (per the approved plan), not just from the
 * internal-checks section that follows it.
 */
export const SOURCE_DRAFT_MARKERS: Record<
  LegalSlug,
  { file: string; heading: string; end: string }
> = {
  privacy: {
    file: 'privacy-policy-draft.md',
    heading: '## Privacy Policy',
    end: '## Internal drafting and publication checks',
  },
  terms: {
    file: 'terms-of-use-draft.md',
    heading: '## Terms of Use',
    end: '## Internal drafting and publication checks',
  },
  'data-collection': {
    file: 'data-collection-policy-draft.md',
    heading: '## Data Collection Policy',
    end: '## Internal drafting and publication checks',
  },
  attribution: {
    file: 'ea-nhl-attribution-notice-draft.md',
    heading: '## Public notice',
    end: '## Drafting component: short-form / footer notice',
  },
}

/**
 * Bare `PLACEHOLDER-*-URL` tokens map to the route the registry actually
 * decided for that document. This is the one place that encodes
 * transformation rule (c)'s bare-token form: the visible text a reader
 * sees is the resolved route path itself (e.g. "/legal/attribution"),
 * exactly what `DocLink` renders.
 */
function placeholderHrefMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const doc of LEGAL_DOCS) {
    // Matches the exact tokens used across the four drafts.
    if (doc.slug === 'privacy') map['PLACEHOLDER-PRIVACY-POLICY-URL'] = doc.href
    if (doc.slug === 'terms') map['PLACEHOLDER-TERMS-OF-USE-URL'] = doc.href
    if (doc.slug === 'data-collection') map['PLACEHOLDER-DATA-COLLECTION-POLICY-URL'] = doc.href
    if (doc.slug === 'attribution') map['PLACEHOLDER-ATTRIBUTION-NOTICE-URL'] = doc.href
  }
  return map
}

/**
 * Slices the public section out of a raw draft file's full text: everything
 * strictly between the end of the document-level `heading` line and the
 * start of the `end` marker. Throws loudly if either marker is missing, so
 * a rewritten draft heading fails a test instead of silently comparing
 * against an empty or wrong slice.
 */
export function extractPublicSection(raw: string, heading: string, end: string): string {
  const headingIdx = raw.indexOf(heading)
  if (headingIdx === -1) {
    throw new Error(`heading marker not found: ${JSON.stringify(heading)}`)
  }
  const lineEnd = raw.indexOf('\n', headingIdx)
  if (lineEnd === -1) {
    throw new Error(`heading marker ${JSON.stringify(heading)} has no trailing newline`)
  }
  const endIdx = raw.indexOf(end, headingIdx)
  if (endIdx === -1) {
    throw new Error(`end marker not found: ${JSON.stringify(end)}`)
  }
  if (endIdx <= lineEnd) {
    throw new Error(`end marker ${JSON.stringify(end)} appears before the heading's own body`)
  }
  return raw.slice(lineEnd + 1, endIdx)
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Converts a draft's raw public-section markdown into the plain visible
 * text a faithful semantic-JSX transcription must produce, applying only
 * the four permitted transformations:
 *
 *   (a) markdown structure -> semantic JSX (headings, lists, bold/italic,
 *       inline code all collapse to their plain text here, matching what a
 *       browser's innerText would show for the equivalent JSX)
 *   (b) the placeholder Effective date / Last updated lines are dropped
 *       entirely
 *   (c) `PLACEHOLDER-*-URL` tokens become the resolved route, either as a
 *       markdown link's visible text (dropping the URL) or, for a bare
 *       token, as the route path itself
 *   (d) email addresses are unaffected here — MailLink keeps the visible
 *       address text unchanged, which backtick-stripping already produces
 */
export function normalizeMarkdownToText(markdown: string): string {
  let text = markdown

  // (b) Drop the placeholder date lines entirely.
  text = text.replace(/^\*\*Effective date:\*\*.*$/gm, '')
  text = text.replace(/^\*\*Last updated:\*\*.*$/gm, '')

  // (c) Markdown links: keep only the visible text, drop the URL. Every
  // markdown link in these four drafts' public sections targets a
  // PLACEHOLDER-*-URL token, so this single rule covers all of them.
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  // (c) Any remaining bare placeholder token becomes the resolved route.
  const hrefByToken = placeholderHrefMap()
  text = text.replace(/PLACEHOLDER-[A-Z-]+-URL/g, (token) => {
    const href = hrefByToken[token]
    if (href === undefined) {
      throw new Error(`unmapped placeholder token: ${token}`)
    }
    return href
  })

  // (a) Inline code, bold, then italic — bold before italic so `**x**`
  // never gets misread as two adjacent italic spans.
  text = text.replace(/`([^`]+)`/g, '$1')
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/\*([^*]+)\*/g, '$1')

  // (a) Heading markers: the number-and-title text survives as the <h2>'s
  // own text; the leading `#`s do not render as characters.
  text = text.replace(/^#{1,6}\s+/gm, '')

  // (a) List bullet markers: the item becomes an <li>; the marker itself is
  // not text content.
  text = text.replace(/^[ \t]*[-*]\s+/gm, '')

  // Horizontal rules are structural only, never rendered as text.
  text = text.replace(/^-{3,}\s*$/gm, '')

  return collapseWhitespace(text)
}

/**
 * Removes every element that carries an `aria-hidden` attribute, by
 * depth-counting that element's own tag name from its opening tag to its
 * matching close tag. `LegalSection`'s decorative section-number column is
 * `aria-hidden` — a presentational duplicate of the number already in the
 * heading text — and must not count as content on either side of a
 * fidelity comparison, the same way a screen reader would never announce
 * it.
 */
export function stripAriaHidden(html: string): string {
  let result = html
  const openTagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\baria-hidden\b[^>]*>/
  for (;;) {
    const openMatch = openTagRe.exec(result)
    if (!openMatch) break
    const tag = openMatch[1]
    if (!tag) break
    const start = openMatch.index
    let depth = 1
    const innerRe = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'gi')
    innerRe.lastIndex = start + openMatch[0].length
    let end = -1
    let match: RegExpExecArray | null
    while ((match = innerRe.exec(result))) {
      if (match[0].startsWith('</')) {
        depth -= 1
      } else {
        depth += 1
      }
      if (depth === 0) {
        end = innerRe.lastIndex
        break
      }
    }
    if (end === -1) {
      throw new Error(`unbalanced <${tag}> while stripping an aria-hidden element`)
    }
    result = result.slice(0, start) + result.slice(end)
  }
  return result
}

/**
 * Tags whose boundary is a real word/sentence break — a heading, a
 * paragraph, a list item, a list itself — and therefore must become a
 * space when stripped, the same way a blank line between markdown blocks
 * collapses to a space in `normalizeMarkdownToText`. Every other tag in
 * this project's legal content (`a`, `strong`, `em`, `code`) is INLINE: it
 * sits flush inside running prose with no space of its own, and any space
 * next to it already exists as a real character in the adjacent text.
 */
const BLOCK_TAG_RE = /<\/?(?:p|li|ul|ol|div|section|h[1-6]|dt|dd|dl)\b[^>]*>/gi

/**
 * Strips `aria-hidden` elements and HTML tags, decodes the handful of
 * entities this project's own rendered text can plausibly contain — React
 * escapes an apostrophe in JSX text as the HEX numeric reference `&#x27;`,
 * not the decimal `&#39;` — then collapses whitespace the same way
 * `normalizeMarkdownToText` does, so the two sides of a fidelity
 * comparison are normalized identically.
 *
 * Two things a naive "replace every tag with a space" would get wrong:
 *
 *   1. HTML comments. React server-renders an empty `<!-- -->` comment
 *      between two adjacent text-expression children of the same element
 *      (for example `{number}. {heading}` becomes
 *      `1<!-- -->. <!-- -->Who operates this project`) purely as a
 *      hydration boundary marker — it represents zero characters, not a
 *      word break. These are removed to NOTHING, before any tag becomes a
 *      space, and specifically before the block/inline split below (a
 *      comment is not a block tag).
 *   2. Inline tags flush against punctuation. `<DocLink>Data Collection
 *      Policy</DocLink>.` has no space between `</a>` and the following
 *      period in the source. Turning every tag into a space would render
 *      "Policy ." — wrong. Only BLOCK_TAG_RE tags become a space; every
 *      other (inline) tag is stripped to nothing, leaving only whatever
 *      space genuinely exists as text.
 */
export function htmlToText(html: string): string {
  const withoutTags = stripAriaHidden(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(BLOCK_TAG_RE, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;|&#0?39;|&apos;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
  return collapseWhitespace(withoutTags)
}

/**
 * Extracts the inner HTML of the first element carrying `data-<attribute>`
 * (a boolean-style data attribute, e.g. `data-legal-content` on a `<div>`,
 * or `data-site-footer` on a `<footer>`), by reading that element's own
 * tag name off its opening tag and then depth-counting occurrences of
 * exactly that tag name until the matching close tag. Only the marked
 * element's own tag needs balancing this way — every other tag nested
 * inside it (p, ul, li, h2, strong, a, code, section, nav, …) is either
 * self-balancing per-occurrence or irrelevant to where THIS element
 * closes.
 */
export function extractByDataAttribute(html: string, attribute: string): string {
  const openTagRe = new RegExp(`<([a-zA-Z][a-zA-Z0-9]*)\\b[^>]*\\b${attribute}\\b[^>]*>`, 'i')
  const openMatch = openTagRe.exec(html)
  if (!openMatch) {
    throw new Error(`no element with ${attribute} found in the fetched HTML`)
  }
  const tag = openMatch[1]
  if (!tag) {
    throw new Error(`could not determine the tag name of the ${attribute} element`)
  }
  let depth = 1
  const bodyStart = openMatch.index + openMatch[0].length
  const tagRe = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'gi')
  tagRe.lastIndex = bodyStart
  let match: RegExpExecArray | null
  while ((match = tagRe.exec(html))) {
    if (match[0].startsWith('</')) {
      depth -= 1
    } else {
      depth += 1
    }
    if (depth === 0) {
      return html.slice(bodyStart, match.index)
    }
  }
  throw new Error(`unbalanced <${tag}> while extracting ${attribute}`)
}
