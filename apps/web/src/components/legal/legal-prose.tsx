import type { ReactNode } from 'react'
import Link from 'next/link'
import { legalHref, type LegalSlug } from '@/lib/legal/legal-docs'

const LINK_CLASS =
  'text-fg-2 underline decoration-border underline-offset-2 transition-colors hover:text-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

/** A transcribed paragraph. */
export function P({ children }: { children: ReactNode }) {
  return <p>{children}</p>
}

/** A transcribed bullet list. */
export function UL({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5">{children}</ul>
}

export function LI({ children }: { children: ReactNode }) {
  return <li>{children}</li>
}

/** `**bold**` from the source markdown. */
export function Strong({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-fg-1">{children}</strong>
}

/** `*italic*` from the source markdown. */
export function Em({ children }: { children: ReactNode }) {
  return <em>{children}</em>
}

/** `` `inline code` `` from the source markdown. */
export function Code({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-xs bg-surface px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
  )
}

/**
 * A `` `local@address` `` from the source markdown, rendered as a working
 * mailto link with the visible address unchanged (permitted transformation
 * (d)).
 */
export function MailLink({ address }: { address: string }) {
  return (
    <a href={`mailto:${address}`} className={LINK_CLASS}>
      {address}
    </a>
  )
}

/**
 * A `PLACEHOLDER-*-URL` token from the source markdown, rendered as a
 * working link to the route the registry actually decided (permitted
 * transformation (c)). `children` is the visible link text — either the
 * markdown link's own text, or (for a bare token) the resolved route path
 * itself, matching `legal-fidelity.ts`'s comparison rule exactly.
 */
export function DocLink({ to, children }: { to: LegalSlug; children: ReactNode }) {
  return (
    <Link href={legalHref(to)} className={LINK_CLASS}>
      {children}
    </Link>
  )
}
