import Image from 'next/image'
import Link from 'next/link'
import { LEGAL_DOCS } from '@/lib/legal/legal-docs'

const LINK_CLASS =
  'text-fg-3 transition-colors hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/**
 * Sitewide footer: rendered once by the root layout, after `<main>`. A
 * static Server Component — no hooks, no `headers()`/search-param reads —
 * so every route that renders it stays static/ISR, and the whole thing
 * works with JavaScript disabled.
 *
 * Legal links, labels, and draft status all come from `LEGAL_DOCS`
 * (`@/lib/legal/legal-docs`) rather than being duplicated here, so a
 * future publish (a registry status/date flip) is reflected here
 * automatically with no footer edit.
 */
export function SiteFooter() {
  const year = new Date().getFullYear()

  return (
    <footer
      data-site-footer
      className="border-t border-accent/40 bg-gradient-to-b from-surface to-[#131112]"
    >
      <span
        aria-hidden
        className="block h-px bg-gradient-to-r from-[#7a1f16] via-accent to-[#7a1f16] opacity-70"
      />

      <div className="mx-auto grid w-full max-w-screen-xl grid-cols-1 gap-8 px-4 py-10 nav:grid-cols-[1.4fr_1fr_1fr] nav:px-5 nav:py-10">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Image
              src="/images/bgm-logo.png"
              alt=""
              width={40}
              height={40}
              className="h-10 w-10 object-contain"
            />
            <span className="font-condensed text-lg font-black uppercase leading-none tracking-[0.06em] text-fg-1">
              Boogeymen
            </span>
          </div>
          <p className="max-w-[36ch] text-[13px] leading-relaxed text-fg-4">
            This website is not endorsed by or affiliated with EA or its licensors.
          </p>
        </div>

        <nav aria-label="Legal" className="flex flex-col gap-3">
          <p className="font-condensed text-[11px] font-semibold uppercase tracking-[0.22em] text-fg-4">
            Legal
          </p>
          <ul className="flex flex-col gap-2.5">
            {LEGAL_DOCS.map((doc) => (
              <li key={doc.slug}>
                <Link
                  href={doc.href}
                  className={`inline-flex items-center gap-2 font-condensed text-sm font-bold uppercase tracking-[0.06em] ${LINK_CLASS}`}
                >
                  {doc.footerLabel}
                  {doc.status === 'draft' ? (
                    <span className="rounded-xs border border-accent-line px-1.5 py-0.5 font-condensed text-[10px] font-bold uppercase tracking-[0.14em] text-accent-readable">
                      Draft
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex flex-col gap-3">
          <p className="font-condensed text-[11px] font-semibold uppercase tracking-[0.22em] text-fg-4">
            Contact
          </p>
          <a href="mailto:webmaster@boogeymen.app" className={`text-sm ${LINK_CLASS}`}>
            webmaster@boogeymen.app
          </a>
        </div>
      </div>

      <div className="border-t border-border-subtle">
        <div className="mx-auto max-w-screen-xl px-4 py-4 nav:px-5">
          <p className="font-condensed text-[10px] font-semibold uppercase tracking-[0.2em] text-fg-4">
            © {year} Boogeymen
          </p>
        </div>
      </div>
    </footer>
  )
}
