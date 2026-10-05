import type { MetadataRoute } from 'next'

/**
 * /robots.txt for the unlisted launch.
 *
 * Crawling stays allowed on purpose: a search engine has to fetch a page to see
 * its `noindex` (the meta tag from app/layout.tsx and the X-Robots-Tag header
 * from next.config.ts). Disallowing crawling here would let a linked URL be
 * listed without its content. No sitemap while the site is unlisted.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', allow: '/' } }
}
